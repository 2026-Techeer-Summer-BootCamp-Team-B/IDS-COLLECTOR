import React, { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from "recharts";
import { CHART_COLORS, DONUT_PALETTE } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { DISPLAY_TIMEZONE } from "../lib/timezone";
import { useAuditLogs } from "../hooks/useAuditLogs";
import { useTargets } from "../hooks/useTargets";
import { useAllowList } from "../hooks/useAllowList";
import { useBannedIps } from "../hooks/useBannedIps";
import { useScenarios } from "../hooks/useScenarios";
import { useAlertConfigs } from "../hooks/useAlertConfigs";
import { useLogPolicies } from "../hooks/useLogPolicies";
import { useTrendReport } from "../hooks/useTrendReport";
import { apiPost, apiPatch, apiDelete, ApiError } from "../lib/authApi";
import { renderMarkdownLite } from "../lib/markdownLite";
import { usePollInterval } from "../context/PollIntervalContext";
import { useFontFamily, FONT_OPTIONS } from "../hooks/useFontFamily";

// 실시간 패널(Overview/WAS/Falco/K8sAudit + LiveTicker)이 공유하는 갱신 주기를
// 관리자가 여기서 바꿀 수 있게 한 프리셋 - 너무 짧으면(500ms) 백엔드 집계 쿼리
// 부담이 커지고, 너무 길면(30초+) "실시간"이라는 느낌이 옅어져서 그 사이 값들로
// 구성했다. 프리셋 밖의 임의 값은 지금은 지원하지 않음(필요해지면 숫자 입력으로
// 바꾸면 됨 - Context 쪽 setPollMs는 이미 임의 ms를 받는다).
const POLL_INTERVAL_PRESETS = [
  { label: "0.5초", ms: 500 },
  { label: "1초", ms: 1000 },
  { label: "2초", ms: 2000 },
  { label: "5초", ms: 5000 },
  { label: "10초", ms: 10000 },
  { label: "30초", ms: 30000 },
];

function PollIntervalPanel() {
  const { pollMs, setPollMs, defaultPollMs } = usePollInterval();

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">실시간 갱신 주기</h3>
      <p className="text-dash-muted text-xs mb-3">
        Overview · WAS · Falco · K8s Audit 상세 화면과 실시간 티커가 서버를 다시 조회하는 간격 —
        짧을수록 화면이 더 빨리 따라오지만 백엔드 조회 부하도 늘어난다. 브라우저에 저장되며 지금은
        이 브라우저에만 적용된다.
      </p>
      <div className="flex flex-wrap gap-2">
        {POLL_INTERVAL_PRESETS.map((p) => (
          <button
            key={p.ms}
            onClick={() => setPollMs(p.ms)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              pollMs === p.ms
                ? "bg-dash-mint/15 text-dash-mint border-dash-mint/40"
                : "bg-dash-bg text-dash-muted border-transparent hover:text-dash-fg hover:bg-dash-surfaceAlt"
            }`}
          >
            {p.label}
            {p.ms === defaultPollMs ? " (기본)" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

// 2026-07-16: 글씨체를 직접 골라볼 수 있는 패널 - PollIntervalPanel과 같은
// "프리셋 버튼 그리드" 패턴. 각 버튼은 자기 라벨을 실제 그 폰트로 렌더링해서
// (style={{ fontFamily: f.value }}) 클릭하기 전에도 미리보기가 되고, 클릭하면
// 전체 대시보드에 바로 적용된다(useFontFamily가 body에 즉시 반영) - 하나씩
// 눌러가며 비교해볼 수 있게.
function FontPickerPanel() {
  const { fontKey, setFontKey } = useFontFamily();

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">글씨체</h3>
      <p className="text-dash-muted text-xs mb-3">
        대시보드 전체에 적용되는 글씨체 — 버튼을 눌러보면 바로 적용되니 하나씩 비교해보고 골라도 된다.
        브라우저에 저장되며 이 브라우저에만 적용된다.
      </p>
      <div className="flex flex-wrap gap-2">
        {FONT_OPTIONS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFontKey(f.key)}
            style={{ fontFamily: f.value }}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              fontKey === f.key
                ? "bg-dash-mint/15 text-dash-mint border-dash-mint/40"
                : "bg-dash-bg text-dash-muted border-transparent hover:text-dash-fg hover:bg-dash-surfaceAlt"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// 스위치형 knob 대신 ON/OFF 텍스트만 있는 단순 버튼 - knob이 튀어보이고
// 켜짐 색(mint 솔리드)이 너무 밝다는 피드백을 반영해 배경을 반투명 톤으로
// 낮췄다 (다른 곳의 "활성/비활성" 배지와 동일한 mint/15 톤 재사용).
function RuleToggle({ enabled, onToggle }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`shrink-0 text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-md transition-colors ${
        enabled
          ? "bg-dash-mint/20 text-dash-mint"
          : "bg-dash-surfaceAlt text-dash-muted border border-dash-muted/40"
      }`}
      title={enabled ? "클릭하여 비활성화" : "클릭하여 활성화"}
    >
      {enabled ? "ON" : "OFF"}
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

// 룰이 많아지면 전체 목록에서 "뭐가 제일 많이 잡혔는지"가 한눈에 안 들어온다는
// 피드백 - 전체 목록(스크롤)은 그대로 두고 그 위에 적중 건수 상위 5개만 뽑아
// 가로 막대로 보여준다. 룰 이름이 길어서 Y축 라벨을 잘라 보여주고, 잘린 이름은
// Tooltip에서 전체를 다시 보여준다.
function RuleRankingBarChart({ data, C }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28, top: 4, bottom: 4 }}>
        <CartesianGrid stroke={C.surfaceAlt} horizontal={false} />
        <XAxis type="number" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          stroke={C.muted}
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={140}
          tickFormatter={(v) => (v.length > 16 ? `${v.slice(0, 16)}…` : v)}
        />
        <Tooltip
          contentStyle={{ background: C.surface, border: `1px solid ${C.surfaceAlt}`, borderRadius: 8, fontSize: 12, color: C.fg }}
          cursor={{ fill: C.surfaceAlt, opacity: 0.5 }}
          formatter={(value) => [`${value}건`, "적중 건수"]}
          labelFormatter={(label, payload) => payload?.[0]?.payload?.name ?? label}
        />
        <Bar dataKey="hits" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
          {data.map((d, i) => (
            <Cell key={d.id} fill={DONUT_PALETTE[i % DONUT_PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// 3등급(기록/원본/파생) 보존 기간을 조정하는 입력 행 (2026-07-16, 023-log-policies-
// retention-tiers.sql - hot_days/cold_days/sampling_rate를 걷어내고 단일
// retention_days로 통합됨: sampling_rate는 어디서도 집행 안 하던 죽은 컨트롤이었고,
// OpenSearch가 단일 노드라 hot/cold 분리 저장 자체가 애초에 불가능했음). 이제
// PATCH /log-policies/{layer}가 실제 네트워크 호출이라 onChange(키 입력)마다
// 커밋하면 느리고 레이스도 생긴다 - 타이핑 중엔 로컬 draft만 갱신하고, blur
// 시점에 클램프한 값을 커밋한다.
function PolicyRow({ policy, onUpdate }) {
  const [draft, setDraft] = useState(policy);

  useEffect(() => {
    setDraft(policy);
  }, [policy]);

  function commit(field, min, max) {
    const num = Math.min(max, Math.max(min, Number(draft[field]) || 0));
    setDraft((d) => ({ ...d, [field]: num }));
    if (num !== policy[field]) onUpdate(policy.layer, { [field]: num });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5 border-t border-dash-surfaceAlt first:border-t-0 first:pt-0 text-xs">
      <span className="text-dash-fg text-sm font-medium w-24 shrink-0">{policy.layer}</span>

      <label className="flex items-center gap-1.5 text-dash-muted">
        보존 기간
        <input
          type="number"
          min={1}
          max={3650}
          value={draft.retention_days}
          onChange={(e) => setDraft((d) => ({ ...d, retention_days: e.target.value }))}
          onBlur={() => commit("retention_days", 1, 3650)}
          className="w-16 bg-dash-bg text-dash-fg text-right rounded-md px-1.5 py-1 border border-dash-surfaceAlt focus:outline-none focus:border-dash-mint"
        />
        일
      </label>

      <button
        onClick={() => onUpdate(policy.layer, { archive_enabled: !policy.archive_enabled })}
        className={`ml-auto text-[10px] px-2 py-1 rounded-md shrink-0 ${
          policy.archive_enabled ? "bg-dash-mint/15 text-dash-mint" : "bg-dash-surfaceAlt text-dash-muted"
        }`}
      >
        아카이브 {policy.archive_enabled ? "ON" : "OFF"}
      </button>
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
                    {new Date(t.created_at).toLocaleDateString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}
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

// 차단 기록(감사 트레일용, 실제 트래픽은 안 막힘 - banned_ips_api.py 주석 참고)
// 테이블. 수동으로 IP를 추가/해제할 수 있다. 2026-07-16: Incidents 페이지에
// 있던 걸 여기로 옮겼다 - "차단 IP 목록 관리"는 allow-list/targets/alert-configs
// 같은 관리자용 설정이라 조사 화면(Incidents)보다 Admin/Audit이 더 어울린다는
// 피드백. (인시던트 상세에서 바로 차단하는 "소스 IP 차단" 버튼은 조사 흐름에
// 필요해서 IncidentsView에 그대로 남아있음 - 이 테이블은 그 전체 목록 관리용.)
function BannedIpsTable({ bannedIps, status, error, onBan, onUnban }) {
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!ip.trim()) return;
    setSubmitting(true);
    try {
      await onBan(ip.trim(), reason.trim() || undefined);
      setIp("");
      setReason("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-dash-fg text-sm font-semibold">차단된 IP</h3>
          <p className="text-dash-muted text-xs mt-0.5">GET /banned-ips · 감사 트레일 (실제 트래픽 차단은 아님)</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-1.5">
          <input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="IP / CIDR"
            className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-36"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유 (선택)"
            className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-36"
          />
          <button
            type="submit"
            disabled={submitting || !ip.trim()}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-critical/15 text-dash-critical hover:bg-dash-critical/25 disabled:opacity-50 whitespace-nowrap"
          >
            차단
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
                <th className="text-left font-medium pb-2">IP / CIDR</th>
                <th className="text-left font-medium pb-2">사유</th>
                <th className="text-left font-medium pb-2">차단 시각</th>
                <th className="text-left font-medium pb-2">조치</th>
              </tr>
            </thead>
            <tbody>
              {bannedIps.map((b) => (
                <tr key={b.id} className="border-t border-dash-surfaceAlt">
                  <td className="py-2.5 pr-3 text-dash-fg font-mono">{b.ip_or_cidr}</td>
                  <td className="py-2.5 pr-3 text-dash-muted text-xs">{b.reason || "-"}</td>
                  <td className="py-2.5 pr-3 text-dash-faint text-xs whitespace-nowrap">
                    {new Date(b.created_at).toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}
                  </td>
                  <td className="py-2.5">
                    <button
                      onClick={() => onUnban(b.id)}
                      className="text-[10px] px-2 py-1 rounded bg-dash-surfaceAlt text-dash-muted hover:text-dash-fg whitespace-nowrap"
                    >
                      해제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bannedIps.length === 0 && <p className="text-dash-muted text-xs py-3">현재 차단된 IP가 없습니다.</p>}
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
                    {e.expires_at ? new Date(e.expires_at).toLocaleDateString("ko-KR", { timeZone: DISPLAY_TIMEZONE }) : "무기한"}
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

// 페이지가 너무 길어져서(정책/룰/타깃/알림/리포트/감사로그 7개 패널) 성격이
// 비슷한 것끼리 3개 탭으로 나눴다 - 스크롤을 줄이는 목적이라 데이터/훅은
// 그대로 한 번에 다 불러오고(탭 전환해도 재요청 없음), 화면에 뭘 그릴지만 나눈다.
const ADMIN_TABS = [
  { key: "policy", label: "탐지 · 정책" },
  { key: "targets", label: "대상 · 알림" },
  { key: "audit", label: "감사 로그" },
];

function AdminTabSwitcher({ active, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 bg-dash-surface rounded-xl p-1">
      {ADMIN_TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`text-xs font-medium px-3.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
            active === tab.key
              ? "bg-dash-mint/15 text-dash-mint"
              : "text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt"
          }`}
        >
          {tab.label}
        </button>
      ))}
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

// GET /reports/trend — 최근 N일 scenario별 인시던트 집계 + (GEMINI_API_KEY 설정 시)
// Gemini AI 요약. message에 미설정 안내문 또는 실제 요약문이 온다 — scenarios
// 목록과 조인해서 scenario_id를 이름으로 보여준다.
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
          <div
            className={`text-xs rounded-lg px-3 py-2 mb-3 ${
              report.configured ? "bg-dash-mint/10 text-dash-mint" : "bg-dash-surfaceAlt text-dash-muted"
            }`}
          >
            {report.configured ? renderMarkdownLite(report.message) : report.message}
            {report.cached && (
              <p className="text-dash-muted mt-2">
                (탐지 결과에 변화가 없어 이전 요약을 그대로 표시 중)
              </p>
            )}
          </div>
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

export default function AdminAuditView({ pushToast }) {
  // GET /audit-logs 실데이터 — 예전엔 App.jsx가 들고 있던 mock auditLog를 prop으로
  // 받았는데, 다른 뷰들(Incidents/WAS/Falco/K8sAudit)과 같은 패턴으로 이 뷰가 직접
  // 자기 데이터를 fetch하도록 통일했다. logPolicies/exclusionRules(데이터 보존·샘플링·
  // 제외 규칙)도 이번에 실제 백엔드(data_policy_api.py)로 연결해서, 이제 이 뷰의
  // 패널 7개가 전부 App.jsx mock 없이 자기 데이터를 직접 fetch한다.
  const { logs: auditLog, status: auditStatus, error: auditError } = useAuditLogs({ limit: 50 });
  const { targets, status: targetsStatus, error: targetsError, reload: reloadTargets } = useTargets();
  const { entries: allowList, status: allowListStatus, error: allowListError, reload: reloadAllowList } =
    useAllowList();
  const { scenarios, status: scenariosStatus, error: scenariosError, reload: reloadScenarios } = useScenarios();
  const { configs: alertConfigs, status: alertConfigsStatus, error: alertConfigsError, reload: reloadAlertConfigs } =
    useAlertConfigs();
  const {
    policies: logPolicies,
    status: logPoliciesStatus,
    error: logPoliciesError,
    reload: reloadLogPolicies,
  } = useLogPolicies();
  // 2026-07-16: 차단 IP 목록 관리(BannedIpsTable)를 Incidents에서 옮겨왔다.
  const { bannedIps, status: bannedIpsStatus, error: bannedIpsError, reload: reloadBannedIps } = useBannedIps();
  const [activeTab, setActiveTab] = useState("policy");
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];

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

  async function handleUpdateLogPolicy(layer, patch) {
    try {
      await apiPatch(`/log-policies/${encodeURIComponent(layer)}`, patch);
      reloadLogPolicies();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "데이터 정책 변경에 실패했습니다.", "error");
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

  async function handleBanIp(ip, reason) {
    try {
      await apiPost("/banned-ips", { ip_or_cidr: ip, reason });
      toast(`${ip} 차단 처리했습니다.`, "success");
      reloadBannedIps();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "IP 차단에 실패했습니다.", "error");
    }
  }

  async function handleUnbanIp(bannedIpId) {
    try {
      await apiDelete(`/banned-ips/${bannedIpId}`);
      toast("차단을 해제했습니다.", "success");
      reloadBannedIps();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "차단 해제에 실패했습니다.", "error");
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
  // 위 rankedScenarios가 이미 hit_count 내림차순이므로 앞 5개만 잘라내면 그대로
  // TOP 5 - 막대그래프용으로 별도 정렬 로직 불필요.
  const top5Scenarios = useMemo(() => rankedScenarios.slice(0, 5), [rankedScenarios]);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-dash-fg text-base font-semibold">Admin / Audit</h2>
        <AdminTabSwitcher active={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === "policy" && (
        <div className="space-y-6">
          <PollIntervalPanel />
          <FontPickerPanel />

          <div className="bg-dash-surface rounded-2xl p-5">
            <h3 className="text-dash-fg text-sm font-semibold mb-1">데이터 정책 (보존 기간)</h3>
            <p className="text-dash-muted text-xs mb-3">
              3등급(기록 · 원본 · 파생) 보존 기간 — app/log_retention.py가 이 값을 읽어 오래된
              인덱스/레코드를 주기적으로 정리한다. (제외 규칙 기능은 탐지 누락 위험으로 2026-07-16 제거됨)
            </p>
            {logPoliciesStatus === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
            {logPoliciesStatus === "error" && <p className="text-dash-critical text-xs py-3">{logPoliciesError}</p>}
            {logPoliciesStatus === "ready" && (
              <div>
                {logPolicies.map((p) => (
                  <PolicyRow key={p.layer} policy={p} onUpdate={handleUpdateLogPolicy} />
                ))}
              </div>
            )}
          </div>

          <div className="bg-dash-surface rounded-2xl p-5">
            <h3 className="text-dash-fg text-sm font-semibold mb-1">탐지 룰별 적중 랭킹 TOP 5</h3>
            <p className="text-dash-muted text-xs mb-3">
              적중 건수가 가장 많은 룰 5개 — 아래 전체 목록과 같은 GET /scenarios 데이터 기준
            </p>
            {scenariosStatus === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
            {scenariosStatus === "error" && <p className="text-dash-critical text-xs py-3">{scenariosError}</p>}
            {scenariosStatus === "ready" && top5Scenarios.length > 0 && (
              <RuleRankingBarChart data={top5Scenarios} C={C} />
            )}
            {scenariosStatus === "ready" && top5Scenarios.length === 0 && (
              <p className="text-dash-muted text-xs py-3">등록된 탐지 룰이 없습니다.</p>
            )}
          </div>

          <div className="bg-dash-surface rounded-2xl p-5">
            <h3 className="text-dash-fg text-sm font-semibold mb-1">탐지 룰 전체 목록</h3>
            <p className="text-dash-muted text-xs mb-1">
              GET /scenarios · 실제 인시던트 적중 건수 기준 · 총 {scenarios.length}개 룰 · 스위치로 켜고 끌 수 있음
            </p>
            {scenariosStatus === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
            {scenariosStatus === "error" && <p className="text-dash-critical text-xs py-3">{scenariosError}</p>}
            {/* 룰이 많아지면 목록이 끝없이 길어지던 문제(2026-07-16) - 10개
                높이로 고정하고 그 이상은 내부 스크롤로. IncidentsView 좌측
                목록과 같은 패턴(max-h + overflow-y-auto). */}
            {scenariosStatus === "ready" && (
              <div className="max-h-[560px] overflow-y-auto pr-2">
                {rankedScenarios.map((r, i) => (
                  <RuleRow key={r.id} rule={r} rank={i + 1} onToggle={() => handleToggleScenario(r._raw)} />
                ))}
                {rankedScenarios.length === 0 && <p className="text-dash-muted text-xs py-3">등록된 탐지 룰이 없습니다.</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "targets" && (
        <div className="space-y-6">
          <BannedIpsTable
            bannedIps={bannedIps}
            status={bannedIpsStatus}
            error={bannedIpsError}
            onBan={handleBanIp}
            onUnban={handleUnbanIp}
          />

          <AllowListPanel
            entries={allowList}
            status={allowListStatus}
            error={allowListError}
            targets={targets}
            onCreate={handleCreateAllowListEntry}
            onDelete={handleDeleteAllowListEntry}
          />

          <TargetsPanel
            targets={targets}
            status={targetsStatus}
            error={targetsError}
            onCreate={handleCreateTarget}
            onToggleActive={handleToggleTargetActive}
            onDelete={handleDeleteTarget}
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
        </div>
      )}

      {activeTab === "audit" && (
        <div className="bg-dash-surface rounded-2xl p-5">
          <h3 className="text-dash-fg text-sm font-semibold mb-1">Audit Log</h3>
          <p className="text-dash-muted text-xs mb-3">누가 · 언제 · 어떤 조치를 했는지 (최근 50건)</p>
          {auditStatus === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
          {auditStatus === "error" && <p className="text-dash-critical text-xs py-3">{auditError}</p>}
          {/* 2026-07-16: 50건이 한 화면에 그대로 다 나와서 페이지가 길어지던
              문제 - 다른 목록들(탐지 룰 랭킹 등)과 같은 패턴으로 높이를 고정하고
              내부 스크롤로 바꿨다. 헤더 행은 sticky로 고정해서 스크롤해도 어느
              컬럼인지 계속 보이게. */}
          {auditStatus === "ready" && (
          <div className="overflow-auto max-h-[480px] pr-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dash-muted text-xs uppercase tracking-wide sticky top-0 bg-dash-surface">
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
                        timeZone: DISPLAY_TIMEZONE,
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
      )}
    </div>
  );
}
