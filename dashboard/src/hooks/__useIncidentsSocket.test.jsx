import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIncidentsSocket } from "./useIncidentsSocket";

vi.mock("../lib/authApi", () => ({
  fetchIncidentChanges: vi.fn(),
}));

import { fetchIncidentChanges } from "../lib/authApi";

describe("useIncidentsSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchIncidentChanges.mockResolvedValue({ data: [], nextCursor: null, nextSince: "2026-07-23T00:00:00Z" });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not request historical changes until the initial list supplies a watermark", async () => {
    renderHook(() => useIncidentsSocket(null, vi.fn()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(fetchIncidentChanges).not.toHaveBeenCalled();
  });

  it("does not overlap polls while a previous delta request is still pending", async () => {
    let resolveRequest;
    fetchIncidentChanges.mockImplementation(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    renderHook(() => useIncidentsSocket("2026-07-23T00:00:00Z", vi.fn()));

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(fetchIncidentChanges).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest({ data: [], nextCursor: null, nextSince: "2026-07-23T00:00:01Z" });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchIncidentChanges).toHaveBeenCalledTimes(2);
  });

  it("keeps the earliest safe watermark across cursor pages", async () => {
    fetchIncidentChanges
      .mockResolvedValueOnce({
        data: [{ id: "first" }],
        nextCursor: "page-2",
        nextSince: "2026-07-23T00:00:01Z",
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: null,
        nextSince: "2026-07-23T00:00:05Z",
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: null,
        nextSince: "2026-07-23T00:00:06Z",
      });

    renderHook(() => useIncidentsSocket("2026-07-23T00:00:00Z", vi.fn()));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchIncidentChanges).toHaveBeenNthCalledWith(2, {
      since: "2026-07-23T00:00:00Z",
      cursor: "page-2",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchIncidentChanges).toHaveBeenNthCalledWith(3, {
      since: "2026-07-23T00:00:01Z",
      cursor: null,
    });
  });
});
