export interface AbortScope {
  signal: AbortSignal;
  close(): void;
}

export function abortScope(parent: AbortSignal, timeoutMs: number): AbortScope {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    close(): void {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}
