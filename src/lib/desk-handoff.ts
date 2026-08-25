import { normalizeStarknetAddress } from "./address-book.js";

const STORAGE_KEY = "app20/desk-handoff/v2";
const LEGACY_STORAGE_KEY = "app20/desk-handoff/v1";
const HANDOFF_TTL_MS = 5 * 60 * 1_000;

export type DeskHandoffKind = "rfq" | "mail";

export type DeskHandoffScope = {
  account: string;
  chainId: string;
};

type DeskHandoffV2 = {
  version: 2;
  kind: DeskHandoffKind;
  address: string;
  account: string;
  chainId: string;
  createdAt: number;
};

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function normalizeChainId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("The desk handoff is missing a chain id.");
  }
  return trimmed;
}

export function storeDeskHandoff(
  storage: SessionStorageLike,
  kind: DeskHandoffKind,
  address: string,
  scope: DeskHandoffScope,
  now = Date.now(),
): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("The counterparty handoff time is invalid.");
  }
  const value: DeskHandoffV2 = {
    version: 2,
    kind,
    address: normalizeStarknetAddress(address),
    account: normalizeStarknetAddress(scope.account),
    chainId: normalizeChainId(scope.chainId),
    createdAt: now,
  };
  storage.removeItem(LEGACY_STORAGE_KEY);
  storage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function consumeDeskHandoff(
  storage: SessionStorageLike,
  kind: DeskHandoffKind,
  scope: Pick<DeskHandoffScope, "account" | "chainId">,
  now = Date.now(),
): string | null {
  storage.removeItem(LEGACY_STORAGE_KEY);
  const raw = storage.getItem(STORAGE_KEY);
  storage.removeItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DeskHandoffV2>;
    const account = normalizeStarknetAddress(scope.account);
    const chainId = normalizeChainId(scope.chainId);
    if (
      value.version !== 2 ||
      value.kind !== kind ||
      typeof value.address !== "string" ||
      typeof value.account !== "string" ||
      typeof value.chainId !== "string" ||
      value.account !== account ||
      value.chainId !== chainId ||
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
