import React, { useMemo, useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useLogs } from "../hooks/useLogs";
import { RANGE_PRESETS, bucketEvents } from "../data/timeSeries";
import { extractTerms } from "../data/dql";
import { MODULE_META } from "../data/moduleMeta";
import { SOURCE_META } from "../components/badges";
import { getRealSeverityMeta } from "../data/realSeverity";
import TimeRangePicker from "../components/TimeRangePicker";
import { CHART_COLORS, forTheme, DONUT_PALETTE } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { DISPLAY_TIMEZONE } from "../lib/timezone";

/**
 * Discover-style search bar over GET /logs (servers/platform-api/app/logs_api.py).
 * 예전엔 data/dql.js의 자체 파서로 mock 배열을 클라이언트에서 필터링했는데, 지금은
 * 쿼리 입력을 그대로 백엔드 `q` 파라미터로 보낸다 — OpenSearch query_string 쿼리라
 * 실제로는 mock DQL보다 더 강력한 Lucene 문법(AND/OR/NOT, 와일드카드, 범위, 구문
 * 검색)을 그대로 지원한다. dql.js의 extractTerms만 하이라이트용 근사치 추출에 재사용.
 *
 * Embedded at the top of Overview — shares its time range with the rest of
 * the page (rangeKey/onRangeChange come from DashboardContent) so picking a
 * range here also drives the Log Volume chart below.
 */

const MODULE_OPTIONS = [
  { key: "", label: "전체 소스" },
  { key: "was", label: MODULE_META.was.label },
  { key: "falco", label: MODULE_META.falco.label },
  { key: "k8s_audit", label: MODULE_META.k8s_audit.label },
];

const RESULT_LIMIT = 500;

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
          <mark key={i} style={{ backgroundColor: "#F5E400", color: "#05060B" }} className="rounded px-0.5">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

