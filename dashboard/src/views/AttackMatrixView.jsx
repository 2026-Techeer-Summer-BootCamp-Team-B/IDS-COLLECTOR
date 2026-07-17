import React, { useEffect, useState } from "react";
import { useAttackCoverage } from "../hooks/useAttackCoverage";
import { useTechniqueIncidents } from "../hooks/useTechniqueIncidents";
import { useIncidentTimeline } from "../hooks/useIncidentTimeline";
import { SeverityBadge, StatusDot, SourceBadge } from "../components/badges";
import { getModuleMeta } from "../data/moduleMeta";
import { DISPLAY_TIMEZONE } from "../lib/timezone";

// incidents.severity(1~4)를 badges.jsx의 SEVERITY_META 키로 별칭 처리.
// IncidentsView.jsx의 동일 매핑과 맞춰둠(공용 모듈로 뺄 정도는 아니라 로컬 복제).
const SEVERITY_TO_BADGE_KEY = { 4: "CRITICAL", 3: "HIGH", 2: "MEDIUM", 1: "LOW" };
function severityBadgeKey(sev) {
  return SEVERITY_TO_BADGE_KEY[sev] || "LOW";
}
const STATUS_LABEL = { open: "Open", investigating: "조사중", closed: "종결" };
function statusDotStatus(status) {
  return status === "closed" ? "RESOLVED" : "IN_PROGRESS";
}

