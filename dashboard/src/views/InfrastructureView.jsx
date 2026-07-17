import React, { useMemo } from "react";
import WorldMap from "../components/WorldMap";
import { CHART_COLORS, DONUT_PALETTE, forTheme } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { usePipelineHealth } from "../hooks/usePipelineHealth";
import { useSourceHealth } from "../hooks/useSourceHealth";
import { useK8sTargets } from "../hooks/useK8sTargets";
import { useGeoStats } from "../hooks/useGeoStats";
import { ModuleVolumeStackedChart } from "./LogDashboard";

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
  const { health, status, error } = useSourceHealth();
  const statusColor = { healthy: C.mint, warning: C.high, critical: C.critical };

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">소스 헬스체크</h3>
      <p className="text-dash-muted text-xs mb-4">
        3계층(WAS / Falco / K8s Audit) 중 하나가 조용해지면 파이프라인 장애 신호로 간주
      </p>
      {status === "loading" && <p className="text-dash-muted text-xs py-2">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-2">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {status !== "loading" && health.map((h) => {
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

// [실측 확인, 2026-07-14] 실제 브로커 대상으로 events.was에 8,000건을 한 번에
// 밀어넣고 normalizer-workers 컨슈머 lag을 1초 간격으로 관찰함 - 정상 상태에서
// 처리 속도가 초당 수천 건 이상이라 8,000건 backlog도 다음 poll(약 1~2초 뒤)에는
// 이미 0으로 소진돼 있었다(실제 공격 시나리오 트래픽으로는 lag이 관측된 적 자체가
// 없음, 자세한 근거는 IDS-COLLECTOR README 참고). 즉 정상 동작 중에는 500만
// 찍혀도 이미 이례적이고, 5000이 "찰나가 아니라 그다음 poll에도 그대로" 남아있다면
// 실제로 못 따라가고 있다는 뜻 - 숫자 자체는 이 실측 결과와 맞아서 그대로 유지.
// 다만 단일 스냅샷만으로는 "막 몰린 버스트가 곧 빠질 것"과 "컨슈머가 멈췄다"를
// 구분 못 한다는 한계는 남아있음 - usePipelineHealth가 지금은 자동 폴링이 없어서
// (수동 reload만) 당장은 아니지만, 나중에 자동 폴링을 붙이면 "N번 연속 임계치
// 초과"처럼 추세를 보는 판정으로 발전시킬 것.
const LAG_WARNING_THRESHOLD = 500;
const LAG_CRITICAL_THRESHOLD = 5000;

function lagColor(totalLag, C) {
  if (totalLag === null || totalLag === undefined) return C.muted;
  if (totalLag >= LAG_CRITICAL_THRESHOLD) return C.critical;
  if (totalLag >= LAG_WARNING_THRESHOLD) return C.high;
  return C.mint;
}

function formatMs(ms) {
  if (ms === null || ms === undefined) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Kafka 컨슈머 lag / DLQ 적재량 / 수신 지연(clock skew) — "로그 소스가 조용해졌는가"를
// 보는 SourceHealthPanel과 달리 "파이프라인이 유입 속도를 따라가고 있는가"를 본다.
// 백엔드 주석에 Kafka AdminClient 부분이 실제 브로커로 미검증이라 적혀 있어, 값이
// 이상하면 백엔드 팀에 먼저 확인하는 게 맞다.
function PipelineHealthPanel() {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { consumerLag, dlqDepth, clockSkew, status, error } = usePipelineHealth();

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">파이프라인 상태</h3>
      <p className="text-dash-muted text-xs mb-4">
        Kafka 컨슈머 lag / DLQ 적재량 / 수신 지연(clock skew) — 파이프라인이 유입 속도를 따라가고 있는지 확인
      </p>

      {status === "loading" && <p className="text-dash-muted text-xs py-2">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-2">{error}</p>}

      {status !== "loading" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-dash-bg rounded-xl p-4">
            <p className="text-dash-faint text-[11px] mb-2">컨슈머 Lag</p>
            {consumerLag.length === 0 && <p className="text-dash-muted text-xs">데이터 없음</p>}
            <div className="space-y-2">
              {consumerLag.map((g) => {
                const color = lagColor(g.total_lag, C);
                return (
                  <div key={g.group} className="flex items-center justify-between text-xs">
                    <span className="text-dash-fg truncate">{g.group}</span>
                    <span className="font-mono shrink-0 ml-2" style={{ color }} title={g.error || ""}>
                      {g.error ? "조회 실패" : `${g.total_lag}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-dash-bg rounded-xl p-4">
            <p className="text-dash-faint text-[11px] mb-2">DLQ 적재량 (events.dlq)</p>
            {dlqDepth ? (
              <p
                className="text-2xl font-semibold"
                style={{ color: dlqDepth.depth > 0 ? C.critical : C.mint }}
              >
                {dlqDepth.depth}
                <span className="text-dash-muted text-xs font-normal ml-1">건</span>
              </p>
            ) : (
              <p className="text-dash-muted text-xs">데이터 없음</p>
            )}
          </div>

          <div className="bg-dash-bg rounded-xl p-4">
            <p className="text-dash-faint text-[11px] mb-2">수신 지연 (clock skew)</p>
            {clockSkew && clockSkew.sample_size > 0 ? (
              <div className="flex gap-4 text-xs">
                <div>
                  <p className="text-dash-faint mb-0.5">p50</p>
                  <p className="text-dash-fg font-mono">{formatMs(clockSkew.p50_ms)}</p>
                </div>
                <div>
                  <p className="text-dash-faint mb-0.5">p95</p>
                  <p className="text-dash-fg font-mono">{formatMs(clockSkew.p95_ms)}</p>
                </div>
                <div>
                  <p className="text-dash-faint mb-0.5">max</p>
                  <p className="text-dash-fg font-mono">{formatMs(clockSkew.max_ms)}</p>
                </div>
              </div>
            ) : (
              <p className="text-dash-muted text-xs">표본 없음</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 압도적으로 큰 값 하나(예: 대상 파드 1개가 전체 트래픽을 다 받는 경우) 때문에
// 나머지 대부분이 "낮음" 티어(ratio ≤ 0.33)로 몰리면서 화면이 온통 mint 색으로
// 뒤덮이는 문제 — 낮음 티어는 색을 아예 빼고(무채도 회색) "집중된 곳"만 색이
// 튀도록 바꿨다.
//
// 2026-07-15: orange -> pink -> cyan/초록까지 세 번 바꿔봤는데도 계속
// "이상하다"는 피드백 - 결국 이미 잘 어울린다고 인정받은 도넛 차트 색
// (Overview/Incidents가 쓰는 DONUT_PALETTE)에서 그대로 3단계를 뽑아 쓰기로.
// 새 색을 발명하지 않고 이미 검증된 톤을 재사용하는 쪽으로 방향을 바꿨다.
function intensityColor(count, max, C, theme) {
  const ratio = max ? count / max : 0;
  if (ratio > 0.66) return forTheme(DONUT_PALETTE[0], theme); // 테라코타 - 가장 집중된 곳
  if (ratio > 0.33) return forTheme(DONUT_PALETTE[1], theme); // 앰버
  if (ratio > 0) return forTheme(DONUT_PALETTE[3], theme); // 스틸 블루
  return C.surfaceAlt;
}

// DONUT_PALETTE 톤(테라코타/앰버/스틸블루)은 중간~어두운 채도라 흰 글자가 다시
// 잘 읽힌다 - 무채색 "공격 없음" 타일만 어두운 surface 계열이라 밝은 글자.
function intensityTextColor(count, max, C) {
  return max && count > 0 ? "#FFFFFF" : C.fg;
}

// 국가별 공격 막대그래프 - GeoIP 지도는 위치 감각은 주지만 국가끼리 정확한
// 건수 비교는 어려워서(원 크기만으로는) 순위형 막대 목록을 옆에 같이 둔다.
// "Top 공격 대상" 패널과 같은 손그림 막대 스타일 + intensityColor로 톤을 맞춤.
function CountryAttackBarChart({ countries, status, error, C, theme }) {
  const max = countries[0]?.count || 1;
  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">국가별 공격 순위</h3>
      <p className="text-dash-muted text-xs mb-4">전체 기간 · 탐지 건수 기준</p>
      {status === "loading" && <p className="text-dash-muted text-xs py-2">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-2">{error}</p>}
      {status === "ready" && countries.length === 0 && (
        <p className="text-dash-muted text-xs py-2">GeoIP 데이터가 아직 없습니다.</p>
      )}
      <div className="space-y-2.5">
        {countries.slice(0, 8).map((c, i) => (
          <div key={c.countryCode} className="flex items-center gap-3">
            <span className="text-dash-muted text-xs w-4">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-dash-fg">{c.country}</span>
                <span className="text-dash-muted">{c.count}건</span>
              </div>
              <div className="h-1.5 rounded-full bg-dash-surfaceAlt overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(c.count / max) * 100}%`, backgroundColor: intensityColor(c.count, max, C, theme) }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InfrastructureView() {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { targets, status: targetsStatus, error: targetsError } = useK8sTargets({ limit: 20 });
  const { countries, status: geoStatus, error: geoError } = useGeoStats({ limit: 10 });
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
      <PipelineHealthPanel />
      <SourceHealthPanel />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-dash-surface rounded-2xl p-5">
          <h3 className="text-dash-fg text-sm font-semibold mb-1">Top 공격 대상 (Namespace / Resource)</h3>
          <p className="text-dash-muted text-xs mb-4">전체 기간 · 공격 탐지 건수 기준 순위</p>
          {targetsStatus === "loading" && <p className="text-dash-muted text-xs py-2">불러오는 중...</p>}
          {targetsStatus === "error" && <p className="text-dash-critical text-xs py-2">{targetsError}</p>}
          {targetsStatus === "ready" && targets.length === 0 && (
            <p className="text-dash-muted text-xs py-2">K8s Audit 이벤트가 아직 없습니다.</p>
          )}
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
                        backgroundColor: intensityColor(t.count, maxTarget, C, theme),
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
          <p className="text-dash-muted text-xs mb-4">네임스페이스 &gt; 리소스 · 색이 진할수록 공격 집중</p>
          {targetsStatus === "ready" && targets.length === 0 && (
            <p className="text-dash-muted text-xs py-2">K8s Audit 이벤트가 아직 없습니다.</p>
          )}
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
                        backgroundColor: `${intensityColor(p.count, maxTarget, C, theme)}cc`,
                        color: intensityTextColor(p.count, maxTarget, C),
                      }}
                      title={`${p.count}건`}
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-dash-surface rounded-2xl p-5">
          <div className="mb-4">
            <h3 className="text-dash-fg text-sm font-semibold">공격 발원지 (GeoIP)</h3>
            <p className="text-dash-muted text-xs mt-0.5">전체 기간 · 국가별 탐지 건수 (원 크기 = 건수)</p>
          </div>
          {geoStatus === "error" && <p className="text-dash-critical text-xs mb-2">{geoError}</p>}
          <div className="h-80">
            <WorldMap points={countries} />
          </div>
        </div>

        <CountryAttackBarChart countries={countries} status={geoStatus} error={geoError} C={C} theme={theme} />
      </div>

      <ModuleVolumeStackedChart />
    </div>
  );
}
