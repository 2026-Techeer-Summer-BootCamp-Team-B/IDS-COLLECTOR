import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ATTACK_EVENTS } from "../data/attackEvents";
import { RAW_EVENTS, MOCK_NOW } from "../data/mockLogs";
import { RANGE_PRESETS, bucketEvents } from "../data/timeSeries";
import { runQuery, extractTerms } from "../data/dql";
import TimeRangePicker from "../components/TimeRangePicker";
import { CHART_COLORS } from "../data/theme";
import { useTheme } from "../hooks/useTheme";

/**
 * Discover-style search bar: pick a dataset (index), write a DQL-ish query,
 * see a histogram + expandable hit rows with matched terms highlighted.
 * Embedded at the top of Overview — shares its time range with the rest of
 * the page (rangeKey/onRangeChange come from DashboardContent) so picking a
 * range here also drives the Log Volume chart below.
 */

const DATASETS = [
  { key: "attack_events", label: "공격 탐지 이벤트 (attack_events)", data: ATTACK_EVENTS },
  { key: "app_logs", label: "애플리케이션 로그 (app_logs)", data: RAW_EVENTS },
];

const HIDDEN_FIELDS = new Set(["id", "lat", "lon"]);

function Highlight({ text, terms }) {
  const str = String(text);
  if (!terms.length) return <>{str}</>;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (escaped.length === 0) return <>{str}</>;
  const pattern = new RegExp(`(${escaped.join("|")})`, "ig");
  const parts = str.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
          <mark key={i} style={{ backgroundColor: "#E8D97A", color: "#171821" }} className="rounded px-0.5">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

function formatValue(v) {
  if (v instanceof Date) return v.toLocaleString("ko-KR");
  return String(v);
}

function HitRow({ doc, fields, terms }) {
  const [open, setOpen] = useState(false);
  const time = doc.timestamp instanceof Date ? doc.timestamp.toLocaleString("ko-KR") : String(doc.timestamp);
  const previewFields = fields.slice(0, 5);

  return (
    <div className="border-t border-dash-surfaceAlt">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-3 py-2.5 text-left">
        <span className="text-dash-faint text-xs shrink-0 mt-0.5">{open ? "▾" : "▸"}</span>
        <span className="text-dash-faint text-xs shrink-0 w-36">{time}</span>
        <span className="text-xs text-dash-muted flex-1 min-w-0 truncate">
          {previewFields.map((f) => (
            <span key={f} className="mr-3">
              <span className="text-dash-faint">{f}:</span>{" "}
              <span className="text-dash-fg">
                <Highlight text={formatValue(doc[f])} terms={terms} />
              </span>
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="pl-16 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
          {fields.map((f) => (
            <div key={f} className="truncate">
              <span className="text-dash-faint">{f}: </span>
              <span className="text-dash-fg">
                <Highlight text={formatValue(doc[f])} terms={terms} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SearchDiscoverView({ rangeKey, onRangeChange }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [datasetKey, setDatasetKey] = useState("app_logs");
  const [queryInput, setQueryInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  const dataset = DATASETS.find((d) => d.key === datasetKey);
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);

  const inRange = useMemo(() => {
    const cutoff = MOCK_NOW.getTime() - preset.lookbackMs;
    return dataset.data.filter((d) => d.timestamp.getTime() > cutoff && d.timestamp.getTime() <= MOCK_NOW.getTime());
  }, [datasetKey, rangeKey]);

  const results = useMemo(() => runQuery(inRange, appliedQuery), [inRange, appliedQuery]);
  const terms = useMemo(() => extractTerms(appliedQuery), [appliedQuery]);

  const histogram = useMemo(() => {
    const buckets = bucketEvents(results, preset, MOCK_NOW.getTime());
    return buckets.map((b) => ({
      label: b.label,
      count: Object.values(b.counts).reduce((a, c) => a + c, 0),
    }));
  }, [results, rangeKey]);

  const fields = dataset.data[0]
    ? Object.keys(dataset.data[0]).filter((f) => !HIDDEN_FIELDS.has(f))
    : [];

  function runSearch() {
    setAppliedQuery(queryInput);
  }

  return (
    <div className="space-y-4">
      <div className="bg-dash-surface rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={datasetKey}
            onChange={(e) => setDatasetKey(e.target.value)}
            className="bg-dash-bg text-dash-fg text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-dash-mint"
          >
            {DATASETS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder='DQL 스타일 검색 — 예: severity:CRITICAL AND source:Falco'
            className="flex-1 min-w-[240px] bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-dash-mint"
          />
          <TimeRangePicker value={rangeKey} onChange={onRangeChange} />
          <button
            onClick={runSearch}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-dash-mint/15 text-dash-mint hover:bg-dash-mint/25 whitespace-nowrap"
          >
            검색
          </button>
        </div>
        {appliedQuery && (
          <p className="text-dash-faint text-[11px] mt-2">
            적용된 쿼리: <span className="text-dash-mint">{appliedQuery}</span>
          </p>
        )}
      </div>

      <div className="bg-dash-surface rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-dash-fg text-sm font-semibold">{results.length.toLocaleString()} hits</p>
          <p className="text-dash-muted text-xs">
            Last {preset.label} · {dataset.label}
          </p>
        </div>
        <div className="h-48 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histogram}>
              <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
              <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} minTickGap={20} />
              <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg, fontSize: 12 }} />
              <Bar dataKey="count" fill={C.mint} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {results.slice(0, 50).map((doc, i) => (
            <HitRow key={doc.id ?? i} doc={doc} fields={fields} terms={terms} />
          ))}
          {results.length === 0 && (
            <p className="text-dash-muted text-xs py-8 text-center">조건에 맞는 결과가 없습니다.</p>
          )}
          {results.length > 50 && (
            <p className="text-dash-muted text-[11px] pt-2 text-center">상위 50건만 표시 중 (총 {results.length}건)</p>
          )}
        </div>
      </div>
    </div>
  );
}
