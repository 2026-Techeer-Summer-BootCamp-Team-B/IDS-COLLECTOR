import { useCallback, useState } from "react";

// 화면을 나갔다 다시 들어와도 차트/지도 표시 방식을 유지하는 작은 공용 훅.
// localStorage 값이 오래된 배포에서 남았거나 손상됐을 때는 allowed 목록으로
// 검증해 기본값으로 안전하게 되돌린다.
export function usePersistedPreference(key, fallback, allowedValues) {
  const [value, setValueState] = useState(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const saved = window.localStorage.getItem(key);
      return allowedValues.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });

  const setValue = useCallback(
    (next) => {
      setValueState((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next;
        if (!allowedValues.includes(resolved)) return previous;
        try {
          window.localStorage.setItem(key, resolved);
        } catch {
          // private mode/storage 제한에서도 현재 화면의 선택은 유지한다.
        }
        return resolved;
      });
    },
    [key, allowedValues]
  );

  return [value, setValue];
}
