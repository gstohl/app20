import { canonicalizeStarknetAddress, feltEquals } from "./addresses";
import { noteMaturityStatus } from "./note-maturity";
import type { PaymentLinkAuthenticity } from "./payment-link";
import { sanitizeUntrustedText } from "./text";
import { resolveCanonicalToken } from "./token-registry";
import { addrSTRK } from "./tokens";
import {
  LOCALNET_CHAIN_ID,
  localnetUsdcToken,
  localnetWalletEnabled,
} from "../utils/constants";

export const OTC_STORAGE_PREFIX = "app20/otc/v1";
export const ONE_SIDED_WARNING = "one_sided_v1" as const;

export type TokenRef = {
  symbol: string;
  address: string;
  decimals: number;
};

export type OfferPayload = {
  dealId: string;
  give: { token: TokenRef; amount: string };
  want: { token: TokenRef; amount: string };
  offerer: string;
  expiresAt: number;
  note?: string;
};

export type AcceptPayload = {
  dealId: string;
  offerIndex?: number;
  transfer: { token: TokenRef; amount: string; to: string };
};

export type DeclinePayload = { dealId: string; reason?: string };

export type ReceiptPayload = {
  dealId: string;
  txHash: string;
  transfer: AcceptPayload["transfer"];
  warning: typeof ONE_SIDED_WARNING;
};

/**
 * `requester` is required because MessagePosted deliberately has no sender.
 * `requestId` is the idempotency key used to prevent a second private payment.
 */
export type PaymentRequestPayload = {
  requestId: string;
  token: TokenRef;
  amount: string;
  memo?: string;
  expiresAt: number;
  requester: string;
  /** Required for shareable links; encrypted mailbox requests inherit their chain. */
  chainId?: string;
  /** Accepted on decode for early invoice drafts; new sends use requestId. */
  invoiceId?: string;
};

export type DealStatus =
  | "offered"
  | "accepted"
  | "closed"
  | "declined"
  | "expired";

export type ValueOperationState =
  | "awaiting-note-maturity"
  | "reserved"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "unknown";

export type InvoiceTakeSettlement = Readonly<{
  takeTransactionHash: string;
  takeBlock: number;
  buyToken: string;
  amount: string;
}>;

type PaymentAttemptOperation = {
  state: Exclude<ValueOperationState, "awaiting-note-maturity">;
  /** Payer-owned random nonce; unpredictable before this payer reserves. */
  attemptId?: string;
  transactionHash?: string;
  updatedAt: number;
} & Partial<InvoiceTakeSettlement>;

export type ValueOperationRecord =
  | ({
      state: "awaiting-note-maturity";
      attemptId?: never;
      updatedAt: number;
    } & InvoiceTakeSettlement)
  | PaymentAttemptOperation;

export type DealRecord = {
  dealId: string;
  status: DealStatus;
  offer: OfferPayload;
  accept?: AcceptPayload;
  receipt?: ReceiptPayload;
  acceptOperation?: ValueOperationRecord;
  /** Legacy display/index fields; acceptOperation is the lifecycle authority. */
  acceptTxHash?: string;
  acceptPending?: boolean;
  settlementVerified?: boolean;
  counterpartyAcceptClaim?: AcceptPayload;
  counterpartyReceiptClaim?: ReceiptPayload;
  updatedAt: number;
};

export type PaymentStatus = "requested" | "paid" | "expired";

export type PaymentRecord = {
  requestId: string;
  status: PaymentStatus;
  request: PaymentRequestPayload;
  /** Present only when this request was explicitly imported from /pay. */
  origin?: "payment_link";
  /** Verified while decoding the original link; unsigned when no proof exists. */
  linkAuthenticity?: PaymentLinkAuthenticity;
  receipt?: ReceiptPayload;
  paymentOperation?: ValueOperationRecord;
  /** Legacy display/index fields; paymentOperation is the lifecycle authority. */
  paymentTxHash?: string;
  paymentPending?: boolean;
  paymentVerified?: boolean;
  counterpartyPaymentClaim?: AcceptPayload;
  updatedAt: number;
};

export type OtcState = {
  version: 1;
  deals: Record<string, DealRecord>;
  payments: Record<string, PaymentRecord>;
};

export type OtcDealEvent =
  | { type: "offer"; payload: OfferPayload }
  | { type: "accept"; payload: AcceptPayload }
  | { type: "accept_claim"; payload: AcceptPayload }
  | { type: "decline"; payload: DeclinePayload }
  | { type: "receipt"; payload: ReceiptPayload }
  | { type: "receipt_claim"; payload: ReceiptPayload }
  | { type: "expire" };

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const BASE_UNITS_PATTERN = /^(?:0|[1-9]\d*)$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_TOKEN_DECIMALS = 255;
const STRK_SYMBOL = "STRK";
const STRK_DECIMALS = 18;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return canonicalizeStarknetAddress(value);
  } catch {
    return null;
  }
}

function isFelt(value: unknown): value is string {
  return parseAddress(value) !== null;
}

export function isRandom32ByteId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isPositiveBaseUnitAmount(value: unknown): value is string {
  if (typeof value !== "string" || !BASE_UNITS_PATTERN.test(value)) {
    return false;
  }
  const amount = BigInt(value);
  return amount > 0n && amount <= MAX_UINT256;
}

