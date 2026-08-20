/**
 * APP20 private intents: taker intents over STRK20 notes, solver quotes over
 * an injected pricing source, and a fill-or-refund lifecycle that mirrors the
 * intended Cairo escrow.
 *
 * Boundaries this package refuses to blur:
 * - It never holds value. Settlement authority is the (not yet deployed)
 *   escrow contract; this code builds and validates, fail-closed.
 * - No live NEAR 1Click transport exists here. Pricing is injected; the
 *   dry-only connector can back it in review builds.
 * - Netting reduces amount/timing correlation on the public hedge. It does
 *   not make a same-size instant restock private, and it never claims to.
 */

const INTENT_DOMAIN = "app20/private-intent/v1";
const QUOTE_DOMAIN = "app20/private-intent-quote/v1";

const TOKEN_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;
const MIN_INTENT_ID_LENGTH = 32;

export type StarknetPool =
  | "starknet:SN_MAIN"
  | "starknet:SN_SEPOLIA"
  | "starknet:APP20_LOCALNET";

export interface PrivateSwapIntentV1 {
  readonly version: 1;
  /** Caller-generated, unpredictable, at least 128 bits encoded. */
  readonly intentId: string;
  readonly pool: StarknetPool;
  readonly sellToken: string;
  readonly sellAmount: bigint;
  readonly buyToken: string;
  /** Fail-closed floor the fill must meet inside the escrow. */
  readonly minBuyAmount: bigint;
  /** Unix seconds. After this the locked note is refundable, never fillable. */
  readonly expiresAt: number;
  readonly createdAt: number;
}

export class PrivateIntentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateIntentError";
  }
}

function requireToken(value: string, label: string): string {
  if (!TOKEN_PATTERN.test(value) || BigInt(value) === 0n) {
    throw new PrivateIntentError(
      `${label} must be a non-zero Starknet token address.`,
    );
  }
  return value.toLowerCase();
}

function requireAmount(value: bigint, label: string): bigint {
  if (value <= 0n) {
    throw new PrivateIntentError(`${label} must be greater than zero.`);
  }
  return value;
}

function requireUnixSeconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PrivateIntentError(
      `${label} must be a positive unix-seconds timestamp.`,
    );
  }
  return value;
}

export function assertPrivateSwapIntent(intent: PrivateSwapIntentV1): void {
  if (intent.version !== 1) {
    throw new PrivateIntentError("Only private-intent version 1 is supported.");
  }
  if (
    typeof intent.intentId !== "string" ||
    intent.intentId.length < MIN_INTENT_ID_LENGTH ||
    !/^[a-z0-9-]+$/i.test(intent.intentId)
  ) {
    throw new PrivateIntentError(
      "intentId must encode at least 128 bits of unpredictable input.",
    );
  }
  if (
    intent.pool !== "starknet:SN_MAIN" &&
    intent.pool !== "starknet:SN_SEPOLIA" &&
    intent.pool !== "starknet:APP20_LOCALNET"
  ) {
    throw new PrivateIntentError(
      "pool must name a supported STRK20 deployment.",
    );
  }
  const sellToken = requireToken(intent.sellToken, "sellToken");
  const buyToken = requireToken(intent.buyToken, "buyToken");
  if (sellToken === buyToken) {
    throw new PrivateIntentError("sellToken and buyToken must differ.");
  }
  requireAmount(intent.sellAmount, "sellAmount");
  requireAmount(intent.minBuyAmount, "minBuyAmount");
  requireUnixSeconds(intent.createdAt, "createdAt");
  requireUnixSeconds(intent.expiresAt, "expiresAt");
  if (intent.expiresAt <= intent.createdAt) {
    throw new PrivateIntentError("expiresAt must be after createdAt.");
  }
}

