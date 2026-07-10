-- Staging table reading directly from events.normalized (정규화된 이벤트, ECS 서브셋
-- JSON). ClickHouse는 자기 컨슈머 그룹/오프셋을 독자적으로 관리한다
-- (kafka_group_name - normalizer/Data Prepper와 별개).
CREATE TABLE IF NOT EXISTS normalized_events_queue
(
    raw String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'kafka:9092',
    kafka_topic_list = 'events.normalized',
    kafka_group_name = 'clickhouse-normalized-consumer-group',
    kafka_format = 'JSONAsString',
    kafka_num_consumers = 1;

-- 컬럼형 통계/분석 엔진 대상 테이블 (Append-Only). "최근 1시간 가장 공격 많이 한 IP
-- Top 10" 같은 집계를 0.1초 안에 뽑아내는 게 목적이라, 여기서부터는 raw JSON 문자열이
-- 아니라 실제 타입이 박힌 컬럼으로 저장한다.
CREATE TABLE IF NOT EXISTS security_events_analytics
(
    timestamp                  DateTime,
    event_id                   String,
    event_module               LowCardinality(String),
    event_kind                 LowCardinality(String),
    event_outcome              LowCardinality(String),
    severity                   UInt8,
    rule_name                  String,
    source_ip                  IPv6,
    geo_country_iso_code       FixedString(2),
    user_name                  String,
    orchestrator_namespace     LowCardinality(String),
    orchestrator_resource_name String
)
ENGINE = MergeTree
ORDER BY (timestamp, event_module);

-- events.normalized JSON(NormalizedEvent, by_alias 직렬화라 키가 "source.ip"처럼
-- 점 표기 그대로인 flat JSON - 중첩 객체 아님)에서 JSONExtract로 타입 있는 컬럼을
-- 뽑아낸다. ClickHouse의 JSONExtract*는 점 포함 키를 리터럴로 찾으므로(경로 파싱
-- 안 함) 그대로 써도 된다 - Data Prepper의 표현식 문법과는 다르니 헷갈리지 말 것.
-- source_ip는 IPv4 문자열이 들어와도 toIPv6OrDefault가 IPv4-mapped IPv6
-- (::ffff:x.x.x.x)로 자동 변환해준다 - DDoS 등 고속 IP 집계용 단일 컬럼 통일.
CREATE MATERIALIZED VIEW IF NOT EXISTS security_events_analytics_mv TO security_events_analytics AS
SELECT
    parseDateTime64BestEffortOrZero(JSONExtractString(raw, '@timestamp')) AS timestamp,
    JSONExtractString(raw, 'event.id') AS event_id,
    JSONExtractString(raw, 'event.module') AS event_module,
    JSONExtractString(raw, 'event.kind') AS event_kind,
    JSONExtractString(raw, 'event.outcome') AS event_outcome,
    toUInt8(JSONExtractInt(raw, 'event.severity')) AS severity,
    -- rule.name은 Falco만, rule.id는 WAF만 채운다 - Top 10 랭킹용이라 소스 무관하게
    -- 하나로 합친다 (rule.name 우선, 없으면 rule.id).
    if(JSONExtractString(raw, 'rule.name') != '', JSONExtractString(raw, 'rule.name'), JSONExtractString(raw, 'rule.id')) AS rule_name,
    toIPv6OrDefault(JSONExtractString(raw, 'source.ip')) AS source_ip,
    toFixedString(if(JSONExtractString(raw, 'source.geo.country_iso_code') = '', '??', JSONExtractString(raw, 'source.geo.country_iso_code')), 2) AS geo_country_iso_code,
    JSONExtractString(raw, 'user.name') AS user_name,
    JSONExtractString(raw, 'orchestrator.namespace') AS orchestrator_namespace,
    JSONExtractString(raw, 'orchestrator.resource.name') AS orchestrator_resource_name
FROM normalized_events_queue;
