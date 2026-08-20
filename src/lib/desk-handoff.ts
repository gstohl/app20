import { normalizeStarknetAddress } from "./address-book.js";

const STORAGE_KEY = "app20/desk-handoff/v1";
const HANDOFF_TTL_MS = 5 * 60 * 1_000;

export type DeskHandoffKind = "rfq" | "mail";

type DeskHandoffV1 = {
  version: 1;
  kind: DeskHandoffKind;
  address: string;
  createdAt: number;
};

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function storeDeskHandoff(
  storage: SessionStorageLike,
  kind: DeskHandoffKind,
  address: string,
  now = Date.now(),
): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("The counterparty handoff time is invalid.");
  }
  const value: DeskHandoffV1 = {
    version: 1,
    kind,
    address: normalizeStarknetAddress(address),
    createdAt: now,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function consumeDeskHandoff(
  storage: SessionStorageLike,
  kind: DeskHandoffKind,
  now = Date.now(),
): string | null {
  const raw = storage.getItem(STORAGE_KEY);
  storage.removeItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DeskHandoffV1>;
    if (
      value.version !== 1 ||
      value.kind !== kind ||
      typeof value.address !== "string" ||
      !Number.isSafeInteger(value.createdAt) ||
      (value.createdAt ?? 0) < 0 ||
      now < (value.createdAt ?? 0) ||
      now - (value.createdAt ?? 0) > HANDOFF_TTL_MS
    ) {
      return null;
    }
    return normalizeStarknetAddress(value.address);
  } catch {
    return null;
  }
}
