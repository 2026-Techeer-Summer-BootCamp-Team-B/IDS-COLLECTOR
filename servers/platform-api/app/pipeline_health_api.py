"""파이프라인 헬스 집계 - README가 "프론트엔드 팀에게 인계해야 할 집계 API 갭"으로
명시해둔 것 중 컨슈머 lag/DLQ 깊이/클록 차이 세 개(precision-recall은 별도 논의로 제외).
컨슈머 lag/DLQ 깊이는 이 서비스가 만드는 데이터가 아니라 normalizer/correlation-engine/
platform-api 자신의 Kafka 컨슈머 상태를 들여다보는 용도라 Kafka 자체에 AdminClient로
질의하고, 클록 차이는 OpenSearch attack-logs-* 표본으로 계산한다(ClickHouse엔
event.ingested 컬럼이 없어서).

주의: Kafka 관련 부분은 aiokafka==0.12.0(requirements.txt) API 기준으로 작성했고, 이
세션 환경에는 컴파일러가 없어 aiokafka를 직접 설치해 API를 검증하지 못했다 - 실제
브로커 대상으로 배포 후 한 번은 반드시 실측 확인할 것."""
import json
from typing import Any, Dict, List, Optional

from aiokafka import AIOKafkaConsumer, TopicPartition
from aiokafka.admin import AIOKafkaAdminClient
from fastapi import APIRouter

from app.config import settings
from app.opensearch_client import client as opensearch_client
from app.timeparse import parse_iso8601_safe

router = APIRouter(prefix="/stats", tags=["stats"])

# group_id -> 그 그룹이 구독하는 토픽. servers/docker-compose.yml의 각 서비스
# KAFKA_CONSUMER_GROUP/KAFKA_SOURCE_TOPICS/KAFKA_NORMALIZED_TOPIC 환경변수를 그대로
# 옮겨 적은 것 - 저쪽이 바뀌면 여기도 같이 바꿔야 한다(자동 동기화 아님).
# "platform-api-event-stream" 그룹(구 app/event_stream.py의 /ws/events 직접 tail
# 컨슈머)은 2026-07-14 계약 v1.1 §7에 따라 제거됨 - 더 이상 존재하지 않는 컨슈머
# 그룹의 lag을 모니터링하면 커밋이 영원히 안 되는 허수 lag만 나오므로 목록에서 뺐다.
_MONITORED_GROUPS: Dict[str, List[str]] = {
    "normalizer-workers": ["events.was", "events.waf", "events.falco", "events.audit"],
    "correlation-engine": ["events.normalized"],
}

# normalizer가 파싱/정규화 실패 시 버리는 대신 보내는 토픽(KAFKA_DLQ_TOPIC) - 이걸
# "소비"하는 컨슈머 그룹은 없으므로 lag이 아니라 절대 적재량(깊이)만 의미가 있다.
DLQ_TOPIC = "events.dlq"

# otel-collector의 routing 커넥터가 log.source가 알려진 4종(was/waf/falco/
# k8s-audit) 중 어디에도 안 걸리는 이벤트를 조용히 버리지 않고 보내는 토픽
# (servers/otel/config/otel-config.yaml, README "조용히 버려지지 않게" 참고).
# events.dlq와 마찬가지로 "소비"하는 컨슈머 그룹이 없어서(2026-07-15까지는 깊이
# 조회조차 없어서 사실상 완전히 안 보이는 상태였음 - events.dlq는 최소한
# /stats/dlq-depth라도 있었는데 이쪽은 그것조차 없었다) 깊이만 노출한다.
UNKNOWN_TOPIC = "events.unknown"

# events.dlq 원본 메시지 미리보기(peek)에서 raw 필드가 너무 길면 응답이 비대해지므로
# 여기서 자른다 - 전체 원본이 필요하면 Kafka에 직접 붙어야 함(이 엔드포인트는
# "지금 뭐가 왜 실패하고 있는지" 파악용이지 전체 포렌식 조회용이 아님).
_DLQ_PEEK_RAW_PREVIEW_CHARS = 2000


async def _topic_partitions(consumer: AIOKafkaConsumer, topics: List[str]) -> List[TopicPartition]:
    tps: List[TopicPartition] = []
    for topic in topics:
        partitions = consumer.partitions_for_topic(topic) or set()
        tps.extend(TopicPartition(topic, p) for p in partitions)
    return tps


async def _end_offsets(topics: List[str]) -> Dict[TopicPartition, int]:
    consumer = AIOKafkaConsumer(bootstrap_servers=settings.kafka_brokers)
    await consumer.start()
    try:
        tps = await _topic_partitions(consumer, topics)
        if not tps:
            return {}
        consumer.assign(tps)
        return await consumer.end_offsets(tps)
    finally:
        await consumer.stop()


