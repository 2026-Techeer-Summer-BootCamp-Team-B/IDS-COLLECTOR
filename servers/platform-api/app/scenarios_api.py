"""Scenario API (/scenarios) - 상관 시나리오 룰 조회/토글. YAML(correlation-engine의
app/scenarios/*.yaml)이 정의의 source of truth고, Postgres scenario_rules는
API 조회/감사용 캐시(sync_scenario_rules()가 enabled는 덮어쓰지 않아 토글이
유지된다).

correlation-engine은 매 이벤트마다 Postgres를 때리지 않고 Redis 키
scenario:enabled:{id}를 본다(correlation-engine/app/rules.py
ScenarioEngine.evaluate() 참고) - 그래서 여기서 Postgres를 바꾼 직후 같은 값을
Redis에도 SET해서 즉시 반영시킨다. Redis SET이 실패해도 API 응답은 Postgres
UPDATE 성공 기준으로 그대로 나간다 - correlation-engine이 재시작할 때마다
Postgres 값으로 Redis를 다시 시드하므로(app/main.py) 최악의 경우도 다음 재시작
때 자동 복구된다."""
from typing import Any, Dict, List, Optional

import redis.asyncio as redis
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.config import settings
from app.db import pool

router = APIRouter(prefix="/scenarios", tags=["scenarios"])

_redis = redis.from_url(settings.redis_url, decode_responses=True)


async def _set_enabled_flag(scenario_id: str, enabled: bool) -> None:
    try:
        await _redis.set(f"scenario:enabled:{scenario_id}", "1" if enabled else "0")
    except Exception as e:
        print(f"[platform-api] scenario enabled Redis 반영 실패({scenario_id}): {e}")


class ScenarioOut(BaseModel):
    id: str
    name: str
    required_modules: List[str]
    correlation_key_type: str
    time_window_seconds: int
    min_severity: int
    enabled: bool
    mitre_technique_id: str | None
    hit_count: int


class EnabledUpdate(BaseModel):
    enabled: bool


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _row_to_out(row) -> ScenarioOut:
    return ScenarioOut(
        id=str(row["id"]),
        name=row["name"],
        required_modules=row["required_modules"],
        correlation_key_type=row["correlation_key_type"],
        time_window_seconds=row["time_window_seconds"],
        min_severity=row["min_severity"],
        enabled=row["enabled"],
        mitre_technique_id=row["mitre_technique_id"],
        hit_count=row["hit_count"],
    )


@router.get("", response_model=List[ScenarioOut])
async def list_scenarios():
    """룰별 적중 랭킹(Admin/Audit 탭)용으로 incidents를 매칭된 scenario별로 집계한
    hit_count를 같이 내려준다 - 발화된 적 없는 시나리오는 0으로 나온다."""
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT sr.id, sr.name, sr.required_modules, sr.correlation_key_type,
                   sr.time_window_seconds, sr.min_severity, sr.enabled, sr.mitre_technique_id,
                   COALESCE(ic.hit_count, 0) AS hit_count
            FROM scenario_rules sr
            LEFT JOIN (
                SELECT matched_scenario_rule_id, count(*) AS hit_count
                FROM incidents
                GROUP BY matched_scenario_rule_id
            ) ic ON ic.matched_scenario_rule_id = sr.id
            ORDER BY hit_count DESC, sr.name
            """
        )
    return [_row_to_out(r) for r in rows]


@router.patch("/{scenario_id}/enabled", response_model=ScenarioOut)
async def set_enabled(scenario_id: str, body: EnabledUpdate, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE scenario_rules SET enabled = $2 WHERE id = $1
            RETURNING id, name, required_modules, correlation_key_type, time_window_seconds,
                      min_severity, enabled, mitre_technique_id,
                      (SELECT count(*) FROM incidents WHERE matched_scenario_rule_id = $1) AS hit_count
            """,
            scenario_id,
            body.enabled,
        )
    if not row:
        raise HTTPException(status_code=404, detail="scenario not found")
    await _set_enabled_flag(scenario_id, body.enabled)
    await record_action(
        "RULE_ENABLED" if body.enabled else "RULE_DISABLED", "scenario_rules", _client_ip(request)
    )
    return _row_to_out(row)
