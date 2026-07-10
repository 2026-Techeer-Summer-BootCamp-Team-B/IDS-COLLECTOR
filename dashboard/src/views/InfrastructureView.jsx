import React, { useMemo } from "react";
import { ATTACK_EVENTS, byK8sTarget, byCountry } from "../data/attackEvents";
import WorldMap from "../components/WorldMap";

function intensityColor(count, max) {
  const ratio = max ? count / max : 0;
  if (ratio > 0.66) return "#F2617A";
  if (ratio > 0.33) return "#F2A65A";
  if (ratio > 0) return "#A9DFD8";
  return "#2B2B36";
}

export default function InfrastructureView() {
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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-dash-surface rounded-2xl p-5">
          <h3 className="text-white text-sm font-semibold mb-1">Top 공격 대상 (Namespace / Pod)</h3>
          <p className="text-dash-muted text-xs mb-4">최근 7일 · 공격 탐지 건수 기준 순위</p>
          <div className="space-y-2.5">
            {targets.slice(0, 8).map((t, i) => (
              <div key={`${t.namespace}/${t.pod}`} className="flex items-center gap-3">
                <span className="text-dash-muted text-xs w-4">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white">
                      {t.namespace} <span className="text-dash-muted">/ {t.pod}</span>
                    </span>
                    <span className="text-dash-muted">{t.count}건</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-dash-surfaceAlt overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(t.count / maxTarget) * 100}%`,
                        backgroundColor: intensityColor(t.count, maxTarget),
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-dash-surface rounded-2xl p-5">
          <h3 className="text-white text-sm font-semibold mb-1">클러스터 구조</h3>
          <p className="text-dash-muted text-xs mb-4">네임스페이스 &gt; Pod · 색이 진할수록 공격 집중</p>
          <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
            {Object.entries(byNamespace).map(([ns, pods]) => (
              <div key={ns}>
                <p className="text-dash-faint text-xs font-medium mb-1.5">{ns}</p>
                <div className="flex flex-wrap gap-1.5">
                  {pods.map((p) => (
                    <span
                      key={p.pod}
                      className="text-[10px] px-2 py-1 rounded-md text-white whitespace-nowrap"
                      style={{ backgroundColor: `${intensityColor(p.count, maxTarget)}cc` }}
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
          <h3 className="text-white text-sm font-semibold">공격 발원지 (GeoIP)</h3>
          <p className="text-dash-muted text-xs mt-0.5">최근 7일 · 국가별 탐지 건수 (원 크기 = 건수)</p>
        </div>
        <div className="h-80">
          <WorldMap points={countries} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-dash-muted">
          {countries.slice(0, 6).map((c) => (
            <span key={c.country}>
              {c.country} <span className="text-white">{c.count}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
