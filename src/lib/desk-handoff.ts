import { normalizeStarknetAddress } from "./address-book.js";

const STORAGE_KEY = "app20/desk-handoff/v2";
const LEGACY_STORAGE_KEY = "app20/desk-handoff/v1";
const INVOICE_STORAGE_KEY = "app20/desk-handoff/invoice/v1";
const HANDOFF_TTL_MS = 5 * 60 * 1_000;
const MAX_INVOICE_MEMO_LENGTH = 512;
const REQUEST_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const BASE_UNITS_PATTERN = /^(?:0|[1-9][0-9]*)$/;

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

/**
 * Pay-any-token invoice handoff from Mail to the RFQ desk: the payer sells
 * private STRK, the desk sizes the request so the selected fills deliver at
 * least `targetBuyBaseUnits` of `buyToken`, and the private transfer to the
 * payee is completed from Mail once the received note matures.
 */
export type InvoiceDeskHandoff = Readonly<{
  requestId: string;
  payee: string;
  buyToken: string;
  targetBuyBaseUnits: string;
  memo?: string;
  returnTo: string;
}>;

type InvoiceDeskHandoffV1 = InvoiceDeskHandoff &
  Readonly<{
    version: 1;
    account: string;
    chainId: string;
    createdAt: number;
  }>;

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

function normalizeInvoiceHandoff(
  handoff: InvoiceDeskHandoff,
): InvoiceDeskHandoff {
  if (!REQUEST_ID_PATTERN.test(handoff.requestId)) {
    throw new Error("The invoice handoff request id is invalid.");
  }
  if (!BASE_UNITS_PATTERN.test(handoff.targetBuyBaseUnits)) {
    throw new Error("The invoice handoff amount must be base units.");
  }
  if (BigInt(handoff.targetBuyBaseUnits) <= 0n) {
    throw new Error("The invoice handoff amount must be positive.");
  }
  if (!handoff.returnTo.startsWith("/") || handoff.returnTo.startsWith("//")) {
    throw new Error("The invoice handoff return path must be app-relative.");
  }
  const memo = handoff.memo?.trim();
  if (memo !== undefined && memo.length > MAX_INVOICE_MEMO_LENGTH) {
    throw new Error("The invoice handoff memo is too long.");
  }
  return {
    requestId: handoff.requestId.toLowerCase(),
    payee: normalizeStarknetAddress(handoff.payee),
    buyToken: normalizeStarknetAddress(handoff.buyToken),
    targetBuyBaseUnits: handoff.targetBuyBaseUnits,
    ...(memo ? { memo } : {}),
    returnTo: handoff.returnTo,
  };
}

export function storeInvoiceDeskHandoff(
  storage: SessionStorageLike,
  handoff: InvoiceDeskHandoff,
  scope: DeskHandoffScope,
  now = Date.now(),
): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("The invoice handoff time is invalid.");
  }
  const value: InvoiceDeskHandoffV1 = {
    version: 1,
    ...normalizeInvoiceHandoff(handoff),
    account: normalizeStarknetAddress(scope.account),
    chainId: normalizeChainId(scope.chainId),
    createdAt: now,
  };
  storage.setItem(INVOICE_STORAGE_KEY, JSON.stringify(value));
}

export function consumeInvoiceDeskHandoff(
  storage: SessionStorageLike,
  scope: Pick<DeskHandoffScope, "account" | "chainId">,
  now = Date.now(),
): InvoiceDeskHandoff | null {
  const raw = storage.getItem(INVOICE_STORAGE_KEY);
  storage.removeItem(INVOICE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<InvoiceDeskHandoffV1>;
    if (
      value.version !== 1 ||
      typeof value.requestId !== "string" ||
      typeof value.payee !== "string" ||
      typeof value.buyToken !== "string" ||
      typeof value.targetBuyBaseUnits !== "string" ||
      typeof value.returnTo !== "string" ||
      (value.memo !== undefined && typeof value.memo !== "string") ||
      value.account !== normalizeStarknetAddress(scope.account) ||
      value.chainId !== normalizeChainId(scope.chainId) ||
      !Number.isSafeInteger(value.createdAt) ||
      (value.createdAt ?? 0) < 0 ||
      now < (value.createdAt ?? 0) ||
      now - (value.createdAt ?? 0) > HANDOFF_TTL_MS
    ) {
      return null;
    }
    return normalizeInvoiceHandoff({
      requestId: value.requestId,
      payee: value.payee,
      buyToken: value.buyToken,
      targetBuyBaseUnits: value.targetBuyBaseUnits,
      ...(value.memo === undefined ? {} : { memo: value.memo }),
      returnTo: value.returnTo,
    });
  } catch {
    return null;
  }
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
