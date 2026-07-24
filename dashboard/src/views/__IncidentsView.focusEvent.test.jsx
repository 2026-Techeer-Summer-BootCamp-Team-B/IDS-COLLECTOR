// 임시 검증용 테스트 - 브라우저 자동화 도구가 없는 환경에서 focusEvent
// 재시도/즉시반응 로직을 jsdom으로 실제 마운트해 검증한다. 확인 끝나면 이
// 파일 + vitest.config.js + package.json의 테스트용 devDependencies를 같이
// 정리할 예정 (프로젝트에 원래 테스트 스위트가 없었음).
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import IncidentsView from "./IncidentsView";
import { ThemeProvider } from "../hooks/useTheme";

// jsdom엔 ResizeObserver가 없는데 recharts의 ResponsiveContainer가 마운트 시
// 바로 사용한다 - 이 테스트는 차트 렌더 자체엔 관심 없으니 no-op으로 채워둠.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function renderView(props) {
  return render(
    <ThemeProvider>
      <IncidentsView {...props} />
    </ThemeProvider>
  );
}

vi.mock("../lib/authApi", () => {
  return {
    apiGet: vi.fn(),
    apiGetAllPages: vi.fn(),
    apiGetPaged: vi.fn(),
    fetchIncidentSummary: vi.fn(),
    fetchIncidentChanges: vi.fn().mockResolvedValue({ data: [], nextCursor: null, nextSince: "2026-07-16T07:00:00Z" }),
    apiPost: vi.fn().mockResolvedValue({}),
    apiPatch: vi.fn().mockResolvedValue({}),
    apiDelete: vi.fn().mockResolvedValue({}),
    ApiError: class ApiError extends Error {},
  };
});

import { apiGet, apiGetAllPages, apiGetPaged, fetchIncidentSummary } from "../lib/authApi";

function incident(overrides) {
  return {
    id: "id-default",
    title: "제목없음",
    correlation_key_type: "source.ip",
    correlation_key_value: "0.0.0.0",
    severity: 3,
    status: "open",
    matched_scenario_rule_id: "rule-1",
    mitre_tactics: [],
    created_at: "2026-07-16T07:00:00Z",
    updated_at: "2026-07-16T07:00:00Z",
    ...overrides,
  };
}

