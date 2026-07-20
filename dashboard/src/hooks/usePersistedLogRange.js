import { useCallback, useState } from "react";
import { RANGE_PRESETS } from "../data/timeSeries";

const DEFAULT_RANGE_KEY = "24h";
const OVERVIEW_RANGE_STORAGE_KEY = "sentinelops_overview_log_range";

function isValidRangeKey(value) {
  return RANGE_PRESETS.some((preset) => preset.key === value);
}

function loadInitialRange() {
  if (typeof window === "undefined") return DEFAULT_RANGE_KEY;

  try {
    const savedRange = window.localStorage.getItem(OVERVIEW_RANGE_STORAGE_KEY);
    return isValidRangeKey(savedRange) ? savedRange : DEFAULT_RANGE_KEY;
  } catch {
    // localStorage를 사용할 수 없는 환경에서도 기본 범위로 정상 동작한다.
    return DEFAULT_RANGE_KEY;
  }
}

// Overview에서 마지막으로 선택한 로그 조회 기간을 브라우저별로 기억한다.
export function usePersistedOverviewLogRange() {
  const [rangeKey, setRangeKeyState] = useState(loadInitialRange);

  const setRangeKey = useCallback((nextRangeKey) => {
    if (!isValidRangeKey(nextRangeKey)) return;

    setRangeKeyState(nextRangeKey);
    try {
      window.localStorage.setItem(OVERVIEW_RANGE_STORAGE_KEY, nextRangeKey);
    } catch {
      // 저장만 실패한 경우에도 현재 접속 중인 화면에는 선택값을 반영한다.
    }
  }, []);

  return [rangeKey, setRangeKey];
}