function canonicalIntent(intent: PrivateSwapIntentV1): string {
  return JSON.stringify({
    domain: INTENT_DOMAIN,
    version: intent.version,
    intentId: intent.intentId,
    pool: intent.pool,
    sellToken: intent.sellToken.toLowerCase(),
    sellAmount: intent.sellAmount.toString(),
    buyToken: intent.buyToken.toLowerCase(),
    minBuyAmount: intent.minBuyAmount.toString(),
    expiresAt: intent.expiresAt,
    createdAt: intent.createdAt,
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return `0x${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function digestPrivateSwapIntent(
  intent: PrivateSwapIntentV1,
): Promise<string> {
  assertPrivateSwapIntent(intent);
  return sha256Hex(canonicalIntent(intent));
}

/**
 * Injected pricing. A dry NEAR 1Click adapter, an AVNU read, or a fixture can
 * implement this; the solver never talks to a venue directly from here.
 */
export interface PricingSource {
  price(input: {
    pool: StarknetPool;
    sellToken: string;
    sellAmount: bigint;
    buyToken: string;
  }): Promise<{ buyAmount: bigint; provenance: string }>;
}

export interface SolverQuote {
  readonly domain: typeof QUOTE_DOMAIN;
  readonly intentDigest: string;
  readonly solverId: string;
  /** What the solver commits to deliver. Must satisfy minBuyAmount. */
  readonly buyAmount: bigint;
  readonly spreadBps: number;
  readonly pricingProvenance: string;
  readonly quotedAt: number;
  readonly quoteExpiresAt: number;
}

export type QuoteOutcome =
  | { readonly kind: "quoted"; readonly quote: SolverQuote }
  | { readonly kind: "declined"; readonly reason: string };

export interface QuoteOptions {
  readonly solverId: string;
  readonly spreadBps: number;
  readonly quoteTtlSeconds: number;
  readonly now?: number;
}

export async function quotePrivateSwapIntent(
  intent: PrivateSwapIntentV1,
  pricing: PricingSource,
  options: QuoteOptions,
): Promise<QuoteOutcome> {
  assertPrivateSwapIntent(intent);
  if (!options.solverId.trim()) {
    throw new PrivateIntentError("solverId is required.");
  }
  if (
    !Number.isSafeInteger(options.spreadBps) ||
    options.spreadBps < 0 ||
    options.spreadBps >= 10_000
  ) {
    throw new PrivateIntentError("spreadBps must be an integer in [0, 10000).");
  }
  if (
    !Number.isSafeInteger(options.quoteTtlSeconds) ||
    options.quoteTtlSeconds <= 0
  ) {
    throw new PrivateIntentError("quoteTtlSeconds must be a positive integer.");
  }
  const now = options.now ?? Math.floor(Date.now() / 1_000);
  if (now >= intent.expiresAt) {
    return { kind: "declined", reason: "The intent already expired." };
  }

  const priced = await pricing.price({
    pool: intent.pool,
    sellToken: intent.sellToken,
    sellAmount: intent.sellAmount,
    buyToken: intent.buyToken,
  });
  if (priced.buyAmount <= 0n) {
    return {
      kind: "declined",
      reason: "The pricing source returned no output.",
    };
  }

  const afterSpread =
    (priced.buyAmount * BigInt(10_000 - options.spreadBps)) / 10_000n;
  if (afterSpread < intent.minBuyAmount) {
    return {
      kind: "declined",
      reason: `Best fill after spread is ${afterSpread} — below the intent floor of ${intent.minBuyAmount}.`,
    };
  }

  const quote: SolverQuote = {
    domain: QUOTE_DOMAIN,
    intentDigest: await digestPrivateSwapIntent(intent),
    solverId: options.solverId,
    buyAmount: afterSpread,
    spreadBps: options.spreadBps,
    pricingProvenance: priced.provenance,
    quotedAt: now,
    quoteExpiresAt: Math.min(now + options.quoteTtlSeconds, intent.expiresAt),
  };
  return { kind: "quoted", quote };
}

/**
 * Fill-or-refund lifecycle. This mirrors what the Cairo escrow must enforce:
 * the locked sell note releases only against a fill meeting the intent floor
 * before expiry, and refunds only after expiry. The contract is the
 * authority; this state machine keeps the app and the solver honest before
 * and after that call.
 */
export type IntentState =
  | { readonly kind: "quoted"; readonly quote: SolverQuote }
  | {
      readonly kind: "locked";
      readonly quote: SolverQuote;
      readonly lockedAt: number;
    }
  | {
      readonly kind: "filled";
      readonly quote: SolverQuote;
      readonly deliveredBuyAmount: bigint;
      readonly filledAt: number;
    }
  | {
      readonly kind: "refunded";
      readonly quote: SolverQuote;
      readonly refundedAt: number;
    };

export function acceptQuote(
  intent: PrivateSwapIntentV1,
  quote: SolverQuote,
  now: number,
): IntentState {
  assertPrivateSwapIntent(intent);
  if (now >= quote.quoteExpiresAt) {
    throw new PrivateIntentError("The quote expired before acceptance.");
  }
  if (quote.buyAmount < intent.minBuyAmount) {
    throw new PrivateIntentError("The quote is below the intent floor.");
  }
  return { kind: "locked", quote, lockedAt: now };
}

export function fillLockedIntent(
  intent: PrivateSwapIntentV1,
  state: IntentState,
  deliveredBuyAmount: bigint,
  now: number,
): IntentState {
  if (state.kind !== "locked") {
    throw new PrivateIntentError(
      `Cannot fill an intent in state ${state.kind}.`,
    );
  }
  if (now >= intent.expiresAt) {
    throw new PrivateIntentError(
      "The intent expired; only a refund is possible now.",
    );
  }
  if (deliveredBuyAmount < intent.minBuyAmount) {
    throw new PrivateIntentError(
      "Delivered amount is below the intent floor; the escrow must not release.",
    );
  }
  return {
    kind: "filled",
    quote: state.quote,
    deliveredBuyAmount,
    filledAt: now,
  };
}

export function refundExpiredIntent(
  intent: PrivateSwapIntentV1,
  state: IntentState,
  now: number,
): IntentState {
  if (state.kind !== "locked") {
    throw new PrivateIntentError(
      `Cannot refund an intent in state ${state.kind}.`,
    );
  }
  if (now < intent.expiresAt) {
    throw new PrivateIntentError("The intent has not expired yet.");
  }
  return { kind: "refunded", quote: state.quote, refundedAt: now };
}

/** Inventory-first rule: a solver may only accept what its notes cover. */
export interface InventoryPosition {
  readonly token: string;
  readonly available: bigint;
}

export function assertInventoryCovers(
  inventory: readonly InventoryPosition[],
  buyToken: string,
  buyAmount: bigint,
): void {
  const token = buyToken.toLowerCase();
  const position = inventory.find(
    (entry) => entry.token.toLowerCase() === token,
  );
  const available = position?.available ?? 0n;
  if (available < buyAmount) {
    throw new PrivateIntentError(
      "Solver inventory does not cover this fill. Fill from notes first; never take a note and hedge after.",
    );
  }
}

/**
 * Restock planning. Fills are netted per token; only residuals at or above
 * the batch floor become public restock orders, rounded UP to the standard
 * denomination so order sizes do not mirror any single user intent.
 */
export interface FillRecord {
  readonly sellToken: string;
  readonly sellAmount: bigint;
  readonly buyToken: string;
  readonly buyAmount: bigint;
}

export interface RestockOrder {
  readonly token: string;
  /** Positive: acquire this much. Rounded up to the denomination. */
  readonly amount: bigint;
}

export interface RestockPlan {
  /** Signed per-token exposure after netting. Positive = we owe inventory. */
  readonly netExposure: readonly { token: string; amount: bigint }[];
  readonly orders: readonly RestockOrder[];
  /** Residuals below the batch floor: wait and net further instead of hedging. */
  readonly deferred: readonly { token: string; amount: bigint }[];
}

export function planRestock(
  fills: readonly FillRecord[],
  options: { denomination: bigint; minBatch: bigint },
): RestockPlan {
  if (options.denomination <= 0n) {
    throw new PrivateIntentError("denomination must be greater than zero.");
  }
  if (options.minBatch <= 0n) {
    throw new PrivateIntentError("minBatch must be greater than zero.");
  }

  const exposure = new Map<string, bigint>();
  for (const fill of fills) {
    const bought = fill.buyToken.toLowerCase();
    const sold = fill.sellToken.toLowerCase();
    // We delivered buyToken from inventory (owed back) and received sellToken.
    exposure.set(bought, (exposure.get(bought) ?? 0n) + fill.buyAmount);
    exposure.set(sold, (exposure.get(sold) ?? 0n) - fill.sellAmount);
  }

  const netExposure = [...exposure.entries()]
    .map(([token, amount]) => ({ token, amount }))
    .sort((left, right) => left.token.localeCompare(right.token));

  const orders: RestockOrder[] = [];
  const deferred: { token: string; amount: bigint }[] = [];
  for (const { token, amount } of netExposure) {
    if (amount <= 0n) continue;
    if (amount < options.minBatch) {
      deferred.push({ token, amount });
      continue;
    }
    const units = (amount + options.denomination - 1n) / options.denomination;
    orders.push({ token, amount: units * options.denomination });
  }

  return { netExposure, orders, deferred };
}
