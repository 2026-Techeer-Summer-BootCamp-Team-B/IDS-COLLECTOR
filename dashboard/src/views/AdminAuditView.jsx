import React, { useMemo } from "react";
import { RULES, byRuleHits } from "../data/rules";
import { ATTACK_EVENTS } from "../data/attackEvents";

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

export default function AdminAuditView({ auditLog = [], rules = RULES, onToggleRule }) {
  const ranked = useMemo(() => byRuleHits(ATTACK_EVENTS, rules), [rules]);

  return (
    <div className="space-y-6">
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
