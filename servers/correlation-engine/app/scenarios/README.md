# 시나리오 선언 룰 (P4-1)

`app/main.py`의 `_load_scenarios()`가 이 디렉터리의 `*.yaml` 파일을 전부 읽어서
하나의 시나리오 목록으로 합친다 - 파일을 어떻게 나누든 엔진 입장에서는 차이가
없다. 카테고리별로 나눈 건 순전히 가독성 때문(2026-07-12, 18개로 늘어나면서
단일 파일이 너무 길어져서 분리함 - 이전엔 `app/scenarios.yaml` 파일 하나였음).

## 파일 구성

| 파일 | 다루는 영역 | 시나리오 |
| --- | --- | --- |
| `rbac.yaml` | RBAC 변경/권한 상승/백도어 계정 | S3, S6, S7, S9, S11, S12, S13, S53, S58 |
| `workload.yaml` | Pod/워크로드 생명주기 및 컨테이너 이스케이프 | S1, S8, S14, S15, S16, S20, S21, S34, S35, S40, S41, S42, S43, S52 |
| `credentials.yaml` | 자격증명 접근/노출 | S2, S18, S38, S39, S45, S46, S47, S48, S49, S56 |
| `network.yaml` | WAF/WAS/외부 노출 경로 | S4, S5, S17, S19, S24, S26, S27, S28, S29, S30, S33, S51, S54, S55, S59 |
| `discovery.yaml` | 정찰(reconnaissance) | S10, S31, S50 |
| `resource_abuse.yaml` | 컨테이너 런타임 리소스 남용(크립토마이닝) | S22 |
| `defense_evasion.yaml` | 컨테이너 내 흔적 인멸 | S23, S36, S37, S44 |
| `lateral_movement.yaml` | 탈취한 인증 자료를 이용한 측면 이동 | S25, S57 |

## 엔진 동작 (sequence/threshold/cardinality 3타입)

- **sequence**: stage1 패턴이 매칭되면 join_key별로 "stage1 대기중" 상태(이벤트
  id+모듈)를 Redis에 TTL=window_seconds로 기록한다. 그 안에 stage2 패턴이
  매칭되면 발화. stage1이 대기 중에 또 매칭되면 최신 것으로 덮어쓴다.
- **threshold**: join_key별 매칭 카운터를 Redis에 TTL=window_seconds로 유지한다.
  count가 threshold 이상이면 발화 -> 카운터 리셋 + 쿨다운 키를 세팅해서 쿨다운
  기간 동안 재발화를 막는다. threshold=1은 "카운트 누적이 필요 없는 단발성
  critical 이벤트"를 쿨다운과 함께 처리하는 용도로도 쓴다(S6/S8/S9/S11 등).
- **cardinality** (2026-07-19): join_key별로 어떤 필드(`distinct_field`, `NormalizedEvent`
  속성명)의 "서로 다른 값 개수"가 threshold 이상이면 발화한다 - Redis SET
  (`SADD`/`SCARD`)으로 distinct 값 집합을 유지한다는 것만 threshold(`INCR` 카운터)와
  다르고, 윈도우/쿨다운 규칙은 threshold와 동일하다. 같은 값이 반복돼도 카운트가
  오르지 않는다는 게 핵심 차이 - "같은 IP가 서로 다른 엔드포인트를 N개 이상
  스캔했다"처럼 반복이 아니라 다양성 자체가 신호인 정찰 탐지용이다(여러 계층 시나리오
  Notion 페이지의 M4/M10). 예:
  ```yaml
  - id: S-EXAMPLE
    type: cardinality
    join_on: source_ip
    correlation_key_type: "source.ip"
    required_modules: [was]
    window_seconds: 60
    threshold: 20            # 서로 다른 url_path가 20개 이상
    cooldown_seconds: 300
    distinct_field: url_path
    match:
      event_module: was
    severity: 2
    mitre_technique_id: "T1595"
  ```

`join_on`: 엔진 내부 로직/Redis 키 네임스페이스용 식별자(`pod`/`user_or_sa`/
`source_ip`, `app/rules.py`의 `_join_key` 참고). `correlation_key_type`:
PostgreSQL enum 값 그대로 - `Incident.correlation_key_type`에 저장되는 값이라
`join_on`과 반드시 짝이 맞아야 한다.

## "동시 부재" 확인 (`absent_recent_module`, 2026-07-19)

`match`(threshold/cardinality) 또는 `stageN`(sequence) 패턴에 `absent_recent_module`을
추가하면, "이 패턴이 매칭되는 순간 지정된 모듈이 같은 join_key로 최근 발생한 적이
없어야" 이 패턴을 매칭으로 친다:

```yaml
match:
  event_module: falco
  event_action: "Known Cryptominer Process Executed"
  absent_recent_module: waf       # 또는 [waf, was]
  absent_recent_seconds: 300      # 생략하면 이 시나리오의 window_seconds
```

`app/rules.py`의 `ScenarioEngine.evaluate()`가 매 이벤트마다 무조건
`_stamp_recency()`로 "이 모듈·이 join_key가 방금 나타났다"는 흔적을 Redis에
남긴다(어느 시나리오가 나중에 이 흔적을 쓸지 몰라 `pod`/`user_or_sa`/`source_ip`
3개 축 전부에 미리 남긴다) - 패턴 평가 시 그 흔적의 최신 여부만 확인하면 되므로
미래를 기다리는 스케줄러가 필요 없다. 여러 계층 시나리오 Notion 페이지의
M9("K8s Audit 비인가 이미지 pull + Falco 악성 패턴 + WAF/WAS 트래픽 없음 = 공급망
침해 정황")이 이 메커니즘을 쓰는 예시다.

⚠️ 이건 "이 사건이 났을 때 다른 소스가 최근에 조용했는가"만 보는 **동시 부재**다 -
"stage1 이후 N초 안에 아무 일도 안 일어나면 발화"처럼 미래 시간 경과 자체를
기다려야 하는 **지연 부재**는 이 메커니즘으로 못 한다(별도 스케줄러가 필요, 아직
미구현 - 여러 계층 시나리오 Notion 페이지 참고).

`absent_recent_seconds`(또는 `window_seconds` 기본값)는 `app/rules.py`의
`_RECENCY_MARKER_TTL_SECONDS`(900초)를 넘을 수 없다 - 넘으면 마커가 그 전에 먼저
Redis에서 사라져 실제로는 있었는데 "부재"로 오판할 수 있다
(`test_scenario_catalog.py`가 카탈로그 로드 단계에서 강제).

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

S10(정찰 burst), S19(로그인 브루트포스), S20/S21(DaemonSet/CronJob 생성), S22
(크립토마이닝), S25(SA 토큰 명시적 발급, 전부 2026-07-14 추가. S23/S24는
falcosecurity 룰을 그대로 옮긴 것이라 이 예외 목록에서 빠짐)는 예외 -
falcosecurity/plugins은 k8s_audit 전용 저장소라 애초에 HTTP/WAS 계층을 다루지
않고(S19), DaemonSet/CronJob/SA 토큰 관련 룰 자체가 없다(S20/S21/S25,
WebFetch로 원본 재확인함). S10도 특정 룰에서 가져온
게 아니라 이 프로젝트가 직접 설계한 것이다(각 파일 자체 주석 참고). S19는
대신 Target 저장소의 WAF 자체 브루트포스 판정 기준(`backend/app/middleware/
gateway.py`의 LOGIN_PATH_KEYWORDS/LOGIN_FAILURE_STATUS_CODES)과 맞춰서 두
계층(WAF/WAS)이 서로 다른 근거로 같은 공격을 이중으로 잡도록 설계했고,
S20/S21은 falcosecurity 룰 대신 MITRE 공식 기법 설명(T1543.005/T1053.007)을
직접 근거로 삼았다 - 카탈로그(`ids_shared.mitre_mapping`)가 sub-technique를
안 담는 기존 컨벤션에 맞춰 부모 technique(T1543/T1053)로 기록. S22는 falco
룰 자체는 있으나 falcosecurity/plugins(k8s_audit 전용)가 아니라 falcosecurity/
rules 저장소의 falco-sandbox_rules.yaml(syscall 기반 코어 룰셋의 sandbox
계열)에서 그대로 옮겼다 - Target 저장소 `backend/falco-values.yaml`의
`customRules`에 룰 본문 추가(WebFetch로 원본 재확인, "Detect outbound
connections to common miner pool ports"는 원본이 `enabled: false`라 명시적으로
켬). S23은 반대로 별도 이식이 필요 없었다 - falcosecurity/rules의 **코어**
falco_rules.yaml(sandbox가 아니라 Falco Helm 차트 기본 번들)에 "Clear Log
Activities" 룰이 이미 기본 활성화 상태로 있고, 태그도 이례적으로 전술 단위
(mitre_defense_evasion)가 아니라 기법 ID(T1070) 그대로 박혀 있어서 그대로
가져다 썼다. 같은 조사에서 T1036/T1550/T1499/T1498은 코어·sandbox 룰셋
어디에도 대응 룰이 없다는 것도 확인함(WebFetch로 falco_rules.yaml/
falco-sandbox_rules.yaml 양쪽 원본 재확인, 2026-07-14) - 단, 이건 falco
**syscall** 룰셋(런타임 관측) 얘기고, T1550은 k8s_audit(API 호출) 계층에서
별도로 재조사해서 S25로 구현했다(아래 문단).

S24(2026-07-14 추가)는 falcosecurity/plugins의 k8s_audit_rules.yaml에 실제로
있는 "Ingress Object without TLS Certificate Created" 룰(ingress_tls 매크로:
requestObject.spec.tls 키 존재 여부)을 그대로 옮겼다 - 다만 이 프로젝트의
감사정책이 원래 ingress 리소스 자체를 아예 안 보고 있어서(과거엔 "스킵/보류"
항목이었음) `k3d-audit-policy.yaml`에 `networking.k8s.io/ingresses`의 create를
Request 레벨로 새로 추가해야 했다.

S25(2026-07-14 추가, Lateral Movement 전술 최초 커버리지)는 falcosecurity/
plugins에 대응 룰이 없어(WebFetch로 재확인) S20/S21과 같은 방식으로 MITRE 공식
기법 설명을 직접 근거로 삼았다 - T1550.001(Application Access Token)의 탐지
전략 설명 "Compromised service account tokens ... reused for external API calls
or lateral movement across services"를 인용, `create serviceaccounts/token`
(TokenRequest API)을 신호로 쓴다. 이 이벤트 자체는 `k3d-audit-policy.yaml`이
처음부터 수집하고 있었지만, 실측 확인 결과(2026-07-14) 거의 전부 kubelet의
자동 토큰 갱신(user=system:node:\*)과 kube-controller-manager 내부 호출이라 -
이 두 신원을 걸러내는 전용 제외 규칙을 `k3d-audit-policy.yaml`에 추가한
뒤에야 실제로 쓸 수 있는 신호가 됐다(자세한 내용은 `lateral_movement.yaml`
주석 참고).

## request body 파싱 현황 (2026-07-12)

k3d-audit-policy.yaml(Target)이 roles/clusterroles/rolebindings/
clusterrolebindings(RequestResponse) + pods/services/configmaps/ingresses
(Request)의 관련 verb에 대해서만 `requestObject`를 남기고 있어서, 이 8개
리소스에 한해서만 request body 기반 시나리오(S12/S13/S16/S17/S18/S24)가
가능했다. 이걸로 원본 falcosecurity/plugins 48개 룰 중 request body가 필요했던
것 대부분(Privileged Pod, HostNetwork/HostPID/HostIPC, hostPath, NodePort
Service, Configmap 자격증명, Ingress without TLS)을 구현했다.

## 스킵/보류한 것

- **시크릿 enumeration 정교화**: falcosecurity/plugins의 실제 룰도 "시크릿 get
  성공/실패"뿐이라 "전체 네임스페이스 열거"를 구분할 근거가 없어서 지어내지 않고
  `credentials.yaml`의 S2(get/list secrets)를 그대로 둔다.
- **T1036(Masquerading)/T1499·T1498(DoS)**: falcosecurity/rules(core+sandbox)
  어디에도 대응 룰이 없고(2026-07-14 WebFetch 재확인), MITRE 공식 페이지의
  Containers 탐지 전략도 "crashlooping pods, 반복적 리소스 고갈" 같은 pod
  **상태(status) 전이**를 요구한다 - 이 프로젝트의 파이프라인은 API 호출
  로그(k8s_audit)/런타임 syscall(Falco)/WAF·WAS만 수집하고 pod 상태 변화
  자체(Watch on pod status, 또는 kube-state-metrics류)는 수집하지 않아서, 새
  시나리오 하나가 아니라 새 수집기(컬렉터)가 있어야 하는 문제 - 범위 밖.
- **port-forward**(subresource=portforward): objectRef만으로 조건은 만들 수
  있지만, MITRE Containers 매트릭스에 깔끔하게 들어맞는 기법이 없어서(억지로
  끼워맞추지 않기로 하고) 시나리오화하지 않았다.
- **외부 allowlist가 필요한 룰**(Disallowed K8s User, Full K8s Administrative
  Access, Untrusted Node, Create Disallowed Namespace 등): "정상 목록"이라는
  운영 정책 자체가 이 프로젝트에 없어서 스킵.