// eventsByIncidentId: { [incidentId]: [{event_id}, ...] } - findIncidentForEvent가
// GET /incidents/{id}/events로 "이 이벤트가 실제로 이 인시던트에 속하는지"를
// 확인하므로, 후보 인시던트의 correlation_key만 맞추는 걸로는 안 되고 이 맵에도
// 그 event_id를 넣어줘야 매칭된다(2026-07-16, correlation_key만으론 여러 인시던트가
// 같은 값(user.name="system:admin" 등)을 공유해서 부정확했던 걸 고친 부분).
function mockApiGet(incidentsProvider, eventsByIncidentId = {}) {
  apiGetAllPages.mockImplementation((path) => path === "/incidents" ? Promise.resolve(incidentsProvider()) : Promise.resolve([]));
  apiGetPaged.mockImplementation((path) => path.startsWith("/incidents?") ? Promise.resolve({ data: incidentsProvider(), nextCursor: null }) : Promise.resolve({ data: [], nextCursor: null }));
  fetchIncidentSummary.mockResolvedValue({ total: incidentsProvider().length, by_status: { open: incidentsProvider().filter((item) => item.status === "open").length }, by_severity: {} });
  apiGet.mockImplementation((url) => {
    const eventsMatch = url.match(/^\/incidents\/([^/]+)\/events$/);
    if (eventsMatch) return Promise.resolve(eventsByIncidentId[eventsMatch[1]] || []);
    if (/^\/incidents\/[^/]+\/timeline$/.test(url)) return Promise.resolve([]);
    if (url === "/scenarios") return Promise.resolve([]);
    if (url === "/banned-ips") return Promise.resolve([]);
    if (url.startsWith("/stats/top-ips")) return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

function detailHeadingText() {
  // 상세 패널의 h2(선택된 인시던트 제목) - 목록 카드에도 title이 나오므로
  // heading 역할로 좁혀서 "지금 선택된 게 뭔지"를 명확히 잡는다.
  return screen.getAllByRole("heading", { level: 2 }).at(-1).textContent;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("IncidentsView focusEvent 선택 로직", () => {
  it("이미 매칭되는 인시던트가 있으면 즉시 그걸 선택한다", async () => {
    const incidents = [
      incident({ id: "newest", title: "최신 인시던트", correlation_key_value: "9.9.9.9", updated_at: "2026-07-16T07:10:00Z" }),
      incident({ id: "matched", title: "매칭될 인시던트", correlation_key_value: "1.2.3.4", updated_at: "2026-07-16T07:05:00Z" }),
    ];
    mockApiGet(() => incidents, { matched: [{ event_id: "ev-1" }] });

    await act(async () => {
      renderView({ focusEvent: { id: "ev-1", sourceIp: "1.2.3.4" }, onFocusConsumed: () => {} });
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(detailHeadingText()).toBe("매칭될 인시던트");
  });

  it("correlation_key가 같은 인시던트가 여러 개 있어도(예: user.name 공유) 실제로 그 이벤트를 포함한 것만 고른다", async () => {
    // 같은 IP로 여러 인시던트가 있을 수 있다(예전 버그: candidates[0]만 보고 틀리기 쉬웠던 케이스) -
    // GET /incidents/{id}/events로 실제 소속을 확인하므로 뒤에 있는(더 오래된) 게 맞아도 정확히 골라야 함.
    const incidents = [
      incident({ id: "newer-but-wrong", title: "더 최근이지만 다른 이벤트", correlation_key_value: "1.2.3.4", updated_at: "2026-07-16T07:20:00Z" }),
      incident({ id: "older-but-correct", title: "더 오래됐지만 진짜 정답", correlation_key_value: "1.2.3.4", updated_at: "2026-07-16T07:05:00Z" }),
    ];
    mockApiGet(() => incidents, {
      "newer-but-wrong": [{ event_id: "some-other-event" }],
      "older-but-correct": [{ event_id: "ev-1" }],
    });

    await act(async () => {
      renderView({ focusEvent: { id: "ev-1", sourceIp: "1.2.3.4" }, onFocusConsumed: () => {} });
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(detailHeadingText()).toBe("더 오래됐지만 진짜 정답");
  });

  it("처음엔 매칭 안 되다가 재시도(reload) 중 새로 나타나면 그걸로 갈아탄다", async () => {
    let incidentsNow = [
      incident({ id: "newest", title: "최신 인시던트", correlation_key_value: "9.9.9.9" }),
    ];
    mockApiGet(() => incidentsNow, { "late-matched": [{ event_id: "ev-2" }] });
    const onFocusConsumed = vi.fn();

    await act(async () => {
      renderView({ focusEvent: { id: "ev-2", sourceIp: "5.5.5.5" }, onFocusConsumed });
      await vi.advanceTimersByTimeAsync(50);
    });

    // 1차 시도 시점엔 매칭되는 게 없어서 아직 폴백도 안 하고 대기 중이어야 함
    // (deadline 2초 전이라 강제 폴백도 아직 안 함) -> onFocusConsumed 아직 안 불림
    expect(onFocusConsumed).not.toHaveBeenCalled();

    // 재시도 폴링(0.5초)이 한 번 돌기 전에, correlation-engine이 방금 인시던트를
    // 만들었다고 가정하고 fixture를 갱신
    incidentsNow = [
      incident({ id: "newest", title: "최신 인시던트", correlation_key_value: "9.9.9.9" }),
      incident({ id: "late-matched", title: "뒤늦게 생긴 인시던트", correlation_key_value: "5.5.5.5", updated_at: "2026-07-16T07:20:00Z" }),
    ];

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600); // 0.5초 재시도 폴링 한 번 지나가게
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // events 조회 비동기 왕복 처리
    });

    expect(detailHeadingText()).toBe("뒤늦게 생긴 인시던트");
    expect(onFocusConsumed).toHaveBeenCalledTimes(1);
  });

  it("2초 안에 끝내 안 잡히면 최신 인시던트로 폴백한다", async () => {
    const incidents = [
      incident({ id: "newest", title: "최신 인시던트", correlation_key_value: "9.9.9.9" }),
    ];
    mockApiGet(() => incidents);
    const onFocusConsumed = vi.fn();

    await act(async () => {
      renderView({ focusEvent: { id: "ev-3", sourceIp: "never-matches" }, onFocusConsumed });
      await vi.advanceTimersByTimeAsync(50);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100); // 2초 데드라인 넘김
    });

    expect(detailHeadingText()).toBe("최신 인시던트");
    expect(onFocusConsumed).toHaveBeenCalledTimes(1);
  });

  it("버그 재현: 이미 다른 게 선택된 상태에서 새 focusEvent가 와도 반응한다", async () => {
    const incidents = [
      incident({ id: "a", title: "A", correlation_key_value: "1.1.1.1" }),
      incident({ id: "b", title: "B", correlation_key_value: "2.2.2.2" }),
    ];
    mockApiGet(() => incidents, { b: [{ event_id: "ev-4" }] });

    let rerender;
    await act(async () => {
      const result = renderView({ focusEvent: null, onFocusConsumed: () => {} });
      rerender = result.rerender;
      await vi.advanceTimersByTimeAsync(50);
    });

    // focusEvent 없이 열었으니 기존 로직대로 맨 위(최신) 항목("A")이 선택돼야 함
    expect(detailHeadingText()).toBe("A");

    // 이미 A가 선택된 상태에서, B에 매칭되는 새 focusEvent가 들어옴 (수정 전엔
    // selectedId가 이미 있어서 이 focusEvent가 무시됐었음 - 그 버그의 회귀 테스트)
    await act(async () => {
      rerender(
        <ThemeProvider>
          <IncidentsView focusEvent={{ id: "ev-4", sourceIp: "2.2.2.2" }} onFocusConsumed={() => {}} />
        </ThemeProvider>
      );
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(detailHeadingText()).toBe("B");
  });
});
