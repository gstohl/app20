import { afterEach, describe, expect, it, vi } from "vitest";
import { rfqCountdownView } from "./rfq-countdown-view";
import {
  getRfqPresentationNow,
  resetRfqPresentationClockForTests,
  rfqPresentationClockListenerCountForTests,
  subscribeRfqPresentationClock,
} from "./rfq-presentation-clock";

afterEach(() => {
  vi.useRealTimers();
  resetRfqPresentationClockForTests();
});

describe("shared RFQ presentation clock", () => {
  it("starts one aligned interval for many subscribers and stops when the last unsubscribes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.400Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = subscribeRfqPresentationClock(first);
    const unsubscribeSecond = subscribeRfqPresentationClock(second);

    expect(rfqPresentationClockListenerCountForTests()).toBe(2);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(getRfqPresentationNow()).toBe(
      Math.floor(new Date("2026-01-01T00:00:01.000Z").getTime() / 1_000),
    );

    vi.advanceTimersByTime(1_000);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    expect(rfqPresentationClockListenerCountForTests()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(3);

    unsubscribeSecond();
    expect(rfqPresentationClockListenerCountForTests()).toBe(0);
    const intervalCalls = setIntervalSpy.mock.calls.length;
    vi.advanceTimersByTime(5_000);
    expect(setIntervalSpy).toHaveBeenCalledTimes(intervalCalls);
    expect(second).toHaveBeenCalledTimes(3);
  });
});

describe("countdown view", () => {
  const now = 1_900_000_000;

  it("keeps expired and one-minute remaining announcements polite", () => {
    expect(rfqCountdownView(now + 61, now)).toMatchObject({
      remaining: 61,
      label: "1m 1s remaining",
      ariaLive: "off",
    });
    expect(rfqCountdownView(now + 60, now)).toMatchObject({
      remaining: 60,
      label: "1m 0s remaining",
      ariaLive: "polite",
    });
    expect(rfqCountdownView(now - 5, now)).toMatchObject({
      remaining: 0,
      label: "expired",
      ariaLive: "polite",
    });
  });
});
