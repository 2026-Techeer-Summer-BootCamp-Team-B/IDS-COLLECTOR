// Loki/Grafana-style time-range + step presets, and the bucketing logic that
// turns a flat list of events into chart-ready buckets.
//
// Real-data integration note: `bucketEvents` below does the bucketing
// client-side over mock data. When you wire in a real backend, you'd instead
// call something like Loki's range_query (which already returns
// time-bucketed counts, step = your `bucketMs`). As long as the real fetch
// returns the same `{ ts, label, counts }` shape, none of the chart
// components need to change.
 
export const RANGE_PRESETS = [
  { key: "15m", label: "15분", lookbackMs: 15 * 60 * 1000, bucketMs: 60 * 1000 },
  { key: "1h", label: "1시간", lookbackMs: 60 * 60 * 1000, bucketMs: 5 * 60 * 1000 },
  { key: "6h", label: "6시간", lookbackMs: 6 * 60 * 60 * 1000, bucketMs: 30 * 60 * 1000 },
  { key: "24h", label: "24시간", lookbackMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  { key: "7d", label: "7일", lookbackMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000 },
  { key: "30d", label: "30일", lookbackMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
];
 
function formatBucketLabel(date, bucketMs) {
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