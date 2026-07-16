"""데이터 정책 API (/log-policies) - 로그 보존 기간.

dashboard/src/data/logPolicy.js의 INITIAL_LOG_POLICIES가 지금까지 프론트 로컬 mock
state로만 존재했던 걸 실제 테이블(datastore/postgres/init/013-data-policy.sql)로
옮긴 것. 레이어 구분과 필드는 2026-07-16에 3등급 보존 체계로 재정의됐다
(datastore/postgres/init/023-log-policies-retention-tiers.sql, docs/reports/
retention-patch-20260716.md) - layer는 이제 소스별(WAS/Falco/K8s Audit)이 아니라
record/raw/derived 3개 고정 영문 키이고, hot_days/cold_days/sampling_rate는 단일
retention_days로 통합됐다(sampling_rate는 저장만 되고 어디서도 집행 안 하던 죽은
컨트롤이라 걷어냄 - docs/reports/repo-audit-20260715.md §3.1). 보존기간은
app/log_retention.py가 실제로 집행한다(오래된 attack-logs-*/otel-logs-raw-* 인덱스
통삭제 + audit_logs/incidents 정리).

layer가 영문인 이유(2026-07-16, docs/reports/high-patch-20260716.md 항목 7): DB에는
처음 한글(기록/원본/파생)로 시드했는데, PATCH /log-policies/{layer} 경로 파라미터에
한글이 들어가면 URL 인코딩·curl 테스트·프론트 상수 관리가 성가셔서 곧바로 영문
키로 바꿨다. 한글 라벨이 필요한 화면을 위해 _DISPLAY_NAMES로 별도 매핑해
응답의 display_name 필드로 얹는다 - DB 자체에는 한글을 안 둔다.

⚠️ 이 스키마 변경으로 GET/PATCH /log-policies 응답 필드가 바뀌었다 - 대시보드
AdminAuditView.jsx의 PolicyRow(hot_days/cold_days/sampling_rate 렌더링, layer
한글 비교)는 아직 새 스키마에 안 맞다(프론트 수정은 이번 작업 범위 밖 - docs/reports/
high-patch-20260716.md에 전달 사항 기록).

record_action(record_id=...)는 여기서 안 쓴다 - log_policies의 PK가 UUID가 아니라
사람이 읽는 문자열(layer 이름)이라 audit_logs.record_id 컬럼(UUID) 타입에 안 맞는다.
테이블 종류가 몇 개뿐인 고정 목록이라 target_table만으로도 행 식별에 충분하다고
보고 생략함.

제외 규칙(exclusion_rules, 저가치 노이즈 자동 드롭) 기능은 2026-07-15 제거됨 -
EX-01/EX-02가 룰 이름/신원 패턴만으로 너무 거칠게 매칭해서 correlation-engine의
S1/S5/S10처럼 실제로 봐야 할 이벤트까지 같이 드롭하는 게 확인됐다(normalizer/app/
main.py 모듈 docstring 참고). IDS에서는 로그 volume 절감보다 탐지 누락이 훨씬
위험하다고 판단해 기능 자체를 뺐다."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


# --- 로그 보존 정책 (계층 3개 고정: record/raw/derived - 생성/삭제 없이 PATCH로 값만 바꿈) ---

router_log_policies = APIRouter(prefix="/log-policies", tags=["data-policy"])

# layer(영문 키) -> 사람이 읽는 한글 라벨. DB에는 영문만 두고(위 모듈 docstring
# 참고) 화면 표시용 문자열만 코드 상수로 관리 - 새 레이어가 추가되면 여기도 같이
# 추가해야 한다(3개 고정 목록이라 잊어버릴 가능성 낮음).
_DISPLAY_NAMES = {
    "record": "기록",
    "raw": "원본",
    "derived": "파생",
}


class LogPolicyOut(BaseModel):
    layer: str
    display_name: str
    retention_days: int
    archive_enabled: bool


class LogPolicyPatch(BaseModel):
    retention_days: Optional[int] = None
    archive_enabled: Optional[bool] = None


def _row_to_log_policy(row) -> LogPolicyOut:
    return LogPolicyOut(
        layer=row["layer"],
        display_name=_DISPLAY_NAMES.get(row["layer"], row["layer"]),
        retention_days=row["retention_days"],
        archive_enabled=row["archive_enabled"],
    )


@router_log_policies.get("", response_model=List[LogPolicyOut])
async def list_log_policies():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT layer, retention_days, archive_enabled FROM log_policies ORDER BY layer"
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
            RETURNING layer, retention_days, archive_enabled
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
