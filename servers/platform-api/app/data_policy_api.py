"""데이터 정책 API (/log-policies, /exclusion-rules) - 로그 보존/샘플링 + 제외 규칙.

dashboard/src/data/logPolicy.js의 INITIAL_LOG_POLICIES/INITIAL_EXCLUSION_RULES가
지금까지 프론트 로컬 mock state로만 존재했던 걸 실제 테이블(datastore/postgres/init/
013-data-policy.sql)로 옮긴 것. 아직 프론트(App.jsx)는 이 API를 안 쓰고 mock 그대로다 -
연동은 별도 작업.

record_action(record_id=...)는 여기서 안 쓴다 - log_policies/exclusion_rules 둘 다
PK가 UUID가 아니라 사람이 읽는 문자열(layer 이름, "EX-01" 등)이라 audit_logs.record_id
컬럼(UUID) 타입에 안 맞는다. 테이블 종류가 몇 개뿐인 고정 목록이라 target_table만으로도
행 식별에 충분하다고 보고 생략함."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


# --- 로그 보존/샘플링 정책 (계층 3개 고정 - 생성/삭제 없이 PATCH로 값만 바꿈) ---

router_log_policies = APIRouter(prefix="/log-policies", tags=["data-policy"])


class LogPolicyOut(BaseModel):
    layer: str
    hot_days: int
    cold_days: int
    sampling_rate: int
    archive_enabled: bool


class LogPolicyPatch(BaseModel):
    hot_days: Optional[int] = None
    cold_days: Optional[int] = None
    sampling_rate: Optional[int] = None
    archive_enabled: Optional[bool] = None


def _row_to_log_policy(row) -> LogPolicyOut:
    return LogPolicyOut(
        layer=row["layer"],
        hot_days=row["hot_days"],
        cold_days=row["cold_days"],
        sampling_rate=row["sampling_rate"],
        archive_enabled=row["archive_enabled"],
    )


@router_log_policies.get("", response_model=List[LogPolicyOut])
async def list_log_policies():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT layer, hot_days, cold_days, sampling_rate, archive_enabled "
            "FROM log_policies ORDER BY layer"
        )
    return [_row_to_log_policy(r) for r in rows]


@router_log_policies.patch("/{layer}", response_model=LogPolicyOut)
async def update_log_policy(layer: str, body: LogPolicyPatch, request: Request):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")

    set_clauses = ", ".join(f"{key} = ${i + 2}" for i, key in enumerate(fields))
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            f"""
            UPDATE log_policies SET {set_clauses}, updated_at = now()
            WHERE layer = $1
            RETURNING layer, hot_days, cold_days, sampling_rate, archive_enabled
            """,
            layer,
            *fields.values(),
        )
    if not row:
        raise HTTPException(status_code=404, detail="log policy not found")
    await record_action(
        "LOG_POLICY_UPDATED", "log_policies", _client_ip(request), user_id=current_user_id(request)
    )
    return _row_to_log_policy(row)


# --- 제외 규칙 (목록 + on/off 토글만 - 생성/삭제 API는 프론트에 해당 UI가 없어서 범위 밖) ---

router_exclusion_rules = APIRouter(prefix="/exclusion-rules", tags=["data-policy"])


class ExclusionRuleOut(BaseModel):
    id: str
    layer: str
    pattern: str
    reason: Optional[str]
    estimated_reduction_pct: int
    enabled: bool


class EnabledUpdate(BaseModel):
    enabled: bool


def _row_to_exclusion_rule(row) -> ExclusionRuleOut:
    return ExclusionRuleOut(
        id=row["id"],
        layer=row["layer"],
        pattern=row["pattern"],
        reason=row["reason"],
        estimated_reduction_pct=row["estimated_reduction_pct"],
        enabled=row["enabled"],
    )


@router_exclusion_rules.get("", response_model=List[ExclusionRuleOut])
async def list_exclusion_rules():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, layer, pattern, reason, estimated_reduction_pct, enabled
            FROM exclusion_rules ORDER BY id
            """
        )
    return [_row_to_exclusion_rule(r) for r in rows]


@router_exclusion_rules.patch("/{rule_id}/enabled", response_model=ExclusionRuleOut)
async def set_exclusion_rule_enabled(rule_id: str, body: EnabledUpdate, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE exclusion_rules SET enabled = $2, updated_at = now()
            WHERE id = $1
            RETURNING id, layer, pattern, reason, estimated_reduction_pct, enabled
            """,
            rule_id,
            body.enabled,
        )
    if not row:
        raise HTTPException(status_code=404, detail="exclusion rule not found")
    await record_action(
        "EXCLUSION_RULE_TOGGLED", "exclusion_rules", _client_ip(request), user_id=current_user_id(request)
    )
    return _row_to_exclusion_rule(row)
