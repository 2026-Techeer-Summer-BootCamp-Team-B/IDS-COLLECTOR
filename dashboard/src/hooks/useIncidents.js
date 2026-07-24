import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetPaged, ApiError } from "../lib/authApi";

const PAGE_SIZE = 100;

// GET /incidents (servers/platform-api/app/incidents_api.py) — IncidentsView의
// 카드 목록(+그 목록에서 파생하는 필터/그룹핑) 실데이터 소스. 상태/도넛 등
// "개수"만 필요한 건 useIncidentCounts.js(서버 GROUP BY 집계)가 따로 맡고,
// 이 훅은 실제 카드 렌더링용 행 데이터만 페이지 단위(apiGetPaged)로 이어 받는다.
// 예전엔 apiGetAllPages로 전 페이지를 한 번에 다 받아왔는데(2026-07-23 도입),
// 더미 생성기가 계속 발화해 인시던트가 수천 건(~5,796건)으로 늘면서 카드 목록
// 자체가 매번 그 전체를 fetch+DOM 렌더링해 눈에 띄게 느려졌다(2026-07-24,
// "인시던트 창 그래프도 느림" 피드백 확인 과정에서 실측). useTechniqueIncidents.js와
// 같은 패턴으로 무한 스크롤 커서 페이지네이션으로 전환 — 화면에 보여줄 만큼만
// 불러오고, 스크롤이 바닥에 닿으면 loadMore()로 다음 페이지를 이어 받는다.
export function useIncidents({ limit = PAGE_SIZE } = {}) {
  const [incidents, setIncidents] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const cursorRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const loadedCountRef = useRef(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    // 리로드(재조회)일 땐 이미 ready 상태를 유지해서 목록이 깜빡이지 않게 한다 —
    // 최초 로드일 때만 loading 문구를 보여준다. 폴링(useIncidentsSocket, 5초
    // 주기)이 부르는 리로드가 매번 1페이지(PAGE_SIZE)로 되돌아가면, 스크롤로
    // 더 불러온 카드가 몇 초 안에 조용히 사라져서 마치 무한 스크롤 자체가 안
    // 되는 것처럼 보인다(2026-07-24, "밑으로 내려도 안 불려와짐" 피드백) -
    // 이미 불러온 만큼(loadedCountRef)은 리로드에서도 요청 하나로 그대로
    // 유지한다(키셋 커서라 큰 limit이어도 OFFSET처럼 느려지지 않음). 서버도
    // limit을 500으로 캡하므로(incidents_api.py) 여기서도 맞춰 캡한다 - 그
    // 이상 스크롤해 들어간 뒤의 리로드는 500건까지만 보존되는 게 그나마 낫다.
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    cursorRef.current = null;
    const fetchLimit = Math.min(Math.max(limit, loadedCountRef.current), 500);

    apiGetPaged(`/incidents?limit=${fetchLimit}`)
      .then(({ data, nextCursor }) => {
        if (cancelled) return;
        setIncidents(data);
        loadedCountRef.current = data.length;
        cursorRef.current = nextCursor;
        setHasMore(Boolean(nextCursor));
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "인시던트 목록을 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [limit, reloadToken]);

  // AttackMatrixView.jsx의 pump() 체인과 같은 이유로 Promise<boolean>(더 받을
  // 페이지가 있는지)을 돌려준다 — 스크롤바를 드래그해서 바닥까지 단번에 내리면
  // IntersectionObserver 콜백이 한 번만 불려도 여러 페이지를 연달아 이어받아야
  // 하는데, 호출부가 이 반환값으로 "더 있으면 다시 부르기"를 체이닝한다.
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !cursorRef.current) {
      return Promise.resolve(Boolean(cursorRef.current));
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    return apiGetPaged(`/incidents?limit=${limit}&cursor=${encodeURIComponent(cursorRef.current)}`)
      .then(({ data, nextCursor }) => {
        setIncidents((prev) => {
          const next = prev.concat(data);
          loadedCountRef.current = next.length;
          return next;
        });
        cursorRef.current = nextCursor;
        setHasMore(Boolean(nextCursor));
        return Boolean(nextCursor);
      })
      .catch(() => false)
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [limit]);

  return { incidents, status, error, hasMore, loadingMore, loadMore, reload };
}
