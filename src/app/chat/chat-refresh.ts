export const CHAT_REFRESH_INTERVAL_MS = 60_000;

/** One bounded read at a time; background tabs and offline clients stay quiet. */
export function startChatRefresh({
  refresh,
  canRefresh,
  visibility,
  connectivity,
}: {
  refresh: () => Promise<void>;
  canRefresh: () => boolean;
  visibility: EventTarget;
  connectivity: EventTarget;
}): () => void {
  let stopped = false;
  let running = false;
  let lastAttempt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function check() {
    if (stopped || running) return;
    clearTimeout(timer);
    if (canRefresh() && Date.now() - lastAttempt >= CHAT_REFRESH_INTERVAL_MS) {
      running = true;
      lastAttempt = Date.now();
      try {
        await refresh();
      } catch {
        // The scan owns error presentation. Retry on the next scheduled check.
      } finally {
        running = false;
      }
    }
    if (!stopped) timer = setTimeout(check, CHAT_REFRESH_INTERVAL_MS);
  }
  const wake = () => { void check(); };
  visibility.addEventListener("visibilitychange", wake);
  connectivity.addEventListener("online", wake);
  void check();
  return () => {
    stopped = true;
    clearTimeout(timer);
    visibility.removeEventListener("visibilitychange", wake);
    connectivity.removeEventListener("online", wake);
  };
}
