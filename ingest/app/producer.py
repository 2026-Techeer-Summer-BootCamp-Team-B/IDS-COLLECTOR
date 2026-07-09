import json
from aiokafka import AIOKafkaProducer
from app.config import settings

class LogProducer:
    def __init__(self):
        # 💡 생성자에서는 주소만 보관하고 객체 생성은 start() 내부로 위임 (에러 해결 핵심)
        self.brokers = getattr(settings, "KAFKA_BROKERS", "localhost:9092")
        self.producer = None

    async def start(self):
        """gRPC 서버가 활성화된 비동기 루프 안에서 프로듀서 객체를 진짜로 생성하고 연결"""
        if self.producer is None:
            self.producer = AIOKafkaProducer(bootstrap_servers=self.brokers)
            
        await self.producer.start()
        print("🔌 [Kafka Producer] 카프카 브로커와 비동기 연결 성공")

    async def stop(self):
        """서버가 꺼질 때 연결을 안전하게 종료"""
        if self.producer:
            await self.producer.stop()
            print("🔌 [Kafka Producer] 카프카 브로커 연결 안전하게 종료")

    async def send_log(self, topic: str, log_data: dict):
        """지정한 토픽으로 로그를 던지는 함수"""
        try:
            if self.producer is None:
                raise RuntimeError("Producer가 아직 시작되지 않았습니다. start()를 먼저 호출하세요.")
                
            payload = json.dumps(log_data).encode('utf-8')
            await self.producer.send_and_wait(topic, payload)
            print(f"📥 [Kafka Producer] {topic} 토픽으로 로그 적재 완료")
        except Exception as e:
            print(f"❌ [Kafka Producer 발송 에러] {str(e)}")