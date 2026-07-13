// Loki/Grafana-style time-range + step presets, and the bucketing logic that
// turns a flat list of events into chart-ready buckets.
//
// Real-data integration note: `bucketEvents` below does the bucketing
// client-side over mock data. When you wire in a real backend, you'd instead
// call something like Loki's range_query (which already returns
// time-bucketed counts, step = your `bucketMs`). As long as the real fetch
// returns the same `{ ts, label, counts }` shape, none of the chart
// components need to change.
 
// 실데이터 패널(Overview/WAS/Falco/K8sAudit)이 usePoll로 자동 새로고침할 때 쓰는
// 공통 간격 — 더미 로그 생성기를 돌리면서 화면이 알아서 갱신되길 원하는 용도라
// 사람이 "느리다"고 느끼지 않을 정도로 짧게 잡았다(백엔드는 단순 집계 쿼리라
// 이 정도 빈도는 부담 없음). 값 하나를 여러 훅 호출부가 공유하도록 여기 둔다.
export const LIVE_POLL_MS = 2000;

// Full ladder, 1분 → 90일 (mirrors OpenSearch/Grafana "commonly used" quick
// select). Used by TimeRangePicker.jsx's dropdown. Note: since the mock
// datasets are static historical snapshots (not a true live stream), very
// short ranges like 1분/5분 will often show 0 hits — that's expected, not a
// bug, until a real live source is wired in.
export const RANGE_PRESETS = [
  { key: "1m", label: "1 minute", lookbackMs: 1 * 60 * 1000, bucketMs: 5 * 1000 },
  { key: "5m", label: "5 minutes", lookbackMs: 5 * 60 * 1000, bucketMs: 15 * 1000 },
  { key: "15m", label: "15 minutes", lookbackMs: 15 * 60 * 1000, bucketMs: 60 * 1000 },
  { key: "30m", label: "30 minutes", lookbackMs: 30 * 60 * 1000, bucketMs: 2 * 60 * 1000 },
  { key: "1h", label: "1 hour", lookbackMs: 60 * 60 * 1000, bucketMs: 5 * 60 * 1000 },
  { key: "3h", label: "3 hours", lookbackMs: 3 * 60 * 60 * 1000, bucketMs: 15 * 60 * 1000 },
  { key: "6h", label: "6 hours", lookbackMs: 6 * 60 * 60 * 1000, bucketMs: 30 * 60 * 1000 },
  { key: "12h", label: "12 hours", lookbackMs: 12 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  { key: "24h", label: "24 hours", lookbackMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  { key: "2d", label: "2 days", lookbackMs: 2 * 24 * 60 * 60 * 1000, bucketMs: 3 * 60 * 60 * 1000 },
  { key: "7d", label: "7 days", lookbackMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000 },
  { key: "30d", label: "30 days", lookbackMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
  { key: "90d", label: "90 days", lookbackMs: 90 * 24 * 60 * 60 * 1000, bucketMs: 3 * 24 * 60 * 60 * 1000 },
];
 
// Curated subset for compact inline chart buttons (LogDashboard's Log Volume
// card) so those don't get crowded by the full 13-item ladder above.
export const QUICK_RANGE_KEYS = ["15m", "1h", "6h", "24h", "7d", "30d"];
 
// Exported so real-data hooks (useLogVolume.js) can format server-returned
// bucket timestamps with the exact same convention as the mock bucketing path.
export function formatBucketLabel(date, bucketMs) {
  const isDayBucket = bucketMs >= 24 * 60 * 60 * 1000;
  const isHourPlus = bucketMs >= 60 * 60 * 1000;
  if (isDayBucket) return date.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
  if (isHourPlus) return date.toLocaleTimeString("ko-KR", { hour: "2-digit", hour12: false }) + "시";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
 
// Evenly-spaced empty buckets from (now - lookback) to now.
export function buildBuckets(preset, now) {
  const buckets = [];
  const start = now - preset.lookbackMs;
  for (let ts = start; ts <= now; ts += preset.bucketMs) {
    buckets.push({ ts, label: formatBucketLabel(new Date(ts), preset.bucketMs), counts: {} });
  }
  return buckets;
}
 
// Buckets a flat list of { timestamp, level } events into the preset's
// buckets. Swap this function's internals for a real API call later — keep
// the return shape the same and every chart downstream keeps working.
export function bucketEvents(events, preset, now) {
  const buckets = buildBuckets(preset, now);
  const start = now - preset.lookbackMs;
  events.forEach((evt) => {
    const t = evt.timestamp.getTime();
    if (t < start || t > now) return;
    const idx = Math.floor((t - start) / preset.bucketMs);
    const bucket = buckets[idx];
    if (!bucket) return;
    bucket.counts[evt.level] = (bucket.counts[evt.level] || 0) + 1;
  });
  return buckets;
}

// Baseline-vs-spike detection for the Log Volume chart: baseline = median of
// the visible range's non-zero buckets, spike = the single peak bucket if
// it's at least `thresholdRatio`x the baseline. Deliberately simple (no
// historical/seasonal model) — good enough to flag "평소 대비 N% 급증" without
// a real anomaly-detection backend.
export function detectSpike(values, { minSamples = 4, thresholdRatio = 1.5 } = {}) {
  const nonZero = values.filter((v) => v > 0);
  if (nonZero.length < minSamples) return null;

  const sorted = [...nonZero].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (median <= 0) return null;

  let peakIndex = -1;
  let peakValue = -Infinity;
  values.forEach((v, i) => {
    if (v > peakValue) {
      peakValue = v;
      peakIndex = i;
    }
  });

  const ratio = peakValue / median;
  if (ratio < thresholdRatio) return null;

  return {
    index: peakIndex,
    value: peakValue,
    baseline: Math.round(median),
    pctOverBaseline: Math.round((ratio - 1) * 100),
  };
}