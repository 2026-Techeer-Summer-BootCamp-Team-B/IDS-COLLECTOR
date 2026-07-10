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
      <p className={`text-[11px] leading-snug ${detected ? "text-white" : "text-dash-muted"}`}>{tech.name}</p>
      {detected && <p className="text-dash-muted text-[10px] mt-1">{tech.hits} hits</p>}
    </button>
  );
}

export default function AttackMatrixView() {
  const [selected, setSelected] = useState({ id: "T1609", name: "Command & Scripting Interp" });
  const logs = matchedLogsByTechnique[selected.id] || [];
  const coveragePct = Math.round((detectedTechniques / totalTechniques) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-white text-base font-semibold mb-1">MITRE ATT&amp;CK 커버리지</h2>
          <p className="text-dash-muted text-xs">실제 공격에서 각 기법으로 탐지된 로그 건수를 표시합니다</p>
        </div>
        <div className="text-right">
          <p className="text-dash-muted text-[11px] mb-1">Technique Coverage</p>
          <p className="text-white text-lg font-semibold">
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
                  onClick={() => setSelected(tech)}
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
            <span className="text-white text-sm font-medium">{selected.name}</span>
          </div>
          <span className="text-dash-muted text-xs">{logs.length} matched logs</span>
        </div>
        <div className="space-y-3">
          {logs.length === 0 && <p className="text-dash-muted text-xs">이 기법에 대한 로그가 아직 없습니다.</p>}
          {logs.map((log, i) => (
            <div key={i} className="flex gap-3 text-xs">
              <span className="text-dash-faint whitespace-nowrap w-14">{log.time}</span>
              <SourceBadge source={log.source} />
              <div>
                <p className="text-white font-medium">{log.title}</p>
                <p className="text-dash-muted font-mono">{log.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
