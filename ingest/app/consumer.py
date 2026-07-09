import asyncio
import json
from aiokafka import AIOKafkaConsumer
from app.config import settings

async def consume_logs():
    # 환경변수 주소 가져오기 (없으면 로컬 기본값 매칭)
    brokers = getattr(settings, "KAFKA_BROKERS", "localhost:9092")
    print(f"🔗 [Kafka Consumer] {brokers} 브로커로 연결을 시도합니다...")
    
    # 💡 에러를 유발하던 타임아웃 관련 옵션들을 통째로 도려내고 필수 인자만 남김
    consumer = AIOKafkaConsumer(
        "app-logs", 
        "falco-alerts", 
        "k8s-audit",
        bootstrap_servers=brokers,
        group_id="ingest-workers"
    )
    
    try:
        # 소비자 가동
        await consumer.start()
        print("跑 [Kafka Consumer] 토픽 감시 및 로그 인출 프로세스 가동 완료!")
        
        # 카프카 브로커로부터 로그를 무한히 인출하여 전처리하는 루프
        async for msg in consumer:
            topic = msg.topic
            log_data = json.loads(msg.value.decode('utf-8'))
            raw_log = log_data.get("raw_log", "")
            
            if topic == "falco-alerts":
                print(f"🚨 [Consumer 처리] Falco 경고 분석 -> {raw_log[:40]}...")
            elif topic == "k8s-audit":
                print(f"☸️ [Consumer 처리] K8s Audit 로그 스캔 중")
            else:
                print(f"📱 [Consumer 처리] 일반 앱 로그 정규화 중")
                
    except Exception as e:
        print(f"❌ [Kafka Consumer 치명적 에러] 구동 실패: {str(e)}")
    finally:
        await consumer.stop()
        print("🔌 [Kafka Consumer] 소비자 프로세스가 종료되었습니다.")

if __name__ == '__main__':
    try:
        asyncio.run(consume_logs())
    except Exception as e:
        print(f"❌ [Main] 실행 중 오류 발생: {e}")