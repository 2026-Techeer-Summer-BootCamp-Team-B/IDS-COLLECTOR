import React from "react";

// AI 트렌드 리포트(app/ai_report.py)가 만드는 마크다운은 형식이 고정돼 있다
// (system prompt가 지시하는 문법만 나옴) - #/##/### 소제목, -/* 불릿, **볼드**(위협
// 이름+건수 - 빨간색), *이탤릭*(권고 사항 등 그 외 강조 - 파란색) 인라인, 나머지는
// 평문 단락. 표/링크/코드블럭 등 나머지 마크다운 문법은 이 응답에 나올 일이 없으므로
// 지원하지 않는다 - 그 정도 때문에 전체 마크다운 라이브러리를 새로 추가하기보단 이
// 형식 전용의 작은 렌더러로 충분하다.

function renderInline(text, keyPrefix) {
  // **...**(볼드)을 *...*(이탤릭)보다 먼저 시도해야 한다 - 순서를 바꾸면 **볼드**의
  // 앞쪽 별 두 개 중 하나가 이탤릭 시작으로 잘못 먹힌다.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      // 볼드 = 위협 이름 + 방어/차단/탐지 건수 (system prompt가 그렇게만 볼드를
      // 쓰도록 지시함, app/ai_report.py 참고) - 빨간색으로 눈에 띄게 한다.
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-dash-critical">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      // 이탤릭 = 권고 사항 등 볼드(위협/건수)는 아니지만 눈에 띄어야 하는 나머지
      // 강조 - 파란색(text-dash-was, WAS 계층에 쓰는 파란 계열을 그대로 재사용).
      return (
        <em key={`${keyPrefix}-${i}`} className="not-italic font-medium text-dash-was">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>;
  });
}

export function renderMarkdownLite(text) {
  if (!text) return null;

  const blocks = [];
  let listItems = null;

  const flushList = () => {
    if (listItems && listItems.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc list-inside space-y-1 mb-2">
          {listItems}
        </ul>
      );
    }
    listItems = null;
  };

  text.split("\n").forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const sizeClass = level === 1 ? "text-sm" : "text-xs";
      blocks.push(
        <p key={`h-${i}`} className={`${sizeClass} font-semibold text-dash-fg mt-3 mb-1 first:mt-0`}>
          {renderInline(heading[2], `h-${i}`)}
        </p>
      );
      return;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      listItems = listItems || [];
      listItems.push(
        <li key={`li-${i}`} className="text-dash-fg">
          {renderInline(bullet[1], `li-${i}`)}
        </li>
      );
      return;
    }

    flushList();
    blocks.push(
      <p key={`p-${i}`} className="mb-2 last:mb-0">
        {renderInline(line, `p-${i}`)}
      </p>
    );
  });
  flushList();

  return blocks;
}
