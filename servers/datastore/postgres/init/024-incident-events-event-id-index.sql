-- event_id로 "이 이벤트가 어느 인시던트에 속하나"를 직접 조회할 수 있게 인덱스를
-- 추가한다(2026-07-17). 기존엔 incident_id에만 인덱스가 있어서, 프론트가
-- "이 event_id가 속한 인시던트"를 찾으려면 correlation_key로 후보를 추린 뒤
-- 후보마다 /incidents/{id}/events를 따로 조회해서 검증하는 우회 방식을 썼다
-- (후보가 MAX_MATCH_CANDIDATES를 넘으면 진짜 정답이 후보에서 빠질 수 있는 구조적
-- 약점도 있었음). 이 인덱스로 GET /events/{event_id}/incident(platform-api
-- app/incidents_api.py)가 한 번의 인덱스 조회로 정확하게 답할 수 있다.
CREATE INDEX IF NOT EXISTS idx_incident_events_event_id ON incident_events (event_id);