async def _beginning_offsets(topics: List[str]) -> Dict[TopicPartition, int]:
    consumer = AIOKafkaConsumer(bootstrap_servers=settings.kafka_brokers)
    await consumer.start()
    try:
        tps = await _topic_partitions(consumer, topics)
        if not tps:
            return {}
        consumer.assign(tps)
        return await consumer.beginning_offsets(tps)
    finally:
        await consumer.stop()


@router.get("/consumer-lag")
async def get_consumer_lag() -> List[Dict[str, Any]]:
    """그룹별 (최신 오프셋 - 커밋된 오프셋) 합산 - 값이 클수록 그 컨슈머가 실시간
    유입 속도를 못 따라가고 있다는 뜻. 그룹 하나가 조회 실패해도 나머지는 반환한다.

    [실측 확인, 2026-07-14] 컨슈머 그룹이 막 시작해서 아직 한 번도 커밋한 적이
    없는 파티션은 committed_offset을 0으로 폴백하면 안 된다 - 그러면 "실제로는
    막 시작해서 곧 따라잡을 것"인 상태가 "토픽 전체 분량만큼 뒤처졌다"는 가짜
    lag(예: 재시작 직후 실측 54565)으로 보인다. 이런 파티션은 합산에서 빼고
    uncommitted_partitions로 별도 표시한다 - 프론트는 이 목록이 비어있지 않으면
    total_lag 숫자를 그대로 경보에 쓰지 말고 "막 시작함"으로 취급할 것."""
    admin = AIOKafkaAdminClient(bootstrap_servers=settings.kafka_brokers)
    await admin.start()
    results: List[Dict[str, Any]] = []
    try:
        for group_id, topics in _MONITORED_GROUPS.items():
            try:
                end_offsets = await _end_offsets(topics)
                committed = await admin.list_consumer_group_offsets(group_id)

                by_topic: Dict[str, int] = {}
                total_lag = 0
                uncommitted_partitions: List[str] = []
                for tp, end_offset in end_offsets.items():
                    offset_meta = committed.get(tp)
                    if offset_meta is None:
                        uncommitted_partitions.append(f"{tp.topic}-{tp.partition}")
                        continue
                    lag = max(end_offset - offset_meta.offset, 0)
                    by_topic[tp.topic] = by_topic.get(tp.topic, 0) + lag
                    total_lag += lag

                results.append(
                    {
                        "group": group_id,
                        "total_lag": total_lag,
                        "by_topic": by_topic,
                        "uncommitted_partitions": uncommitted_partitions,
                        "error": None,
                    }
                )
            except Exception as e:
                results.append(
                    {
                        "group": group_id,
                        "total_lag": None,
                        "by_topic": {},
                        "uncommitted_partitions": [],
                        "error": str(e),
                    }
                )
    finally:
        await admin.close()
    return results


async def get_topic_depth(topic: str) -> int:
    end_offsets = await _end_offsets([topic])
    beginning_offsets = await _beginning_offsets([topic])
    return sum(max(end_offset - beginning_offsets.get(tp, 0), 0) for tp, end_offset in end_offsets.items())


@router.get("/dlq-depth")
async def get_dlq_depth() -> Dict[str, Any]:
    """events.dlq에 현재 쌓여 있는 메시지 수(파티션별 최신-시작 오프셋 차이 합산)."""
    return {"topic": DLQ_TOPIC, "depth": await get_topic_depth(DLQ_TOPIC)}


@router.get("/unknown-depth")
async def get_unknown_depth() -> Dict[str, Any]:
    """events.unknown(log.source 미매칭 이벤트, otel-collector가 조용히 버리지
    않으려고 분리해둔 토픽)의 적재량 - events.dlq와 같은 방식으로 계산한다.
    2026-07-15 이전에는 이 토픽에 깊이 조회조차 없어서 events.dlq보다도 더
    안 보이는 상태였다(실측 확인 후 추가)."""
    return {"topic": UNKNOWN_TOPIC, "depth": await get_topic_depth(UNKNOWN_TOPIC)}


