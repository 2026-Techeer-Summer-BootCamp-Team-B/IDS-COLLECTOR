import { useEffect, useState } from "react";

// 일정 간격(ms)마다 값이 바뀌는 토큰을 반환 — 다른 데이터 훅의 useEffect 의존성
// 배열에 이 값을 끼워 넣으면 그 훅이 주기적으로 다시 fetch하게 만들 수 있다.
// ms가 falsy(0/undefined/null)면 폴링하지 않고 최초 1회만 동작 — 기존 훅들의
// "폴링 없음" 기본 동작을 그대로 유지하면서 옵션으로만 켤 수 있게 하기 위함.
export function usePoll(ms) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ms) return;
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return tick;
}
