-- actor_identity 컬럼 추가(2026-07-19, correlation-engine join_on=user_or_sa로
-- was/waf/falco를 k8s_audit까지 잇는 신원 브릿지 필드 - normalizer/app/enrichment.py,
-- correlation-engine/app/rules.py의 _join_key() 참고).
--
-- init/001-kafka-engine.sql의 CREATE TABLE/VIEW는 "IF NOT EXISTS"라 이미 데이터가 있는
-- 기존 배포에서는 컨테이너가 재시작돼도 재실행되지 않는다(ClickHouse 공식 이미지가
-- "Database directory appears to contain a database; Skipping initialization"으로
-- 건너뜀 - 실측 확인). 그래서 이미 떠 있는 서버에 새 컬럼을 자동으로 반영하려면
-- init 스크립트가 아니라 별도의 멱등(idempotent) 마이그레이션이 필요하다 - 이 파일은
-- docker-compose.yml의 clickhouse-migrate 서비스가 `docker compose up`마다 매번
-- 실행한다(컨테이너가 이미 처음이 아니어도 매번 돈다는 게 init/와의 핵심 차이).
--
-- geo_city_name/geo_lat/geo_lon(2026-07-16 도입분)도 ADD COLUMN IF NOT EXISTS로 같이
-- 넣는다 - 이 마이그레이션이 뷰를 무조건 DROP 후 새 SELECT로 재생성하므로, 그 SELECT가
-- "지금 테이블에 실제로 있는 전체 컬럼"과 어긋나면(이 필드들이 없는 채로 재생성되면)
-- 이미 이 필드를 갖고 있던 배포에서조차 새로 들어오는 이벤트는 채워지지 않게 되는
-- 회귀가 생긴다 - 그래서 001-kafka-engine.sql이 이미 알고 있던 두 번의 스키마 변경을
-- 전부 한 번에 멱등하게 정리하는 스크립트로 작성한다(다음 스키마 변경 때는 이 파일을
-- 고치지 말고 003-... 로 새로 추가할 것 - 뷰 재생성 로직만 그대로 복사).
ALTER TABLE security_events_analytics
    ADD COLUMN IF NOT EXISTS geo_city_name String AFTER geo_country_iso_code,
    ADD COLUMN IF NOT EXISTS geo_lat Float64 AFTER geo_city_name,
    ADD COLUMN IF NOT EXISTS geo_lon Float64 AFTER geo_lat,
    ADD COLUMN IF NOT EXISTS actor_identity String AFTER user_name;

DROP TABLE IF EXISTS security_events_analytics_mv;

CREATE MATERIALIZED VIEW security_events_analytics_mv TO security_events_analytics AS
SELECT
    parseDateTime64BestEffortOrZero(JSONExtractString(raw, '@timestamp')) AS timestamp,
    JSONExtractString(raw, 'event.id') AS event_id,
    JSONExtractString(raw, 'event.module') AS event_module,
    JSONExtractString(raw, 'event.kind') AS event_kind,
    JSONExtractString(raw, 'event.outcome') AS event_outcome,
    toUInt8(JSONExtractInt(raw, 'event.severity')) AS severity,
    if(JSONExtractString(raw, 'rule.name') != '', JSONExtractString(raw, 'rule.name'), JSONExtractString(raw, 'rule.id')) AS rule_name,
    toIPv6OrDefault(JSONExtractString(raw, 'source.ip')) AS source_ip,
    toFixedString(if(JSONExtractString(raw, 'source.geo.country_iso_code') = '', '??', JSONExtractString(raw, 'source.geo.country_iso_code')), 2) AS geo_country_iso_code,
    JSONExtractString(raw, 'source.geo.city_name') AS geo_city_name,
    JSONExtractFloat(raw, 'source.geo.location.lat') AS geo_lat,
    JSONExtractFloat(raw, 'source.geo.location.lon') AS geo_lon,
    JSONExtractString(raw, 'user.name') AS user_name,
    JSONExtractString(raw, 'actor.identity') AS actor_identity,
    JSONExtractString(raw, 'orchestrator.namespace') AS orchestrator_namespace,
    JSONExtractString(raw, 'orchestrator.resource.name') AS orchestrator_resource_name
FROM normalized_events_queue;
