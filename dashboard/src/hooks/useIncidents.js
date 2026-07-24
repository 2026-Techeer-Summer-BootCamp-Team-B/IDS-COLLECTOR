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
  // reload()(마운트 포함)가 새로 실행될 때마다 +1 - loadMore()가 그 순간의
  // epoch를 기억해뒀다가, 자기 응답이 돌아왔을 때 그 사이 reload가 끼어들어
  // epoch가 바뀌었으면(리스트가 통째로 새로 바뀜) 그 응답을 버린다. 이게 없으면
  // "스크롤로 불러온 다음 페이지"와 "그 사이 끝난 reload의 1페이지"가 같은
  // incidents/cursorRef를 동시에 건드려서 카드가 사라지거나 커서가 꼬여
  // 무한 루프로 이어질 수 있었다(2026-07-24, "스크롤 내려도 안 불러와지고
  // 위로 올리면 카드가 사라지고 화면이 멈춘다" 피드백으로 실측 확인).
  const epochRef = useRef(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const myEpoch = ++epochRef.current;
    // 리로드(재조회)일 땐 이미 ready 상태를 유지해서 목록이 깜빡이지 않게 한다 —
    // 최초 로드일 때만 loading 문구를 보여준다. 리로드가 매번 1페이지(PAGE_SIZE)로
    // 되돌아가면, 스크롤로 더 불러온 카드가 리로드 한 번에 조용히 사라져서 마치
    // 무한 스크롤 자체가 안 되는 것처럼 보인다(2026-07-24 피드백) - 이미 불러온
    // 만큼(loadedCountRef)은 리로드에서도 요청 하나로 그대로 유지한다(키셋
    // 커서라 큰 limit이어도 OFFSET처럼 느려지지 않음). 서버도 limit을 500으로
    // 캡하므로(incidents_api.py) 여기서도 맞춰 캡한다.
    //
    // cursorRef는 여기서 미리 null로 초기화하지 않는다 - 그러면 이 fetch가 끝나기
    // 전 짧은 틈에 사용자가 스크롤해서 loadMore()가 불려도 "커서가 없다(=더 없다)"로
    // 오판해 그 자리에서 멈춰버린다(위 "스크롤 내려도 안 불러와짐" 피드백의 또 다른
    // 원인). 새 cursor는 이 fetch가 실제로 끝난 뒤에만 덮어쓴다 - 그 사이 loadMore가
    // 옛 커서로 한 번 더 불러오는 정도의 낭비는 감수한다(epoch 가드가 그 결과를
    // 어차피 버려서 데이터가 꼬이진 않는다).
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    const fetchLimit = Math.min(Math.max(limit, loadedCountRef.current), 500);

    apiGetPaged(`/incidents?limit=${fetchLimit}`)
      .then(({ data, nextCursor }) => {
        if (cancelled || myEpoch !== epochRef.current) return;
        setIncidents(data);
        loadedCountRef.current = data.length;
        cursorRef.current = nextCursor;
        setHasMore(Boolean(nextCursor));
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled || myEpoch !== epochRef.current) return;
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
  //
  // 이미 fetch가 진행 중이면(loadingMoreRef) false를 돌려서 호출부가 재귀를
  // 멈추게 한다 - 스페이서 높이가 로드할 때마다 바뀌어 IntersectionObserver
  // 콜백이 겹쳐 불리는 일이 흔한데, 그때마다 "더 있음(true)"을 돌려주면 호출부의
  // `more && pump()`가 실제 fetch 완료를 기다리지 않고 즉시 자기 자신을 또 불러서
  // 마이크로태스크 재귀 루프로 화면이 멈췄다(2026-07-24 "화면이 멈춰버림" 피드백) -
  // 원래 fetch를 시작시킨 최초 pump() 체인이 완료 후 알아서 이어받으므로, 뒤늦게
  // 겹쳐 불린 쪽은 그냥 조용히 멈추면 된다.
  const loadMore = useCallback(() => {
    if (!cursorRef.current) return Promise.resolve(false);
    if (loadingMoreRef.current) return Promise.resolve(false);
    const myEpoch = epochRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    return apiGetPaged(`/incidents?limit=${limit}&cursor=${encodeURIComponent(cursorRef.current)}`)
      .then(({ data, nextCursor }) => {
        if (myEpoch !== epochRef.current) return false; // 그 사이 reload로 리스트가
        // 통째로 교체됨 - 이 페이지는 이제 옛 리스트 기준이라 버린다.
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
