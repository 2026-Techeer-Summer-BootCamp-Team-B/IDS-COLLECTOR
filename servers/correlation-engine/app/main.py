"""
상관분석 엔진 서비스 (P4).

events.normalized를 실시간 소비 -> 시나리오 룰 평가(threshold/sequence, app/rules.py) ->
발화 시 인시던트 upsert(PG, app/incidents.py)만 한다. 예전엔 여기서 Redis pub/sub
(incidents:events)도 같이 발행해서 platform-api의 WebSocket 릴레이 + Slack/Discord
알림을 트리거했는데, 2026-07-13부로 platform-api가 그 자리를 incidents.notified_at
폴링(app/incident_alerts.py)으로 대체하면서 이 서비스는 Postgres에 쓰기만 하면
할 일이 끝나는 쪽으로 단순해졌다.

시나리오 정의는 app/scenarios/ 디렉터리 밑의 *.yaml 파일들(카테고리별로 분리,
app/scenarios/README.md 참고)에서 로드한다 - falcosecurity/plugins의 실제 K8s
audit 룰에 근거한 설계다(예시가 아님).

기동 순서 경쟁: app/incidents.py의 Postgres 연결은 이 서비스가 아직 안 떴을 때
기동하면 실패할 수 있어서 Kafka 컨슈머와 동일하게 재시도 루프로 감싸져 있다.
/health는 백그라운드 컨슈머 태스크(_consumer_task)가 죽었으면 503을 반환한다 -
프로세스는 살아있는데 컨슈머만 죽어서 상관분석이 조용히 멈추는 걸 감지하기 위함
(servers/docker-compose.yml의 healthcheck가 이 엔드포인트를 주기 폴링).

실행 방법 (컨테이너):
    servers/docker-compose.yml에 포함되어 있음 - 저장소 루트에서 `make up`
    (또는 `docker compose -f servers/docker-compose.yml up -d --build`)으로 기동.
"""
import asyncio
import contextlib
import uuid
from pathlib import Path
from typing import Optional

import redis.asyncio as redis
import yaml
from aiokafka import AIOKafkaConsumer
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app import incidents
from app.config import settings
from app.rules import ScenarioEngine
from ids_shared import mitre_mapping
from ids_shared.schemas import NormalizedEvent

app = FastAPI(title="IDS Correlation Engine")

_consumer: Optional[AIOKafkaConsumer] = None
_consumer_task: Optional[asyncio.Task] = None
_engine: Optional[ScenarioEngine] = None
_redis: Optional["redis.Redis"] = None
_allow_list_task: Optional[asyncio.Task] = None
_ALLOW_LIST_REFRESH_SECONDS = 30  # poll_intervals 테이블에 행이 없을 때의 fail-open 기본값
_scenario_reload_task: Optional[asyncio.Task] = None
_SCENARIO_RELOAD_SECONDS = 30  # poll_intervals 테이블에 행이 없을 때의 fail-open 기본값
_MAX_EVAL_ATTEMPTS = 3  # 상관분석/인시던트 upsert 재시도 상한 (아래 _evaluate_and_upsert 참고)
_EVAL_RETRY_BACKOFF_BASE_SECONDS = 1.0  # 지수 백오프 밑변 - 1s -> 2s -> 4s
# (platform-api/app/notifications.py의 _post_webhook 재시도와 동일 패턴, 감사
# O3 보강분: 총 대기시간(1+2=3s, 마지막 시도는 대기 없음)은 aiokafka 기본
# max_poll_interval_ms(5분)에 비해 무시할 수준이라 컨슈머 세션 타임아웃 위험 없음)

# 연속 드롭 카운터(2026-07-21) - 재시도를 3회 다 소진해 이벤트를 건너뛰어도
# _consumer.commit()은 그대로 호출돼 오프셋이 확정된다. 예전엔 이 경로가 /health에
# 전혀 반영되지 않아서, Redis/Postgres 장애가 지속되는 동안 이벤트마다 조용히
# 버려지는데도(=상관분석이 사실상 완전히 멈췄는데도) 컨슈머 태스크 자체는 안
# 죽으니 /health가 계속 200/ok를 반환했다. 성공할 때마다 0으로 리셋하고, 연속
# _UNHEALTHY_CONSECUTIVE_DROPS건 이상 실패하면 /health가 503을 반환한다 - 딱
# 1건 실패(진짜 poison pill 이벤트 하나)는 기존 설계대로 정상 운영으로 보고
# 넘어가되(재시도 소진 후 스킵은 poison pill이 파티션을 영구히 막는 걸 막기 위한
# 의도된 동작), 장애로 인한 "연속" 드롭만 잡아낸다.
_consecutive_drop_count = 0
_last_drop_error: Optional[str] = None
_UNHEALTHY_CONSECUTIVE_DROPS = 5


