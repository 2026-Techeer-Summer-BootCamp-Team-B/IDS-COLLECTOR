# IDS-COLLECTOR

kafka 트러블 슈팅
1. Bitnami 이미지 → Apache 공식 이미지로 교체 (무료 이미지 정책 변경 이슈)
2. 단일 노드 Kafka는 offsets.topic.replication.factor=1로 반드시 낮춰야 함
3. 컨테이너 안에서 exec할 땐 EXTERNAL(9092) 아니라 내부 리스너(9094) 써야 함

backend 역할:
- Kafka consumer
- JSON 로그 파싱
- Falco/K8s/App 로그 분류
- GeoIP 조회
- 정규화
- 상관분석
- DB 저장

커밋될 변경사항
"refactor(backend): Redis 제거하고 Kafka consumer로 전환"

1. backend/app/config.py — redis 설정 필드 전부 제거, kafka_brokers/kafka_topic/kafka_consumer_group 추가
2. backend/app/main.py — Redis Stream consumer 삭제 → aiokafka 기반 Kafka consumer로 교체. app-logs 토픽의 otlp_json 
3. 메시지를 파싱해서 log.source(was/falco/k8s-audit) + body를 뽑아 normalize()로 연결. Redis pub/sub 실시간 알림 코드/TODO도 제거
4. backend/app/normalizer.py — normalize_falco, normalize_k8s_audit 추가. was 하나만 되던 걸 mysite가 실제로 보내는 3개 로그 소스 전부 커버하도록 확장
5. backend/requirements.txt — redis 제거, aiokafka==0.12.0 추가
6. docker-compose.yml — 안 쓰던 redis-data 볼륨 선언 제거

대시보드 트러블
1. weightedPick()을 .find() 콜백 안에서 호출해서, 비교할 때마다 새로 랜덤 국가를 뽑는 꼴이 되어 거의 매칭이 안 됨. 
2. 그 결과 country가 다음 줄 country.name에서 죽음. 
3. App.jsx가 모든 탭(Overview/Incidents/ATT&CK/Infrastructure)을 한꺼번에 import하기 때문에, 흰화면
4.  npm run build가 성공했던 건 이게 import 경로 문제가 아니라 런타임 로직 버그였기 때문입니다.

수정
1. 랜덤 코드를 먼저 변수로 뽑고 그걸로 찾도록 분리 (attackevents.js)
2. 겸사겸사 InfrastructureView.jsx의 ./attackEvents import를 실제 파일명 attackevents.js에 맞게 고침 — macOS는 대소문자 구분 안 해서 지금은 안 터지지만 나중에 Docker(Linux)에서 빌드하면 같은 문제가 재발했을 부분