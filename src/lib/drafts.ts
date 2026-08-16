import type { CompositeAttachment } from "./composite";
import { createEscrowDealId } from "./escrow";
import { createDealId, createRequestId } from "./otc";

export const DRAFT_STORAGE_PREFIX = "quietline/drafts/v1";

export type TradeDraftFields = {
  giveStrk: string;
  wantAmount: string;
  wantSymbol: string;
  wantAddress: string;
  wantDecimals: string;
  note: string;
  expiryHours: string;
};

export type DraftAttachment =
  | { type: "payment"; paymentId: string; amount: string }
  | ({ type: "offer"; dealId: string } & TradeDraftFields)
  | {
      type: "payment_request";
      requestId: string;
      amount: string;
      memo: string;
      expiryHours: string;
    }
  | ({ type: "escrow_fund"; dealId: string } & TradeDraftFields);

export type CompositeDraft = {
  version: 1;
  id: string;
  documentId: string;
  recipient: string;
  body: string;
  attachments: DraftAttachment[];
  conversationId?: string;
  inReplyTo?: string;
  createdAt: number;
  updatedAt: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageKey(chainId: string, address: string): string {
  return `${DRAFT_STORAGE_PREFIX}/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isNonZeroFeltId(value: unknown): value is string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    return false;
  }
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function parseTrade(value: Record<string, unknown>): TradeDraftFields | null {
  if (
    !isShortString(value.giveStrk, 128) ||
    !isShortString(value.wantAmount, 128) ||
    !isShortString(value.wantSymbol, 32) ||
    !isShortString(value.wantAddress, 128) ||
    !isShortString(value.wantDecimals, 3) ||
    !isShortString(value.note, 512) ||
    !isShortString(value.expiryHours, 32)
  ) {
    return null;
  }
  return {
    giveStrk: value.giveStrk,
    wantAmount: value.wantAmount,
    wantSymbol: value.wantSymbol,
    wantAddress: value.wantAddress,
    wantDecimals: value.wantDecimals,
    note: value.note,
    expiryHours: value.expiryHours,
  };
}

function parseAttachment(value: unknown): DraftAttachment | null {
  if (!isObject(value) || typeof value.type !== "string") return null;
  switch (value.type as CompositeAttachment["type"]) {
    case "payment":
      return isId(value.paymentId) && isShortString(value.amount, 128)
        ? { type: "payment", paymentId: value.paymentId, amount: value.amount }
        : null;
    case "offer": {
      const trade = parseTrade(value);
      return isId(value.dealId) && trade
        ? { type: "offer", dealId: value.dealId, ...trade }
        : null;
    }
    case "payment_request":
      return isId(value.requestId) &&
        isShortString(value.amount, 128) &&
        isShortString(value.memo, 512) &&
        isShortString(value.expiryHours, 32)
        ? {
            type: "payment_request",
            requestId: value.requestId,
            amount: value.amount,
            memo: value.memo,
            expiryHours: value.expiryHours,
          }
        : null;
    case "escrow_fund": {
      const trade = parseTrade(value);
      return isNonZeroFeltId(value.dealId) && trade
        ? { type: "escrow_fund", dealId: value.dealId, ...trade }
        : null;
    }
    default:
      return null;
  }
}

function parseDraft(value: unknown): CompositeDraft | null {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    typeof value.id !== "string" ||
    !/^draft-[0-9a-f-]{36}$/i.test(value.id) ||
    !isId(value.documentId) ||
    !isShortString(value.recipient, 8_192) ||
    !isShortString(value.body, 4_096) ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > 4 ||
    !Number.isSafeInteger(value.createdAt) ||
    !Number.isSafeInteger(value.updatedAt)
  ) {
    return null;
  }
  const attachments: DraftAttachment[] = [];
  const seen = new Set<DraftAttachment["type"]>();
  for (const candidate of value.attachments) {
    const attachment = parseAttachment(candidate);
    if (!attachment || seen.has(attachment.type)) return null;
    seen.add(attachment.type);
    attachments.push(attachment);
  }
  return {
    version: 1,
    id: value.id,
    documentId: value.documentId,
    recipient: value.recipient,
    body: value.body,
    attachments,
    conversationId:
      typeof value.conversationId === "string" ? value.conversationId : undefined,
    inReplyTo: typeof value.inReplyTo === "string" ? value.inReplyTo : undefined,
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
  };
}

export function createBlankDraft(at = Date.now()): CompositeDraft {
  return {
    version: 1,
    id: `draft-${crypto.randomUUID()}`,
    documentId: createDealId(),
    recipient: "",
    body: "",
    attachments: [],
    createdAt: at,
    updatedAt: at,
  };
}

export function createDraftAttachment(
  type: "payment",
): Extract<DraftAttachment, { type: "payment" }>;
export function createDraftAttachment(
  type: "offer",
): Extract<DraftAttachment, { type: "offer" }>;
export function createDraftAttachment(
  type: "payment_request",
): Extract<DraftAttachment, { type: "payment_request" }>;
export function createDraftAttachment(
  type: "escrow_fund",
): Extract<DraftAttachment, { type: "escrow_fund" }>;
export function createDraftAttachment(
  type: DraftAttachment["type"],
): DraftAttachment {
  if (type === "payment") {
    return { type, paymentId: createDealId(), amount: "0.1" };
  }
  if (type === "payment_request") {
    return {
      type,
      requestId: createRequestId(),
      amount: "",
      memo: "",
      expiryHours: "24",
    };
  }
  return {
    type,
    dealId: type === "escrow_fund" ? createEscrowDealId() : createDealId(),
    giveStrk: "0.01",
    wantAmount: "",
    wantSymbol: "USDC",
    wantAddress: "",
    wantDecimals: "6",
    note: "",
    expiryHours: "24",
  };
}

export function loadDrafts(
  storage: Pick<Storage, "getItem">,
  chainId: string,
  address: string,
): CompositeDraft[] {
  try {
    const raw = storage.getItem(storageKey(chainId, address));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .map(parseDraft)
      .filter((draft): draft is CompositeDraft => draft !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

export function saveDraft(
  storage: StorageLike,
  chainId: string,
  address: string,
  draft: CompositeDraft,
  at = Date.now(),
): CompositeDraft[] {
  const normalized = parseDraft({ ...draft, updatedAt: at });
  if (!normalized) throw new Error("Draft is invalid and was not saved.");
  const drafts = loadDrafts(storage, chainId, address).filter(
    (candidate) => candidate.id !== normalized.id,
  );
  drafts.unshift(normalized);
  storage.setItem(storageKey(chainId, address), JSON.stringify(drafts));
  return drafts;
}

export function deleteDraft(
  storage: StorageLike,
  chainId: string,
  address: string,
  draftId: string,
): CompositeDraft[] {
  const drafts = loadDrafts(storage, chainId, address).filter(
    (draft) => draft.id !== draftId,
  );
  if (drafts.length) {
    storage.setItem(storageKey(chainId, address), JSON.stringify(drafts));
  } else {
    storage.removeItem(storageKey(chainId, address));
  }
  return drafts;
}
