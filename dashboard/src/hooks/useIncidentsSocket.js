import { useEffect, useRef } from "react";
import { wsUrl } from "../lib/authApi";

// /ws/incidents(상관분석 엔진 발화를 그대로 릴레이, servers/platform-api/app/
// websocket.py) 구독 훅. 페이로드 형태를 프론트가 가정하지 않고 "뭔가 새로
// 왔다"는 신호로만 쓴다 — 호출부(useIncidents의 reload)가 GET /incidents를
// 다시 불러 목록을 최신화하게 한다. 자동 재연결은 없음(연결이 끊기면 다음
// 탭 재방문/새로고침 때 정상 목록으로 복구) - LiveTicker/CriticalAlertPopup은
// 여전히 별도의 mock(useLiveFeed.js) 경로라 이 훅과 무관하다.
export function useIncidentsSocket(onMessage) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let ws;
    try {
      ws = new WebSocket(wsUrl("/ws/incidents"));
      ws.onmessage = () => onMessageRef.current?.();
    } catch {
      // WebSocket 생성 자체가 실패해도(구형 브라우저 등) 나머지 페이지는 계속
      // 동작해야 하므로 조용히 무시 - 실시간 갱신만 빠지고 최초 로드는 정상.
    }
    return () => {
      ws?.close();
    };
  }, []);
}
