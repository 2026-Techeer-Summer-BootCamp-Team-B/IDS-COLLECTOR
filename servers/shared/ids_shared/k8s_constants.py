"""RBAC 리소스 타입 / 시스템 네임스페이스의 canonical 목록.

normalizer(app/normalizer.py)가 코드에서 직접 참조하는 유일한 소스다. 아래 목록을
바꾸면 이 값과 같은 의미로 하드코딩되어 있는 YAML 설정 파일들도 반드시 같이 고칠 것
(YAML은 사람이 직접 튜닝하는 선언적 규칙이라 여기서 값을 자동으로 주입하지 않는다 -
severity.yaml 자체의 설계 철학이 "값을 바꿀 땐 이 파일만 고치면 된다"는 단순함이라,
매크로/치환 계층을 넣는 대신 아래 목록에 위치를 전부 명시해서 사람이 직접 맞추게 한다):

  - servers/normalizer/app/severity.yaml (audit.rules) - RBAC 변경 severity 4 매치,
    시스템 네임스페이스 SA 생성 severity 4 매치
  - servers/correlation-engine/app/scenarios/rbac.yaml - S3/S6/S7/S9/S11/S12/S13의
    orchestrator_resource_type / orchestrator_namespace 매치
  - servers/correlation-engine/app/scenarios/workload.yaml - S15의
    orchestrator_namespace 매치
  - Techeer-12th-b/k3d-audit-policy.yaml - RequestResponse 레벨로 남길 리소스 목록
    (kube-apiserver가 직접 읽는 파일이라 Python 쪽에서 공유 불가능 - 별도 관리 필수)
"""

RBAC_ROLE_RESOURCES = ["roles", "clusterroles"]
RBAC_BINDING_RESOURCES = ["rolebindings", "clusterrolebindings"]
RBAC_ALL_RESOURCES = RBAC_ROLE_RESOURCES + RBAC_BINDING_RESOURCES

SYSTEM_NAMESPACES = ["kube-system", "kube-public"]
