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
2. SCENARIO_TACTIC_OVERRIDE: 용도가 두 가지다 - (a) 특정 시나리오 맥락에서 MITRE
   공식 다중 전술 중 일부만 보여주고 싶을 때 좁혀서 적는다(예: T1078/S95), (b)
   CONTAINERS_MATRIX에 아예 없는 "카탈로그 밖 기법"(S28/S36/S40/S44/S50/S70/S71/
   S77/S79가 이미 쓰는 관례 - README.md "설계 근거 출처" 참고)을 쓰는 시나리오가
   tactics_for_technique()에서 빈 리스트가 아니라 실제 전술을 받게 해준다(CONTAINERS_MATRIX에
   넣지 않는 이유는 T1055/T1622 문단 참고). 여기 없는 technique_id는
   CONTAINERS_MATRIX의 공식 전술을 그대로 쓴다(또는 그마저 없으면 빈 리스트) -
   새 시나리오를 짤 때마다 매핑을 안 채워도 되는 이유.
   지금 correlation-engine/app/scenarios/*.yaml이 쓰는 기법(S1/S3/S14=T1609,
   S2/S18=T1552, S4/S5=T1190, S6=T1136, S8=T1485, S10=T1613, S11=T1685, S15=T1610,
   S16=T1611)은 CONTAINERS_MATRIX에서 단일 전술이라 비어있다. S7/S12/S13=T1098,
   S9/S17=T1133만 공식적으로 여러 전술에 걸치는데, 둘 다 시나리오 의미(S7/S12/S13:
   계정·역할에 위험한 권한을 몰아줌 - Persistence/Privilege Escalation 둘 다 해당,
   S9/S17: 클러스터 경계 밖에서 접근 가능한 새 경로가 생김 - Initial Access/Persistence
   둘 다 해당)와 맞아서 좁히지 않고 그대로 둔다.

   S95(lateral_movement.yaml, T1078, 2026-07-20, Notion "여러 계층 시나리오" M13
   구현)는 좁힌다 - CONTAINERS_MATRIX의 T1078은 공식적으로 4개 전술(Initial
   Access/Persistence/Privilege Escalation/Defense Evasion)에 걸치지만, S95가
   보는 신호는 "이미 유효한 신원이 여러 소스 IP에서 동시에 재사용되는" 상황
   하나뿐이라 그중 최초 진입(Initial Access)도 아니고 권한이 더 세지는 것도
   아니다(Privilege Escalation) - 이미 확보한 접근을 들키지 않고 유지하는
   것(Persistence)과 정상 신원인 척 섞여드는 것(Defense Evasion) 둘로 좁힌다.
   ⚠️ MITRE 전체 매트릭스에서 Valid Accounts는 흔히 Lateral Movement 기법으로도
   널리 알려져 있지만, 이 프로젝트의 CONTAINERS_MATRIX 서브셋 자체에 T1078의
   Lateral Movement 전술 태그가 없다(MITRE 공식 Containers 매트릭스 페이지 확인
   결과 그대로 옮긴 것) - S95를 파일 스코프상 lateral_movement.yaml에 두는 것과는
   별개로, 여기서 없는 전술을 지어내 추가하지 않는다.

   T1055(S40, Process Injection)/T1622(S44/S100, Debugger Evasion)는 (b) 용도의
   예시다(2026-07-20) - WebFetch로 공식 Containers 매트릭스 페이지
   (https://attack.mitre.org/matrices/enterprise/containers/) 전체를 다시 확인한
   결과 T1055/T1622 둘 다 그 30개 기법 목록에 없다(S28/S36/S40/S44/S50/S70/S71/
   S77/S79와 같은 "카탈로그 밖 기법" 케이스) - CONTAINERS_MATRIX에 추가하면 그
   테이블이 더 이상 공식 Containers 페이지의 정확한 사본이 아니게 되고,
   platform-api의 /attck/coverage("이론상 커버리지 %")도 실재하지 않는 항목을
   포함해 왜곡된다. 그래서 CONTAINERS_MATRIX가 아니라 여기(SCENARIO_TACTIC_OVERRIDE)에
   추가한다 - 각 기법의 개별 페이지(https://attack.mitre.org/techniques/T1055/,
   .../T1622/)를 WebFetch로 확인해 Enterprise 전체 매트릭스 기준 공식 전술을
   그대로 옮겼다: T1055=Privilege Escalation/Defense Evasion(페이지 원문은
   "Stealth"라는 최신 명칭을 쓰지만, 이 파일의 기존 항목들(T1070/T1036/T1685 등)이
   전부 "Defense Evasion"으로 통일해 써서 그대로 맞춤), T1622=Defense
   Evasion/Discovery.

   2026-07-20 후속 - "S28/S36/S40/S44/S50/S70/S71/S77/S79가 이미 쓰는 카탈로그 밖
   기법 사용 관례"라고 여러 시나리오 주석이 인용해온 그 목록을 실제로 하나씩
   짚어봤다: S28(T1046)은 이미 CONTAINERS_MATRIX에 있어(Network Service
   Discovery) 사실 여기 낄 이유가 없었다(과거 주석의 인용이 부정확했던 것 -
   S28은 "MITRE 공식 문서를 직접 인용"이라는 방법론적 정신은 같지만 실제로
   카탈로그 밖은 아니다). 나머지 6개 + S72(T1489, 같은 목록에 뒤늦게 추가된
   케이스)는 전부 진짜로 CONTAINERS_MATRIX에 없어서 이번에 여기 채웠다(각 기법
   개별 페이지를 WebFetch로 확인, "Stealth"는 위와 같은 이유로 "Defense
   Evasion"으로 통일):
     - T1620(S36, Reflective Code Loading): Defense Evasion
     - T1557(S50, Adversary-in-the-Middle): Credential Access/Collection -
       falcosecurity 원본 태그(credential_access)와 이 프로젝트가 이미 S50에
       붙인 설명(스니핑/ARP 스푸핑) 둘 다와 맞아 좁히지 않음.
     - T1082(S70, System Information Discovery): Discovery
     - T1562(S71, Impair Defenses): Defense Evasion - ⚠️ 이 기법만 WebFetch가
       페이지를 못 가져와(원인 불명, 재시도 3회 모두 빈 응답) 라이브 재확인을
       못 했다. T1562는 오랫동안 안정적으로 Defense Evasion 단일 전술로 알려진
       잘 알려진 기법이라 이 사실 자체에 기반해 채웠지만, 이 파일의 나머지
       항목과 달리 이번 세션에서 원본 페이지로 직접 재확인은 못 했다는 차이가
       있다.
     - T1489(S72, Service Stop): Impact
     - T1090(S77, Proxy): Command and Control
     - T1087(S79, Account Discovery): Discovery

   2026-07-20 추가 발견 - 카탈로그 전체 재점검 중 이 관례를 따르지 않고 시나리오
   주석에만 mitre_technique_id를 적어둔 채 여기 채우는 걸 빠뜨린 3개를 발견해서
   마저 채운다(각 기법 개별 페이지를 WebFetch로 확인):
     - T1555(credentials.yaml S45/S46/S47/S48/S49/S99, Credentials from Password
       Stores): Credential Access - 단일 전술이라 좁힐 것도 없음.
     - T1595(discovery.yaml S92, Active Scanning): Reconnaissance - 이 파일이
       처음 쓰는 전술명(지금까지의 정찰류 시나리오는 전부 T1613/T1069/T1082 등
       Discovery 전술이었다 - Active Scanning은 MITRE 공식 분류상 Discovery가
       아니라 Reconnaissance).
     - T1547(workload.yaml S81, Boot or Logon Autostart Execution: Kernel
       Modules and Extensions): Persistence, Privilege Escalation - 이 세
       기법 모두 CONTAINERS_MATRIX(공식 Containers 페이지의 30개 기법 목록)엔
       없어서 그동안 mitre_tactics가 빈 배열로 저장되고 있었다.
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
    # T1078(Valid Accounts) - 위 CONTAINERS_MATRIX 섹션 주석(S95 문단) 참고.
    "T1078": ["Persistence", "Defense Evasion"],
    # T1055(Process Injection)/T1622(Debugger Evasion) - 위 섹션 주석(T1055/T1622
    # 문단) 참고. CONTAINERS_MATRIX에 없는 "카탈로그 밖 기법"이라 여기서 직접
    # 채운다(narrowing이 아니라 최초 공급).
    "T1055": ["Privilege Escalation", "Defense Evasion"],
    "T1622": ["Defense Evasion", "Discovery"],
    # 2026-07-20 후속 - 위 섹션 주석("2026-07-20 후속" 문단) 참고. 전부 (b) 용도
    # (CONTAINERS_MATRIX에 없는 카탈로그 밖 기법에 최초로 전술을 채움).
    "T1620": ["Defense Evasion"],
    "T1557": ["Credential Access", "Collection"],
    "T1082": ["Discovery"],
    "T1562": ["Defense Evasion"],
    "T1489": ["Impact"],
    "T1090": ["Command and Control"],
    "T1087": ["Discovery"],
    # 2026-07-20 추가 발견 - 위 섹션 주석("2026-07-20 추가 발견" 문단) 참고. 셋 다
    # (b) 용도(CONTAINERS_MATRIX에 없는 카탈로그 밖 기법에 최초로 전술을 채움).
    "T1555": ["Credential Access"],
    "T1595": ["Reconnaissance"],
    "T1547": ["Persistence", "Privilege Escalation"],
}


def tactics_for_technique(technique_id: Optional[str]) -> List[str]:
    if not technique_id:
        return []
    if technique_id in SCENARIO_TACTIC_OVERRIDE:
        return SCENARIO_TACTIC_OVERRIDE[technique_id]
    info = CONTAINERS_MATRIX.get(technique_id)
    return info["tactics"] if info else []
