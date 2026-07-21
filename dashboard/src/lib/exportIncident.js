// Client-side incident report export (CSV / PDF) — no backend involved yet,
// matches the rest of this app's "mock data + pure functions" pattern. Pulls
// straight from an `incidents.js` incident object (title, meta, storyline).
// Proves the "우리는 사건을 재구성한다" story: one incident in, one shareable
// file out.

import { DISPLAY_TIMEZONE } from "./timezone";

// CSV(수식) 인젝션 방지(OWASP 권장) - 셀 값이 =, +, -, @ (또는 tab/CR)로
// 시작하면 Excel/Sheets가 이를 수식으로 해석해서 실행할 수 있다. 여기 들어가는
// 값 중 상당수(WAF payload snippet, Falco 커맨드라인 등)는 공격자가 완전히
// 통제하는 문자열이라 실제 공격 벡터가 된다 - 분석가가 인시던트 리포트를 열어봤을
// 뿐인데 수식이 실행돼 원격 명령이나 데이터 유출로 이어질 수 있다.
const FORMULA_INJECTION_PREFIX_RE = /^[=+\-@\t\r]/;

function csvEscape(value) {
  let str = String(value ?? "");
  if (FORMULA_INJECTION_PREFIX_RE.test(str)) {
    // 앞에 작은따옴표를 붙이면 대부분의 스프레드시트 프로그램이 이 셀을 수식이
    // 아닌 순수 텍스트로 강제 인식한다 - 값의 의미는 바뀌지 않고 보통 화면에도
    // 표시되지 않는다.
    str = `'${str}`;
  }
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// One row per storyline entry, incident-level fields repeated on each row so
// the file stays a single flat table (opens cleanly in Excel/Sheets).
export function exportIncidentCSV(incident) {
  const headers = [
    "incident_id",
    "title",
    "severity",
    "status",
    "correlation_rule",
    "mitre_path",
    "target",
    "source_ip",
    "source_country",
    "first_detected",
    "event_offset",
    "event_source",
    "event_title",
    "event_detail",
    "event_mitre",
  ];

  const baseFields = [
    incident.id,
    incident.title,
    incident.severity,
    incident.status,
    incident.correlationRule,
    incident.mitrePath.join(" -> "),
    incident.target,
    incident.sourceIp,
    incident.sourceCountry,
    incident.firstDetected,
  ];

  const rows = incident.storyline.map((entry) => [
    ...baseFields,
    entry.offset,
    entry.source,
    entry.title,
    entry.detail.replace(/\n/g, " / "),
    entry.mitre,
  ]);

  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  // BOM so Excel on Windows/macOS opens 한글 as UTF-8 instead of mangling it.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(`${incident.id}-report.csv`, blob);
}

const PAGE_MARGIN = 15;
const PAGE_WIDTH = 210; // A4 portrait, mm
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

// jsPDF는 (실제로 안 쓰는데도) fast-png 등 vite.config.js에서 external로 뺀
// 선택적 의존성을 정적으로 끌고 들어온다 - 앱 메인 번들에 같이 묶이면 그
// 브라우저가 그 external import를 초기 로딩 시점에 리졸브하려다 실패해서
// 앱 전체가 하얀/검은 화면으로 죽는다. PDF 내보내기 버튼을 누를 때만 필요한
// 기능이니 동적 import로 별도 청크로 분리해서, 초기 로딩과 완전히 분리한다.
export async function exportIncidentPDF(incident) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = PAGE_MARGIN;

  function ensureSpace(neededMm) {
    if (y + neededMm > PAGE_HEIGHT - PAGE_MARGIN) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
  }

  function writeLines(lines, { size = 10, lineHeight = 5, color = [40, 40, 40] } = {}) {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    lines.forEach((line) => {
      ensureSpace(lineHeight);
      doc.text(line, PAGE_MARGIN, y);
      y += lineHeight;
    });
  }

  // Header
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text(`Incident Report - ${incident.id}`, PAGE_MARGIN, y);
  y += 8;
  writeLines(doc.splitTextToSize(incident.title, CONTENT_WIDTH), { size: 12, lineHeight: 6 });
  y += 2;

  writeLines(
    [
      `Severity: ${incident.severity}   Status: ${incident.status}`,
      `Target: ${incident.target}`,
      `Source: ${incident.sourceIp} (${incident.sourceCountry})`,
      `First Detected: ${incident.firstDetected}`,
      `Correlation Rule: ${incident.correlationRule}`,
      `MITRE Path: ${incident.mitrePath.join(" -> ")}`,
    ],
    { size: 10, lineHeight: 5.5 }
  );

  y += 3;
  ensureSpace(10);
  doc.setDrawColor(200, 200, 200);
  doc.line(PAGE_MARGIN, y, PAGE_WIDTH - PAGE_MARGIN, y);
  y += 8;

  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text("Attack Storyline (WAS / Falco / K8s Audit)", PAGE_MARGIN, y);
  y += 8;

  incident.storyline.forEach((entry, i) => {
    ensureSpace(12);
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(`${entry.offset}  ·  ${entry.source}  ·  ${entry.title}  (${entry.mitre})`, PAGE_MARGIN, y);
    y += 6;

    const detailLines = doc.splitTextToSize(entry.detail.replace(/\n/g, "  |  "), CONTENT_WIDTH - 5);
    doc.setFontSize(9.5);
    doc.setTextColor(90, 90, 90);
    detailLines.forEach((line) => {
      ensureSpace(5);
      doc.text(line, PAGE_MARGIN + 5, y);
      y += 5;
    });
    y += i === incident.storyline.length - 1 ? 0 : 4;
  });

  y += 10;
  ensureSpace(6);
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated by SENTINEL-OPS · ${new Date().toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}`, PAGE_MARGIN, y);

  doc.save(`${incident.id}-report.pdf`);
}
