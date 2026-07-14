import { useEffect, useRef, useState } from "react";
import { fetchEventsSince } from "../lib/authApi";
import { mapLogDoc } from "../lib/normalizedEvent";
import { getRealSeverityMeta } from "../data/realSeverity";
import { LIVE_POLL_MS } from "../data/timeSeries";
import { usePoll } from "./usePoll";

// GET /events/recent (servers/platform-api/app/events_api.py) 폴링 — events.normalized를
// 직접 tail하던 WS(/ws/events, 구 servers/platform-api/app/event_stream.py)를 대체한다
// (계약 v1.1 §7, 2026-07-14 팀 합의로 WS/pub-sub 경로 완전 제거). 다른 실데이터 패널과
// 같은 LIVE_POLL_MS(2초) 간격으로 폴링하되, since(마지막으로 받은 이벤트의 @timestamp)를
// 넘겨서 같은 이벤트를 중복 수신하지 않는다.
//
// since 유무에 따라 응답 정렬이 다르다(app/events_api.py 참고): since 없는 최초 호출은
// 최신순(desc), since를 준 이후 호출은 그 시각 이후 이벤트를 오래된순(asc)으로 준다 -
// 화면은 항상 최신이 맨 앞이어야 하므로 이후 호출분은 뒤집어서 앞에 붙인다.
export function useLiveAttackFeed({ feedLimit = 40 } = {}) {
  const [feed, setFeed] = useState([]);
  const [lastCritical, setLastCritical] = useState(null);
  const sinceRef = useRef(null);
  const pollTick = usePoll(LIVE_POLL_MS);

  useEffect(() => {
    let cancelled = false;
    const isInitialLoad = sinceRef.current == null;

    fetchEventsSince(sinceRef.current, feedLimit)
      .then((docs) => {
        if (cancelled || !docs?.length) return;

        const events = docs.map(mapLogDoc);
        const ordered = isInitialLoad ? events : [...events].reverse();

        // 다음 폴링의 since = 이번 배치에서 가장 최신인 이벤트의 원본 @timestamp
        // (desc면 배열 첫 항목, asc면 마지막 항목이 최신).
        sinceRef.current = isInitialLoad ? docs[0]["@timestamp"] : docs[docs.length - 1]["@timestamp"];

        setFeed((prev) => [...ordered, ...prev].slice(0, feedLimit));

        const critical = ordered.find((e) => getRealSeverityMeta(e.severity).key === "CRITICAL");
        if (critical) setLastCritical(critical);
      })
      .catch(() => {
        // 폴링 실패는 조용히 무시하고 다음 tick에 재시도(옛 WS의 재연결 백오프와
        // 동일한 fail-soft 정책 - 폴링이라 재연결 상태 관리 자체가 필요 없어졌다).
      });

    return () => {
      cancelled = true;
    };
  }, [pollTick, feedLimit]);

  return { feed, lastCritical };
}