export function normalizeTokenRef(token: TokenRef): TokenRef {
  if (feltEquals(token.address, addrSTRK)) {
    return { address: addrSTRK, decimals: STRK_DECIMALS, symbol: STRK_SYMBOL };
  }
  return {
    ...token,
    address: canonicalizeStarknetAddress(token.address),
  };
}

export function isCanonicalStrkToken(token: TokenRef): boolean {
  return (
    feltEquals(token.address, addrSTRK) &&
    token.decimals === STRK_DECIMALS &&
    token.symbol === STRK_SYMBOL
  );
}

export function hasConsistentTokenMetadata(token: TokenRef): boolean {
  return !feltEquals(token.address, addrSTRK) || isCanonicalStrkToken(token);
}

function parseTokenRef(value: unknown): TokenRef | null {
  if (!isObject(value)) return null;
  const address = parseAddress(value.address);
  const symbol =
    typeof value.symbol === "string"
      ? sanitizeUntrustedText(value.symbol).trim()
      : "";
  if (
    !symbol ||
    typeof value.symbol !== "string" ||
    value.symbol.length > 32 ||
    symbol.length > 32 ||
    !address ||
    !Number.isInteger(value.decimals) ||
    (value.decimals as number) < 0 ||
    (value.decimals as number) > MAX_TOKEN_DECIMALS
  ) {
    return null;
  }
  const token = {
    symbol,
    address,
    decimals: value.decimals as number,
  };
  if (!hasConsistentTokenMetadata(token)) return null;
  return normalizeTokenRef(token);
}

function parseLeg(value: unknown): OfferPayload["give"] | null {
  if (!isObject(value)) return null;
  const token = parseTokenRef(value.token);
  if (!token || !isPositiveBaseUnitAmount(value.amount)) return null;
  return { token, amount: value.amount };
}

function parseTransfer(value: unknown): AcceptPayload["transfer"] | null {
  if (!isObject(value)) return null;
  const token = parseTokenRef(value.token);
  const to = parseAddress(value.to);
  if (!token || !isPositiveBaseUnitAmount(value.amount) || !to) {
    return null;
  }
  return { token, amount: value.amount, to };
}

function optionalShortText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 512) return null;
  return sanitizeUntrustedText(value);
}

function isExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseOfferPayload(value: unknown): OfferPayload | null {
  if (!isObject(value)) return null;
  const give = parseLeg(value.give);
  const want = parseLeg(value.want);
  const offerer = parseAddress(value.offerer);
  const note = optionalShortText(value.note);
  if (
    !isRandom32ByteId(value.dealId) ||
    !give ||
    !want ||
    !offerer ||
    !isExpiry(value.expiresAt) ||
    note === null
  ) {
    return null;
  }
  return {
    dealId: value.dealId,
    give,
    want,
    offerer,
    expiresAt: value.expiresAt,
    ...(note === undefined ? {} : { note }),
  };
}

export function parseAcceptPayload(value: unknown): AcceptPayload | null {
  if (!isObject(value)) return null;
  const transfer = parseTransfer(value.transfer);
  if (
    !isRandom32ByteId(value.dealId) ||
    !transfer ||
    (value.offerIndex !== undefined &&
      (typeof value.offerIndex !== "number" ||
        !Number.isSafeInteger(value.offerIndex) ||
        value.offerIndex < 0))
  ) {
    return null;
  }
  return {
    dealId: value.dealId,
    transfer,
    ...(value.offerIndex === undefined
      ? {}
      : { offerIndex: value.offerIndex as number }),
  };
}

export function parseDeclinePayload(value: unknown): DeclinePayload | null {
  if (!isObject(value)) return null;
  const reason = optionalShortText(value.reason);
  if (!isRandom32ByteId(value.dealId) || reason === null) return null;
  return {
    dealId: value.dealId,
    ...(reason === undefined ? {} : { reason }),
  };
}

export function parseReceiptPayload(value: unknown): ReceiptPayload | null {
  if (!isObject(value)) return null;
  const transfer = parseTransfer(value.transfer);
  if (
    !isRandom32ByteId(value.dealId) ||
    !isFelt(value.txHash) ||
    !transfer ||
    value.warning !== ONE_SIDED_WARNING
  ) {
    return null;
  }
  return {
    dealId: value.dealId,
    txHash: value.txHash,
    transfer,
    warning: ONE_SIDED_WARNING,
  };
}

export function parsePaymentRequestPayload(
  value: unknown,
): PaymentRequestPayload | null {
  if (!isObject(value)) return null;
  const requestId = isRandom32ByteId(value.requestId)
    ? value.requestId
    : isRandom32ByteId(value.invoiceId)
      ? value.invoiceId
      : null;
  const token = parseTokenRef(value.token);
  const requester = parseAddress(value.requester);
  const memo = optionalShortText(value.memo);
  if (
    !requestId ||
    !token ||
    !isPositiveBaseUnitAmount(value.amount) ||
    memo === null ||
    !isExpiry(value.expiresAt) ||
    !requester
  ) {
    return null;
  }
  return {
    requestId,
    token,
    amount: value.amount,
    expiresAt: value.expiresAt,
    requester,
    ...(memo === undefined ? {} : { memo }),
    ...(typeof value.chainId === "string" && value.chainId.length <= 80
      ? { chainId: value.chainId }
      : {}),
    ...(typeof value.invoiceId === "string"
      ? { invoiceId: value.invoiceId }
      : {}),
  };
}

function createRandom32ByteId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export const createDealId = createRandom32ByteId;
export const createRequestId = createRandom32ByteId;
export const createPaymentAttemptId = createRandom32ByteId;

