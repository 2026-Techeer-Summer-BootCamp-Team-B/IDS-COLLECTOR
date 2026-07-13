import React, { useState } from "react";
import { tactics, totalTechniques, detectedTechniques, matchedLogsByTechnique } from "../data/attackMatrix";
import { SourceBadge } from "../components/badges";

function TechniqueCell({ tech, active, onClick }) {
  const detected = tech.hits > 0;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg p-2.5 mb-2 border transition-colors ${
        active
          ? "border-dash-mint bg-dash-mint/10"
          : detected
          ? "border-transparent bg-dash-mint/15 hover:bg-dash-mint/20"
          : "border-transparent bg-dash-surfaceAlt/60 hover:bg-dash-surfaceAlt"
      }`}
    >
      <p className={`text-[11px] font-semibold ${detected ? "text-dash-mint" : "text-dash-faint"}`}>{tech.id}</p>
      <p className={`text-[11px] leading-snug ${detected ? "text-dash-fg" : "text-dash-muted"}`}>{tech.name}</p>
      {detected && <p className="text-dash-muted text-[10px] mt-1">{tech.hits} hits</p>}
    </button>
  );
}

export default function AttackMatrixView() {
  const [selected, setSelected] = useState({ id: "T1609", name: "Command & Scripting Interp" });
  const [expandedIdx, setExpandedIdx] = useState(null);
  const logs = matchedLogsByTechnique[selected.id] || [];
  const coveragePct = Math.round((detectedTechniques / totalTechniques) * 100);

  function selectTechnique(tech) {
    setSelected(tech);
    setExpandedIdx(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-dash-fg text-base font-semibold mb-1">MITRE ATT&amp;CK 커버리지</h2>
          <p className="text-dash-muted text-xs">실제 공격에서 각 기법으로 탐지된 로그 건수를 표시합니다</p>
        </div>
        <div className="text-right">
          <p className="text-dash-muted text-[11px] mb-1">Technique Coverage</p>
          <p className="text-dash-fg text-lg font-semibold">
            {detectedTechniques}/{totalTechniques} <span className="text-dash-mint text-sm">({coveragePct}%)</span>
          </p>
          <div className="flex gap-3 justify-end mt-1 text-[10px] text-dash-muted">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-dash-mint/60 inline-block" /> 탐지됨
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-dash-surfaceAlt inline-block" /> 미탐지
            </span>
          </div>
        </div>
      </div>

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
                  active={selected.id === tech.id}
                  onClick={() => selectTechnique(tech)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-dash-surface rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-dash-mint text-xs font-semibold">{selected.id}</span>
            <span className="text-dash-fg text-sm font-medium">{selected.name}</span>
          </div>
          <span className="text-dash-muted text-xs">{logs.length} matched logs</span>
        </div>
        <div className="space-y-1">
          {logs.length === 0 && <p className="text-dash-muted text-xs">이 기법에 대한 로그가 아직 없습니다.</p>}
          {logs.map((log, i) => {
            const isOpen = expandedIdx === i;
            return (
              <div key={i} className="rounded-lg -mx-2 px-2">
                <button
                  onClick={() => setExpandedIdx(isOpen ? null : i)}
                  className="w-full flex gap-3 text-xs py-1.5 text-left hover:bg-dash-surfaceAlt/50 rounded-lg"
                >
                  <span className="text-dash-faint shrink-0 mt-0.5">{isOpen ? "▾" : "▸"}</span>
                  <span className="text-dash-faint whitespace-nowrap w-14 shrink-0">{log.time}</span>
                  <span className="shrink-0">
                    <SourceBadge source={log.source} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-dash-fg font-medium">{log.title}</p>
                    <p className="text-dash-muted font-mono truncate">{log.detail}</p>
                  </div>
                </button>
                {isOpen && (
                  <div className="ml-[4.75rem] mb-2 mt-1 bg-dash-bg rounded-xl p-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                    <div>
                      <p className="text-dash-faint mb-0.5">대상</p>
                      <p className="text-dash-fg">
                        {log.namespace}/{log.pod}
                      </p>
                    </div>
                    <div>
                      <p className="text-dash-faint mb-0.5">출발지 IP</p>
                      <p className="text-dash-fg">{log.sourceIp}</p>
                    </div>
                    <div>
                      <p className="text-dash-faint mb-0.5">기법</p>
                      <p className="text-dash-fg">{selected.id}</p>
                    </div>
                    <div className="col-span-2 sm:col-span-3">
                      <p className="text-dash-faint mb-0.5">원본 로그</p>
                      <p className="text-dash-fg font-mono text-[11px] break-all">{log.raw}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
