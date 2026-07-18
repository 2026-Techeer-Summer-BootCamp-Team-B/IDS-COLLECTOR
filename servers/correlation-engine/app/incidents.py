"""인시던트 생명주기 (P4-4). datastore/postgres/init/001-schema.sql의
scenario_rules/incidents/incident_events 참고.

발화 -> incidents insert(open). 동일 시나리오(matched_scenario_rule_id)+상관키
(correlation_key_value)로 이미 open 또는 investigating인(=아직 해결 안 된)
인시던트가 있으면 새로 만들지 않고 incident_events에 이벤트만 추가한다 -
"조사중"은 분석가가 보고 있을 뿐 미해결 상태라 open과 동일하게 취급해야
한다(2026-07-15, datastore/postgres/init/015-incidents-active-dedup.sql에서
바로잡음 - 이전엔 open만 병합 대상이라 조사중인 인시던트에 같은 공격이 또
들어오면 매번 새 인시던트가 생겼다). closed(=해결 완료)로 넘어간 뒤 같은
공격이 다시 들어오면 그건 별개의 새 인시던트가 맞다.
idx_incidents_active_dedup unique index가 이 규칙을 DB 레벨에서도 강제한다.
"""
import asyncio
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import asyncpg

from app.config import settings

_pool: Optional[asyncpg.Pool] = None

# join_on=user_or_sa 시나리오(S1/S3/S14/S15/S16 등 pod 생성이 얽힌 것들)는 join_key로
# event.user.name을 그대로 쓰는데, Deployment/DaemonSet/StatefulSet/Job을 통해 만들어진
# pod의 실제 create 요청자는 항상 그 리소스를 만든 사람이 아니라 kube-system의 내장
# 컨트롤러(replicaset-controller 등)로 찍힌다 - k3d-audit-policy.yaml이 deployments류의
# request body(pod template)를 아예 안 남겨서(catch-all Metadata 레벨) normalizer가
# "누가 이 Deployment를 만들었는지"를 볼 방법이 없기 때문(실측 확인, 2026-07-17
# event-generator k8saudit 테스트에서 S16 join_key가 전부
# system:serviceaccount:kube-system:replicaset-controller로 찍힘). 근본 수정은 감사
# 정책/normalizer/시나리오 3곳을 다 고쳐야 하는 큰 작업이라, 우선 인시던트 제목에
# 귀속이 불확실하다는 걸 눈에 띄게 표시해서 분석가가 "범인은 replicaset-controller"로
# 오해하지 않게만 한다.
_K8S_POD_CONTROLLER_IDENTITY_RE = re.compile(
    r"^system:serviceaccount:kube-system:[\w-]*-controller$"
)


async def start() -> None:
    """asyncpg.create_pool은 min_size만큼 연결을 즉시 맺으려 하므로, Postgres가 아직
    안 뜬 상태로 기동하면 그 자리에서 예외가 난다 - Kafka 컨슈머와 동일한 재시도
    루프로 기동 순서 경쟁을 흡수한다."""
    global _pool
    while True:
        try:
            _pool = await asyncpg.create_pool(dsn=settings.postgres_dsn)
            break
        except Exception as e:
            print(f"[correlation] Postgres 연결 실패, 3초 후 재시도: {e}")
            await asyncio.sleep(3)


async def stop() -> None:
    if _pool:
        await _pool.close()


async def sync_scenario_rules(scenarios: List[Dict[str, Any]]) -> None:
    """app/scenarios/*.yaml을 scenario_rules 테이블에 반영 (YAML이 source of truth, PG는
    API 조회/감사용 캐시). incidents.matched_scenario_rule_id가 이 테이블을 FK로
    참조하므로, 엔진이 뜰 때 이 sync가 먼저 끝나야 인시던트 upsert가 성공한다."""
    assert _pool is not None, "incidents.start()를 먼저 호출해야 함"
    async with _pool.acquire() as conn:
        for scenario in scenarios:
            await conn.execute(
                """
                INSERT INTO scenario_rules
                    (id, name, required_modules, correlation_key_type, time_window_seconds,
                     min_severity, enabled, mitre_technique_id)
                VALUES ($1, $2, $3, $4, $5, $6, true, $7)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    required_modules = EXCLUDED.required_modules,
                    correlation_key_type = EXCLUDED.correlation_key_type,
                    time_window_seconds = EXCLUDED.time_window_seconds,
                    min_severity = EXCLUDED.min_severity,
                    mitre_technique_id = EXCLUDED.mitre_technique_id
                """,
                scenario["db_id"],
                scenario["name"],
                scenario["required_modules"],
                scenario["correlation_key_type"],
                scenario["window_seconds"],
                # scenario_rules.min_severity 컬럼(스키마명은 유지)에는 YAML의
                # "min_severity" 키가 아니라 "severity"(발화 시 실제 부여되는
                # 심각도, app/rules.py의 scenario.get("severity", 1)과 동일 값)를
                # 채운다 - 8개 scenarios/*.yaml 전체가 top-level min_severity 키를
                # 쓰지 않아(S5 stage1 매치 조건에만 중첩 사용) 예전 코드는 항상
                # 기본값 1만 저장했다(감사 D5, docs/reports/repo-audit-20260715.md).
                # sync_scenario_rules는 매 재로드(_scenario_reload_loop, 30초 주기)마다
                # ON CONFLICT UPDATE로 다시 쓰므로, 이미 잘못 저장된 기존 25개 행도
                # 이 코드가 반영된 채로 재시작(또는 다음 재로드 주기)하면 자동으로
                # 바로잡힌다 - 별도 수동 SQL 불필요.
                scenario.get("severity", 1),
                scenario.get("mitre_technique_id"),
            )


