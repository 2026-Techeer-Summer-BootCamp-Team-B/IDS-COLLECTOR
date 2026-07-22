import React from "react";

// 프로젝트 전체에서 차트/지도 hover 시 뜨는 정보 패널의 공용 시각 스타일
// (2026-07-17 요청 - 이전엔 3D 지구본/2D 맵/Log Levels 등 각자 어두운 톤
// 툴팁을 따로 구현하고 있었다). 라이트/다크 둘 다 밝은 패널이라는 큰 방향은
// 유지하되(어두운 배경 위 각각 다른 다크 톤 툴팁을 따로 만드는 예전 방식으로는
// 안 돌아감), 다크모드에서는 순백이 "눈이 아프다"는 2026-07-17 후속 피드백으로
// 아주 살짝만 톤을 낮춘다(흰색 대비 명도 약 6% 다운, #FFFFFF -> #F0F0F4) -
// 라이트모드는 순백 그대로 둔다. 이 정도 차이는 육안으로는 "그냥 흰색"처럼
// 보이면서 다크 UI 옆에서 느껴지는 눈부심만 줄이는 수준이라, theme prop을
// 안 넘기는 호출부는 기존처럼 라이트(흰색) 취급되게 기본값을 "light"로 둔다.
//
// 세 가지 방식으로 재사용된다:
//  - <HoverPanel>: 순수 React (Globe3D, WorldMap처럼 우리 트리 안의 absolute div)
//  - renderHoverPanelHTML(): Google Maps InfoWindow처럼 HTML 문자열만 받는 API용
//  - <RechartsHoverPanel>: recharts <Tooltip content={...}>에 그대로 꽂는 어댑터
// 셋 다 theme("light"|"dark")을 프롭으로 받아 그대로 HoverPanel에 넘긴다 -
// renderHoverPanelHTML()은 react-dom/server로 React 트리 밖에서 렌더링되므로
// useTheme() 컨텍스트를 못 읽는다(Provider가 없음) - 그래서 HoverPanel은
// useTheme()을 직접 안 쓰고 항상 명시적 prop으로만 theme을 받는다.
const PANEL_FONT =
  '"Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif';
const PANEL_BG = { light: "#FFFFFF", dark: "#F0F1F4" };
const PANEL_TEXT = { light: "#111827", dark: "#1F2937" };
const PANEL_LABEL = { light: "#9CA3AF", dark: "#687386" };
const PANEL_BORDER = { light: "#E5EAF2", dark: "#D9DCE4" };
const PANEL_SHADOW = {
  light: "0 5px 20px rgba(15, 23, 42, 0.10)",
  dark: "0 6px 22px rgba(15, 23, 42, 0.14)",
};
// 패널 배경도 테마별로 다르므로 지역/도시 보조 문구도 같은 회색을 재사용하지
// 않는다. light는 흰 배경에서 또렷한 청회색, dark는 눈부심을 낮춘 패널 위에서
// 충분히 진한 중성 회색을 쓴다.
const PANEL_SUBTITLE = { light: "#475569", dark: "#4B5563" };

export function HoverPanel({ title, titleFlag, subtitle, rows = [], style, className = "", theme = "light" }) {
  return (
    <div
      className={`rounded-2xl px-4 py-3 ${className}`}
      style={{
        backgroundColor: PANEL_BG[theme] ?? PANEL_BG.light,
        border: `1px solid ${PANEL_BORDER[theme] ?? PANEL_BORDER.light}`,
        boxShadow: PANEL_SHADOW[theme] ?? PANEL_SHADOW.light,
        fontFamily: PANEL_FONT,
        minWidth: 96,
        ...style,
      }}
    >
      {title != null && title !== "" && (
        <div
          className="flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap leading-tight"
          style={{ color: PANEL_TEXT[theme] ?? PANEL_TEXT.light }}
        >
          {titleFlag && <span className={`fi fi-${titleFlag} text-base leading-none`} aria-hidden="true" />}
          <span>{title}</span>
        </div>
      )}
      {subtitle != null && subtitle !== "" && (
        <div className="text-[11px] mt-0.5 whitespace-nowrap" style={{ color: PANEL_SUBTITLE[theme] ?? PANEL_SUBTITLE.light }}>
          {subtitle}
        </div>
      )}
      {rows.length > 0 && (
        <div className={`space-y-1.5 ${title != null && title !== "" ? "mt-2" : ""}`}>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 whitespace-nowrap">
              {r.color && (
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: r.color }} />
              )}
              <span className="text-sm font-bold" style={{ color: PANEL_TEXT[theme] ?? PANEL_TEXT.light }}>{r.value}</span>
              {r.label != null && r.label !== "" && (
                <span className="text-xs" style={{ color: PANEL_LABEL[theme] ?? PANEL_LABEL.light }}>{r.label}</span>
              )}
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
export function RechartsHoverPanel({ active, payload, label, formatter, labelFormatter, offsetX = 0, transform, theme = "light" }) {
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
    // Recharts가 Bar의 fill을 payload에 넣지 않는 구성도 있다. 그 경우에도 모든
    // 막대 툴팁이 같은 정보 밀도(색 점 + 값)를 유지하도록 테마 보조색을 쓴다.
    return {
      color:
        entry.color ||
        entry.fill ||
        entry.stroke ||
        entry.payload?.color ||
        entry.payload?.fill ||
        entry.payload?.stroke ||
        entry.payload?.payload?.color ||
        entry.payload?.payload?.fill ||
        entry.payload?.payload?.stroke ||
        PANEL_LABEL[theme] ||
        PANEL_LABEL.light,
      value,
      label: name,
    };
  });

  // Pie는 축 레이블이 없어서 label이 비어 있을 수 있다. 그 경우에도 다른 차트와
  // 같은 제목을 보이도록 payload의 항목명을 사용한다.
  const titleText = labelFormatter ? labelFormatter(label, payload) : label ?? payload[0]?.name ?? payload[0]?.payload?.label;

  return (
    <HoverPanel
      title={titleText}
      rows={rows}
      theme={theme}
      style={transform ? { transform } : offsetX ? { transform: `translateX(${offsetX}px)` } : undefined}
    />
  );
}

// 도넛·세로 막대·가로 막대에 공통으로 쓰는 표준 위치. Recharts의 기본 경계 보정은
// 좌우에서 패널을 반대편으로 보내므로, 호출부에서는 allowEscapeViewBox와 함께 쓴다.
export function ChartHoverPanel(props) {
  return <RechartsHoverPanel {...props} transform={props.transform ?? "translate(-50%, calc(-100% - 16px))"} />;
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
