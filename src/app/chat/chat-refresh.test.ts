import { afterEach, describe, expect, it, vi } from "vitest";
import { startChatRefresh } from "./chat-refresh";

afterEach(() => vi.useRealTimers());

describe("automatic Chat refresh", () => {
  it("checks on unlock and every 60 seconds, then stops on cleanup", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const events = new EventTarget();
    const stop = startChatRefresh({ refresh, canRefresh: () => true, visibility: events, connectivity: events });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    events.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("pauses when unavailable and resumes on visibility or connectivity without a burst", async () => {
    vi.useFakeTimers();
    let available = false;
    const refresh = vi.fn().mockResolvedValue(undefined);
    const events = new EventTarget();
    const stop = startChatRefresh({ refresh, canRefresh: () => available, visibility: events, connectivity: events });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).not.toHaveBeenCalled();
    available = true;
    events.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    events.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("never overlaps a slow check and never reschedules an old account after cleanup", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const events = new EventTarget();
    const stop = startChatRefresh({ refresh, canRefresh: () => true, visibility: events, connectivity: events });
    await vi.advanceTimersByTimeAsync(120_000);
    events.dispatchEvent(new Event("online"));
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("skips an existing manual scan and recovers from a failed read", async () => {
    vi.useFakeTimers();
    let busy = true;
    const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const events = new EventTarget();
    const stop = startChatRefresh({ refresh, canRefresh: () => !busy, visibility: events, connectivity: events });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();
    busy = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });
});
