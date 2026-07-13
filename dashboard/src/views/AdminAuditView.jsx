import React, { useMemo } from "react";
import { RULES, byRuleHits } from "../data/rules";
import { ATTACK_EVENTS } from "../data/attackEvents";
import { INITIAL_LOG_POLICIES, INITIAL_EXCLUSION_RULES } from "../data/logPolicy";
import { DISPLAY_TIMEZONE } from "../lib/timezone";

function RuleToggle({ enabled, onToggle }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`relative w-8 h-4.5 rounded-full transition-colors shrink-0 ${
        enabled ? "bg-dash-mint" : "bg-dash-surfaceAlt"
      }`}
      title={enabled ? "클릭하여 비활성화" : "클릭하여 활성화"}
    >
      <span
        className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-dash-bg transition-transform ${
          enabled ? "translate-x-[17px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function RuleRow({ rule, rank, onToggle }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-t border-dash-surfaceAlt first:border-t-0 first:pt-0">
      <span className="text-dash-muted text-xs w-4">{String(rank).padStart(2, "0")}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-dash-fg text-sm truncate">{rule.name}</p>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
              rule.enabled ? "bg-dash-mint/15 text-dash-mint" : "bg-dash-surfaceAlt text-dash-muted"
            }`}
          >
            {rule.enabled ? "활성" : "비활성"}
          </span>
        </div>
        <p className="text-dash-muted text-[11px] truncate">{rule.description}</p>
      </div>
      <span className="text-dash-fg text-sm font-semibold w-14 text-right shrink-0">{rule.hits}건</span>
      <RuleToggle enabled={rule.enabled} onToggle={() => onToggle?.(rule.id)} />
    </div>
  );
}

// 보존 tier + 샘플링 비율을 계층별로 조정하는 입력 행. 숫자 입력이라 로컬 문자열
// 상태 없이 onChange에서 바로 상위 state로 반영 — 잘못된 값(빈 문자열 등)은
// blur 전까지는 그냥 두고 커밋 시점에만 숫자로 정규화한다.
function PolicyRow({ policy, onUpdate }) {
  function commit(field, value, min, max) {
    const num = Math.min(max, Math.max(min, Number(value) || 0));
    onUpdate(policy.layer, { [field]: num });
  }
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5 border-t border-dash-surfaceAlt first:border-t-0 first:pt-0 text-xs">
      <span className="text-dash-fg text-sm font-medium w-24 shrink-0">{policy.layer}</span>

      <label className="flex items-center gap-1.5 text-dash-muted">
        Hot tier
        <input
          type="number"
          min={1}
          max={90}
          value={policy.hotDays}
          onChange={(e) => commit("hotDays", e.target.value, 1, 90)}
          className="w-14 bg-dash-bg text-dash-fg text-right rounded-md px-1.5 py-1 border border-dash-surfaceAlt focus:outline-none focus:border-dash-mint"
        />
        일
      </label>

      <label className="flex items-center gap-1.5 text-dash-muted">
        Cold/Archive
        <input
          type="number"
          min={7}
          max={730}
          value={policy.coldDays}
          onChange={(e) => commit("coldDays", e.target.value, 7, 730)}
          className="w-16 bg-dash-bg text-dash-fg text-right rounded-md px-1.5 py-1 border border-dash-surfaceAlt focus:outline-none focus:border-dash-mint"
        />
        일
      </label>

      <label className="flex items-center gap-1.5 text-dash-muted">
        샘플링
        <input
          type="number"
          min={1}
          max={100}
          value={policy.samplingRate}
          onChange={(e) => commit("samplingRate", e.target.value, 1, 100)}
          className="w-14 bg-dash-bg text-dash-fg text-right rounded-md px-1.5 py-1 border border-dash-surfaceAlt focus:outline-none focus:border-dash-mint"
        />
        %
      </label>

      <button
        onClick={() => onUpdate(policy.layer, { archiveEnabled: !policy.archiveEnabled })}
        className={`ml-auto text-[10px] px-2 py-1 rounded-md shrink-0 ${
          policy.archiveEnabled ? "bg-dash-mint/15 text-dash-mint" : "bg-dash-surfaceAlt text-dash-muted"
        }`}
      >
        아카이브 {policy.archiveEnabled ? "ON" : "OFF"}
      </button>
    </div>
  );
}

function ExclusionRuleRow({ rule, onToggle }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-t border-dash-surfaceAlt first:border-t-0 first:pt-0">
      <RuleToggle enabled={rule.enabled} onToggle={() => onToggle?.(rule.id)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-dash-surfaceAlt text-dash-muted shrink-0">{rule.layer}</span>
          <p className="text-dash-fg text-xs font-mono truncate">{rule.pattern}</p>
        </div>
        <p className="text-dash-muted text-[11px] mt-0.5">{rule.reason}</p>
      </div>
      <span
        className={`text-xs font-semibold shrink-0 ${rule.enabled ? "text-dash-mint" : "text-dash-faint"}`}
        title="예상 로그량 감소 비중"
      >
        -{rule.estimatedReductionPct}%
      </span>
    </div>
  );
}

export default function AdminAuditView({
  auditLog = [],
  rules = RULES,
  onToggleRule,
  logPolicies = INITIAL_LOG_POLICIES,
  onUpdatePolicy,
  exclusionRules = INITIAL_EXCLUSION_RULES,
  onToggleExclusion,
}) {
  const ranked = useMemo(() => byRuleHits(ATTACK_EVENTS, rules), [rules]);
  const activeExclusions = exclusionRules.filter((r) => r.enabled);
  const totalReductionByLayer = useMemo(() => {
    return activeExclusions.reduce((acc, r) => {
      acc[r.layer] = (acc[r.layer] || 0) + r.estimatedReductionPct;
      return acc;
    }, {});
  }, [exclusionRules]);

  return (
    <div className="space-y-6">
      <div className="bg-dash-surface rounded-2xl p-5">
        <h3 className="text-dash-fg text-sm font-semibold mb-1">데이터 정책 (보존 · 샘플링 · 제외)</h3>
        <p className="text-dash-muted text-xs mb-3">
          계층별 hot/cold tier 보존 기간과 저장 전 샘플링 비율 · 파이프라인 단계에서 걸러낼 저가치 노이즈 규칙
        </p>
        <div className="mb-4">
          {logPolicies.map((p) => (
            <PolicyRow key={p.layer} policy={p} onUpdate={onUpdatePolicy} />
          ))}
        </div>
        <div className="pt-3 border-t border-dash-surfaceAlt">
          <p className="text-dash-faint text-[11px] mb-2">
            제외 규칙 {activeExclusions.length}/{exclusionRules.length}개 활성 · 계층별 예상 로그량 감소:{" "}
            {Object.entries(totalReductionByLayer)
              .map(([layer, pct]) => `${layer} -${pct}%`)
              .join(" · ") || "없음"}
          </p>
          {exclusionRules.map((r) => (
            <ExclusionRuleRow key={r.id} rule={r} onToggle={onToggleExclusion} />
          ))}
        </div>
      </div>

      <div className="bg-dash-surface rounded-2xl p-5">
        <h3 className="text-dash-fg text-sm font-semibold mb-1">탐지 룰별 적중 랭킹</h3>
        <p className="text-dash-muted text-xs mb-1">
          최근 7일 · 어느 룰이 제일 많이 걸리는지 · 총 {rules.length}개 룰 · 스위치로 켜고 끌 수 있음
        </p>
        <div>
          {ranked.map((r, i) => (
            <RuleRow key={r.id} rule={r} rank={i + 1} onToggle={onToggleRule} />
          ))}
        </div>
      </div>

      <div className="bg-dash-surface rounded-2xl p-5">
        <h3 className="text-dash-fg text-sm font-semibold mb-1">Audit Log</h3>
        <p className="text-dash-muted text-xs mb-3">누가 · 언제 · 어떤 룰/조치를 했는지</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dash-muted text-xs uppercase tracking-wide">
                <th className="text-left font-medium pb-2">시각</th>
                <th className="text-left font-medium pb-2">사용자</th>
                <th className="text-left font-medium pb-2">액션</th>
                <th className="text-left font-medium pb-2">대상</th>
                <th className="text-left font-medium pb-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((log) => (
                <tr key={log.id} className="border-t border-dash-surfaceAlt">
                  <td className="py-2.5 text-dash-faint whitespace-nowrap pr-4 text-xs">
                    {log.timestamp.toLocaleString("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: DISPLAY_TIMEZONE,
                    })}
                  </td>
                  <td className="py-2.5 text-dash-fg whitespace-nowrap pr-4 text-xs">{log.user}</td>
                  <td className="py-2.5 text-dash-fg pr-4 text-xs">{log.action}</td>
                  <td className="py-2.5 text-dash-muted whitespace-nowrap pr-4 text-xs">{log.target}</td>
                  <td className="py-2.5 text-dash-faint whitespace-nowrap text-xs">{log.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {auditLog.length === 0 && <p className="text-dash-muted text-xs py-3">기록된 감사 로그가 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}
