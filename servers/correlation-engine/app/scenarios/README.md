# 시나리오 선언 룰 (P4-1)

`app/main.py`의 `_load_scenarios()`가 이 디렉터리의 `*.yaml` 파일을 전부 읽어서
하나의 시나리오 목록으로 합친다 - 파일을 어떻게 나누든 엔진 입장에서는 차이가
없다. 카테고리별로 나눈 건 순전히 가독성 때문(2026-07-12, 18개로 늘어나면서
단일 파일이 너무 길어져서 분리함 - 이전엔 `app/scenarios.yaml` 파일 하나였음).

## 파일 구성

| 파일 | 다루는 영역 | 시나리오 |
| --- | --- | --- |
| `rbac.yaml` | RBAC 변경/권한 상승/백도어 계정 | S3, S6, S7, S9, S11, S12, S13 |
| `workload.yaml` | Pod/워크로드 생명주기 및 컨테이너 이스케이프 | S1, S8, S14, S15, S16 |
| `credentials.yaml` | 자격증명 접근/노출 | S2, S18 |
| `network.yaml` | WAF/외부 노출 경로 | S4, S5, S17 |
| `discovery.yaml` | 정찰(reconnaissance) | S10 |

## 엔진 동작 (sequence/threshold 2타입)

- **sequence**: stage1 패턴이 매칭되면 join_key별로 "stage1 대기중" 상태(이벤트
  id+모듈)를 Redis에 TTL=window_seconds로 기록한다. 그 안에 stage2 패턴이
  매칭되면 발화. stage1이 대기 중에 또 매칭되면 최신 것으로 덮어쓴다.
- **threshold**: join_key별 매칭 카운터를 Redis에 TTL=window_seconds로 유지한다.
  count가 threshold 이상이면 발화 -> 카운터 리셋 + 쿨다운 키를 세팅해서 쿨다운
  기간 동안 재발화를 막는다. threshold=1은 "카운트 누적이 필요 없는 단발성
  critical 이벤트"를 쿨다운과 함께 처리하는 용도로도 쓴다(S6/S8/S9/S11 등).

`join_on`: 엔진 내부 로직/Redis 키 네임스페이스용 식별자(`pod`/`user_or_sa`/
`source_ip`, `app/rules.py`의 `_join_key` 참고). `correlation_key_type`:
PostgreSQL enum 값 그대로 - `Incident.correlation_key_type`에 저장되는 값이라
`join_on`과 반드시 짝이 맞아야 한다.

## 설계 근거 출처

S1/S3/S6~S18 대부분은 falcosecurity/plugins 저장소
(`plugins/k8saudit/rules/k8s_audit_rules.yaml`)의 실제 판정 로직을 그대로
옮긴 것이다 - 엔진 동작 검증용 예시가 아니라 실제 근거 있는 설계다. 이 파일은
확인 결과 MITRE 태그를 달고 있지 않으므로(`tags: [k8s]`뿐), `mitre_technique_id`는
그 룰의 태그가 아니라 MITRE 공식 Containers 매트릭스
(https://attack.mitre.org/matrices/enterprise/containers/)를 직접 대조해서 이
프로젝트가 붙인 값이다. (예전 커밋 메시지에 "룰 자체의 tags"라고 적었던 건 잘못된
인용이었음 - falcosecurity/rules에는 애초에 k8s_audit 룰이 없고 SigmaHQ/sigma에도
kubernetes 클라우드 룰 폴더 자체가 없다는 걸 재확인함.)

S10(정찰 burst)만 예외 - falcosecurity/plugins의 특정 룰에서 가져온 게 아니라
이 프로젝트가 직접 설계한 것이다(`discovery.yaml` 자체 주석 참고).

## request body 파싱 현황 (2026-07-12)

k3d-audit-policy.yaml(Target)이 roles/clusterroles/rolebindings/
clusterrolebindings(RequestResponse) + pods/services/configmaps(Request)의
관련 verb에 대해서만 `requestObject`를 남기고 있어서, 이 7개 리소스에 한해서만
request body 기반 시나리오(S12/S13/S16/S17/S18)가 가능했다. 이걸로 원본
falcosecurity/plugins 48개 룰 중 request body가 필요했던 것 대부분(Privileged
Pod, HostNetwork/HostPID/HostIPC, hostPath, NodePort Service, Configmap
자격증명)을 구현했다.

## 스킵/보류한 것

- **시크릿 enumeration 정교화**: falcosecurity/plugins의 실제 룰도 "시크릿 get
  성공/실패"뿐이라 "전체 네임스페이스 열거"를 구분할 근거가 없어서 지어내지 않고
  `credentials.yaml`의 S2(get/list secrets)를 그대로 둔다.
- **Ingress without TLS**: `spec.tls` 확인이 필요한 request body 기반 룰,
  낮은 우선순위로 아직 미구현.
- **port-forward**(subresource=portforward): objectRef만으로 조건은 만들 수
  있지만, MITRE Containers 매트릭스에 깔끔하게 들어맞는 기법이 없어서(억지로
  끼워맞추지 않기로 하고) 시나리오화하지 않았다.
- **외부 allowlist가 필요한 룰**(Disallowed K8s User, Full K8s Administrative
  Access, Untrusted Node, Create Disallowed Namespace 등): "정상 목록"이라는
  운영 정책 자체가 이 프로젝트에 없어서 스킵.