// hits > 0("탐지됨")는 실제로 공격이 관측된 기법이라 위험 신호다 — 초록/민트는
// "안전"으로 오해되기 쉬워서 critical(빨강) 계열로 표시한다. 선택된(active) 셀은
// 별도 테두리로만 구분하고 배경색은 탐지 여부를 그대로 따른다.
function TechniqueCell({ tech, active, onClick }) {
  const detected = tech.hits > 0;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg p-2.5 mb-2 border transition-colors ${
        active ? "border-dash-critical" : "border-transparent"
      } ${
        detected
          ? "bg-dash-critical/15 hover:bg-dash-critical/25"
          : "bg-dash-surfaceAlt/60 hover:bg-dash-surfaceAlt"
      }`}
    >
      <p className={`text-[11px] font-semibold ${detected ? "text-dash-critical" : "text-dash-faint"}`}>{tech.id}</p>
      <p className={`text-[11px] leading-snug ${detected ? "text-dash-fg" : "text-dash-muted"}`}>{tech.name}</p>
      {detected && <p className="text-dash-critical text-[10px] mt-1">{tech.hits} hits</p>}
    </button>
  );
}

export default function AttackMatrixView({ onNavigateToIncident } = {}) {
  const { tactics, status: coverageStatus, error: coverageError } = useAttackCoverage();
  const [selected, setSelected] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);

  // 커버리지가 로드되면 첫 화면에 보여줄 기법을 고른다: hit이 있는 기법 우선,
  // 없으면 카탈로그의 첫 기법. mock 시절엔 T1609를 하드코딩했지만 실데이터는
  // 그 기법이 아예 없을 수도 있어 매번 계산해야 한다.
  useEffect(() => {
    if (selected || coverageStatus !== "ready" || tactics.length === 0) return;
    const flat = tactics.flatMap((t) => t.techniques);
    const firstDetected = flat.find((t) => t.hits > 0);
    setSelected(firstDetected || flat[0] || null);
  }, [coverageStatus, tactics, selected]);

  const { incidents, status: incidentsStatus, error: incidentsError } = useTechniqueIncidents(selected?.id);

  // 펼쳐진 인시던트 행 하나("자세히보기")에 대해서만 실제 원본 로그(타임라인)를
  // 불러온다 — expandedIdx가 곧 "지금 펼쳐진 행"이라 별도 상태 없이 그대로 파생.
  const timelineIncidentId = expandedIdx !== null ? incidents[expandedIdx]?.id ?? null : null;
  const { timeline, status: timelineStatus } = useIncidentTimeline(timelineIncidentId);

  // 2026-07-16(8차): "우측 상단 숫자가 30인데 실제로 세면 38개"라는 직접
  // 피드백 - 이전엔 "고유 기법 수"(중복 제거, 30) 기준이 의도된 설계였지만
  // (T1133/T1098처럼 전술 여러 개에 걸치는 기법이 매트릭스엔 열마다 반복
  // 표시됨), 사용자가 실제로 매트릭스에 보이는 칸을 세는 방식(38)을
  // 기준으로 삼길 원해서 그쪽으로 맞췄다 - tactics(전술별 기법 목록, 이미
  // 중복 포함)의 길이 합으로 다시 계산한다.
  const totalTechniques = tactics.reduce((sum, t) => sum + t.techniques.length, 0);
  const detectedTechniques = tactics.reduce((sum, t) => sum + t.techniques.filter((x) => x.hits > 0).length, 0);
  const coveragePct = totalTechniques > 0 ? Math.round((detectedTechniques / totalTechniques) * 100) : 0;

  function selectTechnique(tech) {
    setSelected(tech);
    setExpandedIdx(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-dash-fg text-base font-semibold mb-1">MITRE ATT&amp;CK 커버리지</h2>
          <p className="text-dash-muted text-xs">실제 인시던트로 확인된 기법별 탐지 건수를 표시합니다</p>
        </div>
        <div className="text-right">
          <p className="text-dash-muted text-[11px] mb-1">Technique Coverage</p>
          <p className="text-dash-fg text-lg font-semibold">
            {detectedTechniques}/{totalTechniques} <span className="text-dash-mint text-sm">({coveragePct}%)</span>
          </p>
          <div className="flex gap-3 justify-end mt-1 text-[10px] text-dash-muted">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-dash-critical/60 inline-block" /> 탐지됨
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-dash-surfaceAlt inline-block" /> 미탐지
            </span>
          </div>
          {/* 2026-07-16(8차): "직접 세면 38개인데 우측 상단 숫자를 바꿔야한다"는
              피드백 - 이전엔 고유 기법 수(30, CONTAINERS_MATRIX 카탈로그 항목 수)
              기준이었는데, 실제 매트릭스에 표시되는 칸 수(T1133/T1098처럼 전술
              여러 개에 걸친 기법은 열마다 한 번씩 더 세짐)를 기준으로 바꿨다. */}
          <p className="text-dash-faint text-[10px] mt-1 max-w-[220px] leading-relaxed">
            전체 MITRE ATT&CK가 아니라 이 프로젝트가 탐지하는 컨테이너/K8s 관련 기법 {totalTechniques}개 기준
            (매트릭스에 표시되는 칸 수 — 여러 전술에 걸친 기법은 전술마다 한 번씩 셈)
          </p>
        </div>
      </div>

      {coverageStatus === "loading" && <p className="text-dash-muted text-xs">커버리지 데이터를 불러오는 중...</p>}
      {coverageStatus === "error" && <p className="text-dash-critical text-xs">{coverageError}</p>}

      {coverageStatus === "ready" && (
        <div className="overflow-x-auto pb-2">
          <div
            className="grid gap-3 min-w-[1500px]"
            style={{ gridTemplateColumns: `repeat(${tactics.length}, minmax(115px, 1fr))` }}
          >
            {tactics.map((tactic) => (
              <div key={tactic.name}>
                <p className="text-dash-muted text-[11px] font-medium mb-2 truncate" title={tactic.name}>
                  {tactic.name}
                </p>
                {tactic.techniques.map((tech) => (
                  <TechniqueCell
                    key={tech.id}
                    tech={tech}
                    active={selected?.id === tech.id}
                    onClick={() => selectTechnique(tech)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="bg-dash-surface rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-dash-mint text-xs font-semibold">{selected.id}</span>
              <span className="text-dash-fg text-sm font-medium">{selected.name}</span>
            </div>
            <span className="text-dash-muted text-xs">{incidents.length} matched incidents</span>
          </div>
          {/* 2026-07-17: 같은 기법으로 매칭된 인시던트가 계속 쌓이면 이 목록이
              끝없이 늘어나서 페이지 전체가 하염없이 길어지던 문제 - IncidentsView의
              좌측 리스트와 같은 패턴(높이 고정 + 내부 스크롤)으로 통일. */}
          <div className="space-y-1 max-h-[520px] overflow-y-auto pr-2">
            {incidentsStatus === "loading" && <p className="text-dash-muted text-xs">인시던트를 불러오는 중...</p>}
            {incidentsStatus === "error" && <p className="text-dash-critical text-xs">{incidentsError}</p>}
            {incidentsStatus === "ready" && incidents.length === 0 && (
              <p className="text-dash-muted text-xs">이 기법으로 연결된 인시던트가 아직 없습니다.</p>
            )}
            {incidents.map((incident, i) => {
              const isOpen = expandedIdx === i;
              const inProgress = statusDotStatus(incident.status) === "IN_PROGRESS";
              return (
                <div key={incident.id} className="rounded-lg -mx-2 px-2">
                  {/* 2026-07-16: 원래는 이 행 전체가 <button>(펼치기/접기)이었는데,
                      "진행중" 상태에 조치 화면(Incidents)으로 이동하는 버튼을 추가
                      하려면 버튼 안에 버튼을 넣는 꼴이 돼서(무효한 마크업 + 클릭이
                      바깥 버튼에 먹힘) div+onClick으로 바꾸고, 새 버튼은
                      e.stopPropagation()으로 바깥 클릭(펼치기/접기)과 분리했다. */}
                  <div
                    onClick={() => setExpandedIdx(isOpen ? null : i)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setExpandedIdx(isOpen ? null : i)}
                    className="w-full flex gap-3 text-xs py-1.5 text-left hover:bg-dash-surfaceAlt/50 rounded-lg cursor-pointer"
                  >
                    <span className="text-dash-faint shrink-0 mt-0.5">{isOpen ? "▾" : "▸"}</span>
                    <span className="text-dash-faint whitespace-nowrap w-32 shrink-0">
                      {new Date(incident.updated_at).toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}
                    </span>
                    <span className="shrink-0">
                      <SeverityBadge level={severityBadgeKey(incident.severity)} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-dash-fg font-medium truncate">{incident.title}</p>
                      <p className="text-dash-muted font-mono truncate">
                        {incident.correlation_key_type}={incident.correlation_key_value}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <StatusDot status={statusDotStatus(incident.status)} />
                      {inProgress && onNavigateToIncident && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToIncident(incident.id);
                          }}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-dash-critical/15 text-dash-critical hover:bg-dash-critical/25 transition-colors whitespace-nowrap"
                        >
                          조치하러 가기 →
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="ml-[4.75rem] mb-2 mt-1 bg-dash-bg rounded-xl p-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                      <div>
                        <p className="text-dash-faint mb-0.5">인시던트 ID</p>
                        <p className="text-dash-fg font-mono">{incident.id}</p>
                      </div>
                      <div>
                        <p className="text-dash-faint mb-0.5">상태</p>
                        <p className="text-dash-fg">{STATUS_LABEL[incident.status] ?? incident.status}</p>
                      </div>
                      <div>
                        <p className="text-dash-faint mb-0.5">최초 탐지</p>
                        <p className="text-dash-fg">{new Date(incident.created_at).toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}</p>
                      </div>
                      <div className="col-span-2 sm:col-span-3">
                        <p className="text-dash-faint mb-0.5">연관 MITRE 전술</p>
                        <p className="text-dash-fg">
                          {incident.mitre_tactics && incident.mitre_tactics.length > 0
                            ? incident.mitre_tactics.join(", ")
                            : "-"}
                        </p>
                      </div>

                      {/* GET /incidents/{id}/timeline — 이 인시던트를 이루는 실제
                          원본 로그(WAS/Falco/K8s Audit)를 시간순으로. IncidentsView의
                          "공격 스토리라인"과 같은 API, 여기선 더 간략하게 표시. */}
                      <div className="col-span-2 sm:col-span-3 pt-2 border-t border-dash-surfaceAlt">
                        <p className="text-dash-faint mb-1.5">실제 로그 (원본 이벤트)</p>
                        {timelineStatus === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
                        {timelineStatus === "error" && (
                          <p className="text-dash-critical text-xs">타임라인을 불러오지 못했습니다.</p>
                        )}
                        {timelineStatus === "ready" && timeline.length === 0 && (
                          <p className="text-dash-muted text-xs">연결된 원본 로그가 없습니다.</p>
                        )}
                        {/* 인시던트 하나에 원본 로그가 많이 묶이면(브루트포스류
                            threshold 시나리오 등) 이 안쪽 목록도 끝없이 늘어질 수
                            있어 마찬가지로 높이를 고정하고 내부 스크롤로 막는다. */}
                        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                          {timelineStatus === "ready" &&
                            timeline.map((t) => (
                              <div key={t.event_id} className="bg-dash-surface rounded-lg p-2.5">
                                <div className="flex items-center gap-2 mb-1">
                                  <SourceBadge source={getModuleMeta(t.event_module).label} />
                                  <span className="text-dash-faint text-[10px]">
                                    {new Date(t.added_at).toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}
                                  </span>
                                </div>
                                <p className="text-dash-fg text-xs font-medium">{t.title || "(원본 로그 없음)"}</p>
                                {t.detail && (
                                  <p className="text-dash-muted text-[11px] font-mono mt-0.5 whitespace-pre-wrap break-all">
                                    {t.detail}
                                  </p>
                                )}
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
