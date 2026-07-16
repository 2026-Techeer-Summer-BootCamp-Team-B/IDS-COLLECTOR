"""폴링/자동 실행 주기 설정 API (/poll-intervals) - poll_intervals 테이블
(datastore/postgres/init/014-poll-intervals.sql) CRUD.

여기서 바꾼 값은 재배포/재시작 없이 다음 반복부터 바로 반영된다 - 각 폴링 루프가
매 반복 시작 시 이 테이블 값을 다시 읽기 때문(platform-api app/incident_alerts.py,
correlation-engine app/main.py의 _allow_list_refresh_loop). key는 고정 목록이라
(마이그레이션에 미리 심어둔 행만 존재) 새 키를 만드는 POST는 없다 - 있는 키의
seconds만 PATCH로 바꾼다."""
from typing import List

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool

router = APIRouter(prefix="/poll-intervals", tags=["poll-intervals"])


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


class PollIntervalOut(BaseModel):
    key: str
    seconds: int
    description: str
    min_seconds: int
    max_seconds: int
    updated_at: str


class PollIntervalIn(BaseModel):
    seconds: int


def _row_to_out(row) -> PollIntervalOut:
    return PollIntervalOut(
        key=row["key"],
        seconds=row["seconds"],
        description=row["description"],
        min_seconds=row["min_seconds"],
        max_seconds=row["max_seconds"],
        updated_at=row["updated_at"].isoformat(),
    )


@router.get("", response_model=List[PollIntervalOut])
async def list_poll_intervals():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT key, seconds, description, min_seconds, max_seconds, updated_at "
            "FROM poll_intervals ORDER BY key"
        )
    return [_row_to_out(r) for r in rows]


@router.patch("/{key}", response_model=PollIntervalOut)
async def update_poll_interval(key: str, body: PollIntervalIn, request: Request):
    async with pool().acquire() as conn:
        bounds = await conn.fetchrow(
            "SELECT id, min_seconds, max_seconds FROM poll_intervals WHERE key = $1", key
        )
        if bounds is None:
            raise HTTPException(status_code=404, detail=f"unknown poll interval key: {key}")
        if not (bounds["min_seconds"] <= body.seconds <= bounds["max_seconds"]):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"seconds must be between {bounds['min_seconds']} and "
                    f"{bounds['max_seconds']}"
                ),
            )

        row = await conn.fetchrow(
            """
            UPDATE poll_intervals SET seconds = $2, updated_at = now()
            WHERE key = $1
            RETURNING key, seconds, description, min_seconds, max_seconds, updated_at
            """,
            key,
            body.seconds,
        )

    await record_action(
        "POLL_INTERVAL_UPDATED",
        "poll_intervals",
        _client_ip(request),
        user_id=current_user_id(request),
        record_id=bounds["id"],
    )
    return _row_to_out(row)
