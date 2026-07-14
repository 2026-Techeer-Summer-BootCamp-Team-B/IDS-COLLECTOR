"""쿼리스트링/응답 필드로 오가는 ISO8601 시각 문자열을 datetime으로 변환.

프론트는 전부 `start`/`end`/`since`(ISO8601, 'Z' 접미사 + 밀리초 포함, 예:
"2026-07-14T10:57:10.000Z")로 시각을 보낸다(dashboard/src/lib/authApi.js 관례).
OpenSearch(logs_api.py/stats_api.py/events_api.py)는 이 문자열을 query DSL에
그대로 넣어도 알아서 파싱하지만, ClickHouse/Postgres는 드라이버가 문자열을
암묵적으로 datetime으로 변환해주지 않는다 - 각 라우터가 직접
`datetime.fromisoformat(...)`을 부르게 두면 구현이 갈라지기 쉽다(2026-07-14,
analytics_api.py의 ClickHouse `/stats/top-ips`는 문자열을 그대로 바인딩해 Code 53
TYPE_MISMATCH로 500이 났고, incidents_api.py의 Postgres `/incidents?since=`는
asyncpg가 문자열 바인딩 자체를 거부해 500이 났다 - 같은 실수가 allow_list_api.py/
pipeline_health_api.py에도 각자 복제돼 있었다). 이 파일 하나로 통일해서 ClickHouse/
Postgres를 다루는 라우터를 새로 추가할 때도 같은 실수가 반복될 여지를 없앤다."""
from datetime import datetime
from typing import Optional


def parse_iso8601(value: str) -> datetime:
    """'Z' 접미사(UTC) ISO8601 문자열을 datetime으로 변환한다. Python의
    datetime.fromisoformat()은 'Z'를 인식하지 못해(3.11 기준) 'Z'를 명시적
    오프셋('+00:00')으로 바꿔줘야 한다 - 값에 오프셋이 이미 있으면(예: '+09:00')
    그대로 통과시킨다. ClickHouse(clickhouse-connect)/Postgres(asyncpg) 양쪽 다
    문자열이 아니라 datetime 객체를 바인딩해야 컬럼 타입에 맞게 직렬화된다.
    값이 비어있거나 형식이 깨졌으면 ValueError를 그대로 던진다(필수 파라미터용) -
    없어도 되는 값이면 parse_iso8601_optional을, 실패해도 그냥 건너뛰어야 하면
    parse_iso8601_safe를 대신 쓸 것."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def parse_iso8601_optional(value: Optional[str]) -> Optional[datetime]:
    """값이 없으면 None, 있으면 parse_iso8601과 동일(형식이 깨졌으면 ValueError를
    그대로 던짐 - 잘못 입력된 값을 조용히 None으로 눙치면 "만료 없음"처럼 원래
    의도와 반대되는 결과가 나올 수 있는 자리(예: allow_list의 expires_at)에서 쓴다."""
    if not value:
        return None
    return parse_iso8601(value)


def parse_iso8601_safe(value: Optional[str]) -> Optional[datetime]:
    """값이 없거나 형식이 깨졌으면 조용히 None(예외를 던지지 않음). 우리가 직접
    검증하지 않은 값(예: OpenSearch 응답 필드) 여러 건을 순회하면서 하나가
    깨졌다고 전체 계산을 죽이면 안 되는 자리(pipeline_health_api.py의 clock-skew
    표본 집계)에서 쓴다."""
    if not value:
        return None
    try:
        return parse_iso8601(value)
    except ValueError:
        return None