// doc.raw = /logs가 돌려준 flat dict 원본(event.module, source.ip, ... 점 표기
// 그대로) — 상세 패널에선 이걸 펼쳐서 보여준다. 필드가 소스마다 다르므로(WAS만
// url.path/http.*, Falco/Audit는 orchestrator.*) 고정 컬럼 대신 있는 것만 나열.
function HitRow({ doc, terms }) {
  const [open, setOpen] = useState(false);
  const { theme } = useTheme();
  const src = SOURCE_META[doc.source] || { label: doc.source, color: "#8890B5" };
  const sevMeta = getRealSeverityMeta(doc.severity);
  const rawFields = Object.keys(doc.raw).sort();

  return (
    <div className="border-t border-dash-surfaceAlt">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-3 py-2.5 text-left">
        <span className="text-dash-faint text-xs shrink-0 mt-0.5">{open ? "▾" : "▸"}</span>
        <span className="text-dash-faint text-xs shrink-0 w-36">{doc.timestamp.toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}</span>
        <span className="shrink-0" style={{ color: forTheme(src.color, theme) }}>
          <span className="text-[10px] font-medium">{src.label}</span>
        </span>
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
          style={{ color: sevMeta.color, backgroundColor: `${sevMeta.color}22` }}
          title={sevMeta.label}
        >
          {sevMeta.label}
        </span>
        <span className="text-xs text-dash-muted flex-1 min-w-0 truncate">
          <span className="text-dash-fg">
            <Highlight text={doc.message} terms={terms} />
          </span>
          {doc.namespace && (
            <span className="text-dash-faint ml-2">
              {doc.namespace}/{doc.pod}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="pl-16 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
          {rawFields.map((f) => (
            <div key={f} className="truncate">
              <span className="text-dash-faint">{f}: </span>
              <span className="text-dash-fg">
                <Highlight text={String(doc.raw[f])} terms={terms} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// expanded/setExpanded는 기본값을 내부 state로 두되, 부모(DashboardContent)가
// "Total Logs" KPI 행 위에 놓을 전용 토글 버튼을 위해 제어권을 넘겨줄 수 있게
// 함 — 검색바 안의 "N hits" 배지를 눌러도, 부모 쪽 버튼을 눌러도 같은 패널이
// 열리고 닫힌다.
export default function SearchDiscoverView({ rangeKey, onRangeChange, expanded: expandedProp, setExpanded: setExpandedProp, onResultsCountChange }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [moduleFilter, setModuleFilter] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  // Results (histogram + hit list) start collapsed so the first thing a new
  // user sees is the Overview's KPI/차트 요약, not an unexplained "N hits"
  // wall — expands automatically once they actually run a search, or via
  // the manual toggle for browsing without a query.
  const [expandedState, setExpandedState] = useState(false);
  const expanded = expandedProp ?? expandedState;
  const setExpanded = setExpandedProp ?? setExpandedState;

  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const moduleLabel = MODULE_OPTIONS.find((m) => m.key === moduleFilter)?.label ?? "전체 소스";

  const { logs: results, status, error } = useLogs({
    lookbackMs: preset.lookbackMs,
    module: moduleFilter || undefined,
    q: appliedQuery || undefined,
    limit: RESULT_LIMIT,
  });
  const terms = useMemo(() => extractTerms(appliedQuery), [appliedQuery]);

  // 부모가 "N hits" 결과 수를 자기 쪽 토글 버튼에도 표시할 수 있게 매번 알려준다.
  useEffect(() => {
    onResultsCountChange?.(results.length);
  }, [results.length]);

  const histogram = useMemo(() => {
    const buckets = bucketEvents(results, preset, Date.now());
    return buckets.map((b) => ({
      label: b.label,
      count: Object.values(b.counts).reduce((a, c) => a + c, 0),
    }));
  }, [results, rangeKey]);

  function runSearch() {
    setAppliedQuery(queryInput);
    setExpanded(true);
  }

  return (
    <div className="space-y-4">
      <div className="bg-dash-surface rounded-2xl px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="text-dash-faint shrink-0">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="bg-dash-bg text-dash-fg text-xs rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint"
          >
            {MODULE_OPTIONS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder='OpenSearch 쿼리 — 예: event.severity:4 AND rule.name:"Terminal shell"'
            className="flex-1 min-w-[200px] bg-dash-bg text-xs text-dash-fg placeholder-dash-muted rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint"
          />
          <TimeRangePicker value={rangeKey} onChange={onRangeChange} />
          <button
            onClick={runSearch}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint hover:bg-dash-mint/25 whitespace-nowrap"
          >
            검색
          </button>
        </div>
        {appliedQuery && (
          <p className="text-dash-faint text-[11px] mt-1.5">
            적용된 쿼리: <span className="text-dash-mint">{appliedQuery}</span>
          </p>
        )}
      </div>

      {/* 검색 결과 펼치기 토글 버튼은 2026-07-16부터 여기서 안 그린다 - 대시보드
          상단 위젯 설정 행(LogDashboard.jsx의 DashboardContent)으로 옮겨서 그
          행과 한 줄에 나란히 놓는다(예전엔 이 행 + 위젯 설정 행이 따로 한 줄씩
          차지해서 세로 공간을 낭비했음). expanded/setExpanded 상태는 그대로
          부모(DashboardContent)가 소유하고 여기로 내려받으므로 그 버튼을 눌러도
          아래 패널은 똑같이 열리고 닫힌다. */}

      {expanded && (
        <div className="bg-dash-surface rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-dash-fg text-sm font-semibold">
              {results.length.toLocaleString()}
              {results.length >= RESULT_LIMIT ? "+" : ""} hits
            </p>
            <p className="text-dash-muted text-xs">
              Last {preset.label} · {moduleLabel}
            </p>
          </div>

          {status === "error" && <p className="text-dash-critical text-xs py-3">{error}</p>}

          {status !== "error" && (
            <>
              <div className="h-48 mb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogram}>
                    <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
                    <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} minTickGap={20} />
                    <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg, fontSize: 12 }}
                      labelStyle={{ color: C.fg }}
                      itemStyle={{ color: C.fg }}
                      cursor={{ fill: C.surfaceAlt, opacity: 0.5 }}
                    />
                    <Bar dataKey="count" fill={DONUT_PALETTE[3]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="max-h-96 overflow-y-auto">
                {status === "loading" && <p className="text-dash-muted text-xs py-8 text-center">불러오는 중...</p>}
                {status === "ready" &&
                  results.slice(0, 50).map((doc) => <HitRow key={doc.id} doc={doc} terms={terms} />)}
                {status === "ready" && results.length === 0 && (
                  <p className="text-dash-muted text-xs py-8 text-center">조건에 맞는 결과가 없습니다.</p>
                )}
                {results.length > 50 && (
                  <p className="text-dash-muted text-[11px] pt-2 text-center">
                    상위 50건만 표시 중 (총 {results.length.toLocaleString()}
                    {results.length >= RESULT_LIMIT ? "+" : ""}건)
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