@router.get("/dlq-peek")
async def get_dlq_peek(limit: int = 20) -> Dict[str, Any]:
    """events.dlq에 실제로 쌓인 메시지 내용(source/error/raw 미리보기)을 최신
    순으로 최대 `limit`건 읽어온다 - 2026-07-15 이전에는 /stats/dlq-depth로
    "몇 건 쌓였는지"만 알 수 있었고 "뭐가 왜 실패했는지"는 kafka-console-consumer로
    컨테이너에 직접 들어가야만 볼 수 있었다(실측 확인 후 추가).

    group_id 없이 매번 새로 붙는 일회성 컨슈머라 실제 컨슈머 그룹의 커밋 오프셋에는
    전혀 영향을 주지 않는다(이 토픽은 애초에 소비하는 그룹 자체가 없다 - 위 주석
    참고) - 순수 조회 전용. 각 파티션의 끝에서 최대 `limit`개를 seek해서 읽으므로
    파티션이 여러 개면 파티션별로 최대 `limit`개씩 읽힐 수 있다(전역 정확히
    최신 N건 순서 보장은 아님 - 그 정도까지 필요하면 Kafka에 직접 붙을 것)."""
    limit = max(1, min(limit, 200))
    consumer = AIOKafkaConsumer(bootstrap_servers=settings.kafka_brokers)
    await consumer.start()
    try:
        tps = await _topic_partitions(consumer, [DLQ_TOPIC])
        if not tps:
            return {"topic": DLQ_TOPIC, "messages": []}

        consumer.assign(tps)
        end_offsets = await consumer.end_offsets(tps)
        beginning_offsets = await consumer.beginning_offsets(tps)
        messages: List[Dict[str, Any]] = []
        for tp in tps:
            end = end_offsets.get(tp, 0)
            beginning = beginning_offsets.get(tp, 0)
            # 파티션 끝에서 최대 limit개만 읽도록 시작 오프셋을 뒤에서부터 잡되,
            # beginning보다 앞으로는 안 간다(파티션에 limit개보다 적게 있는 경우).
            start = max(end - limit, beginning)
            if start >= end:
                continue
            consumer.seek(tp, start)

        remaining = limit
        while remaining > 0:
            batch = await consumer.getmany(timeout_ms=1000, max_records=remaining)
            if not batch:
                break
            got_any = False
            for tp, records in batch.items():
                for record in records:
                    got_any = True
                    raw_text = record.value.decode("utf-8", errors="replace") if record.value else ""
                    try:
                        envelope = json.loads(raw_text)
                    except json.JSONDecodeError:
                        envelope = {"source": None, "error": None, "raw": raw_text}
                    messages.append(
                        {
                            "partition": tp.partition,
                            "offset": record.offset,
                            "timestamp": record.timestamp,
                            "source": envelope.get("source"),
                            "error": envelope.get("error"),
                            "raw_preview": (envelope.get("raw") or "")[:_DLQ_PEEK_RAW_PREVIEW_CHARS],
                        }
                    )
                    remaining -= 1
                    if remaining <= 0:
                        break
                if remaining <= 0:
                    break
            if not got_any:
                break

        messages.sort(key=lambda m: m["timestamp"], reverse=True)
        return {"topic": DLQ_TOPIC, "messages": messages[:limit]}
    finally:
        await consumer.stop()


def _percentile(sorted_data: List[float], pct: float) -> float:
    idx = min(int(len(sorted_data) * pct), len(sorted_data) - 1)
    return sorted_data[idx]


@router.get("/clock-skew")
async def get_clock_skew(
    start: Optional[str] = None, end: Optional[str] = None, sample: int = 1000
) -> Dict[str, Any]:
    """@timestamp(사건 실제 발생 시각)와 event.ingested(파이프라인 수신 시각) 차이(ms) 분포.
    ClickHouse의 security_events_analytics엔 event.ingested 컬럼이 없어서
    (datastore/clickhouse/init/001-kafka-engine.sql 참고) OpenSearch attack-logs-*에서
    표본을 뽑아 파이썬에서 직접 계산한다 - 전수 집계가 아니라 최근 `sample`건 표본 기준."""
    must: List[Dict[str, Any]] = []
    if start or end:
        time_range: Dict[str, str] = {}
        if start:
            time_range["gte"] = start
        if end:
            time_range["lte"] = end
        must.append({"range": {"@timestamp": time_range}})
    query = {"bool": {"filter": must}} if must else {"match_all": {}}

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "query": query,
            "sort": [{"@timestamp": {"order": "desc"}}],
            "size": min(sample, 5000),
            "_source": ["@timestamp", "event.ingested"],
        },
    )

    deltas_ms: List[float] = []
    for hit in result["hits"]["hits"]:
        source = hit["_source"]
        ts = parse_iso8601_safe(source.get("@timestamp"))
        ingested = parse_iso8601_safe(source.get("event.ingested"))
        if ts is None or ingested is None:
            continue
        deltas_ms.append((ingested - ts).total_seconds() * 1000)

    if not deltas_ms:
        return {"sample_size": 0, "p50_ms": None, "p95_ms": None, "max_ms": None}

    deltas_ms.sort()
    return {
        "sample_size": len(deltas_ms),
        "p50_ms": round(_percentile(deltas_ms, 0.50), 1),
        "p95_ms": round(_percentile(deltas_ms, 0.95), 1),
        "max_ms": round(deltas_ms[-1], 1),
    }
