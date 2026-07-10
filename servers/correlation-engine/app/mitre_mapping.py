"""MITRE ATT&CK technique -> tactic 매핑.

DetectionRule.mitre_technique_id / ScenarioRule.mitre_technique_id와 같은 값 체계를
쓴다. 지금은 scenarios.yaml 예시 시나리오에 쓰인 기술 ID 몇 개만 채워둔 최소 테이블 -
실제 서비스용 정식 매핑(팀 공용 mitre_mapping 원본)으로 교체할 것."""
from typing import List, Optional

TECHNIQUE_TO_TACTICS = {
    "T1078": ["Defense Evasion", "Persistence", "Privilege Escalation", "Initial Access"],
    "T1552": ["Credential Access"],
    "T1110": ["Credential Access"],
}


def tactics_for_technique(technique_id: Optional[str]) -> List[str]:
    if not technique_id:
        return []
    return TECHNIQUE_TO_TACTICS.get(technique_id, [])
