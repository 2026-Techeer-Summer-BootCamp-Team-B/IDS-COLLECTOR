"""ATT&CK 커버리지 API (/attck) - README가 "아직 안 된 것"으로 명시해둔 기능.
ids_shared.mitre_mapping.CONTAINERS_MATRIX(전체 Containers 매트릭스 카탈로그)를
뼈대로 삼아 전술→기법 트리를 만들고, Postgres incidents를 matched_scenario_rule_id로
집계해서 기법별 hit count를 채운다. 카탈로그에는 있지만 hit이 0인 기법도 그대로
포함하는 게 핵심 - "우리가 이론상 잡을 수 있는 기법 중 실제로 몇 %를 봤는가"라는
커버리지 질문에 답하는 게 목적이라서다."""
from collections import defaultdict
from typing import Any, Dict, List

from fastapi import APIRouter
from ids_shared.mitre_mapping import CONTAINERS_MATRIX

from app.db import pool
from app.incidents_api import IncidentOut, _row_to_incident

router = APIRouter(prefix="/attck", tags=["attck"])


async def _hit_counts_by_technique() -> Dict[str, int]:
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT sr.mitre_technique_id, count(*) AS hit_count
            FROM incidents i
            JOIN scenario_rules sr ON sr.id = i.matched_scenario_rule_id
            WHERE sr.mitre_technique_id IS NOT NULL
            GROUP BY sr.mitre_technique_id
            """
        )
    return {r["mitre_technique_id"]: r["hit_count"] for r in rows}


@router.get("/coverage")
async def get_coverage() -> Dict[str, Any]:
    hit_counts = await _hit_counts_by_technique()

    tactics: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for technique_id, info in CONTAINERS_MATRIX.items():
        hits = hit_counts.get(technique_id, 0)
        for tactic in info["tactics"]:
            tactics[tactic].append({"id": technique_id, "name": info["name"], "hits": hits})

    tactic_list = [
        {"name": tactic, "techniques": techniques} for tactic, techniques in tactics.items()
    ]
    total_techniques = len(CONTAINERS_MATRIX)
    detected_techniques = sum(1 for t in hit_counts if t in CONTAINERS_MATRIX)

    return {
        "tactics": tactic_list,
        "total_techniques": total_techniques,
        "detected_techniques": detected_techniques,
    }


@router.get("/coverage/{technique_id}/incidents", response_model=List[IncidentOut])
async def get_technique_incidents(technique_id: str):
    """이 기법과 연결된 scenario_rules를 거쳐 실제 발화한 인시던트 목록을 반환 -
    프론트가 여기서 인시던트를 골라 GET /incidents/{id}/timeline으로 드릴다운한다."""
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT i.id, i.title, i.correlation_key_type, i.correlation_key_value, i.severity,
                   i.status, i.matched_scenario_rule_id, i.mitre_tactics, i.created_at, i.updated_at,
                   i.verdict, i.verdict_note, i.verdict_at
            FROM incidents i
            JOIN scenario_rules sr ON sr.id = i.matched_scenario_rule_id
            WHERE sr.mitre_technique_id = $1
            ORDER BY i.updated_at DESC
            """,
            technique_id,
        )
    return [_row_to_incident(r) for r in rows]
