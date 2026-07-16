"""normalize_was() - nginx access log(JSON) -> NormalizedEvent. severity는
app/severity.yaml 실제 규칙을 그대로 태워서(모킹 없음) 오분류를 원본 배포
규칙 기준으로 잡는다."""
from app.normalizer import normalize_was


class TestNormalizeWas:
    def test_success_response_maps_outcome_and_default_severity(self, base_was_log):
        payload = base_was_log(status=200, method="GET", path="/rest/products")
        event = normalize_was(payload, "evt-1", "{}")
        assert event.event_module == "was"
        assert event.event_dataset == "was.access"
        assert event.event_action == "GET"
        assert event.event_outcome == "success"
        assert event.event_severity == 1
        assert event.url_path == "/rest/products"
        assert event.http_response_status_code == 200

    def test_error_response_maps_outcome_failure(self, base_was_log):
        payload = base_was_log(status=500)
        event = normalize_was(payload, "evt-2", "{}")
        assert event.event_outcome == "failure"

    def test_login_failure_gets_elevated_severity(self, base_was_log):
        # S19(로그인 브루트포스, correlation-engine/app/scenarios/network.yaml) 재료 -
        # severity.yaml의 유일한 was 예외 규칙(path_prefix+method+status).
        payload = base_was_log(method="POST", path="/rest/user/login", status=401)
        event = normalize_was(payload, "evt-3", "{}")
        assert event.event_severity == 2

    def test_login_success_keeps_default_severity(self, base_was_log):
        payload = base_was_log(method="POST", path="/rest/user/login", status=200)
        event = normalize_was(payload, "evt-4", "{}")
        assert event.event_severity == 1

    def test_login_failure_wrong_method_not_elevated(self, base_was_log):
        # 규칙이 method: POST까지 요구한다 - GET으로 그 경로에 401이 나도(예: 세션
        # 만료 체크) 브루트포스 신호가 아니므로 올라가면 안 된다.
        payload = base_was_log(method="GET", path="/rest/user/login", status=401)
        event = normalize_was(payload, "evt-5", "{}")
        assert event.event_severity == 1

    def test_login_path_prefix_covers_subpaths(self, base_was_log):
        payload = base_was_log(method="POST", path="/rest/user/login/2fa", status=403)
        event = normalize_was(payload, "evt-6", "{}")
        assert event.event_severity == 2

    def test_duration_converted_to_nanoseconds(self, base_was_log):
        payload = base_was_log(request_time="0.05")
        event = normalize_was(payload, "evt-7", "{}")
        assert event.event_duration == 50_000_000

    def test_orchestrator_fields_pass_through_when_present(self, base_was_log):
        payload = base_was_log(
            orchestrator_namespace="default",
            orchestrator_pod="juice-shop-abc123",
            target_name="juice-shop",
        )
        event = normalize_was(payload, "evt-8", "{}")
        assert event.orchestrator_namespace == "default"
        assert event.orchestrator_resource_type == "pod"
        assert event.orchestrator_resource_name == "juice-shop-abc123"
        assert event.target_name == "juice-shop"

    def test_orchestrator_fields_absent_when_not_in_payload(self, base_was_log):
        # was의 정적 폴백은 enrichment.py 책임 - normalize_was 자체는 채우지 않는다.
        event = normalize_was(base_was_log(), "evt-9", "{}")
        assert event.orchestrator_namespace is None
        assert event.orchestrator_resource_type is None
        assert event.orchestrator_resource_name is None
        assert event.target_name is None

    def test_container_name_is_hardcoded_nginx_was_logger(self, base_was_log):
        event = normalize_was(base_was_log(), "evt-10", "{}")
        assert event.container_name == "nginx-was-logger"

    def test_source_ip_prefers_xff_over_remote_addr(self, base_was_log):
        payload = base_was_log(http_x_forwarded_for="203.0.113.10", remote_addr="10.0.0.2")
        event = normalize_was(payload, "evt-11", "{}")
        assert event.source_ip == "203.0.113.10"

    def test_referrer_field_is_read_from_referrer_key(self, base_was_log):
        # 회귀 테스트(2026-07-15) - Techeer-12th-b의 juice-shop-nginx-configmap.yaml
        # log_format이 한때 JSON 키를 "referer"(HTTP 헤더 이름)로 내보내서,
        # normalize_was()가 읽는 "referrer"(ECS 표기)와 철자가 어긋나
        # http.request.referrer가 실제 Referer 헤더 값과 무관하게 항상 None이었다
        # - nginx 쪽 키를 "referrer"로 맞춰서 고쳤다(정규화 계약 쪽이 기준).
        payload = base_was_log(referrer="https://example.com/products")
        event = normalize_was(payload, "evt-12", "{}")
        assert event.http_request_referrer == "https://example.com/products"