def _load_scenarios() -> list:
    """scenarios_config_path 디렉터리 밑의 *.yaml 파일을 전부 읽어서 하나의 목록으로
    합친다 - 카테고리별로 파일을 나눈 건 순전히 가독성 때문이고(app/scenarios/README.md
    참고) 엔진 입장에서는 파일이 몇 개든 차이가 없다. 파일 이름 순으로 정렬해서
    읽으므로 로드 순서(=평가 순서)는 결정적이다."""
    path = Path(settings.scenarios_config_path)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent / path

    scenarios: list = []
    seen_ids: dict = {}
    for yaml_path in sorted(path.glob("*.yaml")):
        with open(yaml_path, "r", encoding="utf-8") as f:
            file_scenarios = yaml.safe_load(f)["scenarios"]
        for scenario in file_scenarios:
            dup_source = seen_ids.get(scenario["id"])
            assert dup_source is None, (
                f"시나리오 id 중복: {scenario['id']} ({dup_source.name}, {yaml_path.name})"
            )
            seen_ids[scenario["id"]] = yaml_path
        scenarios.extend(file_scenarios)

    # scenario_rules.id는 PostgreSQL UUID 컬럼이라, YAML의 사람이 읽는 코드(S1/S2/...)를
    # 결정적으로 UUID로 변환해서 db_id에 얹는다 - 같은 코드는 재시작해도 항상 같은
    # UUID가 나오므로 sync_scenario_rules가 매번 같은 행을 덮어쓴다(중복 insert 없음).
    for scenario in scenarios:
        scenario["db_id"] = str(uuid.uuid5(uuid.NAMESPACE_OID, f"scenario:{scenario['id']}"))
    return scenarios


async def _allow_list_refresh_loop():
    """allow_list(전역 항목)를 주기적으로 Postgres에서 다시 읽어 ScenarioEngine
    캐시에 반영한다 - 매 이벤트마다 DB를 치면 상관분석 hot path에 지연이 그대로
    더해지니 폴링+캐시로 뺐다(incidents.fetch_active_allow_list() 참고).
    관리자가 allow_list에 새 항목을 추가/삭제해도 최대 이 주기만큼만 지나면
    반영된다 - 즉시 반영이 필요해지면 나중에 Redis pub/sub 등으로 바꿀 것.

    주기 자체도 poll_intervals 테이블(platform-api GET/PATCH /poll-intervals)에서
    매 반복마다 다시 읽는다(2026-07-15, 이전엔 코드에 아예 하드코딩돼 있어서 env var로도
    못 바꿨음) - admin이 API로 바꾸면 재시작 없이 다음 반복부터 반영된다.

    interval 조회도 같은 try/except 안에서 한다 - platform-api의
    incident_alerts.py에서 실제로 겪은 사고(interval 조회 실패가 안 잡히고
    poll_loop 태스크 자체가 조용히 죽어서 /health가 영구히 503을 낸 사고)를
    여기서 반복하지 않기 위함(2026-07-14)."""
    global _engine
    # 2026-07-15 버그 수정: fetch_poll_interval_seconds() 호출이 try/except 밖에
    # 있어서 poll_intervals 테이블이 없는 배포 직후 같은 상황에서 예외가 나면
    # 잡히지 않고 이 while 루프 전체(태스크)가 죽었다 - platform-api의 같은
    # 패턴 버그(app/incident_alerts.py)가 /health 영구 503 -> Traefik이 API
    # 라우팅을 통째로 내려버리는 장애로 이어진 걸 실측 확인해서, 여기도 같이
    # try/except 안으로 옮겨 방어.
    while True:
        interval = _ALLOW_LIST_REFRESH_SECONDS
        try:
            entries = await incidents.fetch_active_allow_list()
            if _engine is not None:
                _engine.set_allow_list(entries)
            interval = await incidents.fetch_poll_interval_seconds(
                "allow_list_refresh_seconds", _ALLOW_LIST_REFRESH_SECONDS
            )
        except Exception as e:
            print(f"[correlation] allow_list 갱신 실패: {e}")
        await asyncio.sleep(interval)


