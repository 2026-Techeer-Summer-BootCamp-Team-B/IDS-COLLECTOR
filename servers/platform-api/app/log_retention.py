"""로그 보존 기간(hot/cold) 강제 - log_policies 테이블 값을 실제로 집행한다.

지금까지 data_policy_api.py는 log_policies 값을 저장/조회만 했지 아무도 읽어서
실제로 오래된 로그를 지우지 않았다(설정 화면은 진짜인데 뒤에 배관이 없는 상태).
이 모듈이 그 배관이다.

OpenSearch가 단일 노드 dev 구성이라 hot 노드/cold 노드를 실제로 분리하는 진짜
tiering(ISM 등)은 인프라상 불가능하다 - 그래서 "hot"과 "cold"는 서로 다른
저장소가 아니라 같은 attack-logs-* 인덱스에 계속 남아있는 논리적 구간일 뿐이고,
cold_days의 유일한 효과는 삭제 시점을 늦추는 것이다:

- archive_enabled=true  -> hot_days + cold_days가 지나야 삭제
- archive_enabled=false -> cold 구간을 건너뛰고 hot_days만 지나면 바로 삭제
  (cold_days 값은 무시)

layer(WAS/Falco/K8s Audit)는 사람이 읽는 계층 이름이고 실제 이벤트는
event.module(was/waf/falco/k8s_audit)로 구분되므로 _LAYER_MODULES로 매핑한다 -
"WAS" 레이어는 nginx 액세스 로그(was)와 WAF 알림(waf) 둘 다를 가리킨다(같은
타깃을 보호하는 같은 파이프라인 구간).

otel-logs-raw-*(포렌식 원본 사본)는 이 정책 대상이 아니다 - 의도적으로 그대로
둔다(항상 남는 원본이라는 계약, servers/datastore/opensearch/config/data-prepper/
pipelines.yaml 참고).
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from app.config import settings
from app.db import pool
from app.opensearch_client import client as opensearch_client

_LAYER_MODULES: Dict[str, List[str]] = {
    "WAS": ["was", "waf"],
    "Falco": ["falco"],
    "K8s Audit": ["k8s_audit"],
}

_DEFAULT_INTERVAL_SECONDS = 3600  # poll_intervals 행이 없는 극단적 상황(마이그레이션
# 누락 등)에 대비한 fail-open 기본값 - retention은 alert 폴링과 달리 지연돼도
# 사용자가 바로 체감하지 않으니 1시간으로 넉넉히 잡았다.


async def _current_interval_seconds() -> float:
    async with pool().acquire() as conn:
        value = await conn.fetchval(
            "SELECT seconds FROM poll_intervals WHERE key = 'log_retention_interval_seconds'"
        )
    return value if value is not None else _DEFAULT_INTERVAL_SECONDS


def _retention_days(hot_days: int, cold_days: int, archive_enabled: bool) -> int:
    return hot_days + cold_days if archive_enabled else hot_days


async def _enforce_retention() -> None:
    async with pool().acquire() as conn:
        policies = await conn.fetch(
            "SELECT layer, hot_days, cold_days, archive_enabled FROM log_policies"
        )

    now = datetime.now(timezone.utc)
    for policy in policies:
        modules = _LAYER_MODULES.get(policy["layer"])
        if not modules:
            # 스키마에 없는 레이어 이름 - 셋 다 고정 목록이라 정상 운영 중엔 안 일어남
            # (마이그레이션 오타 등 방어).
            continue

        cutoff = now - timedelta(
            days=_retention_days(policy["hot_days"], policy["cold_days"], policy["archive_enabled"])
        )
        result = await opensearch_client.delete_by_query(
            index=settings.attack_log_index_pattern,
            body={
                "query": {
                    "bool": {
                        "filter": [
                            {"terms": {"event.module": modules}},
                            {"range": {"@timestamp": {"lt": cutoff.isoformat()}}},
                        ]
                    }
                }
            },
            # 삭제 대상 문서가 삭제 진행 중에 다른 요청으로 갱신/삭제돼서 버전이
            # 어긋나도(예: 동시에 재색인) 그 문서만 건너뛰고 나머지는 계속 지운다 -
            # 기본값(abort)이면 흔한 동시성 충돌 하나로 그 사이클 전체가 실패한다.
            conflicts="proceed",
        )
        deleted = result.get("deleted", 0)
        if deleted:
            print(
                f"[platform-api] 보존기간 초과 로그 삭제: layer={policy['layer']} "
                f"cutoff={cutoff.isoformat()} deleted={deleted}건"
            )


async def poll_loop() -> None:
    while True:
        interval = _DEFAULT_INTERVAL_SECONDS
        try:
            await _enforce_retention()
            interval = await _current_interval_seconds()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[platform-api] 로그 보존기간 집행 실패, 다음 주기에 재시도: {e}")
        await asyncio.sleep(interval)
