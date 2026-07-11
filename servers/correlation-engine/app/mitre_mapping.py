"""MITRE ATT&CK technique -> tactic/name 매핑.

DetectionRule.mitre_technique_id / ScenarioRule.mitre_technique_id와 같은 값 체계를
쓴다. 두 단계로 나뉜다:

1. CONTAINERS_MATRIX: https://attack.mitre.org/matrices/enterprise/containers/ 의
   공식 Containers 매트릭스 카탈로그(technique_id -> name/tactics) 전체를 미리 채워둔
   참조 테이블 - Enterprise/Mobile/ICS 전체(600개+)는 대부분 컨테이너 환경과 무관해서
   제외했다. sub-technique(T1078.001 등)도 안 담는다 - 이 프로젝트가 실제로 쓰는
   technique_id는 전부 부모 technique 단위라서. "우리 시나리오가 Containers 매트릭스의
   몇 %를 커버하는가" 같은 ATT&CK 커버리지 API/대시보드(README "아직 안 된 것" 참고)를
   만들 때도 이 카탈로그를 그대로 쓸 수 있다.
2. SCENARIO_TACTIC_OVERRIDE: 특정 시나리오 맥락에서 MITRE 공식 다중 전술 중 일부만
   보여주고 싶을 때만 좁혀서 적는다 (예: T1078은 공식적으로 4개 전술에 걸치지만, S1은
   RBAC 변경으로 인한 권한상승 맥락이라 Privilege Escalation 하나로만 표시). 여기 없는
   technique_id는 CONTAINERS_MATRIX의 공식 전술을 그대로 쓴다 - 새 시나리오를 짤 때마다
   매핑을 안 채워도 되는 이유.
"""
from typing import Dict, List, Optional, TypedDict


class TechniqueInfo(TypedDict):
    name: str
    tactics: List[str]


CONTAINERS_MATRIX: Dict[str, TechniqueInfo] = {
    # --- Initial Access ---
    "T1190": {"name": "Exploit Public-Facing Application", "tactics": ["Initial Access"]},
    "T1133": {"name": "External Remote Services", "tactics": ["Initial Access", "Persistence"]},
    "T1078": {
        "name": "Valid Accounts",
        "tactics": ["Initial Access", "Persistence", "Privilege Escalation", "Defense Evasion"],
    },
    # --- Execution ---
    "T1059": {"name": "Command and Scripting Interpreter", "tactics": ["Execution"]},
    "T1609": {"name": "Container Administration Command", "tactics": ["Execution"]},
    "T1610": {"name": "Deploy Container", "tactics": ["Execution"]},
    "T1053": {
        "name": "Scheduled Task/Job",
        "tactics": ["Execution", "Persistence", "Privilege Escalation"],
    },
    "T1204": {"name": "User Execution", "tactics": ["Execution"]},
    # --- Persistence / Privilege Escalation ---
    "T1098": {"name": "Account Manipulation", "tactics": ["Persistence", "Privilege Escalation"]},
    "T1136": {"name": "Create Account", "tactics": ["Persistence"]},
    "T1543": {
        "name": "Create or Modify System Process",
        "tactics": ["Persistence", "Privilege Escalation"],
    },
    "T1525": {"name": "Implant Internal Image", "tactics": ["Persistence"]},
    "T1611": {"name": "Escape to Host", "tactics": ["Privilege Escalation"]},
    "T1068": {"name": "Exploitation for Privilege Escalation", "tactics": ["Privilege Escalation"]},
    "T1612": {"name": "Build Image on Host", "tactics": ["Privilege Escalation"]},
    # --- Defense Evasion ---
    "T1070": {"name": "Indicator Removal", "tactics": ["Defense Evasion"]},
    "T1036": {"name": "Masquerading", "tactics": ["Defense Evasion"]},
    "T1685": {"name": "Disable or Modify Tools", "tactics": ["Defense Evasion"]},
    # --- Credential Access ---
    "T1110": {"name": "Brute Force", "tactics": ["Credential Access"]},
    "T1528": {"name": "Steal Application Access Token", "tactics": ["Credential Access"]},
    "T1552": {"name": "Unsecured Credentials", "tactics": ["Credential Access"]},
    # --- Discovery ---
    "T1613": {"name": "Container and Resource Discovery", "tactics": ["Discovery"]},
    "T1046": {"name": "Network Service Discovery", "tactics": ["Discovery"]},
    "T1069": {"name": "Permission Groups Discovery", "tactics": ["Discovery"]},
    # --- Lateral Movement ---
    "T1550": {"name": "Use Alternate Authentication Material", "tactics": ["Lateral Movement"]},
    # --- Impact ---
    "T1485": {"name": "Data Destruction", "tactics": ["Impact"]},
    "T1499": {"name": "Endpoint Denial of Service", "tactics": ["Impact"]},
    "T1490": {"name": "Inhibit System Recovery", "tactics": ["Impact"]},
    "T1498": {"name": "Network Denial of Service", "tactics": ["Impact"]},
    "T1496": {"name": "Resource Hijacking", "tactics": ["Impact"]},
}

SCENARIO_TACTIC_OVERRIDE: Dict[str, List[str]] = {
    # S1: RBAC 변경으로 인한 권한상승 맥락이라 Privilege Escalation 하나로 좁힘.
    "T1078": ["Privilege Escalation"],
}


def tactics_for_technique(technique_id: Optional[str]) -> List[str]:
    if not technique_id:
        return []
    if technique_id in SCENARIO_TACTIC_OVERRIDE:
        return SCENARIO_TACTIC_OVERRIDE[technique_id]
    info = CONTAINERS_MATRIX.get(technique_id)
    return info["tactics"] if info else []


def name_for_technique(technique_id: Optional[str]) -> Optional[str]:
    if not technique_id:
        return None
    info = CONTAINERS_MATRIX.get(technique_id)
    return info["name"] if info else None
