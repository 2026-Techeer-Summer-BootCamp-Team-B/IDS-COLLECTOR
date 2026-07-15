"""Allow-list API (/allow-list) - 탐지 예외 IP/대역 등록. target_id를 주면 해당
target에만 적용, 생략하면 전역 예외(001-schema.sql 참고).

[2026-07-14] correlation-engine이 전역/target_id 스코프 항목 둘 다 실제로 집행한다
(app/rules.py의 ScenarioEngine._is_allow_listed, app/main.py의 30초 주기 폴링) -
등록된 IP/CIDR에서 온 이벤트는 어느 시나리오와도 상관분석 대상이 되지 않아 인시던트가
안 뜬다(원본 로그 자체는 그대로 쌓여서 raw 조회/포렌식엔 영향 없음, 상관분석만 면제).
target_id 스코프는 Target 저장소(Techeer-12th-b)의 WAF backend/WAS 사이드카가
TARGET_NAME을 이벤트에 실어 보내고(WafAlert.target_name/WAS access log)
normalizer가 NormalizedEvent.target_name으로 정규화해서 가능해졌다 - correlation-
engine이 target_id를 targets.name으로 JOIN해서 event.target_name과 비교한다
(같은 IP라도 등록된 target과 다른 target 소속 이벤트면 억제 안 됨, 실측 확인됨).
falco/k8s_audit 이벤트는 앱 단위가 아니라 클러스터 단위라 target_name이 항상
없으므로 target_id로 스코프된 항목은 이런 이벤트엔 적용되지 않는다(전역 항목만 적용)."""
import ipaddress
from typing import List, Optional

import asyncpg
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool
from app.timeparse import parse_iso8601_optional

router = APIRouter(prefix="/allow-list", tags=["allow-list"])


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _validate_ip_or_cidr(value: str) -> None:
    """correlation-engine(rules.py의 ScenarioEngine.set_allow_list)은 파싱 실패한
    CIDR/IP를 조용히 건너뛴다(입력 검증은 여기 책임이라는 그쪽 주석 참고) - 여기서
    막지 않으면 오타난 값이 201로 저장은 되지만 실제로는 아무것도 걸러내지 못하는
    채로 화면에 "등록됨"으로만 남는다."""
    try:
        ipaddress.ip_network(value, strict=False)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid ip_or_cidr {value!r}: {e}")


class AllowListIn(BaseModel):
    ip_or_cidr: str
    target_id: Optional[str] = None
    reason: Optional[str] = None
    expires_at: Optional[str] = None  # ISO8601, 생략하면 무기한


class AllowListOut(BaseModel):
    id: str
    ip_or_cidr: str
    target_id: Optional[str]
    reason: Optional[str]
    expires_at: Optional[str]
    created_at: str
    updated_at: str


def _row_to_out(row) -> AllowListOut:
    return AllowListOut(
        id=str(row["id"]),
        # ip_or_cidr은 019-db-hardening.sql부터 inet 컬럼 - asyncpg가 문자열이
        # 아니라 ipaddress.IPv4Interface/IPv6Interface 객체로 돌려주므로 str()로
        # 감싸야 이전과 동일한 문자열 응답을 유지한다(실측 확인: str()이 입력
        # 문자열과 정확히 동일하게 왕복됨, 호스트 비트 있는 값도 안 잘림).
        ip_or_cidr=str(row["ip_or_cidr"]),
        target_id=str(row["target_id"]) if row["target_id"] else None,
        reason=row["reason"],
        expires_at=row["expires_at"].isoformat() if row["expires_at"] else None,
        created_at=row["created_at"].isoformat(),
        updated_at=row["updated_at"].isoformat(),
    )


@router.get("", response_model=List[AllowListOut])
async def list_allow_list(target_id: Optional[str] = None):
    async with pool().acquire() as conn:
        if target_id:
            rows = await conn.fetch(
                """
                SELECT id, ip_or_cidr, target_id, reason, expires_at, created_at, updated_at
                FROM allow_list WHERE target_id = $1 ORDER BY id
                """,
                target_id,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, ip_or_cidr, target_id, reason, expires_at, created_at, updated_at
                FROM allow_list ORDER BY id
                """
            )
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=AllowListOut)
async def create_allow_list_entry(body: AllowListIn, request: Request):
    _validate_ip_or_cidr(body.ip_or_cidr)
    async with pool().acquire() as conn:
        if body.target_id is not None:
            exists = await conn.fetchval("SELECT count(*) FROM targets WHERE id = $1", body.target_id)
            if not exists:
                raise HTTPException(status_code=404, detail="target not found")

        try:
            row = await conn.fetchrow(
                """
                INSERT INTO allow_list (ip_or_cidr, target_id, reason, expires_at)
                VALUES ($1, $2, $3, $4)
                RETURNING id, ip_or_cidr, target_id, reason, expires_at, created_at, updated_at
                """,
                body.ip_or_cidr,
                body.target_id,
                body.reason,
                parse_iso8601_optional(body.expires_at),
            )
        except asyncpg.UniqueViolationError:
            # 019-db-hardening.sql의 idx_allow_list_unique_scoped/_global - 같은
            # IP/CIDR을 같은 target(또는 둘 다 전역)에 이미 등록한 경우.
            raise HTTPException(
                status_code=409, detail="이미 등록된 IP/CIDR입니다 (같은 target 스코프 기준)"
            )
    await record_action(
        "ALLOW_LIST_CREATED",
        "allow_list",
        _client_ip(request),
        user_id=current_user_id(request),
        record_id=row["id"],
    )
    return _row_to_out(row)


@router.delete("/{entry_id}")
async def delete_allow_list_entry(entry_id: str, request: Request):
    async with pool().acquire() as conn:
        result = await conn.execute("DELETE FROM allow_list WHERE id = $1", entry_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="allow-list entry not found")
    await record_action(
        "ALLOW_LIST_DELETED",
        "allow_list",
        _client_ip(request),
        user_id=current_user_id(request),
        record_id=entry_id,
    )
    return {"status": "ok"}
