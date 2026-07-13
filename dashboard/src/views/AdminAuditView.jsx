import React, { useMemo, useState } from "react";
import { INITIAL_LOG_POLICIES, INITIAL_EXCLUSION_RULES } from "../data/logPolicy";
import { useAuditLogs } from "../hooks/useAuditLogs";
import { useTargets } from "../hooks/useTargets";
import { useAllowList } from "../hooks/useAllowList";
import { useScenarios } from "../hooks/useScenarios";
import { useAlertConfigs } from "../hooks/useAlertConfigs";
import { useTrendReport } from "../hooks/useTrendReport";
import { apiPost, apiPatch, apiDelete, ApiError } from "../lib/authApi";

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

// scenario_rules엔 사람이 쓴 설명 필드가 없어서(correlation-engine YAML엔 있을
// 수도 있지만 API가 안 내려줌) required_modules/time_window/correlation_key로
// 대신 조립한다 — "이 룰이 대략 뭘 보는지" 감만 잡히면 충분.
function describeScenario(s) {
  const modules = (s.required_modules || []).join(" + ") || "모듈 미지정";
  return `${modules} · ${s.time_window_seconds}s 내 동일 ${s.correlation_key_type} · severity≥${s.min_severity}`;
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

// 보호 대상 애플리케이션(targets) 관리 패널 — 여러 개 등록해두면(예: Juice Shop을
// 여러 인스턴스로 띄워서 테스트) 나중에 allow-list를 타깃별로 스코프할 수 있다.
// 지금은 등록/관리까지만 되고, 실제 파이프라인은 아직 이 테이블을 안 읽는다
// (targets_api.py 주석 참고) — 여러 개 등록해도 당장 로그 흐름엔 영향 없음.
function TargetsPanel({ targets, status, error, onCreate, onToggleActive, onDelete }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim()) return;
    setSubmitting(true);
    try {
      await onCreate(name.trim(), baseUrl.trim());
      setName("");
      setBaseUrl("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-dash-fg text-sm font-semibold">보호 대상 (Targets)</h3>
          <p className="text-dash-muted text-xs mt-0.5">
            GET/POST/PATCH/DELETE /targets · 등록만 되고 파이프라인 소비는 아직 없음
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름 (예: Juice Shop #2)"
            className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-44"
          />
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="base URL (예: http://juice-shop-2:3000)"
            className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-56"
          />
          <button
            type="submit"
            disabled={submitting || !name.trim() || !baseUrl.trim()}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint hover:bg-dash-mint/25 disabled:opacity-50 whitespace-nowrap"
          >
            추가
          </button>
        </form>
      </div>
      {status === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-3">{error}</p>}
      {status === "ready" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dash-muted text-xs uppercase tracking-wide">
                <th className="text-left font-medium pb-2">이름</th>
                <th className="text-left font-medium pb-2">Base URL</th>
                <th className="text-left font-medium pb-2">상태</th>
                <th className="text-left font-medium pb-2">등록일</th>
                <th className="text-left font-medium pb-2">조치</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} className="border-t border-dash-surfaceAlt">
                  <td className="py-2.5 pr-3 text-dash-fg text-xs">{t.name}</td>
                  <td className="py-2.5 pr-3 text-dash-muted font-mono text-xs">{t.base_url}</td>
                  <td className="py-2.5 pr-3">
                    <button
                      onClick={() => onToggleActive(t)}
                      className={`text-[10px] px-2 py-1 rounded-md whitespace-nowrap ${
                        t.is_active ? "bg-dash-mint/15 text-dash-mint" : "bg-dash-surfaceAlt text-dash-muted"
                      }`}
                    >
                      {t.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="py-2.5 pr-3 text-dash-faint whitespace-nowrap text-xs">
                    {new Date(t.created_at).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="py-2.5">
                    <button
                      onClick={() => onDelete(t)}
                      className="text-[10px] px-2 py-1 rounded bg-dash-surfaceAlt text-dash-muted hover:text-dash-critical whitespace-nowrap"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {targets.length === 0 && <p className="text-dash-muted text-xs py-3">등록된 타깃이 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

// 탐지 예외 IP/CIDR 관리 패널. target을 고르면 그 타깃에만, "전역"을 고르면 모든
// 타깃에 적용되는 예외로 등록된다 — 실제로 걸러내는 로직은 아직 없음(allow_list_api.py
// 주석 참고, banned_ips와 같은 "장부용" 성격).
function AllowListPanel({ entries, status, error, targets, onCreate, onDelete }) {
  const [ip, setIp] = useState("");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const targetNameById = useMemo(() => {
    const map = {};
    targets.forEach((t) => (map[t.id] = t.name));
    return map;
  }, [targets]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!ip.trim()) return;
    setSubmitting(true);
    try {
      await onCreate({
        ip_or_cidr: ip.trim(),
        target_id: targetId || undefined,
        reason: reason.trim() || undefined,
        // <input type="date">는 "YYYY-MM-DD"만 주므로 자정 UTC 기준 ISO로 보정.
        expires_at: expiresAt ? new Date(`${expiresAt}T00:00:00Z`).toISOString() : undefined,
      });
      setIp("");
      setTargetId("");
      setReason("");
      setExpiresAt("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <div className="mb-3">
        <h3 className="text-dash-fg text-sm font-semibold">탐지 예외 (Allow List)</h3>
        <p className="text-dash-muted text-xs mt-0.5">
          GET/POST/DELETE /allow-list · 등록만 되고 파이프라인이 실제로 걸러내진 않음
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-1.5 mb-3">
        <input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="IP / CIDR"
          className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-36"
        />
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="bg-dash-bg text-sm text-dash-fg rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint"
        >
          <option value="">전역 (모든 타깃)</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="사유 (선택)"
          className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-36"
        />
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          title="만료일 (선택, 비우면 무기한)"
          className="bg-dash-bg text-sm text-dash-fg rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint"
        />
        <button
          type="submit"
          disabled={submitting || !ip.trim()}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint hover:bg-dash-mint/25 disabled:opacity-50 whitespace-nowrap"
        >
          추가
        </button>
      </form>
      {status === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-3">{error}</p>}
      {status === "ready" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dash-muted text-xs uppercase tracking-wide">
                <th className="text-left font-medium pb-2">IP / CIDR</th>
                <th className="text-left font-medium pb-2">적용 대상</th>
                <th className="text-left font-medium pb-2">사유</th>
                <th className="text-left font-medium pb-2">만료</th>
                <th className="text-left font-medium pb-2">조치</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-dash-surfaceAlt">
                  <td className="py-2.5 pr-3 text-dash-fg font-mono text-xs">{e.ip_or_cidr}</td>
                  <td className="py-2.5 pr-3 text-dash-muted text-xs">
                    {e.target_id ? targetNameById[e.target_id] ?? e.target_id.slice(0, 8) : "전역"}
                  </td>
                  <td className="py-2.5 pr-3 text-dash-muted text-xs">{e.reason ?? "-"}</td>
                  <td className="py-2.5 pr-3 text-dash-faint whitespace-nowrap text-xs">
                    {e.expires_at ? new Date(e.expires_at).toLocaleDateString("ko-KR") : "무기한"}
                  </td>
                  <td className="py-2.5">
                    <button
                      onClick={() => onDelete(e)}
                      className="text-[10px] px-2 py-1 rounded bg-dash-surfaceAlt text-dash-muted hover:text-dash-critical whitespace-nowrap"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="text-dash-muted text-xs py-3">등록된 예외가 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

const CHANNEL_LABEL = { slack: "Slack", discord: "Discord" };

// Slack/Discord 알림 채널 설정. targets/allow-list와 달리 "장부용"이 아니라
// app/notifications.py가 실제로 이 테이블을 읽어서 발송한다 — 여기서 켠 채널은
// severity가 min_severity 이상인 인시던트가 생기면 바로 웹훅이 나간다.
function AlertConfigsPanel({ configs, status, error, onCreate, onToggleActive, onDelete }) {
  const [channelType, setChannelType] = useState("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [minSeverity, setMinSeverity] = useState(4);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!webhookUrl.trim()) return;
    setSubmitting(true);
    try {
      await onCreate({ channel_type: channelType, webhook_url: webhookUrl.trim(), enabled: true, min_severity: Number(minSeverity) });
      setWebhookUrl("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-dash-fg text-sm font-semibold">알림 채널 (Slack / Discord)</h3>
          <p className="text-dash-muted text-xs mt-0.5">
            GET/POST/PATCH/DELETE /alert-configs · 활성 채널은 min_severity 이상 인시던트 발생 시 실제로 웹훅 발송됨
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-1.5">
          <select
            value={channelType}
            onChange={(e) => setChannelType(e.target.value)}
            className="bg-dash-bg text-sm text-dash-fg rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint"
          >
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
          </select>
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="webhook URL"
            className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-64"
          />
          <select
            value={minSeverity}
            onChange={(e) => setMinSeverity(e.target.value)}
            title="이 severity 이상일 때만 발송"
            className="bg-dash-bg text-sm text-dash-fg rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint"
          >
            {[4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                severity≥{n}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting || !webhookUrl.trim()}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint hover:bg-dash-mint/25 disabled:opacity-50 whitespace-nowrap"
          >
            추가
          </button>
        </form>
      </div>
      {status === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-3">{error}</p>}
      {status === "ready" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dash-muted text-xs uppercase tracking-wide">
                <th className="text-left font-medium pb-2">채널</th>
                <th className="text-left font-medium pb-2">Webhook URL</th>
                <th className="text-left font-medium pb-2">기준</th>
                <th className="text-left font-medium pb-2">상태</th>
                <th className="text-left font-medium pb-2">조치</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id} className="border-t border-dash-surfaceAlt">
                  <td className="py-2.5 pr-3 text-dash-fg text-xs">{CHANNEL_LABEL[c.channel_type] ?? c.channel_type}</td>
                  <td className="py-2.5 pr-3 text-dash-muted font-mono text-xs truncate max-w-xs">{c.webhook_url}</td>
                  <td className="py-2.5 pr-3 text-dash-muted text-xs">severity≥{c.min_severity}</td>
                  <td className="py-2.5 pr-3">
                    <button
                      onClick={() => onToggleActive(c)}
                      className={`text-[10px] px-2 py-1 rounded-md whitespace-nowrap ${
                        c.enabled ? "bg-dash-mint/15 text-dash-mint" : "bg-dash-surfaceAlt text-dash-muted"
                      }`}
                    >
                      {c.enabled ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="py-2.5">
                    <button
                      onClick={() => onDelete(c)}
                      className="text-[10px] px-2 py-1 rounded bg-dash-surfaceAlt text-dash-muted hover:text-dash-critical whitespace-nowrap"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {configs.length === 0 && <p className="text-dash-muted text-xs py-3">등록된 알림 채널이 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

// GET /reports/trend — 최근 N일 scenario별 인시던트 집계 + (설정돼 있으면) AI 요약.
// 백엔드의 Anthropic 호출부가 아직 TODO라 지금은 항상 원본 통계만 오고 message가
// 그 상태를 안내한다 — scenarios 목록과 조인해서 scenario_id를 이름으로 보여준다.
function TrendReportPanel({ scenarios }) {
  const { report, status, error } = useTrendReport({ days: 7 });
  const scenarioNameById = useMemo(() => {
    const map = {};
    scenarios.forEach((s) => (map[s.id] = s.name));
    return map;
  }, [scenarios]);

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">AI 트렌드 리포트</h3>
      <p className="text-dash-muted text-xs mb-3">GET /reports/trend · 최근 7일 인시던트를 룰별로 집계</p>
      {status === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-3">{error}</p>}
      {status === "ready" && report && (
        <>
          <p
            className={`text-xs rounded-lg px-3 py-2 mb-3 ${
              report.configured ? "bg-dash-mint/10 text-dash-mint" : "bg-dash-surfaceAlt text-dash-muted"
            }`}
          >
            {report.message}
          </p>
          {report.stats.length === 0 ? (
            <p className="text-dash-muted text-xs py-3">최근 7일간 인시던트가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dash-muted text-xs uppercase tracking-wide">
                  <th className="text-left font-medium pb-2">규칙</th>
                  <th className="text-left font-medium pb-2">인시던트 수</th>
                  <th className="text-left font-medium pb-2">최고 severity</th>
                </tr>
              </thead>
              <tbody>
                {report.stats.map((row) => (
                  <tr key={row.scenario_id ?? "unmatched"} className="border-t border-dash-surfaceAlt">
                    <td className="py-2 pr-3 text-dash-fg text-xs">
                      {row.scenario_id ? scenarioNameById[row.scenario_id] ?? row.scenario_id.slice(0, 8) : "미매칭"}
                    </td>
                    <td className="py-2 pr-3 text-dash-fg text-xs">{row.incident_count}</td>
                    <td className="py-2 text-dash-muted text-xs">{row.max_severity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminAuditView({
  logPolicies = INITIAL_LOG_POLICIES,
  onUpdatePolicy,
  exclusionRules = INITIAL_EXCLUSION_RULES,
  onToggleExclusion,
  pushToast,
}) {
  // GET /audit-logs 실데이터 — 예전엔 App.jsx가 들고 있던 mock auditLog를 prop으로
  // 받았는데, 다른 뷰들(Incidents/WAS/Falco/K8sAudit)과 같은 패턴으로 이 뷰가 직접
  // 자기 데이터를 fetch하도록 통일했다. logPolicies/exclusionRules(데이터 보존·샘플링·
  // 제외 규칙)만 아직 대응하는 백엔드 엔드포인트가 아예 없어서 App.jsx의 로컬 mock
  // 상태로 남아있다 — rules(탐지 룰 랭킹)/alert-configs/reports-trend는 이번에 실제
  // 백엔드(scenarios_api.py/alert_configs_api.py/ai_report.py)로 연결했다.
  const { logs: auditLog, status: auditStatus, error: auditError } = useAuditLogs({ limit: 50 });
  const { targets, status: targetsStatus, error: targetsError, reload: reloadTargets } = useTargets();
  const { entries: allowList, status: allowListStatus, error: allowListError, reload: reloadAllowList } =
    useAllowList();
  const { scenarios, status: scenariosStatus, error: scenariosError, reload: reloadScenarios } = useScenarios();
  const { configs: alertConfigs, status: alertConfigsStatus, error: alertConfigsError, reload: reloadAlertConfigs } =
    useAlertConfigs();

  function toast(message, tone) {
    pushToast?.(message, tone);
  }

  async function handleToggleScenario(scenario) {
    try {
      await apiPatch(`/scenarios/${scenario.id}/enabled`, { enabled: !scenario.enabled });
      toast(`"${scenario.name}" ${scenario.enabled ? "비활성화" : "활성화"}했습니다.`, "success");
      reloadScenarios();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "탐지 룰 상태 변경에 실패했습니다.", "error");
    }
  }

  async function handleCreateAlertConfig(body) {
    try {
      await apiPost("/alert-configs", body);
      toast(`${CHANNEL_LABEL[body.channel_type] ?? body.channel_type} 알림 채널을 등록했습니다.`, "success");
      reloadAlertConfigs();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "알림 채널 등록에 실패했습니다.", "error");
    }
  }

  async function handleToggleAlertConfigActive(config) {
    try {
      await apiPatch(`/alert-configs/${config.id}`, {
        channel_type: config.channel_type,
        webhook_url: config.webhook_url,
        enabled: !config.enabled,
        min_severity: config.min_severity,
      });
      toast(`알림 채널을 ${config.enabled ? "비활성화" : "활성화"}했습니다.`, "success");
      reloadAlertConfigs();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "알림 채널 상태 변경에 실패했습니다.", "error");
    }
  }

  async function handleDeleteAlertConfig(config) {
    try {
      await apiDelete(`/alert-configs/${config.id}`);
      toast("알림 채널을 삭제했습니다.", "success");
      reloadAlertConfigs();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "알림 채널 삭제에 실패했습니다.", "error");
    }
  }

  async function handleCreateTarget(name, baseUrl) {
    try {
      await apiPost("/targets", { name, base_url: baseUrl, is_active: true });
      toast(`타깃 "${name}" 등록했습니다.`, "success");
      reloadTargets();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "타깃 등록에 실패했습니다.", "error");
    }
  }

  async function handleToggleTargetActive(target) {
    try {
      await apiPatch(`/targets/${target.id}`, {
        name: target.name,
        base_url: target.base_url,
        is_active: !target.is_active,
      });
      toast(`"${target.name}" ${target.is_active ? "비활성화" : "활성화"}했습니다.`, "success");
      reloadTargets();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "타깃 상태 변경에 실패했습니다.", "error");
    }
  }

  async function handleDeleteTarget(target) {
    try {
      await apiDelete(`/targets/${target.id}`);
      toast(`타깃 "${target.name}"을(를) 삭제했습니다.`, "success");
      reloadTargets();
    } catch (e) {
      // 409 - allow_list가 이 target_id를 참조 중이면 백엔드가 삭제를 막는다
      // (targets_api.py delete_target 참고) - 그대로 사용자에게 알려준다.
      toast(
        e instanceof ApiError
          ? e.message || "이 타깃을 참조하는 allow-list 항목이 있어 삭제할 수 없습니다."
          : "타깃 삭제에 실패했습니다.",
        "error"
      );
    }
  }

  async function handleCreateAllowListEntry(body) {
    try {
      await apiPost("/allow-list", body);
      toast(`${body.ip_or_cidr} 예외 등록했습니다.`, "success");
      reloadAllowList();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "예외 등록에 실패했습니다.", "error");
    }
  }

  async function handleDeleteAllowListEntry(entry) {
    try {
      await apiDelete(`/allow-list/${entry.id}`);
      toast(`${entry.ip_or_cidr} 예외를 삭제했습니다.`, "success");
      reloadAllowList();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "예외 삭제에 실패했습니다.", "error");
    }
  }

  // /scenarios가 이미 hit_count 기준 내림차순으로 정렬해서 내려주므로(scenarios_api.py
  // list_scenarios) 클라이언트에서 다시 정렬할 필요 없음 — RuleRow가 기대하는
  // {id, name, description, hits, enabled} 모양으로만 얇게 매핑한다.
  const rankedScenarios = useMemo(
    () => scenarios.map((s) => ({ id: s.id, name: s.name, description: describeScenario(s), hits: s.hit_count, enabled: s.enabled, _raw: s })),
    [scenarios]
  );
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
          GET /scenarios · 실제 인시던트 적중 건수 기준 · 총 {scenarios.length}개 룰 · 스위치로 켜고 끌 수 있음
        </p>
        {scenariosStatus === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
        {scenariosStatus === "error" && <p className="text-dash-critical text-xs py-3">{scenariosError}</p>}
        {scenariosStatus === "ready" && (
          <div>
            {rankedScenarios.map((r, i) => (
              <RuleRow key={r.id} rule={r} rank={i + 1} onToggle={() => handleToggleScenario(r._raw)} />
            ))}
            {rankedScenarios.length === 0 && <p className="text-dash-muted text-xs py-3">등록된 탐지 룰이 없습니다.</p>}
          </div>
        )}
      </div>

      <TargetsPanel
        targets={targets}
        status={targetsStatus}
        error={targetsError}
        onCreate={handleCreateTarget}
        onToggleActive={handleToggleTargetActive}
        onDelete={handleDeleteTarget}
      />

      <AllowListPanel
        entries={allowList}
        status={allowListStatus}
        error={allowListError}
        targets={targets}
        onCreate={handleCreateAllowListEntry}
        onDelete={handleDeleteAllowListEntry}
      />

      <AlertConfigsPanel
        configs={alertConfigs}
        status={alertConfigsStatus}
        error={alertConfigsError}
        onCreate={handleCreateAlertConfig}
        onToggleActive={handleToggleAlertConfigActive}
        onDelete={handleDeleteAlertConfig}
      />

      <TrendReportPanel scenarios={scenarios} />

      <div className="bg-dash-surface rounded-2xl p-5">
        <h3 className="text-dash-fg text-sm font-semibold mb-1">Audit Log</h3>
        <p className="text-dash-muted text-xs mb-3">누가 · 언제 · 어떤 조치를 했는지 (최근 50건)</p>
        {auditStatus === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
        {auditStatus === "error" && <p className="text-dash-critical text-xs py-3">{auditError}</p>}
        {auditStatus === "ready" && (
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
                    {new Date(log.created_at).toLocaleString("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  {/* user_id는 UUID 그대로 — 백엔드에 유저 목록 조회 API가 아직
                      없어서 이름으로 못 바꾼다(useAuditLogs.js 주석 참고). 앞 8자리만
                      잘라서 그나마 스캔하기 쉽게 표시. */}
                  <td className="py-2.5 text-dash-fg whitespace-nowrap pr-4 text-xs font-mono">
                    {log.user_id ? log.user_id.slice(0, 8) : "system"}
                  </td>
                  <td className="py-2.5 text-dash-fg pr-4 text-xs">{log.action}</td>
                  <td className="py-2.5 text-dash-muted whitespace-nowrap pr-4 text-xs">
                    {log.target_table ?? "-"}
                  </td>
                  <td className="py-2.5 text-dash-faint whitespace-nowrap text-xs">{log.ip_address ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {auditLog.length === 0 && <p className="text-dash-muted text-xs py-3">기록된 감사 로그가 없습니다.</p>}
        </div>
        )}
      </div>
    </div>
  );
}
