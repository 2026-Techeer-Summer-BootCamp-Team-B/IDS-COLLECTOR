# IDS-COLLECTOR

kafka 트러블 슈팅
1. Bitnami 이미지 → Apache 공식 이미지로 교체 (무료 이미지 정책 변경 이슈)
2. 단일 노드 Kafka는 offsets.topic.replication.factor=1로 반드시 낮춰야 함
3. 컨테이너 안에서 exec할 땐 EXTERNAL(9092) 아니라 내부 리스너(9094) 써야 함