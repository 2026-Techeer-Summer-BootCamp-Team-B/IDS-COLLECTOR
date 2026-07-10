"""Scenario API (/scenarios) [TBD] - 상관 시나리오 룰 조회/토글. YAML(correlation-engine의
scenarios.yaml) vs API 중 어느 쪽이 최종 관리 주체인지 미정 - 지금은 조회 + enabled
토글만 제공. sync_scenario_rules()가 enabled는 덮어쓰지 않으므로 토글은 유지되지만,
correlation-engine이 실제로 이 값을 평가에 반영하는지는 별도 확인 필요(스켈레톤)."""
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import pool

router = APIRouter(prefix="/scenarios", tags=["scenarios"])


class ScenarioOut(BaseModel):
    id: str
    name: str
    required_modules: List[str]
    correlation_key_type: str
    time_window_seconds: int
    min_severity: int
    enabled: bool
    mitre_technique_id: str | None


class EnabledUpdate(BaseModel):
    enabled: bool


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
    )


@router.get("", response_model=List[ScenarioOut])
async def list_scenarios():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, required_modules, correlation_key_type, time_window_seconds,
                   min_severity, enabled, mitre_technique_id
            FROM scenario_rules ORDER BY name
            """
        )
    return [_row_to_out(r) for r in rows]


@router.patch("/{scenario_id}/enabled", response_model=ScenarioOut)
async def set_enabled(scenario_id: str, body: EnabledUpdate):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE scenario_rules SET enabled = $2 WHERE id = $1
            RETURNING id, name, required_modules, correlation_key_type, time_window_seconds,
                      min_severity, enabled, mitre_technique_id
            """,
            scenario_id,
            body.enabled,
        )
    if not row:
        raise HTTPException(status_code=404, detail="scenario not found")
    return _row_to_out(row)
