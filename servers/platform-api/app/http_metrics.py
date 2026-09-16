"""요청 지연 히스토그램 (P8, 2026-09-16) - SENTINEL-OPS 블로그 시리즈 ⑦ toxiproxy
드릴의 재발방지 항목 중 하나("API 응답시간이라는 개념 자체가 없다")에 대한 조치.
main.py의 GatewaySecretMiddleware와 같은 이유로 BaseHTTPMiddleware가 아니라 순수
ASGI 미들웨어로 작성한다(main.py 모듈 docstring/GatewaySecretMiddleware 참고 -
BaseHTTPMiddleware가 call_next 이후 로직을 별도 task로 스폰하는 데서 오는 알려진
문제들을 피하기 위함).

라벨에 원시 요청 경로(scope["path"])를 그대로 쓰지 않고 FastAPI가 등록한 라우트
템플릿(예: "/incidents/{incident_id}")으로 정규화한다 - 안 그러면 인시던트 ID처럼
매번 달라지는 값마다 새 라벨 조합(시계열)이 생겨서 카디널리티가 무한정 늘어난다.
Starlette 1.6.0 기준 scope["route"]는 Router가 매칭을 마친 뒤에도 자동으로
채워지지 않아서(scope["endpoint"]/scope["path_params"]만 채움 - 직접 소스 확인),
라우터가 할 매칭을 미들웨어 진입 시점에 한 번 더 똑같이 수행해 경로 템플릿을
알아낸다."""
import time

from prometheus_client import CONTENT_TYPE_LATEST, Histogram, generate_latest
from starlette.routing import Match

REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "platform-api 요청 처리 시간(초)",
    ["method", "path", "status"],
)


def _route_template(scope) -> str:
    app = scope.get("app")
    if app is None:
        return scope["path"]
    for route in app.router.routes:
        match, _ = route.matches(scope)
        if match == Match.FULL:
            return getattr(route, "path", scope["path"])
    return scope["path"]  # 매칭되는 라우트가 없음(404) - 원시 경로 그대로 기록


class RequestMetricsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = _route_template(scope)
        start = time.monotonic()
        status_holder = {"code": 500}  # 응답 시작 전에 예외로 죽으면 500으로 기록

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            REQUEST_DURATION.labels(
                method=scope["method"], path=path, status=str(status_holder["code"])
            ).observe(time.monotonic() - start)


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST
