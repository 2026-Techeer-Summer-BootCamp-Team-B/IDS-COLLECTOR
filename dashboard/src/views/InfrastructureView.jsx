import React, { useMemo } from "react";
import { ATTACK_EVENTS, byK8sTarget, byCountry, sourceHealth } from "../data/attackEvents";
import WorldMap from "../components/WorldMap";
import { CHART_COLORS } from "../data/theme";
import { useTheme } from "../hooks/useTheme";

const STATUS_META = {
  healthy: { label: "정상 수신중" },
  warning: { label: "수신 지연" },
  critical: { label: "무응답 (장애 의심)" },
};

function formatSilence(ms) {
  if (!isFinite(ms)) return "로그 수신 이력 없음";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전 마지막 수신`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 ${mins % 60}분 전 마지막 수신`;
  return `${Math.floor(hours / 24)}일 전 마지막 수신`;
}

// absent_over_time 스타일 헬스체크 — WAS/Falco/K8s Audit 중 하나가 일정 시간
// 조용해지면(에이전트 다운, 파이프라인 장애 의심) 여기서 바로 드러남.
function SourceHealthPanel() {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const health = useMemo(() => sourceHealth(), []);
  const statusColor = { healthy: C.mint, warning: C.high, critical: C.critical };

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">소스 헬스체크</h3>
      <p className="text-dash-muted text-xs mb-4">
        3계층(WAS / Falco / K8s Audit) 중 하나가 조용해지면 파이프라인 장애 신호로 간주
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {health.map((h) => {
          const color = statusColor[h.status];
          return (
            <div key={h.source} className="bg-dash-bg rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-dash-fg text-sm font-medium">{h.source}</span>
                <span className="flex items-center gap-1.5 text-[11px]" style={{ color }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: color }} />
                  {STATUS_META[h.status].label}
                </span>
              </div>
              <p className="text-dash-muted text-[11px]">{formatSilence(h.silentMs)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function intensityColor(count, max, C) {
  const ratio = max ? count / max : 0;
  if (ratio > 0.66) return C.critical;
  if (ratio > 0.33) return C.high;
  if (ratio > 0) return C.mint;
  return C.surfaceAlt;
}

// The neutral "no attacks" tier uses the surface color, which is light in
// light mode — white text on it would be unreadable, so only the hot tiers
// (which stay dark/saturated in both themes) get white text.
function intensityTextColor(count, max, C) {
  return max && count > 0 ? "#FFFFFF" : C.fg;
}

export default function InfrastructureView() {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const targets = useMemo(() => byK8sTarget(ATTACK_EVENTS), []);
  const countries = useMemo(() => byCountry(ATTACK_EVENTS), []);
  const maxTarget = targets[0]?.count || 1;

  const byNamespace = useMemo(() => {
    const map = {};
    targets.forEach((t) => {
      map[t.namespace] = map[t.namespace] || [];
      map[t.namespace].push(t);
    });
    return map;
  }, [targets]);

  return (
    <div className="space-y-6">
      <SourceHealthPanel />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-dash-surface rounded-2xl p-5">
          <h3 className="text-dash-fg text-sm font-semibold mb-1">Top 공격 대상 (Namespace / Pod)</h3>
          <p className="text-dash-muted text-xs mb-4">최근 7일 · 공격 탐지 건수 기준 순위</p>
          <div className="space-y-2.5">
            {targets.slice(0, 8).map((t, i) => (
              <div key={`${t.namespace}/${t.pod}`} className="flex items-center gap-3">
                <span className="text-dash-muted text-xs w-4">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-dash-fg">
                      {t.namespace} <span className="text-dash-muted">/ {t.pod}</span>
                    </span>
                    <span className="text-dash-muted">{t.count}건</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-dash-surfaceAlt overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(t.count / maxTarget) * 100}%`,
                        backgroundColor: intensityColor(t.count, maxTarget, C),
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-dash-surface rounded-2xl p-5">
          <h3 className="text-dash-fg text-sm font-semibold mb-1">클러스터 구조</h3>
          <p className="text-dash-muted text-xs mb-4">네임스페이스 &gt; Pod · 색이 진할수록 공격 집중</p>
          <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
            {Object.entries(byNamespace).map(([ns, pods]) => (
              <div key={ns}>
                <p className="text-dash-faint text-xs font-medium mb-1.5">{ns}</p>
                <div className="flex flex-wrap gap-1.5">
                  {pods.map((p) => (
                    <span
                      key={p.pod}
                      className="text-[10px] px-2 py-1 rounded-md whitespace-nowrap"
                      style={{
                        backgroundColor: `${intensityColor(p.count, maxTarget, C)}cc`,
                        color: intensityTextColor(p.count, maxTarget, C),
                      }}
                      title={`${p.count}건 · 주요 유형 ${p.topAttackType}`}
                    >
                      {p.pod} ({p.count})
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-dash-surface rounded-2xl p-5">
        <div className="mb-4">
          <h3 className="text-dash-fg text-sm font-semibold">공격 발원지 (GeoIP)</h3>
          <p className="text-dash-muted text-xs mt-0.5">최근 7일 · 국가별 탐지 건수 (원 크기 = 건수)</p>
        </div>
        <div className="h-80">
          <WorldMap points={countries} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-dash-muted">
          {countries.slice(0, 6).map((c) => (
            <span key={c.country}>
              {c.country} <span className="text-dash-fg">{c.count}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
