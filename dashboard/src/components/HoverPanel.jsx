import React from "react";

// 프로젝트 전체에서 차트/지도 hover 시 뜨는 정보 패널의 공용 시각 스타일
// (2026-07-17 요청 - 이전엔 3D 지구본/2D 맵/Log Levels 등 각자 어두운 톤
// 툴팁을 따로 구현하고 있었다). 항상 라이트(흰 배경 + 옅은 그림자)로 통일 -
// 대시보드 자체는 다크/라이트 테마가 있지만, 이 패널은 테마와 무관하게
// 고정된 스타일이라 CHART_COLORS(C)를 안 받는다.
//
// 세 가지 방식으로 재사용된다:
//  - <HoverPanel>: 순수 React (Globe3D, WorldMap처럼 우리 트리 안의 absolute div)
//  - renderHoverPanelHTML(): Google Maps InfoWindow처럼 HTML 문자열만 받는 API용
//  - <RechartsHoverPanel>: recharts <Tooltip content={...}>에 그대로 꽂는 어댑터
const PANEL_FONT =
  '"Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif';

export function HoverPanel({ title, titleFlag, subtitle, rows = [], style, className = "" }) {
  return (
    <div
      className={`rounded-2xl bg-white px-4 py-3 ${className}`}
      style={{
        boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
        fontFamily: PANEL_FONT,
        minWidth: 96,
        ...style,
      }}
    >
      {title != null && title !== "" && (
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-900 whitespace-nowrap leading-tight">
          {titleFlag && (
            <span className="text-base leading-none" aria-hidden="true">
              {titleFlag}
            </span>
          )}
          <span>{title}</span>
        </div>
      )}
      {subtitle != null && subtitle !== "" && (
        <div className="text-[11px] text-gray-400 mt-0.5 whitespace-nowrap">{subtitle}</div>
      )}
      {rows.length > 0 && (
        <div className={`space-y-1.5 ${title != null && title !== "" ? "mt-2" : ""}`}>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 whitespace-nowrap">
              {r.color && (
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: r.color }} />
              )}
              <span className="text-sm font-bold text-gray-900">{r.value}</span>
              {r.label != null && r.label !== "" && <span className="text-xs text-gray-400">{r.label}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// recharts Tooltip의 `content` render-prop 시그니처({active, payload, label,
// coordinate, viewBox, ...})를 그대로 받아 HoverPanel로 그려주는 어댑터.
// formatter/labelFormatter는 기존 recharts Tooltip에 쓰던 것과 동일한 시그니처
// (formatter(value, name, entry) => [값, 이름], labelFormatter(label, payload) => node)라
// 호출부 코드를 거의 그대로 옮겨 쓸 수 있다. offsetX는 Log Levels처럼 커서
// 위치(coordinate)에 따라 좌/우로 추가 이동을 줄 때 쓴다.
export function RechartsHoverPanel({ active, payload, label, formatter, labelFormatter, offsetX = 0 }) {
  if (!active || !payload || !payload.length) return null;

  const rows = payload.map((entry) => {
    let value = entry.value;
    let name = entry.name;
    if (formatter) {
      const out = formatter(entry.value, entry.name, entry);
      if (Array.isArray(out)) {
        [value, name] = out;
      } else if (out != null) {
        value = out;
      }
    } else if (typeof value === "number") {
      value = value.toLocaleString();
    }
    return { color: entry.color || entry.fill || entry.payload?.color, value, label: name };
  });

  const titleText = labelFormatter ? labelFormatter(label, payload) : label;

  return (
    <HoverPanel
      title={titleText}
      rows={rows}
      style={offsetX ? { transform: `translateX(${offsetX}px)` } : undefined}
    />
  );
}

let renderToStaticMarkup = null;

// Google Maps InfoWindow는 React 트리가 아니라 HTML 문자열/DOM 노드를 받는
// API라, 같은 HoverPanel을 react-dom/server로 정적 마크업 렌더링해서 넘긴다 -
// 스타일이 어긋나지 않게 소스를 하나로 유지하기 위함.
export async function renderHoverPanelHTML(props) {
  if (!renderToStaticMarkup) {
    ({ renderToStaticMarkup } = await import("react-dom/server"));
  }
  return renderToStaticMarkup(<HoverPanel {...props} />);
}