async def _scenario_reload_loop():
    """app/scenarios/*.yaml을 주기적으로 다시 읽어 ScenarioEngine에 반영한다 -
    예전엔 _consume_loop 기동 시 딱 한 번만 로드해서 시나리오를 추가/수정하려면
    correlation-engine을 재배포해야 했다(2026-07-15, _allow_list_refresh_loop와
    같은 폴링+캐시 패턴).

    새로 읽은 목록은 scenario_rules(Postgres)에도 sync해서(sync_scenario_rules)
    admin 화면(GET/PATCH /scenarios)이 새로 추가된 시나리오도 바로 보고 토글할
    수 있게 한다 - sync_scenario_rules의 UPSERT는 enabled 컬럼을 건드리지 않으므로
    (ON CONFLICT UPDATE에 없음) admin이 이미 꺼둔 기존 룰은 YAML을 다시 읽어도
    계속 꺼진 채로 남는다. 새로 추가된 시나리오는 Redis에 scenario:enabled:{id}
    키가 아직 없어 evaluate()의 fail-open 기본값(키 없음=활성)으로 시작한다.

    interval 조회도 같은 try/except 안에서 한다 - _allow_list_refresh_loop와
    동일한 이유(poll_intervals 조회 실패가 안 잡히면 이 태스크 자체가 조용히
    죽는 사고를 반복하지 않기 위함)."""
    global _engine
    while True:
        interval = _SCENARIO_RELOAD_SECONDS
        try:
            scenarios = _load_scenarios()
            if _engine is not None:
                _engine.set_scenarios(scenarios)
            await incidents.sync_scenario_rules(scenarios)
            interval = await incidents.fetch_poll_interval_seconds(
                "scenario_reload_seconds", _SCENARIO_RELOAD_SECONDS
            )
        except Exception as e:
            print(f"[correlation] 시나리오 재로드 실패: {e}")
        await asyncio.sleep(interval)


async def _evaluate_and_upsert(event: NormalizedEvent) -> None:
    assert _engine is not None  # _consume_loop이 컨슈머 루프 진입 전에 이미 초기화해둠
    fired = await _engine.evaluate(event)
    for f in fired:
        await incidents.upsert_incident(
            f["scenario_db_id"],
            f["scenario_name"],
            f["correlation_key_type"],
            f["join_key"],
            f["severity"],
            mitre_mapping.tactics_for_technique(f["mitre_technique_id"]),
            f["events"],
        )
        print(
            f"[correlation] 인시던트 발화 - {f['scenario_name']} "
            f"join_key={f['join_key']}"
        )


async def _consume_loop():
    global _consumer, _engine, _redis, _allow_list_task, _scenario_reload_task
    global _consecutive_drop_count, _last_drop_error

    _redis = redis.from_url(settings.redis_url, decode_responses=True)
    scenarios = _load_scenarios()
    _engine = ScenarioEngine(scenarios, _redis)

    _consumer = AIOKafkaConsumer(
        settings.kafka_normalized_topic,
        bootstrap_servers=settings.kafka_brokers,
        group_id=settings.kafka_consumer_group,
        enable_auto_commit=False,
    )

    while True:
        try:
            await _consumer.start()
            break
        except Exception as e:
            print(f"[correlation] Kafka 연결 실패, 3초 후 재시도: {e}")
            await asyncio.sleep(3)

    await incidents.start()
    await incidents.sync_scenario_rules(scenarios)
    _allow_list_task = asyncio.create_task(_allow_list_refresh_loop())
    _scenario_reload_task = asyncio.create_task(_scenario_reload_loop())

    # platform-api의 PATCH /scenarios/{id}/enabled 토글은 Redis 키
    # scenario:enabled:{id}로 실시간 반영된다(ScenarioEngine.evaluate() 참고) -
    # 엔진이 뜰 때마다 Postgres의 현재 값으로 그 키들을 다시 시드해서, Redis가
    # 재시작/플러시돼 토글 상태를 잃어버려도 Postgres 기준으로 자가 복구되게 한다.
    enabled_map = await incidents.fetch_enabled_map()
    for scenario in scenarios:
        enabled = enabled_map.get(scenario["db_id"], True)
        await _redis.set(f"scenario:enabled:{scenario['db_id']}", "1" if enabled else "0")

    print(f"[correlation] 시작 - topic={settings.kafka_normalized_topic}")

    try:
        async for msg in _consumer:
            try:
                event = NormalizedEvent.model_validate_json(msg.value)
            except Exception as e:
                print(f"[correlation] 이벤트 파싱 실패, 스킵: {e}")
                await _consumer.commit()
                continue

            # evaluate/upsert는 Redis(카운터/쿨다운)와 Postgres(incidents) 둘 다
            # 건드리는데, 예전엔 여기 아무 try/except가 없어서 순간적인 커넥션
            # 오류 하나가 이 async for 루프 전체를 죽였다 - asyncio.CancelledError만
            # 잡는 바깥 except로는 안 걸러지고, Docker healthcheck가 unhealthy를
            # 감지해도 프로세스 자체는 안 죽어서(restart: unless-stopped는 종료 시에만
            # 작동) 사람이 눈치채고 수동 재시작할 때까지 상관분석이 영구히 멈췄다
            # (2026-07-15 실측 확인 후 수정). 짧은 재시도로 일시적 장애는 흡수하고,
            # 그래도 안 되면(결정적 실패) 이 이벤트 하나만 건너뛰고 계속 진행한다 -
            # 재시도 없이 그냥 무시하면 poison pill 하나가 이 파티션을 영원히
            # 막을 위험도 같이 없앤다.
            for attempt in range(1, _MAX_EVAL_ATTEMPTS + 1):
                try:
                    await _evaluate_and_upsert(event)
                    _consecutive_drop_count = 0
                    break
                except Exception as e:
                    if attempt < _MAX_EVAL_ATTEMPTS:
                        backoff = _EVAL_RETRY_BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
                        print(
                            f"[correlation] WARN: 상관분석/인시던트 upsert 실패 "
                            f"({attempt}/{_MAX_EVAL_ATTEMPTS}회, event.id={event.event_id}), "
                            f"{backoff:.0f}초 후 재시도: {e}"
                        )
                        await asyncio.sleep(backoff)
                    else:
                        _consecutive_drop_count += 1
                        _last_drop_error = str(e)
                        print(
                            f"[correlation] ERROR: 상관분석/인시던트 upsert 실패, "
                            f"{_MAX_EVAL_ATTEMPTS}회 재시도 소진 - event.id={event.event_id} "
                            f"이벤트는 건너뜀 (연속 드롭 {_consecutive_drop_count}건째): {e}"
                        )

            await _consumer.commit()
    except asyncio.CancelledError:
        raise
    finally:
        if _allow_list_task:
            _allow_list_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await _allow_list_task
        if _scenario_reload_task:
            _scenario_reload_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await _scenario_reload_task
        await incidents.stop()
        await _consumer.stop()


def _log_task_exception(task: "asyncio.Task") -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        return
    import traceback

    traceback.print_exception(type(exc), exc, exc.__traceback__)


@app.on_event("startup")
async def on_startup():
    global _consumer_task
    _consumer_task = asyncio.create_task(_consume_loop())
    _consumer_task.add_done_callback(_log_task_exception)


@app.on_event("shutdown")
async def on_shutdown():
    if _consumer_task:
        _consumer_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _consumer_task


def _dead_task_reason() -> Optional[str]:
    """백그라운드 컨슈머 태스크가 살아있지 않은 이유(있으면) - /health가 503을
    반환할지 판단하는 근거. None이면 정상."""
    if _consumer_task is None:
        return "consumer task not started"
    if _consumer_task.done():
        return "consumer task exited"
    return None


def _unhealthy_reason() -> Optional[str]:
    """/health가 503을 반환할지 판단하는 근거 전체 - 컨슈머 태스크가 죽은 경우뿐
    아니라, 태스크는 살아있지만 Redis/Postgres 장애로 이벤트가 연속으로 조용히
    버려지는 중인 경우도 여기서 잡는다(_consecutive_drop_count, 위 상수 설명
    참고). None이면 정상."""
    dead = _dead_task_reason()
    if dead:
        return dead
    if _consecutive_drop_count >= _UNHEALTHY_CONSECUTIVE_DROPS:
        return (
            f"{_consecutive_drop_count}건 연속으로 상관분석/인시던트 upsert가 재시도 "
            f"소진 후 스킵됨 (최근 오류: {_last_drop_error}) - Redis/Postgres 장애로 "
            "상관분석이 조용히 멈췄을 가능성"
        )
    return None


@app.get("/health")
def health_check():
    reason = _unhealthy_reason()
    if reason:
        return JSONResponse(status_code=503, content={"status": "unhealthy", "reason": reason})
    return {"status": "ok"}


@app.get("/debug/missing-join-count")
def missing_join_count():
    """P7-3 파이프라인 헬스 뷰 참고용 join 결측 카운터.
    지금은 in-memory라 재시작하면 0으로 리셋된다 - 영속시키려면 Redis INCR로 바꿀 것."""
    return {"missing_join_count": _engine.missing_join_count if _engine else 0}
