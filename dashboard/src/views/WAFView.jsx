import React, { useMemo, useState } from "react";
import { RANGE_PRESETS } from "../data/timeSeries";
import { REAL_SEVERITY_LEVELS, REAL_ERROR_MIN_SEVERITY, getRealSeverityMeta } from "../data/realSeverity";
import { useLogs } from "../hooks/useLogs";
import { useDetectionSources } from "../hooks/useDetectionSources";
import { usePollInterval } from "../context/PollIntervalContext";
import TimeRangePicker from "../components/TimeRangePicker";
import RankedList from "../components/RankedList";
import { Card, KpiCard, LogVolumeChart, RealLevelDistributionChart } from "./LogDashboard";
import { DISPLAY_TIMEZONE } from "../lib/timezone";

// waf.risk_level(정규화 단계에서 payload.risk_level 그대로 통과)은 센서가
// 보내는 원문 값이 정해져 있지 않을 수 있어 방어적으로 대/소문자 섞어서 비교.
const HIGH_RISK_LEVELS = new Set(["critical", "high", "CRITICAL", "HIGH"]);

function RecentWafEvents({ events, status, error }) {
  const [expandedId, setExpandedId] = useState(null);
  return (
    <Card title="Recent Events" subtitle={`Showing ${Math.min(events.length, 10)} of ${events.length}`}>
      {status === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-3">{error}</p>}
      {status === "ready" && (
        <div className="space-y-1">
          {events.slice(0, 10).map((e) => {
            const isOpen = expandedId === e.id;
            const meta = getRealSeverityMeta(e.severity);
            const attackType = e.raw["event.action"] || "-";
            const blocked = e.raw["waf.blocked"];
            const riskLevel = e.raw["waf.risk_level"] || "-";
            return (
              <div key={e.id}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : e.id)}
                  className="w-full flex items-center gap-3 py-2 text-left text-xs hover:bg-dash-surfaceAlt/50 rounded-lg px-1"
                >
                  <span className="text-dash-faint shrink-0">{isOpen ? "▾" : "▸"}</span>
                  <span className="text-dash-faint whitespace-nowrap w-16 shrink-0">
                    {e.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: DISPLAY_TIMEZONE })}
                  </span>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: meta.color, backgroundColor: `${meta.color}22` }}
                    title={meta.label}
                  >
                    {meta.label}
                  </span>
                  <span className="text-dash-fg truncate">{attackType}</span>
                  <span className="text-dash-muted truncate">{e.path}</span>
                  <span
                    className={`ml-auto shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      blocked ? "text-dash-critical bg-dash-critical/15" : "text-dash-muted bg-dash-surfaceAlt"
                    }`}
                  >
                    {blocked === true ? "차단됨" : blocked === false ? "허용됨" : "-"}
                  </span>
                </button>
                {isOpen && (
                  <div className="ml-8 mb-2 mt-1 bg-dash-bg rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                    <div>
                      <p className="text-dash-faint mb-0.5">공격 유형</p>
                      <p className="text-dash-fg">{attackType}</p>
                    </div>
                    <div>
                      <p className="text-dash-faint mb-0.5">위험도</p>
                      <p className="text-dash-fg">{riskLevel}</p>
                    </div>
                    <div>
                      <p className="text-dash-faint mb-0.5">동작 모드</p>
                      <p className="text-dash-fg">{e.raw["waf.mode"] || "-"}</p>
                    </div>
                    <div>
                      <p className="text-dash-faint mb-0.5">Source IP</p>
                      <p className="text-dash-fg">{e.sourceIp || "-"}</p>
                    </div>
                    <div>
                      <p className="text-dash-faint mb-0.5">요청</p>
                      <p className="text-dash-fg font-mono truncate">
                        {e.raw["http.request.method"] || "-"} {e.path}
                      </p>
                    </div>
                    <div>
                      <p className="text-dash-faint mb-0.5">매칭 규칙 ID</p>
                      <p className="text-dash-fg font-mono">{e.raw["rule.id"] || "-"}</p>
                    </div>
                    <div>
                      <p className="text-dash-faint mb-0.5">전체 시각</p>
                      <p className="text-dash-fg">{e.timestamp.toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}</p>
                    </div>
                    <div>
                      <p className="text-dash-faint mb-0.5">User Agent</p>
                      <p className="text-dash-fg truncate" title={e.raw["user_agent.original"]}>
                        {e.raw["user_agent.original"] || "-"}
                      </p>
                    </div>
                    <div className="col-span-2 sm:col-span-4">
                      <p className="text-dash-faint mb-0.5">탐지된 payload</p>
                      <p className="text-dash-fg font-mono text-[11px] break-all">
                        {e.raw["waf.payload_snippet"] || "(없음)"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {events.length === 0 && <p className="text-dash-muted text-xs py-3">이 구간에는 이벤트가 없습니다.</p>}
        </div>
      )}
    </Card>
  );
}

/**
 * WAF 상세 — GET /logs?module=waf 실데이터 연동. WAS와 달리 severity가 항상
 * 고정값이 아니라 다른 모듈처럼 실제 1~4 스케일(severity.yaml, get_severity("waf", ...))을
 * 쓰기 때문에 Falco 페이지와 같은 패턴(HTTP 상태코드로 우회하지 않고 severity를
 * 그대로 사용)을 따른다. WAF 고유 필드(waf.risk_level/blocked/mode,
 * payload_snippet)는 servers/normalizer/app/normalizer.py의 normalize_waf 참고.
 */
export default function WAFView() {
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const hours = preset.lookbackMs / (60 * 60 * 1000);
  const { pollMs } = usePollInterval();

  const { logs, status, error } = useLogs({
    lookbackMs: preset.lookbackMs,
    module: "waf",
    limit: 300,
    pollMs,
  });

  // Total 카드는 logs.length(limit=300 캡) 대신 GET /stats의 by_module count(정확한
  // 총량)를 쓴다 — WASView.jsx/FalcoView.jsx와 동일한 이유.
  const { byModule } = useDetectionSources({ lookbackMs: preset.lookbackMs, pollMs });
  const totalRequests = byModule.find((m) => m.module === "waf")?.count ?? 0;

  const blockedCount = useMemo(() => logs.filter((e) => e.raw["waf.blocked"] === true).length, [logs]);
  const highRiskCount = useMemo(
    () => logs.filter((e) => HIGH_RISK_LEVELS.has(e.raw["waf.risk_level"])).length,
    [logs]
  );
  const notableCount = useMemo(
    () => logs.filter((e) => e.severity >= REAL_ERROR_MIN_SEVERITY).length,
    [logs]
  );

  const attackTypes = useMemo(() => {
    const counts = {};
    logs.forEach((e) => {
      const key = e.raw["event.action"] || "unknown";
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [logs]);

  const targetPaths = useMemo(() => {
    const counts = {};
    logs.forEach((e) => {
      const key = e.path || "-";
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [logs]);

  const topAttackType = attackTypes[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-dash-fg text-base font-semibold mb-1">WAF 상세</h2>
          <p className="text-dash-muted text-xs">
            웹 방화벽 탐지/차단 로그 전용 뷰 (module=waf) · 공격 페이로드 매칭 기반
          </p>
        </div>
        <TimeRangePicker value={rangeKey} onChange={setRangeKey} />
      </div>

      <div className="flex flex-wrap gap-4">
        <KpiCard label={`Total Detections (${preset.label})`} value={totalRequests.toLocaleString()} />
        <KpiCard label="Blocked" value={blockedCount} accent="critical" />
        <KpiCard label="High/Critical Risk" value={highRiskCount} accent="critical" />
        <KpiCard label="Top Attack Type" value={topAttackType ? topAttackType.count : "-"} delta={topAttackType?.label} positive />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <LogVolumeChart rangeKey={rangeKey} module="waf" />
        </div>
        <RealLevelDistributionChart hours={hours} module="waf" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RankedList title="공격 유형 랭킹" subtitle={`총 ${attackTypes.length}종`} items={attackTypes} />
        <RankedList title="공격 대상 경로" subtitle="선택 구간 기준" items={targetPaths} valueSuffix=" hits" />
      </div>

      <RecentWafEvents events={logs} status={status} error={error} />

      <p className="text-dash-faint text-[11px]">
        참고: Notable(Major~Critical) {notableCount}건 — Overview/Incidents 상관분석에는 이 중 반복 패턴으로
        확인된 것만 인시던트로 올라갑니다.
      </p>
    </div>
  );
}
