import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Target } from "lucide-react";
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

  const {
    incidents,
    status: incidentsStatus,
    error: incidentsError,
    loadingMore: loadingMoreIncidents,
    loadMore: loadMoreIncidents,
  } = useTechniqueIncidents(selected?.id);

  // 2026-07-19: onScroll에서 매 스크롤 이벤트마다 scrollTop/scrollHeight를 직접
  // 읽는 방식은 브라우저가 그때마다 강제로 레이아웃을 다시 계산하게 만들어서
  // (forced synchronous layout) 스크롤 중 버벅임의 원인이 됐다 - "바닥에 닿기
  // 직전"을 IntersectionObserver로 감시하는 쪽이 표준적인 해법.
  //
  // 스크롤바를 드래그해서 스페이서 한가운데로 훅 뛰어버리면 더 안 불러와지는
  // 문제(2026-07-19) - IntersectionObserver는 "안 겹침 -> 겹침"으로 상태가
  // *바뀔 때* 딱 한 번만 콜백을 준다. 스페이서가 아직 크게 남아있으면 로드
  // 한 페이지로는 sentinel이 겹친 상태를 벗어나지 못해서(계속 겹쳐있는 동안은
  // 재발화 안 함) 딱 한 번 불러오고 멈춰버렸다. isIntersectingRef에 최신
  // 겹침 상태를 계속 기록해두고, 로드가 끝날 때마다 "아직도 겹쳐있고 더
  // 남았으면"(useTechniqueIncidents.loadMore가 resolve하는 값) 바로 이어서
  // 또 로드하는 pump()로 체인을 걸어서, 사용자가 얼마나 멀리 뛰었든 sentinel이
  // 시야에서 벗어날 때까지(=실제 콘텐츠가 따라잡을 때까지) 연속으로 페이지를
  // 당겨온다. hasMore state 대신 이 resolve 값을 쓰는 이유는 state 업데이트가
  // 다음 렌더까지 반영이 늦어(비동기) 방금 끝난 요청 결과를 아직 못 볼 수
  // 있어서 - resolve 값은 렌더 타이밍과 무관하게 항상 최신이다.
  const scrollBoxRef = useRef(null);
  const bottomSentinelRef = useRef(null);
  const loadMoreRef = useRef(loadMoreIncidents);
  loadMoreRef.current = loadMoreIncidents;
  const isIntersectingRef = useRef(false);

  useEffect(() => {
    const root = scrollBoxRef.current;
    const target = bottomSentinelRef.current;
    if (!root || !target) return;

    function pump() {
      if (!isIntersectingRef.current) return;
      loadMoreRef.current().then((hasMore) => hasMore && pump());
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        isIntersectingRef.current = entry.isIntersecting;
        if (entry.isIntersecting) pump();
      },
      { root, rootMargin: "200px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [selected?.id]);

  // 스크롤바 "툭 튀는" 문제(2026-07-19) - 새 페이지가 로드되면 scrollHeight가
  // 늘어나는데 scrollTop은 그대로라, 스크롤바 thumb는 "바닥에 붙어있다가" 다음
  // 순간 트랙 중간으로 튕겨 올라간 것처럼 보인다. IntersectionObserver로
  // 미리 당겨와도(rootMargin) 근본 원인은 그대로다 - "전체 크기를 모르는 채로
  // 계속 늘어나는 목록"이라 브라우저가 thumb 크기/위치를 다시 계산할 때마다
  // 매번 이 순간이 반복된다.
  //
  // 해법: 이미 알고 있는 총 개수(selected.hits, /attck/coverage가 COUNT(*)로
  // 미리 계산해둔 값)만큼 "이 다음에 올 자리"를 빈 스페이서로 미리 확보해둔다.
  // 그러면 스크롤 가능한 총 높이(scrollHeight)가 기법을 고른 순간부터 이미
  // 최종 크기에 가깝게 잡혀 있어서, 페이지가 하나씩 들어올 때마다 스페이서가
  // 그만큼 줄어들 뿐 총 높이는 거의 안 바뀐다 - thumb가 안 튄다. react-window
  // 같은 가상 스크롤 라이브러리가 쓰는 것과 같은 원리(itemCount로 총 높이를
  // 먼저 확정)를 라이브러리 없이 최소한으로 흉내낸 것.
  //
  // 행 높이는 고정값이 아니라(제목 줄바꿈 등으로 가변) 실제 렌더된 높이를
  // 매 페이지 로드 후 재서(rowsWrapperRef) 평균을 갱신한다 - 완벽히 정확할
  // 필요는 없고, 스페이서가 줄어드는 만큼 실제 콘텐츠가 늘어나서 총합만
  // 안정적이면 된다.
  const rowsWrapperRef = useRef(null);
  const [avgRowHeight, setAvgRowHeight] = useState(36);
  useLayoutEffect(() => {
    if (!rowsWrapperRef.current || incidents.length === 0) return;
    const measured = rowsWrapperRef.current.scrollHeight / incidents.length;
    if (measured > 0 && Math.abs(measured - avgRowHeight) > 1) setAvgRowHeight(measured);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidents.length]);
  const estimatedRemaining = Math.max(0, (selected?.hits ?? incidents.length) - incidents.length);

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
          <h2 className="text-dash-fg text-base font-semibold mb-1 flex items-center gap-2">
            <Target className="w-4 h-4 shrink-0" strokeWidth={2} />
            MITRE ATT&amp;CK 커버리지
          </h2>
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
            <span className="text-dash-muted text-xs">
              {incidents.length}
              {typeof selected.hits === "number" && selected.hits > incidents.length ? ` / ${selected.hits}` : ""} matched
              incidents
            </span>
          </div>
          {/* 2026-07-17: 같은 기법으로 매칭된 인시던트가 계속 쌓이면 이 목록이
              끝없이 늘어나서 페이지 전체가 하염없이 길어지던 문제 - IncidentsView의
              좌측 리스트와 같은 패턴(높이 고정 + 내부 스크롤)으로 통일.
              2026-07-19: "더 보기" 버튼 대신 무한 스크롤 - 바닥 감지는 아래
              IntersectionObserver(scrollBoxRef/bottomSentinelRef)가 담당.
              space-y-1을 rowsWrapperRef 쪽으로 옮김 - 스페이서/센티넬까지 같은
              간격 규칙을 타면 스페이서 높이 계산이 그만큼 어긋난다. */}
          <div ref={scrollBoxRef} className="max-h-[520px] overflow-y-auto pr-2">
            {incidentsStatus === "loading" && <p className="text-dash-muted text-xs">인시던트를 불러오는 중...</p>}
            {incidentsStatus === "error" && <p className="text-dash-critical text-xs">{incidentsError}</p>}
            {incidentsStatus === "ready" && incidents.length === 0 && (
              <p className="text-dash-muted text-xs">이 기법으로 연결된 인시던트가 아직 없습니다.</p>
            )}
            <div ref={rowsWrapperRef} className="space-y-1">
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
            {/* 스페이서 겸 IntersectionObserver 타깃 - 높이를 estimatedRemaining
                (아직 안 불러온 인시던트 수) * avgRowHeight로 잡아서 스크롤 총
                높이를 처음부터 최종 크기에 가깝게 맞춘다(위 큰 주석 참고). ref는
                selected?.id가 바뀔 때 한 번만 옵저버에 잡히므로 조건 없이 항상
                렌더 - loadMore 자체는 훅 내부에서 커서가 없으면 no-op이라 남은
                게 0이어도(높이 1px) 안전하다. */}
            <div ref={bottomSentinelRef} style={{ height: Math.max(1, Math.round(estimatedRemaining * avgRowHeight)) }} />
            {loadingMoreIncidents && (
              <p className="text-dash-faint text-[11px] text-center py-1.5">불러오는 중...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
