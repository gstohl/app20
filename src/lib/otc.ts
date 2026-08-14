import { feltEquals } from "./addresses";
import { addrSTRK } from "../utils/constants";

export const OTC_STORAGE_PREFIX = "quietline/otc/v1";
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
  /** Accepted on decode for early invoice drafts; new sends use requestId. */
  invoiceId?: string;
};

export type DealStatus =
  | "offered"
  | "accepted"
  | "closed"
  | "declined"
  | "expired";

export type DealRecord = {
  dealId: string;
  status: DealStatus;
  offer: OfferPayload;
  accept?: AcceptPayload;
  receipt?: ReceiptPayload;
  acceptTxHash?: string;
  acceptPending?: boolean;
  updatedAt: number;
};

export type PaymentStatus = "requested" | "paid" | "expired";

export type PaymentRecord = {
  requestId: string;
  status: PaymentStatus;
  request: PaymentRequestPayload;
  receipt?: ReceiptPayload;
  paymentTxHash?: string;
  paymentPending?: boolean;
  updatedAt: number;
};

export type OtcState = {
  version: 1;
  deals: Record<string, DealRecord>;
  payments: Record<string, PaymentRecord>;
};

export type OtcDealEvent =
  | { type: "offer"; payload: OfferPayload }
  | { type: "accept"; payload: AcceptPayload; txHash?: string }
  | { type: "decline"; payload: DeclinePayload }
  | { type: "receipt"; payload: ReceiptPayload }
  | { type: "expire" };

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const BASE_UNITS_PATTERN = /^(?:0|[1-9]\d*)$/;
const MAX_TOKEN_DECIMALS = 255;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFelt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n && parsed < 2n ** 251n;
  } catch {
    return false;
  }
}

export function isRandom32ByteId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isPositiveBaseUnitAmount(value: unknown): value is string {
  return (
    typeof value === "string" &&
    BASE_UNITS_PATTERN.test(value) &&
    BigInt(value) > 0n
  );
}

function parseTokenRef(value: unknown): TokenRef | null {
  if (!isObject(value)) return null;
  if (
    typeof value.symbol !== "string" ||
    !value.symbol.trim() ||
    value.symbol.length > 32 ||
    !isFelt(value.address) ||
    !Number.isInteger(value.decimals) ||
    (value.decimals as number) < 0 ||
    (value.decimals as number) > MAX_TOKEN_DECIMALS
  ) {
    return null;
  }
  return {
    symbol: value.symbol.trim(),
    address: value.address,
    decimals: value.decimals as number,
  };
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
  if (
    !token ||
    !isPositiveBaseUnitAmount(value.amount) ||
    !isFelt(value.to)
  ) {
    return null;
  }
  return { token, amount: value.amount, to: value.to };
}

function optionalShortString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= 512);
}

function isExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseOfferPayload(value: unknown): OfferPayload | null {
  if (!isObject(value)) return null;
  const give = parseLeg(value.give);
  const want = parseLeg(value.want);
  if (
    !isRandom32ByteId(value.dealId) ||
    !give ||
    !want ||
    !isFelt(value.offerer) ||
    !isExpiry(value.expiresAt) ||
    !optionalShortString(value.note)
  ) {
    return null;
  }
  return {
    dealId: value.dealId,
    give,
    want,
    offerer: value.offerer,
    expiresAt: value.expiresAt,
    ...(value.note === undefined ? {} : { note: value.note }),
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
  if (
    !isObject(value) ||
    !isRandom32ByteId(value.dealId) ||
    !optionalShortString(value.reason)
  ) {
    return null;
  }
  return {
    dealId: value.dealId,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
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
  if (
    !requestId ||
    !token ||
    !isPositiveBaseUnitAmount(value.amount) ||
    !optionalShortString(value.memo) ||
    !isExpiry(value.expiresAt) ||
    !isFelt(value.requester)
  ) {
    return null;
  }
  return {
    requestId,
    token,
    amount: value.amount,
    expiresAt: value.expiresAt,
    requester: value.requester,
    ...(value.memo === undefined ? {} : { memo: value.memo }),
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

export function parseDecimalToBaseUnits(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
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
  return units.toString();
}

export function formatBaseUnits(amount: string, decimals: number): string {
  if (!BASE_UNITS_PATTERN.test(amount)) return amount;
  if (!Number.isInteger(decimals) || decimals <= 0) return BigInt(amount).toString();
  const padded = amount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${BigInt(whole).toString()}.${fraction}` : BigInt(whole).toString();
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
  if (!feltEquals(offer.give.token.address, addrSTRK)) {
    throw new Error("Quietline OTC v1 can settle only STRK on the give leg.");
  }
}

function assertPaysStrk(request: PaymentRequestPayload): void {
  if (!feltEquals(request.token.address, addrSTRK)) {
    throw new Error("Quietline payment v1 can pay only STRK invoices.");
  }
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
      token: offer.give.token,
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
    throw new Error("A valid id and transaction hash are required for a receipt.");
  }
  return {
    dealId: id,
    txHash,
    transfer,
    warning: ONE_SIDED_WARNING,
  };
}

function transfersEqual(
  left: AcceptPayload["transfer"],
  right: AcceptPayload["transfer"],
): boolean {
  return (
    feltEquals(left.token.address, right.token.address) &&
    left.token.decimals === right.token.decimals &&
    left.amount === right.amount &&
    feltEquals(left.to, right.to)
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
      if (current.dealId === offer.dealId) return current;
      throw new Error("Cannot replace an existing deal with another offer.");
    }
    return {
      dealId: offer.dealId,
      status: offerIsExpired(offer, at) ? "expired" : "offered",
      offer,
      updatedAt: at,
    };
  }

  if (!current) throw new Error("The referenced OTC offer is not stored locally.");

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

  if (event.type === "accept") {
    if (current.status === "accepted" || current.status === "closed") return current;
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
      ...(event.txHash === undefined ? {} : { acceptTxHash: event.txHash }),
      acceptPending: false,
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

  if (current.status === "closed") return current;
  if (current.status !== "accepted" || !current.accept) {
    throw new Error(`Cannot close a ${current.status} deal.`);
  }
  const receipt = parseReceiptPayload(event.payload);
  if (
    !receipt ||
    !transfersEqual(receipt.transfer, current.accept.transfer)
  ) {
    throw new Error("Receipt does not match the accepted STRK transfer.");
  }
  return {
    ...current,
    status: "closed",
    receipt,
    acceptTxHash: current.acceptTxHash ?? receipt.txHash,
    acceptPending: false,
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
  if (!dealId) throw new Error("recordDealEvent requires an event with a dealId.");
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
  if (!current) throw new Error("The referenced OTC offer is not stored locally.");
  if (current.status !== "offered" || current.acceptPending) {
    throw new Error("This deal was already accepted; no second transfer was sent.");
  }
  const next = transitionDeal(current, { type: "accept", payload: accept }, at);
  const claimed = { ...next, acceptPending: true };
  state.deals[accept.dealId] = claimed;
  saveOtcState(storage, chainId, selfAddress, state);
  return claimed;
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
  if (!current || current.status !== "accepted" || !current.accept) {
    throw new Error("No reserved OTC accept can be confirmed.");
  }
  const next = {
    ...current,
    acceptTxHash: transactionHash,
    acceptPending: false,
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
    !current.acceptPending ||
    current.acceptTxHash
  ) {
    return current;
  }
  const next: DealRecord = {
    dealId: current.dealId,
    status: offerIsExpired(current.offer, at) ? "expired" : "offered",
    offer: current.offer,
    updatedAt: at,
  };
  state.deals[dealId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}

export function recordPaymentRequest(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  request: PaymentRequestPayload,
  at = nowSeconds(),
): PaymentRecord {
  const parsed = parsePaymentRequestPayload(request);
  if (!parsed) throw new Error("Invalid payment request payload.");
  const state = loadOtcState(storage, chainId, selfAddress);
  const existing = state.payments[parsed.requestId];
  if (existing) return existing;
  const record: PaymentRecord = {
    requestId: parsed.requestId,
    status: paymentRequestIsExpired(parsed, at) ? "expired" : "requested",
    request: parsed,
    updatedAt: at,
  };
  state.payments[parsed.requestId] = record;
  saveOtcState(storage, chainId, selfAddress, state);
  return record;
}

export function claimPayment(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  requestId: string,
  at = nowSeconds(),
): PaymentRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.payments[requestId];
  if (!current || current.status !== "requested" || current.paymentPending) {
    throw new Error("This request was already paid; no second transfer was sent.");
  }
  assertPaysStrk(current.request);
  if (paymentRequestIsExpired(current.request, at)) {
    const expired: PaymentRecord = {
      ...current,
      status: "expired",
      updatedAt: at,
    };
    state.payments[requestId] = expired;
    saveOtcState(storage, chainId, selfAddress, state);
    throw new Error("This payment request has expired.");
  }
  const claimed: PaymentRecord = {
    ...current,
    status: "paid",
    paymentPending: true,
    updatedAt: at,
  };
  state.payments[requestId] = claimed;
  saveOtcState(storage, chainId, selfAddress, state);
  return claimed;
}

export function recordPaymentTransfer(
  storage: StorageLike,
  chainId: string,
  selfAddress: string,
  accept: AcceptPayload,
  transactionHash: string,
  at = nowSeconds(),
): PaymentRecord {
  const state = loadOtcState(storage, chainId, selfAddress);
  const current = state.payments[accept.dealId];
  if (!current) throw new Error("The referenced payment request is not stored locally.");
  if (current.status === "paid") return current;
  if (current.status !== "requested" || paymentRequestIsExpired(current.request, at)) {
    throw new Error("This payment request is no longer payable.");
  }
  assertPaysStrk(current.request);
  const expected: AcceptPayload["transfer"] = {
    token: current.request.token,
    amount: current.request.amount,
    to: current.request.requester,
  };
  if (!transfersEqual(accept.transfer, expected)) {
    throw new Error("Payment memo does not match the requested STRK transfer.");
  }
  const receipt = receiptForTransfer(
    current.requestId,
    accept.transfer,
    transactionHash,
  );
  const next: PaymentRecord = {
    ...current,
    status: "paid",
    receipt,
    paymentTxHash: transactionHash,
    paymentPending: false,
    updatedAt: at,
  };
  state.payments[current.requestId] = next;
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
  if (!current || current.status !== "paid") {
    throw new Error("No reserved payment can be confirmed.");
  }
  if (
    receipt.dealId !== requestId ||
    receipt.txHash !== transactionHash ||
    !transfersEqual(receipt.transfer, {
      token: current.request.token,
      amount: current.request.amount,
      to: current.request.requester,
    })
  ) {
    throw new Error("Payment receipt does not match the requested STRK transfer.");
  }
  const next: PaymentRecord = {
    ...current,
    receipt,
    paymentTxHash: transactionHash,
    paymentPending: false,
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
    !current.paymentPending ||
    current.paymentTxHash
  ) {
    return current;
  }
  const next: PaymentRecord = {
    ...current,
    status: paymentRequestIsExpired(current.request, at)
      ? "expired"
      : "requested",
    paymentPending: false,
    updatedAt: at,
  };
  state.payments[requestId] = next;
  saveOtcState(storage, chainId, selfAddress, state);
  return next;
}
