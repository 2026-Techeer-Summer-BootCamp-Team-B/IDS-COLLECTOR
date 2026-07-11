"""MITRE ATT&CK technique -> tactic 매핑.

DetectionRule.mitre_technique_id / ScenarioRule.mitre_technique_id와 같은 값 체계를
쓴다. 지금은 scenarios.yaml 예시 시나리오에 쓰인 기술 ID 몇 개만 채워둔 최소 테이블 -
실제 서비스용 정식 매핑(팀 공용 mitre_mapping 원본)으로 교체할 것."""
from typing import List, Optional

TECHNIQUE_TO_TACTICS = {
    # T1078은 MITRE 상 4개 전술에 걸치지만, 이 프로젝트에서 실제로 쓰는 맥락(S1: RBAC
    # 변경으로 인한 권한상승)에 맞춰 Privilege Escalation 하나로 좁혔다 - 다른 맥락으로
    # 쓸 일이 생기면 그때 다시 넓힐 것.
    "T1078": ["Privilege Escalation"],
    "T1552": ["Credential Access"],
    # S1 stage2(pod exec) 재료.
    "T1609": ["Execution"],
    # S4 재료. WAF 다발 차단은 attack_type(SQLi/XSS 등)을 가리지 않고 전부 잡으므로
    # 로그인 실패 다발(T1110)보다 공개 애플리케이션 익스플로잇 시도 전반(T1190)이 더
    # 정확하다.
    "T1190": ["Initial Access"],
}


def tactics_for_technique(technique_id: Optional[str]) -> List[str]:
    if not technique_id:
        return []
    return TECHNIQUE_TO_TACTICS.get(technique_id, [])
