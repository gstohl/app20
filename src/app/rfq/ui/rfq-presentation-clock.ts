import { useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();

let snapshot = Math.floor(Date.now() / 1_000);
let alignmentTimer: ReturnType<typeof setTimeout> | undefined;
let intervalTimer: ReturnType<typeof setInterval> | undefined;

function readNow(): number {
  return Math.floor(Date.now() / 1_000);
}

function timers(): Pick<
  typeof globalThis,
  "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval"
> {
  return typeof window === "undefined" ? globalThis : window;
}

function emit(): void {
  const next = readNow();
  if (next === snapshot && listeners.size > 0) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function stop(): void {
  const api = timers();
  if (alignmentTimer !== undefined) {
    api.clearTimeout(alignmentTimer);
    alignmentTimer = undefined;
  }
  if (intervalTimer !== undefined) {
    api.clearInterval(intervalTimer);
    intervalTimer = undefined;
  }
}

function start(): void {
  if (alignmentTimer !== undefined || intervalTimer !== undefined) return;
  snapshot = readNow();
  const api = timers();
  const delay = Math.max(0, 1_000 - (Date.now() % 1_000));
  alignmentTimer = api.setTimeout(() => {
    alignmentTimer = undefined;
    emit();
    intervalTimer = api.setInterval(emit, 1_000);
  }, delay);
}

function subscribeNoop(): () => void {
  return () => undefined;
}

/** Cached whole-second snapshot. Only changes when a subscriber is notified. */
export function getRfqPresentationNow(): number {
  return snapshot;
}

export function subscribeRfqPresentationClock(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/**
 * One wall-clock subscription for countdown, resume, and live-authority
 * presentation. Disabled subscribers do not keep the shared interval alive.
 */
export function useRfqPresentationClock(enabled = true): number {
  return useSyncExternalStore(
    enabled ? subscribeRfqPresentationClock : subscribeNoop,
    getRfqPresentationNow,
    getRfqPresentationNow,
  );
}

export function resetRfqPresentationClockForTests(): void {
  listeners.clear();
  stop();
  snapshot = readNow();
}

export function rfqPresentationClockListenerCountForTests(): number {
  return listeners.size;
}
