import { useEffect, useRef, useState } from "react";
import { wsUrl } from "../lib/authApi";
import { mapLogDoc } from "../lib/normalizedEvent";
import { getRealSeverityMeta } from "../data/realSeverity";

// WS /ws/events (servers/platform-api/app/event_stream.py) — events.normalized
// 토픽을 그대로 tail하는 개별 이벤트 스트림. 이전엔 ATTACK_EVENTS(mock)를
// setInterval로 재생했는데, 그 mock은 attackType/blocked/country 같은 실제
// 이벤트엔 없는 필드를 갖고 있어서 그대로 실데이터로 못 바꾼다 — 소비하는 쪽
// (LiveTicker/CriticalAlertPopup)도 같이 real 필드(mapLogDoc 결과: module/
// source/message/sourceIp/namespace/pod)로 다시 그렸다.
//
// 재연결: 서버가 재시작되거나 네트워크가 끊기면 onclose가 불리는데, 지수
// 백오프(1s -> 2s -> 4s ... 최대 10s)로 재시도한다. auto_offset_reset=latest라
// 재연결 시점 이전 이벤트는 리플레이되지 않는다(백엔드 주석 참고) - 티커 용도라
// 문제없음.
const MAX_BACKOFF_MS = 10000;

export function useLiveAttackFeed({ feedLimit = 40 } = {}) {
  const [feed, setFeed] = useState([]);
  const [lastCritical, setLastCritical] = useState(null);
  const wsRef = useRef(null);
  const backoffRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    closedByUsRef.current = false;

    function connect() {
      const ws = new WebSocket(wsUrl("/ws/events"));
      wsRef.current = ws;

      ws.onopen = () => {
        backoffRef.current = 1000; // 연결 성공하면 백오프 리셋
      };

      ws.onmessage = (msg) => {
        let doc;
        try {
          doc = JSON.parse(msg.data);
        } catch {
          return; // 파싱 안 되는 메시지는 조용히 무시
        }
        const event = mapLogDoc(doc);
        setFeed((prev) => [event, ...prev].slice(0, feedLimit));
        if (getRealSeverityMeta(event.severity).key === "CRITICAL") {
          setLastCritical(event);
        }
      };

      ws.onclose = () => {
        if (closedByUsRef.current) return;
        timerRef.current = setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      closedByUsRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [feedLimit]);

  return { feed, lastCritical };
}