export function parseDecimalToBaseUnits(
  value: string,
  decimals: number,
): string {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > MAX_TOKEN_DECIMALS
  ) {
    throw new Error("Token decimals must be an integer from 0 to 255.");
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error("Amount must be a positive decimal number.");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places.`);
  }
  const units =
    BigInt(match[1]) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units <= 0n) throw new Error("Amount must be greater than zero.");
  if (units > MAX_UINT256) {
    throw new Error("Amount exceeds the uint256 limit.");
  }
  return units.toString();
}

export function formatBaseUnits(amount: string, decimals: number): string {
  if (!BASE_UNITS_PATTERN.test(amount)) return amount;
  if (!Number.isInteger(decimals) || decimals <= 0)
    return BigInt(amount).toString();
  const padded = amount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction
    ? `${BigInt(whole).toString()}.${fraction}`
    : BigInt(whole).toString();
}

export function offerIsExpired(
  offer: Pick<OfferPayload, "expiresAt">,
  at = nowSeconds(),
): boolean {
  return offer.expiresAt !== 0 && offer.expiresAt <= at;
}

export function paymentRequestIsExpired(
  request: Pick<PaymentRequestPayload, "expiresAt">,
  at = nowSeconds(),
): boolean {
  return request.expiresAt !== 0 && request.expiresAt <= at;
}

export function assertSettlesStrk(offer: OfferPayload): void {
  if (!isCanonicalStrkToken(offer.give.token)) {
    throw new Error(
      "Mail can settle only STRK with canonical metadata on the give leg.",
    );
  }
  if (!hasConsistentTokenMetadata(offer.want.token)) {
    throw new Error(
      "The offered want leg contains inconsistent STRK metadata.",
    );
  }
}

export function resolvePaymentRequestTokenForChain(
  request: PaymentRequestPayload,
  chainId: string,
): TokenRef {
  if (isCanonicalStrkToken(request.token))
    return normalizeTokenRef(request.token);
  if (
    (request.chainId !== undefined && !feltEquals(request.chainId, chainId)) ||
    !localnetWalletEnabled ||
    !feltEquals(chainId, LOCALNET_CHAIN_ID)
  ) {
    throw new Error(
      "Mail can pay only STRK with canonical invoice metadata on public networks.",
    );
  }
  const resolved = resolveCanonicalToken("localnet", request.token.address);
  if (
    !resolved.ok ||
    resolved.token.key !== "usdc" ||
    !feltEquals(resolved.token.address, localnetUsdcToken) ||
    request.token.symbol !== resolved.token.symbol ||
    request.token.decimals !== resolved.token.decimals
  ) {
    throw new Error(
      "Mail can pay only the registry-resolved localnet USDC token or canonical STRK.",
    );
  }
  return {
    address: resolved.token.address,
    symbol: resolved.token.symbol,
    decimals: resolved.token.decimals,
  };
}

export function acceptPayloadForOffer(
  offer: OfferPayload,
  offerIndex?: number,
): AcceptPayload {
  assertSettlesStrk(offer);
  if (offerIsExpired(offer)) throw new Error("This offer has expired.");
  return {
    dealId: offer.dealId,
    ...(offerIndex === undefined ? {} : { offerIndex }),
    transfer: {
      token: normalizeTokenRef(offer.give.token),
      amount: offer.give.amount,
      to: offer.offerer,
    },
  };
}

export function receiptForTransfer(
  id: string,
  transfer: AcceptPayload["transfer"],
  txHash: string,
): ReceiptPayload {
  if (!isRandom32ByteId(id) || !isFelt(txHash)) {
    throw new Error(
      "A valid id and transaction hash are required for a receipt.",
    );
  }
  return {
    dealId: id,
    txHash,
    transfer,
    warning: ONE_SIDED_WARNING,
  };
}

function tokenRefsEqual(left: TokenRef, right: TokenRef): boolean {
  return (
    feltEquals(left.address, right.address) &&
    left.symbol === right.symbol &&
    left.decimals === right.decimals
  );
}

function transfersEqual(
  left: AcceptPayload["transfer"],
  right: AcceptPayload["transfer"],
): boolean {
  return (
    tokenRefsEqual(left.token, right.token) &&
    left.amount === right.amount &&
    feltEquals(left.to, right.to)
  );
}

function offersEqual(left: OfferPayload, right: OfferPayload): boolean {
  return (
    left.dealId === right.dealId &&
    tokenRefsEqual(left.give.token, right.give.token) &&
    left.give.amount === right.give.amount &&
    tokenRefsEqual(left.want.token, right.want.token) &&
    left.want.amount === right.want.amount &&
    feltEquals(left.offerer, right.offerer) &&
    left.expiresAt === right.expiresAt &&
    (left.note ?? "") === (right.note ?? "")
  );
}

function paymentRequestsEqual(
  left: PaymentRequestPayload,
  right: PaymentRequestPayload,
): boolean {
  return (
    left.requestId === right.requestId &&
    tokenRefsEqual(left.token, right.token) &&
    left.amount === right.amount &&
    (left.memo ?? "") === (right.memo ?? "") &&
    left.expiresAt === right.expiresAt &&
    feltEquals(left.requester, right.requester) &&
    (left.chainId ?? "") === (right.chainId ?? "")
  );
}

function assertAcceptMatchesOffer(
  offer: OfferPayload,
  accept: AcceptPayload,
): void {
  assertSettlesStrk(offer);
  if (
    accept.dealId !== offer.dealId ||
    !transfersEqual(accept.transfer, {
      token: offer.give.token,
      amount: offer.give.amount,
      to: offer.offerer,
    })
  ) {
    throw new Error("Accept transfer does not match the offered STRK terms.");
  }
}

export function transitionDeal(
  current: DealRecord | undefined,
  event: OtcDealEvent,
  at = nowSeconds(),
): DealRecord {
  if (event.type === "offer") {
    const offer = parseOfferPayload(event.payload);
    if (!offer) throw new Error("Invalid OTC offer payload.");
    if (current) {
      if (
        current.dealId !== offer.dealId ||
        !offersEqual(current.offer, offer)
      ) {
        throw new Error(
          "Conflicting OTC terms reuse an existing deal id; the duplicate was rejected.",
        );
      }
      return current;
    }
    return {
      dealId: offer.dealId,
      status: offerIsExpired(offer, at) ? "expired" : "offered",
      offer,
      updatedAt: at,
    };
  }

  if (!current)
    throw new Error("The referenced OTC offer is not stored locally.");

  if (event.type === "expire") {
    if (current.status === "offered" && offerIsExpired(current.offer, at)) {
      return { ...current, status: "expired", updatedAt: at };
    }
    return current;
  }

  if (event.payload.dealId !== current.dealId) {
    throw new Error("OTC payload dealId does not match the local deal.");
  }

  const expired =
    current.status === "offered" && offerIsExpired(current.offer, at);
  if (expired) {
    return { ...current, status: "expired", updatedAt: at };
  }

  if (event.type === "accept_claim") {
    const accept = parseAcceptPayload(event.payload);
    if (!accept) throw new Error("Invalid OTC accept claim payload.");
    assertAcceptMatchesOffer(current.offer, accept);
    return {
      ...current,
      counterpartyAcceptClaim: accept,
      updatedAt: at,
    };
  }

  if (event.type === "receipt_claim") {
    const receipt = parseReceiptPayload(event.payload);
    if (!receipt) throw new Error("Invalid OTC receipt claim payload.");
    assertAcceptMatchesOffer(current.offer, {
      dealId: receipt.dealId,
      transfer: receipt.transfer,
    });
    if (
      current.acceptTxHash &&
      !feltEquals(receipt.txHash, current.acceptTxHash)
    ) {
      throw new Error(
        "Receipt transaction hash does not match the recorded accept transaction.",
      );
    }
    return {
      ...current,
      counterpartyReceiptClaim: receipt,
      updatedAt: at,
    };
  }

  if (event.type === "accept") {
    if (current.status === "accepted" || current.status === "closed")
      return current;
    if (current.status !== "offered") {
      throw new Error(`Cannot accept a ${current.status} deal.`);
    }
    const accept = parseAcceptPayload(event.payload);
    if (!accept) throw new Error("Invalid OTC accept payload.");
    assertAcceptMatchesOffer(current.offer, accept);
    return {
      ...current,
      status: "accepted",
      accept,
      acceptPending: false,
      settlementVerified: false,
      updatedAt: at,
    };
  }

  if (event.type === "decline") {
    if (current.status === "declined") return current;
    if (current.status !== "offered") {
      throw new Error(`Cannot decline a ${current.status} deal.`);
    }
    if (!parseDeclinePayload(event.payload)) {
      throw new Error("Invalid OTC decline payload.");
    }
    return { ...current, status: "declined", updatedAt: at };
  }

  const receipt = parseReceiptPayload(event.payload);
  if (!receipt) throw new Error("Invalid OTC receipt payload.");
  if (
    (current.status !== "accepted" && current.status !== "closed") ||
    !current.accept ||
    !current.acceptTxHash ||
    !current.settlementVerified ||
    !transfersEqual(receipt.transfer, current.accept.transfer) ||
    !feltEquals(receipt.txHash, current.acceptTxHash)
  ) {
    throw new Error(
      "Receipt does not match the locally verified accept transaction.",
    );
  }
  if (current.status === "closed") return current;
  return {
    ...current,
    status: "closed",
    receipt,
    acceptPending: false,
    settlementVerified: true,
    updatedAt: at,
  };
}

export function emptyOtcState(): OtcState {
  return { version: 1, deals: {}, payments: {} };
}

export function otcStorageKey(chainId: string, selfAddress: string): string {
  return `${OTC_STORAGE_PREFIX}/${chainId}/${selfAddress}`;
}

export function loadOtcState(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
): OtcState {
  const serialized = storage.getItem(otcStorageKey(chainId, selfAddress));
  if (!serialized) return emptyOtcState();
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isObject(parsed) || parsed.version !== 1) return emptyOtcState();
    return {
      version: 1,
      deals: isObject(parsed.deals)
        ? (parsed.deals as Record<string, DealRecord>)
        : {},
      payments: isObject(parsed.payments)
        ? (parsed.payments as Record<string, PaymentRecord>)
        : {},
    };
  } catch {
    return emptyOtcState();
  }
}

function saveOtcState(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  state: OtcState,
): void {
  storage.setItem(otcStorageKey(chainId, selfAddress), JSON.stringify(state));
}

export function recordDealEvent(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  event: OtcDealEvent,
  at = nowSeconds(),
): DealRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const dealId = event.type === "expire" ? "" : event.payload.dealId;
  if (!dealId)
    throw new Error("recordDealEvent requires an event with a dealId.");
  const next = transitionDeal(state.deals[dealId], event, at);
  state.deals[dealId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

export function expireStoredDeals(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  at = nowSeconds(),
): OtcState {
  const state = loadOtcState(storage, chainId, selfAddress);
  let changed = false;
  for (const [dealId, deal] of Object.entries(state.deals)) {
    const next = transitionDeal(deal, { type: "expire" }, at);
    if (next !== deal) {
      state.deals[dealId] = next;
      changed = true;
    }
  }
  for (const [requestId, payment] of Object.entries(state.payments)) {
    if (
      payment.status === "requested" &&
      paymentRequestIsExpired(payment.request, at)
    ) {
      state.payments[requestId] = {
        ...payment,
        status: "expired",
        updatedAt: at,
      };
      changed = true;
    }
  }
  if (changed) saveOtcState(storage, chainId, selfAddress, state);
  return state;
}

/**
 * Synchronously reserves an accept before opening the wallet. A second click
 * observes `accepted` and cannot submit another transfer.
 */
export function claimOtcAccept(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  accept: AcceptPayload,
  at = nowSeconds(),
): DealRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.deals[accept.dealId];
  if (!current)
    throw new Error("The referenced OTC offer is not stored locally.");
  if (
    current.status === "expired" ||
    (current.status === "offered" &&
      !current.acceptPending &&
      offerIsExpired(current.offer, at))
  ) {
    if (current.status !== "expired") {
      state.deals[accept.dealId] = {
        ...current,
        status: "expired",
        updatedAt: at,
      };
      saveOtcState(storage, chainId, selfAddress, state);
    }
    throw new Error("This offer has expired.");
  }
  if (current.status !== "offered" || current.acceptPending) {
    throw new Error(
      "This deal was already accepted; no second transfer was sent.",
    );
  }
  const next = transitionDeal(current, { type: "accept", payload: accept }, at);
  if (next.status !== "accepted" || !next.accept) {
    throw new Error("Cannot reserve an OTC accept for this deal.");
  }
  const claimed = {
    ...next,
    acceptOperation: {
      state: "reserved" as const,
      attemptId: createPaymentAttemptId(),
      updatedAt: at,
    },
    acceptTxHash: undefined,
    acceptPending: true,
    settlementVerified: false,
  };
  state.deals[accept.dealId] = claimed;
  saveOtcState(storage, chainId, selfAddress, state);
  return claimed;
}

export function markOtcAcceptSubmitted(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  transactionHash: string,
  at = nowSeconds(),
): DealRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.deals[dealId];
  if (
    !current ||
    current.status !== "accepted" ||
    !current.accept ||
    current.acceptOperation?.state !== "reserved" ||
    !isFelt(transactionHash)
  ) {
    throw new Error("No matching reserved OTC accept can be submitted.");
  }
  const next: DealRecord = {
    ...current,
    acceptOperation: {
      state: "submitted",
      attemptId: current.acceptOperation.attemptId,
      transactionHash,
      updatedAt: at,
    },
    acceptTxHash: transactionHash,
    acceptPending: true,
    settlementVerified: false,
    updatedAt: at,
  };
  state.deals[dealId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

export function confirmOtcAccept(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  transactionHash: string,
  at = nowSeconds(),
): DealRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.deals[dealId];
  if (
    !current ||
    current.status !== "accepted" ||
    !current.accept ||
    current.acceptOperation?.state !== "submitted" ||
    !current.acceptOperation.transactionHash ||
    !isFelt(transactionHash) ||
    !feltEquals(current.acceptOperation.transactionHash, transactionHash) ||
    (current.acceptTxHash !== undefined &&
      !feltEquals(current.acceptTxHash, transactionHash))
  ) {
    throw new Error("No matching submitted OTC accept can be confirmed.");
  }
  const next: DealRecord = {
    ...current,
    acceptOperation: {
      state: "confirmed",
      attemptId: current.acceptOperation.attemptId,
      transactionHash,
      updatedAt: at,
    },
    acceptTxHash: transactionHash,
    acceptPending: false,
    settlementVerified: true,
    updatedAt: at,
  };
  state.deals[dealId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

export function markOtcAcceptOutcome(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  transactionHash: string,
  outcome: "reverted" | "unknown",
  at = nowSeconds(),
): DealRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.deals[dealId];
  if (
    !current ||
    current.status !== "accepted" ||
    current.acceptOperation?.state !== "submitted" ||
    !current.acceptOperation.transactionHash ||
    !isFelt(transactionHash) ||
    !feltEquals(current.acceptOperation.transactionHash, transactionHash)
  ) {
    throw new Error("No matching submitted OTC accept can be reconciled.");
  }
  const operation: ValueOperationRecord = {
    state: outcome,
    attemptId: current.acceptOperation.attemptId,
    transactionHash,
    updatedAt: at,
  };
  const next: DealRecord =
    outcome === "unknown"
      ? {
          ...current,
          acceptOperation: operation,
          acceptPending: true,
          settlementVerified: false,
          updatedAt: at,
        }
      : {
          dealId: current.dealId,
          status: offerIsExpired(current.offer, at) ? "expired" : "offered",
          offer: current.offer,
          acceptOperation: operation,
          acceptTxHash: transactionHash,
          acceptPending: false,
          settlementVerified: false,
          ...(current.counterpartyAcceptClaim
            ? { counterpartyAcceptClaim: current.counterpartyAcceptClaim }
            : {}),
          ...(current.counterpartyReceiptClaim
            ? { counterpartyReceiptClaim: current.counterpartyReceiptClaim }
            : {}),
          updatedAt: at,
        };
  state.deals[dealId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

export function releaseOtcAccept(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  dealId: string,
  at = nowSeconds(),
): DealRecord | undefined {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.deals[dealId];
  if (
    !current ||
    current.status !== "accepted" ||
    current.acceptOperation?.state !== "reserved" ||
    !current.acceptPending ||
    current.acceptTxHash
  ) {
    return current;
  }
  const next: DealRecord = {
    dealId: current.dealId,
    status: offerIsExpired(current.offer, at) ? "expired" : "offered",
    offer: current.offer,
    ...(current.counterpartyAcceptClaim
      ? { counterpartyAcceptClaim: current.counterpartyAcceptClaim }
      : {}),
    ...(current.counterpartyReceiptClaim
      ? { counterpartyReceiptClaim: current.counterpartyReceiptClaim }
      : {}),
    updatedAt: at,
  };
  state.deals[dealId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

function paymentLinkAuthenticitiesEqual(
  left: PaymentLinkAuthenticity | undefined,
  right: PaymentLinkAuthenticity | undefined,
): boolean {
  if (left?.kind !== right?.kind) return false;
  if (
    !left ||
    !right ||
    left.kind === "unsigned" ||
    right.kind === "unsigned"
  ) {
    return true;
  }
  return (
    left.mailboxPublicKey === right.mailboxPublicKey &&
    left.authPublicKey === right.authPublicKey
  );
}

function recordPaymentRequestWithOrigin(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  request: PaymentRequestPayload,
  at: number,
  origin?: PaymentRecord["origin"],
  linkAuthenticity?: PaymentLinkAuthenticity,
): PaymentRecord {
  const parsed = parsePaymentRequestPayload(request);
  if (!parsed) throw new Error("Invalid payment request payload.");
  const state = loadOtcState(storage, chainId, selfAddress);
  const existing = state.payments[parsed.requestId];
  if (existing) {
    if (!paymentRequestsEqual(existing.request, parsed)) {
      throw new Error(
        "Conflicting payment terms reuse an existing request id; the duplicate was rejected.",
      );
    }
    if (
      origin === "payment_link" &&
      (existing.origin !== origin ||
        !paymentLinkAuthenticitiesEqual(
          existing.linkAuthenticity,
          linkAuthenticity,
        ))
    ) {
      const imported = {
        ...existing,
        origin,
        ...(linkAuthenticity ? { linkAuthenticity } : {}),
      };
      state.payments[parsed.requestId] = imported;
      saveOtcState(storage, chainId, selfAddress, state);
      return imported;
    }
    return existing;
  }
  const record: PaymentRecord = {
    requestId: parsed.requestId,
    status: paymentRequestIsExpired(parsed, at) ? "expired" : "requested",
    request: parsed,
    ...(origin ? { origin } : {}),
    ...(linkAuthenticity ? { linkAuthenticity } : {}),
    updatedAt: at,
  };
  state.payments[parsed.requestId] = record;
  saveOtcState(storage, chainId, selfAddress, state);
  return record;
}

export function recordPaymentRequest(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  request: PaymentRequestPayload,
  at = nowSeconds(),
): PaymentRecord {
  return recordPaymentRequestWithOrigin(
    storage,
    chainId,
    selfAddress,
    request,
    at,
  );
}

/** Persist an explicitly reviewed payment-link request for mailbox rendering. */
export function recordPaymentLinkRequest(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  request: PaymentRequestPayload,
  linkAuthenticity: PaymentLinkAuthenticity,
  at = nowSeconds(),
): PaymentRecord {
  return recordPaymentRequestWithOrigin(
    storage,
    chainId,
    selfAddress,
    request,
    at,
    "payment_link",
    linkAuthenticity,
  );
}

export type RecordInvoiceTakeSettledInput = InvoiceTakeSettlement &
  Readonly<{ requestId: string }>;

export type InvoicePaymentMaturity = Readonly<{
  mature: boolean;
  matureAtBlock: number;
  blocksRemaining: number;
}>;

function operationTakeSettlement(
  operation: ValueOperationRecord | undefined,
): InvoiceTakeSettlement | undefined {
  if (
    !operation ||
    !isFelt(operation.takeTransactionHash) ||
    typeof operation.takeBlock !== "number" ||
    !Number.isSafeInteger(operation.takeBlock) ||
    operation.takeBlock < 0 ||
    !isFelt(operation.buyToken) ||
    !isPositiveBaseUnitAmount(operation.amount)
  ) {
    return undefined;
  }
  return {
    takeTransactionHash: operation.takeTransactionHash,
    takeBlock: operation.takeBlock,
    buyToken: operation.buyToken,
    amount: operation.amount,
  };
}

export function invoicePaymentMaturity(
  payment: PaymentRecord,
  headBlock: number,
): InvoicePaymentMaturity | null {
  const take = operationTakeSettlement(payment.paymentOperation);
  if (!take) return null;
  const status = noteMaturityStatus(
    [
      {
        kind: "openNote",
        blockNumber: take.takeBlock,
        transactionHash: take.takeTransactionHash,
        token: take.buyToken,
        amountBaseUnits: BigInt(take.amount),
      },
    ],
    headBlock,
  );
  const pending = status.pending[0];
  return Object.freeze({
    mature: pending === undefined,
    matureAtBlock: take.takeBlock + status.maturityBlocks,
    blocksRemaining: pending?.blocksRemaining ?? 0,
  });
}

export function recordInvoiceTakeSettled(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  input: RecordInvoiceTakeSettledInput,
  at = nowSeconds(),
): PaymentRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.payments[input.requestId];
  if (!current) {
    throw new Error("The invoice request is not stored locally.");
  }
  const token = resolvePaymentRequestTokenForChain(current.request, chainId);
  if (isCanonicalStrkToken(token)) {
    throw new Error("A STRK invoice does not require an RFQ take.");
  }
  if (
    current.status !== "requested" ||
    current.paymentPending ||
    !isFelt(input.takeTransactionHash) ||
    !Number.isSafeInteger(input.takeBlock) ||
    input.takeBlock < 0 ||
    !isPositiveBaseUnitAmount(input.amount) ||
    !feltEquals(input.buyToken, token.address) ||
    input.amount !== current.request.amount
  ) {
    throw new Error(
      "The settled invoice take does not match the reviewed request.",
    );
  }
  const existing = operationTakeSettlement(current.paymentOperation);
  if (current.paymentOperation?.state === "awaiting-note-maturity") {
    if (
      existing &&
      feltEquals(existing.takeTransactionHash, input.takeTransactionHash) &&
      existing.takeBlock === input.takeBlock &&
      feltEquals(existing.buyToken, input.buyToken) &&
      existing.amount === input.amount
    ) {
      return current;
    }
    throw new Error(
      "A different settled take is already bound to this invoice.",
    );
  }
  if (current.paymentOperation) {
    throw new Error("This invoice already has a payment operation.");
  }
  const next: PaymentRecord = {
    ...current,
    paymentOperation: {
      state: "awaiting-note-maturity",
      takeTransactionHash: input.takeTransactionHash,
      takeBlock: input.takeBlock,
      buyToken: token.address,
      amount: input.amount,
      updatedAt: at,
    },
    paymentPending: false,
    paymentVerified: false,
    updatedAt: at,
  };
  state.payments[input.requestId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

function claimPaymentInternal(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  expectedRequest: PaymentRequestPayload,
  at: number,
  maturityHeadBlock?: number,
): PaymentRecord {
  const parsedExpected = parsePaymentRequestPayload(expectedRequest);
  if (!parsedExpected)
    throw new Error("Invalid expected payment request terms.");
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.payments[parsedExpected.requestId];
  if (!current || !paymentRequestsEqual(current.request, parsedExpected)) {
    throw new Error(
      "Payment request terms do not match the locally reviewed record.",
    );
  }
  if (current.status !== "requested" || current.paymentPending) {
    throw new Error(
      "This request was already paid; no second transfer was sent.",
    );
  }
  const token = resolvePaymentRequestTokenForChain(current.request, chainId);
  const awaitingMaturity =
    current.paymentOperation?.state === "awaiting-note-maturity";
  if (!isCanonicalStrkToken(token) && !awaitingMaturity) {
    throw new Error(
      "This localnet USDC invoice must complete its private STRK RFQ before payment.",
    );
  }
  if (awaitingMaturity) {
    const take = operationTakeSettlement(current.paymentOperation);
    if (
      !take ||
      !feltEquals(take.buyToken, token.address) ||
      take.amount !== current.request.amount
    ) {
      throw new Error("The settled invoice take record is invalid.");
    }
    if (maturityHeadBlock === undefined) {
      throw new Error(
        "The received invoice note maturity must be checked first.",
      );
    }
    const maturity = invoicePaymentMaturity(current, maturityHeadBlock);
    if (!maturity?.mature) {
      throw new Error(
        `The received invoice note matures at block ${maturity?.matureAtBlock ?? "unknown"}.`,
      );
    }
  }
  if (paymentRequestIsExpired(current.request, at)) {
    const expired: PaymentRecord = {
      ...current,
      status: "expired",
      updatedAt: at,
    };
    state.payments[parsedExpected.requestId] = expired;
    saveOtcState(storage, chainId, selfAddress, state);
    throw new Error("This payment request has expired.");
  }
  const claimed: PaymentRecord = {
    ...current,
    status: "paid",
    paymentOperation: {
      state: "reserved",
      attemptId: createPaymentAttemptId(),
      ...operationTakeSettlement(current.paymentOperation),
      updatedAt: at,
    },
    paymentTxHash: undefined,
    paymentPending: true,
    paymentVerified: false,
    updatedAt: at,
  };
  state.payments[parsedExpected.requestId] = claimed;
  saveOtcState(storage, chainId, selfAddress, state);
  return claimed;
}

export function claimPayment(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  expectedRequest: PaymentRequestPayload,
  at = nowSeconds(),
): PaymentRecord {
  return claimPaymentInternal(
    storage,
    chainId,
    selfAddress,
    expectedRequest,
    at,
  );
}

export function claimMatureInvoicePayment(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  expectedRequest: PaymentRequestPayload,
  headBlock: number,
  at = nowSeconds(),
): PaymentRecord {
  return claimPaymentInternal(
    storage,
    chainId,
    selfAddress,
    expectedRequest,
    at,
    headBlock,
  );
}

export function recordUnverifiedPaymentClaim(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  acceptPayload: AcceptPayload,
  at = nowSeconds(),
): PaymentRecord {
  const accept = parseAcceptPayload(acceptPayload);
  if (!accept) throw new Error("Invalid payment claim payload.");
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.payments[accept.dealId];
  if (!current)
    throw new Error("The referenced payment request is not stored locally.");
  if (paymentRequestIsExpired(current.request, at)) {
    throw new Error("This payment request is no longer payable.");
  }
  resolvePaymentRequestTokenForChain(current.request, chainId);
  const expected: AcceptPayload["transfer"] = {
    token: current.request.token,
    amount: current.request.amount,
    to: current.request.requester,
  };
  if (!transfersEqual(accept.transfer, expected)) {
    throw new Error(
      "Payment claim does not match the requested private transfer.",
    );
  }
  const next: PaymentRecord = {
    ...current,
    counterpartyPaymentClaim: accept,
    updatedAt: at,
  };
  state.payments[current.requestId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

export function markPaymentSubmitted(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  requestId: string,
  transactionHash: string,
  at = nowSeconds(),
): PaymentRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.payments[requestId];
  if (
    !current ||
    current.status !== "paid" ||
    current.paymentOperation?.state !== "reserved" ||
    !isFelt(transactionHash)
  ) {
    throw new Error("No matching reserved payment can be submitted.");
  }
  const next: PaymentRecord = {
    ...current,
    paymentOperation: {
      state: "submitted",
      attemptId: current.paymentOperation.attemptId,
      ...operationTakeSettlement(current.paymentOperation),
      transactionHash,
      updatedAt: at,
    },
    paymentTxHash: transactionHash,
    paymentPending: true,
    paymentVerified: false,
    updatedAt: at,
  };
  state.payments[requestId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

export function confirmPayment(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  requestId: string,
  transactionHash: string,
  receipt: ReceiptPayload,
  at = nowSeconds(),
): PaymentRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.payments[requestId];
  if (
    !current ||
    current.status !== "paid" ||
    current.paymentOperation?.state !== "submitted" ||
    !current.paymentOperation.transactionHash
  ) {
    throw new Error("No submitted payment can be confirmed.");
  }
  if (
    receipt.dealId !== requestId ||
    !isFelt(transactionHash) ||
    !feltEquals(receipt.txHash, transactionHash) ||
    !feltEquals(current.paymentOperation.transactionHash, transactionHash) ||
    (current.paymentTxHash !== undefined &&
      !feltEquals(current.paymentTxHash, transactionHash)) ||
    !transfersEqual(receipt.transfer, {
      token: current.request.token,
      amount: current.request.amount,
      to: current.request.requester,
    })
  ) {
    throw new Error(
      "Payment receipt does not match the requested private transfer.",
    );
  }
  const next: PaymentRecord = {
    ...current,
    receipt,
    paymentOperation: {
      state: "confirmed",
      attemptId: current.paymentOperation.attemptId,
      ...operationTakeSettlement(current.paymentOperation),
      transactionHash,
      updatedAt: at,
    },
    paymentTxHash: transactionHash,
    paymentPending: false,
    paymentVerified: true,
    updatedAt: at,
  };
  state.payments[requestId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

export function markPaymentOutcome(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  requestId: string,
  transactionHash: string,
  outcome: "reverted" | "unknown",
  at = nowSeconds(),
): PaymentRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.payments[requestId];
  if (
    !current ||
    current.status !== "paid" ||
    current.paymentOperation?.state !== "submitted" ||
    !current.paymentOperation.transactionHash ||
    !isFelt(transactionHash) ||
    !feltEquals(current.paymentOperation.transactionHash, transactionHash)
  ) {
    throw new Error("No matching submitted payment can be reconciled.");
  }
  const take = operationTakeSettlement(current.paymentOperation);
  const paymentOperation: ValueOperationRecord =
    outcome === "reverted" && take
      ? {
          state: "awaiting-note-maturity",
          ...take,
          updatedAt: at,
        }
      : {
          state: outcome,
          attemptId: current.paymentOperation.attemptId,
          ...take,
          transactionHash,
          updatedAt: at,
        };
  const next: PaymentRecord = {
    ...current,
    status:
      outcome === "reverted"
        ? paymentRequestIsExpired(current.request, at)
          ? "expired"
          : "requested"
        : "paid",
    paymentOperation,
    paymentTxHash: transactionHash,
    paymentPending: outcome === "unknown",
    paymentVerified: false,
    updatedAt: at,
  };
  state.payments[requestId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

export function releasePayment(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  requestId: string,
  at = nowSeconds(),
): PaymentRecord | undefined {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.payments[requestId];
  if (
    !current ||
    current.status !== "paid" ||
    current.paymentOperation?.state !== "reserved" ||
    !current.paymentPending ||
    current.paymentTxHash
  ) {
    return current;
  }
  const take = operationTakeSettlement(current.paymentOperation);
  const next: PaymentRecord = {
    requestId: current.requestId,
    status: paymentRequestIsExpired(current.request, at)
      ? "expired"
      : "requested",
    request: current.request,
    ...(take
      ? {
          paymentOperation: {
            state: "awaiting-note-maturity" as const,
            ...take,
            updatedAt: at,
          },
        }
      : {}),
    paymentPending: false,
    paymentVerified: false,
    ...(current.origin ? { origin: current.origin } : {}),
    ...(current.linkAuthenticity
      ? { linkAuthenticity: current.linkAuthenticity }
      : {}),
    ...(current.counterpartyPaymentClaim
      ? { counterpartyPaymentClaim: current.counterpartyPaymentClaim }
      : {}),
    updatedAt: at,
  };
  state.payments[requestId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}
