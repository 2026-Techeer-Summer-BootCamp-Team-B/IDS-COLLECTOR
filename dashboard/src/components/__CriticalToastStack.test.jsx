// 임시 검증용 테스트 - CriticalToastStack.jsx 확인용. IncidentsView 테스트와
// 같이 정리 예정.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import CriticalToastStack from "./CriticalToastStack";
import { ThemeProvider } from "../hooks/useTheme";

function ev(id, message, sourceIp = "1.2.3.4", module = "waf") {
  return { id, message, module, source: "WAS", sourceIp, namespace: "default", pod: "pod-1" };
}

function renderStack(props) {
  return render(
    <ThemeProvider>
      <CriticalToastStack {...props} />
    </ThemeProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CriticalToastStack", () => {
  it("한 배치에 여러 건이 와도 전부 큐에 들어간다(유실 없음)", async () => {
    const events = [ev("e1", "공격1"), ev("e2", "공격2"), ev("e3", "공격3")];
    await act(async () => {
      renderStack({ events, onInvestigate: () => {} });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByText("공격1")).toBeInTheDocument();
    expect(screen.getByText("공격2")).toBeInTheDocument();
    expect(screen.getByText("공격3")).toBeInTheDocument();
  });

  it("MAX_TOASTS(5)를 넘으면 가장 오래된 게 결국 화면에서 사라진다", async () => {
    const events = Array.from({ length: 7 }, (_, i) => ev(`e${i}`, `공격${i}`));
    await act(async () => {
      renderStack({ events, onInvestigate: () => {} });
      await vi.advanceTimersByTimeAsync(50);
    });

    // 강제퇴장 애니메이션(300ms)까지 흘려보내면 최종적으로 5개만 남아야 함
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(screen.queryByText("공격0")).not.toBeInTheDocument();
    expect(screen.queryByText("공격1")).not.toBeInTheDocument();
    expect(screen.getByText("공격2")).toBeInTheDocument();
    expect(screen.getByText("공격6")).toBeInTheDocument();
  });

  it("조사하기 클릭 시 그 토스트의 event 객체를 그대로 onInvestigate로 넘긴다", async () => {
    const events = [ev("e1", "공격1"), ev("e2", "공격2")];
    const onInvestigate = vi.fn();
    await act(async () => {
      renderStack({ events, onInvestigate });
      await vi.advanceTimersByTimeAsync(50);
    });

    const buttons = screen.getAllByText("조사하기");
    await act(async () => {
      fireEvent.click(buttons[0]);
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(onInvestigate).toHaveBeenCalledTimes(1);
    const passed = onInvestigate.mock.calls[0][0];
    expect(["e1", "e2"]).toContain(passed.id);
  });

  it("같은 module+message의 공격이 또 오면 새로 안 쌓고 카운트만 올린다", async () => {
    const events = [
      ev("e1", "xss"),
      ev("e2", "xss", "9.9.9.9"), // 다른 IP지만 같은 공격 종류 - 합쳐져야 함
      ev("e3", "sqli"), // 다른 종류 - 별도 카드
    ];
    await act(async () => {
      renderStack({ events, onInvestigate: () => {} });
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getAllByText("xss")).toHaveLength(1); // 카드 자체는 1개로 합쳐짐
    expect(screen.getByText("×2")).toBeInTheDocument(); // 카운트 뱃지
    expect(screen.getByText("sqli")).toBeInTheDocument(); // 다른 종류는 별도 카드 유지
  });

  it("카운트가 올라가면 자동소멸 타이머가 리셋된다(늦게 사라짐)", async () => {
    let events = [ev("e1", "xss")];
    let rerender;
    await act(async () => {
      const result = renderStack({ events, onInvestigate: () => {} });
      rerender = result.rerender;
      await vi.advanceTimersByTimeAsync(50);
    });

    // 4초 시점에 같은 종류 공격이 한 번 더 옴 -> 타이머가 리셋돼야 함
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText("xss")).toBeInTheDocument();

    events = [...events, ev("e2", "xss")];
    await act(async () => {
      rerender(
        <ThemeProvider>
          <CriticalToastStack events={events} onInvestigate={() => {}} />
        </ThemeProvider>
      );
      await vi.advanceTimersByTimeAsync(10);
    });

    // 리셋 후에는 최초 자동소멸 시점보다 더 오래 유지돼야 한다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1050);
    });
    expect(screen.getByText("xss")).toBeInTheDocument(); // 리셋 덕분에 아직 살아있음
  });

  it("인시던트로 묶이지 않으면 15초 뒤 자동으로 사라진다", async () => {
    const events = [ev("e1", "곧사라짐")];
    await act(async () => {
      renderStack({ events, onInvestigate: () => {} });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByText("곧사라짐")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15050); // FALLBACK_LIFETIME_MS(15000) 만료 시점 지남
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350); // EXIT_DURATION_MS(300) 퇴장애니메이션까지
    });
    expect(screen.queryByText("곧사라짐")).not.toBeInTheDocument();
  });
});
