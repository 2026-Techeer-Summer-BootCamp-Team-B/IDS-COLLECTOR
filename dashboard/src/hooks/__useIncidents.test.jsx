import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIncidents } from "./useIncidents";

vi.mock("../lib/authApi", () => ({
  apiGet: vi.fn(),
  apiGetPaged: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

import { apiGetPaged } from "../lib/authApi";

describe("useIncidents", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("상태 필터를 서버 목록 요청에 전달한다", async () => {
    apiGetPaged.mockResolvedValue({
      data: [],
      nextCursor: null,
      nextSince: "2026-07-24T00:00:00Z",
    });

    const { result, rerender } = renderHook(
      ({ statusFilter }) => useIncidents({ statusFilter }),
      { initialProps: { statusFilter: "ALL" } }
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ statusFilter: "investigating" });
    await waitFor(() =>
      expect(apiGetPaged).toHaveBeenCalledWith(
        expect.stringContaining("&status=investigating")
      )
    );
  });

  it("브라우저 시간이 아니라 서버 snapshot watermark를 사용한다", async () => {
    apiGetPaged.mockResolvedValue({
      data: [],
      nextCursor: null,
      nextSince: "2026-07-24T12:34:56Z",
    });

    const { result } = renderHook(() => useIncidents());
    await waitFor(() =>
      expect(result.current.syncWatermark).toBe("2026-07-24T12:34:56Z")
    );
  });

  it("실시간 변경 뒤 도착한 오래된 페이지가 최신 상태를 되돌리지 않는다", async () => {
    let resolvePage;
    apiGetPaged
      .mockResolvedValueOnce({
        data: [],
        nextCursor: "next-page",
        nextSince: "2026-07-24T12:00:00Z",
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePage = resolve;
          })
      );

    const { result } = renderHook(() =>
      useIncidents({ statusFilter: "open", limit: 50 })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let loadPromise;
    loadPromise = result.current.loadMore();
    result.current.mergeChanges([
      {
        id: "incident-1",
        status: "closed",
        updated_at: "2026-07-24T12:00:02Z",
      },
    ]);
    resolvePage({
      data: [
        {
          id: "incident-1",
          status: "open",
          updated_at: "2026-07-24T12:00:01Z",
        },
      ],
      nextCursor: null,
    });
    await loadPromise;

    expect(result.current.incidents).toEqual([]);
  });

  it("오래된 socket 응답이 최신 로컬 상태를 되돌리지 않는다", async () => {
    apiGetPaged.mockResolvedValue({
      data: [
        {
          id: "incident-1",
          status: "open",
          updated_at: "2026-07-24T12:00:00Z",
        },
      ],
      nextCursor: null,
      nextSince: "2026-07-24T12:00:00Z",
    });

    const { result } = renderHook(() => useIncidents());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.mergeChanges([
        {
          id: "incident-1",
          status: "investigating",
          updated_at: "2026-07-24T12:00:02Z",
        },
      ]);
    });
    act(() => {
      result.current.mergeChanges([
        {
          id: "incident-1",
          status: "open",
          updated_at: "2026-07-24T12:00:01Z",
        },
      ]);
    });

    expect(result.current.incidents[0].status).toBe("investigating");
  });
});
