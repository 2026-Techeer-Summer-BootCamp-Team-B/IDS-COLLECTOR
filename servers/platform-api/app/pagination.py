"""커서 기반 페이지네이션 공통 유틸.

`/logs`(OpenSearch)와 `/incidents`(Postgres)는 저장소가 다르지만 커서 자체의
모양(정렬 키 값들을 담은 불투명 토큰)은 같다 - 클라이언트는 내용을 몰라도 되고,
응답 헤더(`X-Next-Cursor`)로 받은 값을 다음 요청의 `cursor` 쿼리파라미터에
그대로 돌려주기만 하면 다음 페이지를 받는다.

응답 바디는 그대로 배열을 유지한다(`X-Next-Cursor` 헤더로만 다음 페이지 존재
여부/커서를 알린다) - 기존에 이 배열을 그대로 소비하던 프론트(dashboard/src/
hooks/useLogs.js, useIncidents.js 등)가 커서 기능을 실제로 쓰기 전까지는 전혀
안 바뀌어도 되게 하기 위한 선택. limit(페이지 크기)은 기존처럼 그대로 유지 -
이전엔 그게 "전체 조회 가능한 최대치"였지만 이제는 "한 페이지 크기"일 뿐이고,
cursor로 계속 다음 페이지를 요청하면 그 이상도 전부 조회할 수 있다."""
import base64
import json
from typing import Any

_HEADER_NAME = "X-Next-Cursor"


def encode_cursor(value: Any) -> str:
    raw = json.dumps(value, default=str).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def decode_cursor(cursor: str) -> Any:
    """형식이 깨진 커서(위변조/오래된 프론트 버전 등)는 400으로 명확히 알린다 -
    조용히 무시하고 처음부터 다시 보여주면 클라이언트가 무한 루프에 빠질 수 있다."""
    from fastapi import HTTPException

    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii"))
        return json.loads(raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid cursor: {e}")


def set_next_cursor_header(response, value: Any) -> None:
    response.headers[_HEADER_NAME] = encode_cursor(value)
