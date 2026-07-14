"""인시던트 생명주기 (P4-4). datastore/postgres/init/001-schema.sql의
scenario_rules/incidents/incident_events 참고.

발화 -> incidents insert(open). 동일 시나리오(matched_scenario_rule_id)+상관키
(correlation_key_value)로 이미 open인 인시던트가 있으면 새로 만들지 않고
incident_events에 이벤트만 추가한다 - idx_incidents_open_dedup unique index가
이 규칙을 DB 레벨에서도 강제한다.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import asyncpg

from app.config import settings

_pool: Optional[asyncpg.Pool] = None


async def start() -> None:
    global _pool
    _pool = await asyncpg.create_pool(dsn=settings.postgres_dsn)


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
                scenario.get("min_severity", 1),
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
    return [{"ip_or_cidr": row["ip_or_cidr"], "target_name": row["target_name"]} for row in rows]


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
                WHERE matched_scenario_rule_id = $1 AND correlation_key_value = $2 AND status = 'open'
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
