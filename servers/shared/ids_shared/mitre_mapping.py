"""MITRE ATT&CK technique -> tactic/name 매핑.

DetectionRule.mitre_technique_id / ScenarioRule.mitre_technique_id와 같은 값 체계를
쓴다. correlation-engine(시나리오 발화 시 mitre_tactics 계산)과 platform-api
(app/attck_api.py의 ATT&CK 커버리지 API)가 같이 참조하는 canonical 카탈로그라
ids_shared로 뽑아뒀다 - schemas.py와 같은 이유(각 서비스가 따로 복사해서 쓰면
드리프트 난다). 두 단계로 나뉜다:

1. CONTAINERS_MATRIX: https://attack.mitre.org/matrices/enterprise/containers/ 의
   공식 Containers 매트릭스 카탈로그(technique_id -> name/tactics) 전체를 미리 채워둔
   참조 테이블 - Enterprise/Mobile/ICS 전체(600개+)는 대부분 컨테이너 환경과 무관해서
   제외했다. sub-technique(T1078.001 등)도 안 담는다 - 이 프로젝트가 실제로 쓰는
   technique_id는 전부 부모 technique 단위라서. "우리 시나리오가 Containers 매트릭스의
   몇 %를 커버하는가" 같은 ATT&CK 커버리지 API(platform-api/app/attck_api.py)도 이
   카탈로그를 그대로 쓴다.
2. SCENARIO_TACTIC_OVERRIDE: 특정 시나리오 맥락에서 MITRE 공식 다중 전술 중 일부만
   보여주고 싶을 때만 좁혀서 적는다 (예: 공식적으로 여러 전술에 걸치는 기법을 특정
   시나리오 맥락 하나로 좁히고 싶을 때). 여기 없는 technique_id는 CONTAINERS_MATRIX의
   공식 전술을 그대로 쓴다 - 새 시나리오를 짤 때마다 매핑을 안 채워도 되는 이유.
   지금 correlation-engine/app/scenarios/*.yaml이 쓰는 기법(S1/S3/S14=T1609,
   S2/S18=T1552, S4/S5=T1190, S6=T1136, S8=T1485, S10=T1613, S11=T1685, S15=T1610,
   S16=T1611)은 CONTAINERS_MATRIX에서 단일 전술이라 비어있다. S7/S12/S13=T1098,
   S9/S17=T1133만 공식적으로 여러 전술에 걸치는데, 둘 다 시나리오 의미(S7/S12/S13:
   계정·역할에 위험한 권한을 몰아줌 - Persistence/Privilege Escalation 둘 다 해당,
   S9/S17: 클러스터 경계 밖에서 접근 가능한 새 경로가 생김 - Initial Access/Persistence
   둘 다 해당)와 맞아서 좁히지 않고 그대로 둔다.
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
    # 지금 쓰는 시나리오는 전부 단일 전술 기법이라 좁힐 게 없음 - 다중 전술 기법을
    # 특정 시나리오 맥락으로 좁혀야 할 때 여기 추가.
}


def tactics_for_technique(technique_id: Optional[str]) -> List[str]:
    if not technique_id:
        return []
    if technique_id in SCENARIO_TACTIC_OVERRIDE:
        return SCENARIO_TACTIC_OVERRIDE[technique_id]
    info = CONTAINERS_MATRIX.get(technique_id)
    return info["tactics"] if info else []
