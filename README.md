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