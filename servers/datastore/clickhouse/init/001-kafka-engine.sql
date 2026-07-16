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
-- PARTITION BY toDate(timestamp) + TTL 14일 (2026-07-16, docs/reports/
-- repo-audit-20260715.md §3.2 - 이전엔 파티셔닝도 TTL도 없어 무기한 누적됐다).
-- 3등급 보존 체계에서 "파생"(derived) 데이터에 해당 - retention_days는 Postgres
-- log_policies."파생" 행과 값을 맞춰서 관리한다(이 테이블은 폴링이 아니라
-- ClickHouse 자체 TTL 머지 프로세스가 만료 파티션을 지운다 - app/log_retention.py는
-- Postgres/OpenSearch만 다룬다).
--
-- ⚠️ 이미 배포된 서버는 이 CREATE TABLE IF NOT EXISTS가 재실행돼도 기존 테이블에
-- PARTITION BY/TTL이 소급 적용되지 않는다(ClickHouse는 테이블 생성 후 PARTITION BY
-- 변경을 지원하지 않음) - 수동 DROP+재생성 절차가 필요하다(docs/reports/
-- retention-patch-20260716.md 배포 절차 참고).
--
-- ⚠️ geo_city_name/geo_lat/geo_lon(2026-07-16, GeoLite2-City 도입)도 마찬가지로 이미
-- 배포된 서버에는 소급 적용되지 않는다 - 수동으로 다음을 먼저 실행할 것:
--   ALTER TABLE security_events_analytics
--     ADD COLUMN geo_city_name String AFTER geo_country_iso_code,
--     ADD COLUMN geo_lat Float64 AFTER geo_city_name,
--     ADD COLUMN geo_lon Float64 AFTER geo_lat;
--   DROP TABLE security_events_analytics_mv; -- 아래 새 SELECT로 재생성됨
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
    geo_city_name               String,
    geo_lat                     Float64,
    geo_lon                     Float64,
    user_name                  String,
    orchestrator_namespace     LowCardinality(String),
    orchestrator_resource_name String
)
ENGINE = MergeTree
PARTITION BY toDate(timestamp)
ORDER BY (timestamp, event_module)
TTL timestamp + INTERVAL 14 DAY;

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
    JSONExtractString(raw, 'source.geo.city_name') AS geo_city_name,
    JSONExtractFloat(raw, 'source.geo.location.lat') AS geo_lat,
    JSONExtractFloat(raw, 'source.geo.location.lon') AS geo_lon,
    JSONExtractString(raw, 'user.name') AS user_name,
    JSONExtractString(raw, 'orchestrator.namespace') AS orchestrator_namespace,
    JSONExtractString(raw, 'orchestrator.resource.name') AS orchestrator_resource_name
FROM normalized_events_queue;