async def fetch_enabled_map() -> Dict[str, bool]:
    """scenario_rules.enabled의 현재 Postgres 값을 {db_id: enabled}로 반환.
    엔진 기동 시 이 값으로 Redis의 scenario:enabled:{id} 키를 시드해서(app/main.py),
    platform-api의 PATCH /scenarios/{id}/enabled 토글이 재시작 후에도(Redis가
    비어있더라도) Postgres 기준으로 자가 복구되게 한다."""
    assert _pool is not None, "incidents.start()를 먼저 호출해야 함"
    async with _pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, enabled FROM scenario_rules")
    return {str(row["id"]): row["enabled"] for row in rows}


async def fetch_active_allow_list() -> List[Dict[str, Optional[str]]]:
    """만료되지 않은 allow_list 전체를 [{ip_or_cidr, target_name}] 형태로 반환.
    app/main.py가 주기적으로 호출해서 ScenarioEngine.set_allow_list()에 반영한다
    (매 이벤트마다 DB를 치면 안 되니 폴링+캐시). target_id는 allow_list 테이블의
    FK일 뿐이고 이벤트 쪽(NormalizedEvent)은 target_id가 아니라 target_name을
    들고 있으므로(정규화 단계에서 UUID 조회 없이 그대로 전파, normalizer/app/
    normalizer.py 참고) targets와 JOIN해서 이름으로 변환해둔다. 전역 항목은
    target_name이 None으로 나가고, rules.py의 _is_allow_listed()가 이걸 "모든
    타깃에 적용"으로 해석한다."""
    assert _pool is not None, "incidents.start()를 먼저 호출해야 함"
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT a.ip_or_cidr, t.name AS target_name
            FROM allow_list a
            LEFT JOIN targets t ON t.id = a.target_id
            WHERE a.expires_at IS NULL OR a.expires_at > now()
            """
        )
    # ip_or_cidr은 019-db-hardening.sql부터 inet 컬럼이라 asyncpg가 문자열이 아니라
    # ipaddress.IPv4Interface/IPv6Interface 객체로 돌려준다 - rules.py의
    # set_allow_list()가 ipaddress.ip_network(entry["ip_or_cidr"], ...)로 다시
    # 파싱하는데, ip_network()는 그 객체 타입을 못 받아들여 ValueError로 조용히
    # 건너뛴다(=allow_list 집행 자체가 조용히 전부 무효화됨) - str()로 감싸서
    # 이전과 동일하게 문자열로 넘긴다.
    return [
        {"ip_or_cidr": str(row["ip_or_cidr"]), "target_name": row["target_name"]} for row in rows
    ]


async def fetch_poll_interval_seconds(key: str, default: int) -> int:
    """poll_intervals 테이블(datastore/postgres/init/013-poll-intervals.sql,
    platform-api의 GET/PATCH /poll-intervals API로 admin이 조절)에서 폴링 주기를
    읽는다. app/main.py의 _allow_list_refresh_loop가 매 반복마다 다시 불러서
    재시작 없이 바로 반영한다(2026-07-15). 행이 없으면(마이그레이션 누락 등)
    default로 fail-open."""
    assert _pool is not None, "incidents.start()를 먼저 호출해야 함"
    async with _pool.acquire() as conn:
        value = await conn.fetchval("SELECT seconds FROM poll_intervals WHERE key = $1", key)
    return value if value is not None else default


async def upsert_incident(
    scenario_db_id: str,
    scenario_name: str,
    correlation_key_type: str,
    join_key: str,
    severity: int,
    mitre_tactics: List[str],
    events: List[Dict[str, str]],
) -> Dict[str, Any]:
    assert _pool is not None, "incidents.start()를 먼저 호출해야 함"
    now = datetime.now(timezone.utc)

    async with _pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchrow(
                """
                SELECT id FROM incidents
                WHERE matched_scenario_rule_id = $1 AND correlation_key_value = $2
                      AND status IN ('open', 'investigating')
                FOR UPDATE
                """,
                scenario_db_id,
                join_key,
            )

            if existing:
                incident_id = existing["id"]
                await conn.execute(
                    "UPDATE incidents SET updated_at = $2, severity = GREATEST(severity, $3) WHERE id = $1",
                    incident_id,
                    now,
                    severity,
                )
            else:
                title = f"{scenario_name} - {join_key}"
                if correlation_key_type == "user.name" and _K8S_POD_CONTROLLER_IDENTITY_RE.match(join_key):
                    title += " (⚠ 컨트롤러 경유 생성 - 실제 생성자는 Deployment/DaemonSet/Job 등 상위 리소스 이력 확인 필요)"
                row = await conn.fetchrow(
                    """
                    INSERT INTO incidents
                        (title, correlation_key_type, correlation_key_value, severity,
                         matched_scenario_rule_id, mitre_tactics, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
                    RETURNING id
                    """,
                    title,
                    correlation_key_type,
                    join_key,
                    severity,
                    scenario_db_id,
                    mitre_tactics,
                    now,
                )
                incident_id = row["id"]

            for e in events:
                await conn.execute(
                    """
                    INSERT INTO incident_events (incident_id, event_id, event_module, added_at)
                    VALUES ($1, $2, $3, $4)
                    """,
                    incident_id,
                    e["event_id"],
                    e["event_module"],
                    now,
                )

            result = await conn.fetchrow(
                """
                SELECT id, title, correlation_key_type, correlation_key_value, severity,
                       status, matched_scenario_rule_id, mitre_tactics, created_at, updated_at
                FROM incidents WHERE id = $1
                """,
                incident_id,
            )
    return dict(result)
