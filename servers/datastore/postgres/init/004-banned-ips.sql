-- IP 차단 기록(P5-1 연장). 이 프로젝트엔 실제 방화벽/iptables/WAF 제어 API가 없어서
-- 여기 기록해도 트래픽이 실제로 막히진 않는다 - "차단 처리됨"을 기록/감사하는
-- 용도까지만이다. allow_list(예외 허용, target 스코프 가능)와 반대 개념이지만
-- target_id 스코프 없이 전역으로만 둔다(대시보드의 "차단" 버튼이 특정 target을
-- 고르지 않으므로).
CREATE TABLE IF NOT EXISTS banned_ips (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_or_cidr  TEXT NOT NULL,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    unbanned_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_banned_ips_active ON banned_ips (ip_or_cidr) WHERE unbanned_at IS NULL;
