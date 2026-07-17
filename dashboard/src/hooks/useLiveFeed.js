import { useEffect, useRef, useState } from "react";
import { fetchEventsSince } from "../lib/authApi";
import { mapLogDoc } from "../lib/normalizedEvent";
import { getRealSeverityMeta } from "../data/realSeverity";
import { usePoll } from "./usePoll";
import { usePollInterval } from "../context/PollIntervalContext";

// GET /events/recent (servers/platform-api/app/events_api.py) 폴링 — events.normalized를
// 직접 tail하던 WS(/ws/events, 구 servers/platform-api/app/event_stream.py)를 대체한다
// (계약 v1.1 §7, 2026-07-14 팀 합의로 WS/pub-sub 경로 완전 제거). 다른 실데이터 패널과
// 같은 간격(usePollInterval, Admin 페이지에서 커스텀 가능 - 기본 2초)으로 폴링하되,
// since(마지막으로 받은 이벤트의 @timestamp)를 넘겨서 같은 이벤트를 중복 수신하지 않는다.
//
// since 유무에 따라 응답 정렬이 다르다(app/events_api.py 참고): since 없는 최초 호출은
// 최신순(desc), since를 준 이후 호출은 그 시각 이후 이벤트를 오래된순(asc)으로 준다 -
// 화면은 항상 최신이 맨 앞이어야 하므로 이후 호출분은 뒤집어서 앞에 붙인다.
// criticalEvents 상한 - 폴링 배치마다 계속 append만 하면 무한정 자라니, CriticalToastStack이
// 화면에 띄우는 MAX_TOASTS(4)보다 넉넉히 크게 잡아 최근 것만 유지한다. 폴링 주기 안에
// 이보다 많은 CRITICAL이 몰리면 그 초과분은 (이미 예전부터 그랬듯) 다음 틱을 기다리지 않고
// 이번 틱에 한꺼번에 들어오므로 문제 없음 - 여기서 잘려나가는 건 "화면에 이미 다 보여주고
// 지나간, 아주 오래된" 항목뿐이다.
const CRITICAL_QUEUE_CAP = 50;

export function useLiveAttackFeed({ feedLimit = 40 } = {}) {
  const [feed, setFeed] = useState([]);
  // 예전엔 "이 폴링 배치에서 발견한 CRITICAL 중 하나"(lastCritical, find()로 딱 1건)만
  // 담았는데, 폴링 간격(기본 2초) 안에 CRITICAL이 여러 건 몰리면 나머지가 통째로
  // 유실됐다(2026-07-16, 더미 생성기로 1초당 5건 발사해서 실측 확인 - 토스트 스택이
  // 안 쌓이는 것처럼 보였던 원인). criticalEvents는 배치당 하나가 아니라 그 배치에
  // 온 CRITICAL 전부를 오래된 순서로 누적한다 - CriticalToastStack이 지난번에 어디까지
  // 처리했는지(마지막 id) 기억해두고 그 뒤에 새로 붙은 것들을 전부 큐에 넣는 방식으로
  // 소비한다(App.jsx의 유일한 소비처라 이 구조 변경이 다른 화면에 영향 없음).
  const [criticalEvents, setCriticalEvents] = useState([]);
  const sinceRef = useRef(null);
  const { pollMs } = usePollInterval();
  const pollTick = usePoll(pollMs);

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

        const criticals = ordered.filter((e) => getRealSeverityMeta(e.severity).key === "CRITICAL");
        if (criticals.length) {
          // ordered는 항상 최신순(desc) - 큐에는 오래된 것부터 쌓아야 소비 측(토스트
          // 스택)이 도착한 순서 그대로 아래에서부터 쌓을 수 있어서 뒤집는다.
          const chronological = criticals.slice().reverse();
          setCriticalEvents((prev) => [...prev, ...chronological].slice(-CRITICAL_QUEUE_CAP));
        }
      })
      .catch(() => {
        // 폴링 실패는 조용히 무시하고 다음 tick에 재시도(옛 WS의 재연결 백오프와
        // 동일한 fail-soft 정책 - 폴링이라 재연결 상태 관리 자체가 필요 없어졌다).
      });

    return () => {
      cancelled = true;
    };
  }, [pollTick, feedLimit]);

  return { feed, criticalEvents };
}
