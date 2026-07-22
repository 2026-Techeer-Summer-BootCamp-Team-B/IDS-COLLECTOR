import React, { useMemo, useState, Suspense, lazy } from "react";
import { Server } from "lucide-react";
import GoogleGeoMap from "../components/GoogleGeoMap";
import { CHART_COLORS, donutPalette } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { usePersistedPreference } from "../hooks/usePersistedPreference";
import { usePipelineHealth } from "../hooks/usePipelineHealth";
import { useSourceHealth } from "../hooks/useSourceHealth";
import { useGeoStats } from "../hooks/useGeoStats";
import { ModuleVolumeStackedChart } from "./LogDashboard";

// 2026-07-17(6차): "구글 지도(2D)랑 기존 3D 지구본을 합쳐서 버튼으로 전환하게
// 해달라" - Globe3D는 three.js 기반이라 무겁다(LogDashboard.jsx도 같은 이유로
// lazy+Suspense로 분리해서 씀). 여기서도 3D를 실제로 선택했을 때만 청크를
// 받아오도록 동일하게 지연 로드한다.
const Globe3D = lazy(() => import("../components/Globe3D"));

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
      {/* 2026-07-16: "Kafka 컨슈머 lag / DLQ 적재량 / clock skew"처럼 용어를
          그대로 나열해서 뭘 보여주는 패널인지 감이 안 온다는 피드백 - 이 패널이
          전달하려는 핵심 하나("로그가 밀리지 않고 실시간으로 잘 들어오고 있는가")를
          먼저 쉬운 말로 설명하고, 원래 기술 용어는 괄호로 보조 설명만 남겼다. */}
      <p className="text-dash-muted text-xs mb-4">
        로그가 밀리지 않고 실시간으로 잘 들어오고 있는지 보여줍니다 — 아래 숫자들이 낮을수록 정상, 계속 커지면
        어딘가 막혀서 처리가 밀리고 있다는 뜻입니다
      </p>

      {status === "loading" && <p className="text-dash-muted text-xs py-2">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-2">{error}</p>}

      {status !== "loading" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-dash-bg rounded-xl p-4">
            <p className="text-dash-fg text-[11px] font-medium">대기 중인 로그 (컨슈머 Lag)</p>
            <p className="text-dash-muted text-[10px] mb-2">아직 처리 못 하고 쌓여있는 로그 수</p>
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
            <p className="text-dash-fg text-[11px] font-medium">처리 실패한 로그 (DLQ)</p>
            <p className="text-dash-muted text-[10px] mb-2">정상 처리가 안 돼서 따로 빼놓은 로그 수</p>
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
            <p className="text-dash-fg text-[11px] font-medium">로그 도착까지 걸린 시간</p>
            <p className="text-dash-muted text-[10px] mb-2">로그가 발생한 순간부터 여기 수집되기까지 걸린 시간 (짧을수록 실시간에 가까움)</p>
            {clockSkew && clockSkew.sample_size > 0 ? (
              <div className="flex gap-4 text-xs">
                <div>
                  <p className="text-dash-muted mb-0.5">p50</p>
                  <p className="text-dash-fg font-mono">{formatMs(clockSkew.p50_ms)}</p>
                </div>
                <div>
                  <p className="text-dash-muted mb-0.5">p95</p>
                  <p className="text-dash-fg font-mono">{formatMs(clockSkew.p95_ms)}</p>
                </div>
                <div>
                  <p className="text-dash-muted mb-0.5">max</p>
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
  const palette = donutPalette(theme);
  if (ratio > 0.66) return palette[0];
  if (ratio > 0.33) return palette[1];
  if (ratio > 0) return palette[3];
  return C.surfaceAlt;
}

// 국가별 공격 막대그래프 - GeoIP 지도는 위치 감각은 주지만 국가끼리 정확한
// 건수 비교는 어려워서(원 크기만으로는) 순위형 막대 목록을 옆에 같이 둔다.
// "Top 공격 대상" 패널과 같은 손그림 막대 스타일 + intensityColor로 톤을 맞춤.
//
// countries prop은 도시 단위(2026-07-16, GeoLite2-City 도입 이후 useGeoStats가
// city 좌표를 그대로 내려줌) - 같은 나라의 여러 도시를 국가 하나로 합산해서
// 순위를 매긴다(그대로 쓰면 같은 country_iso_code가 여러 행에 걸쳐 나와 React key
// 충돌도 난다).
function CountryAttackBarChart({ countries, status, error, C, theme }) {
  const byCountry = useMemo(() => {
    const totals = new Map();
    countries.forEach((c) => {
      const prev = totals.get(c.countryCode);
      if (prev) prev.count += c.count;
      else totals.set(c.countryCode, { countryCode: c.countryCode, country: c.country, count: c.count });
    });
    return [...totals.values()].sort((a, b) => b.count - a.count);
  }, [countries]);
  const max = byCountry[0]?.count || 1;
  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">국가별 공격 순위</h3>
      <p className="text-dash-muted text-xs mb-4">전체 기간 · 탐지 건수 기준</p>
      {status === "loading" && <p className="text-dash-muted text-xs py-2">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-2">{error}</p>}
      {status === "ready" && byCountry.length === 0 && (
        <p className="text-dash-muted text-xs py-2">GeoIP 데이터가 아직 없습니다.</p>
      )}
      <div className="space-y-2.5">
        {byCountry.slice(0, 8).map((c, i) => (
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
  const { countries, status: geoStatus, error: geoError } = useGeoStats({ limit: 50 });
  const [mapMode, setMapMode] = usePersistedPreference("sentinel-ops:map-mode:infrastructure-geo", "2d", ["2d", "3d"]);

  return (
    <div className="space-y-6">
      {/* 페이지 상단 설명 문구 (2026-07-16) - ATT&CK 페이지의 타이틀+서브타이틀
          패턴을 그대로 가져왔다. Infrastructure는 섹션별 소제목은 이미 있었지만
          "이 페이지 전체가 뭘 보여주는 곳인지"를 알려주는 헤더가 없었다. */}
      <div>
        <h2 className="text-dash-fg text-base font-semibold mb-1 flex items-center gap-2">
          <Server className="w-4 h-4 shrink-0" strokeWidth={2} />
          인프라 현황
        </h2>
        <p className="text-dash-muted text-xs">
          로그 파이프라인 상태와 실제 공격이 집중된 K8s 클러스터 대상(네임스페이스/파드), 공격 발원지를 표시합니다
        </p>
      </div>

      <PipelineHealthPanel />
      <SourceHealthPanel />

      {/* 2026-07-17(5차): "클러스터 구조는 그냥 없애버리자" - 여러 차례
          재디자인(#174/#183/#197/8차)에도 계속 "뭘 뜻하는지 모르겠다"는 반응이
          반복돼서 패널 자체를 제거했다(Top 공격 대상 랭킹도 같은 이유로 함께
          정리). K8s 타겟 랭킹이 필요하면 계층별 로그의 K8s Audit 상세
          페이지에서 볼 수 있다. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-dash-surface rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-dash-fg text-sm font-semibold">공격 발원지 (GeoIP)</h3>
              <p className="text-dash-muted text-xs mt-0.5">
                {mapMode === "2d"
                  ? "전체 기간 · 도시 단위 탐지 건수 (원 크기 = 건수) · 스크롤로 확대해서 지역별로 자세히 볼 수 있습니다"
                  : "전체 기간 · 도시 단위 탐지 건수 · 드래그로 회전, 스크롤로 확대"}
              </p>
            </div>
            {/* 2D(Google Maps)/3D(지구본) 전환 버튼 - RuleToggle과 같은 단순 on/off 톤 */}
            <div className="flex items-center gap-1 shrink-0 bg-dash-surfaceAlt rounded-lg p-0.5">
              {[
                { key: "2d", label: "2D" },
                { key: "3d", label: "3D" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMapMode(opt.key)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    mapMode === opt.key
                      ? "bg-dash-fg text-dash-bg"
                      : "text-dash-muted hover:text-dash-fg"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {geoStatus === "error" && <p className="text-dash-critical text-xs mb-2">{geoError}</p>}
          <div className="h-80">
            {mapMode === "2d" ? (
              <GoogleGeoMap points={countries} />
            ) : (
              <Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center text-dash-faint text-xs">
                    지구본 로딩 중...
                  </div>
                }
              >
                <Globe3D points={countries} theme={theme} />
              </Suspense>
            )}
          </div>
        </div>

        <CountryAttackBarChart countries={countries} status={geoStatus} error={geoError} C={C} theme={theme} />
      </div>

      <ModuleVolumeStackedChart />
    </div>
  );
}
