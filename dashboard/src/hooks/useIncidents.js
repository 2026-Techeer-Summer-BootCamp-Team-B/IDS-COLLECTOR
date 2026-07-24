import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiGetPaged, ApiError } from "../lib/authApi";

const PAGE_SIZE = 50;
const MAX_RETAINED_INCIDENTS = 100;

function uniqueById(items) {
  const map = new Map();
  items.forEach((item) => {
    const current = map.get(item.id);
    if (!current || item.updated_at > current.updated_at) map.set(item.id, item);
  });
  return [...map.values()]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id))
    .slice(0, MAX_RETAINED_INCIDENTS);
}

function latestUpdatedAt(items, fallback) {
  return items.reduce(
    (latest, item) => (!latest || new Date(item.updated_at) > new Date(latest) ? item.updated_at : latest),
    fallback
  );
}

// Keep a bounded, cursor-paged window. Aggregates deliberately live in
// useIncidentStats: a rendered list must never be treated as global totals.
export function useIncidents({ statusFilter = "ALL", limit = PAGE_SIZE } = {}) {
  const [incidents, setIncidents] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [syncWatermark, setSyncWatermark] = useState(null);
  const cursorRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const loadedCountRef = useRef(0);
  const epochRef = useRef(0);
  // 페이지 요청이 진행되는 동안 delta가 먼저 도착할 수 있다. 목록에서 빠진
  // 항목까지 최신 updated_at을 기억해야 뒤늦게 온 오래된 페이지가 그 상태를
  // 되돌려 넣지 못한다.
  const liveUpdatedAtRef = useRef(new Map());

  const query = statusFilter === "ALL" ? "" : `&status=${encodeURIComponent(statusFilter)}`;
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    const myEpoch = ++epochRef.current;
    setStatus((current) => (current === "ready" ? "ready" : "loading"));

    // Preserve the currently loaded window across a refresh, but never render
    // more than the bounded client-side list permits.
    const fetchLimit = Math.min(Math.max(limit, loadedCountRef.current), MAX_RETAINED_INCIDENTS);
    apiGetPaged(`/incidents?limit=${fetchLimit}${query}`)
      .then(({ data, nextCursor, nextSince }) => {
        if (cancelled || myEpoch !== epochRef.current) return;
        const freshData = data.filter((item) => {
          const liveUpdatedAt = liveUpdatedAtRef.current.get(item.id);
          return !liveUpdatedAt || item.updated_at >= liveUpdatedAt;
        });
        setIncidents((previous) => {
          const preservedLiveItems = previous.filter((item) => {
            const liveUpdatedAt = liveUpdatedAtRef.current.get(item.id);
            if (liveUpdatedAt !== item.updated_at) return false;
            if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
            const fetched = data.find((candidate) => candidate.id === item.id);
            return !fetched || item.updated_at > fetched.updated_at;
          });
          const next = uniqueById([...freshData, ...preservedLiveItems]);
          loadedCountRef.current = next.length;
          return next;
        });
        cursorRef.current = nextCursor;
        setHasMore(Boolean(nextCursor) && loadedCountRef.current < MAX_RETAINED_INCIDENTS);
        setSyncWatermark(nextSince || latestUpdatedAt(freshData, null));
        setStatus("ready");
        setError(null);
      })
      .catch((requestError) => {
        if (cancelled || myEpoch !== epochRef.current) return;
        setError(requestError instanceof ApiError ? requestError.message : "인시던트 목록을 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [limit, query, reloadToken]);

  const loadMore = useCallback(() => {
    if (!cursorRef.current || loadingMoreRef.current || loadedCountRef.current >= MAX_RETAINED_INCIDENTS) return Promise.resolve(false);
    const myEpoch = epochRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const params = new URLSearchParams({ limit: String(Math.min(limit, MAX_RETAINED_INCIDENTS - loadedCountRef.current)), cursor: cursorRef.current });
    if (statusFilter !== "ALL") params.set("status", statusFilter);

    return apiGetPaged(`/incidents?${params}`)
      .then(({ data, nextCursor }) => {
        if (myEpoch !== epochRef.current) return false;
        setIncidents((previous) => {
          const freshData = data.filter((item) => {
            const liveUpdatedAt = liveUpdatedAtRef.current.get(item.id);
            const inFilter = statusFilter === "ALL" || item.status === statusFilter;
            return inFilter && (!liveUpdatedAt || item.updated_at >= liveUpdatedAt);
          });
          const next = uniqueById([...previous, ...freshData]);
          loadedCountRef.current = next.length;
          return next;
        });
        cursorRef.current = nextCursor;
        const canLoadMore = Boolean(nextCursor) && loadedCountRef.current < MAX_RETAINED_INCIDENTS;
        setHasMore(canLoadMore);
        return canLoadMore;
      })
      .catch((requestError) => {
        setError(requestError instanceof ApiError ? requestError.message : "다음 페이지를 불러오지 못했습니다.");
        return false;
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [limit, statusFilter]);

  const mergeChanges = useCallback((changes) => {
    if (!changes?.length) return;
    const freshChanges = changes.filter((item) => {
      const current = liveUpdatedAtRef.current.get(item.id);
      return !current || item.updated_at >= current;
    });
    if (!freshChanges.length) return;
    freshChanges.forEach((item) => {
      liveUpdatedAtRef.current.set(item.id, item.updated_at);
    });
    setIncidents((previous) => {
      const inFilter = (item) => statusFilter === "ALL" || item.status === statusFilter;
      const next = uniqueById([
        ...previous.filter(
          (item) => !freshChanges.some((change) => change.id === item.id)
        ),
        ...freshChanges.filter(inFilter),
      ]);
      loadedCountRef.current = next.length;
      return next;
    });
  }, [statusFilter]);

  const ensureIncident = useCallback(async (id) => {
    const item = await apiGet(`/incidents/${encodeURIComponent(id)}`);
    mergeChanges([item]);
    return item;
  }, [mergeChanges]);

  return { incidents, status, error, hasMore, loadingMore, loadMore, reload, mergeChanges, ensureIncident, syncWatermark };
}
