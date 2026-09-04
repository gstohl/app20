/**
 * Which decrypted records this device has already opened.
 *
 * Read state used to live in React state alone, so a reload marked a whole
 * mailbox unread again. It is device-local by design: nothing about what you
 * have read is ever posted, and the set is scoped to one chain and account so
 * switching either never leaks the other's history.
 */
export const MAIL_READ_STATE_STORAGE_PREFIX = "app20/mailread/v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Bounded so a long-lived mailbox cannot grow the entry without limit. */
export const MAX_TRACKED_READ_IDS = 5_000;

function key(chainId: string, address: string): string {
  return `${MAIL_READ_STATE_STORAGE_PREFIX}/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`;
}

export function loadReadMessageIds(
  storage: StorageLike,
  chainId: string,
  address: string,
): Set<string> {
  if (!chainId || !address) return new Set();
  let raw: string | null = null;
  try {
    raw = storage.getItem(key(chainId, address));
  } catch {
    return new Set();
  }
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((item): item is string => typeof item === "string"),
    );
  } catch {
    return new Set();
  }
}

export function saveReadMessageIds(
  storage: StorageLike,
  chainId: string,
  address: string,
  ids: ReadonlySet<string>,
): void {
  if (!chainId || !address) return;
  const bounded = [...ids].slice(-MAX_TRACKED_READ_IDS);
  try {
    storage.setItem(key(chainId, address), JSON.stringify(bounded));
  } catch {
    // A profile that refuses storage keeps session-only read state.
  }
}
