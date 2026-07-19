import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetPaged, ApiError } from "../lib/authApi";

// GET /attck/coverage/{technique_id}/incidents (attck_api.py) — 선택한 기법에
// matched_scenario_rule_id로 연결된 incidents 목록. mock의 matchedLogsByTechnique와
// 달리 "개별 로그"가 아니라 IncidentsView와 동일한 IncidentOut(집계된 인시던트) 단위다.
// technique_id가 바뀔 때마다 다시 불러온다.
//
// 페이지네이션(2026-07-19) - 자주 탐지되는 기법(T1190 등)은 매칭된 인시던트가
// 수천 건이라 예전처럼 한 번에 다 받아 전부 DOM에 그리면 클릭할 때마다 렉이
// 걸렸다(실측: T1190 2,681건/1.2MB). 한 페이지(50건)만 받고, 더 필요하면
// loadMore()로 커서 이어받기 - /incidents, /audit-logs와 같은 패턴.
const PAGE_SIZE = 50;

export function useTechniqueIncidents(techniqueId) {
  const [incidents, setIncidents] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef(null);
  // 무한 스크롤의 onScroll은 짧은 시간에 여러 번 발화한다 - loadingMore
  // state는 다음 렌더까지 반영이 안 돼서(비동기), 그 사이에 또 onScroll이
  // 오면 stale closure 때문에 같은 페이지를 중복 요청할 수 있다. ref는
  // 즉시(동기적으로) 갱신되므로 이 가드는 state가 아니라 ref로 건다.
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!techniqueId) {
      setIncidents([]);
      setStatus("ready");
      setError(null);
      setHasMore(false);
      cursorRef.current = null;
      return;
    }
    let cancelled = false;
    setStatus("loading");
    cursorRef.current = null;
    apiGetPaged(`/attck/coverage/${encodeURIComponent(techniqueId)}/incidents?limit=${PAGE_SIZE}`)
      .then(({ data, nextCursor }) => {
        if (cancelled) return;
        setIncidents(data);
        cursorRef.current = nextCursor;
        setHasMore(Boolean(nextCursor));
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "해당 기법의 인시던트를 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [techniqueId]);

  // "더 남았는지"(boolean)로 resolve하는 Promise를 리턴한다 - 스크롤바를
  // 드래그해서 한 번에 저 아래로 뛰어버리면 IntersectionObserver는 "안 겹침
  // -> 겹침"으로 상태가 *바뀔 때* 딱 한 번만 콜백을 준다(계속 겹쳐있는 동안은
  // 재발화 안 함). 그래서 호출부(AttackMatrixView)가 이 Promise를 체이닝해서
  // "로드 끝났는데 아직도 더 있으면 또 로드"를 직접 반복해야 한다. hasMore
  // state를 읽게 하면 다음 렌더까지 반영이 늦어(setState는 비동기) 방금 끝난
  // 요청의 결과를 아직 못 보고 판단할 수 있어서, 대신 이 호출 자체의 resolve
  // 값으로 직접 넘겨준다 - 렌더 타이밍과 무관하게 항상 최신 상태.
  //
  // loadingMoreRef에 걸려 아무 요청도 안 보낸 경우(이미 진행 중인 다른 호출과
  // 겹침)는 "더 없다"가 아니라 "아직 모른다"이므로 true로 resolve해서
  // 호출부가 재시도하게 한다 - false로 주면 실제로는 더 남았는데 체인이
  // 거기서 끊겨버린다.
  const loadMore = useCallback(() => {
    if (!techniqueId || !cursorRef.current) return Promise.resolve(false);
    if (loadingMoreRef.current) return Promise.resolve(true);
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), cursor: cursorRef.current });
    return apiGetPaged(`/attck/coverage/${encodeURIComponent(techniqueId)}/incidents?${qs}`)
      .then(({ data, nextCursor }) => {
        setIncidents((prev) => [...prev, ...data]);
        cursorRef.current = nextCursor;
        setHasMore(Boolean(nextCursor));
        return Boolean(nextCursor);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "다음 페이지를 불러오지 못했습니다.");
        return false;
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [techniqueId]);

  return { incidents, status, error, hasMore, loadingMore, loadMore };
}
