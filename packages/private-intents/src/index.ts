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
 * - Quotes are worthless until a solver key signs the canonical payload.
 *   A digest proves consistency; only the signature proves authenticity.
 */

import { canonicalizeStarknetFelt, starknetFeltEquals } from "@app20/domain";

export const INTENT_DOMAIN = "app20/private-intent/v1";
export const QUOTE_DOMAIN = "app20/private-intent-quote/v1";
export const LOCALNET_SOLVER_ID = "app20-localnet-solver";
export const LOCALNET_SOLVER_KEY_ID = "app20-localnet-solver/ecdsa-p256-v1";
export const QUOTE_CLOCK_SKEW_SECONDS = 30;

const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-f]+$/;
const MIN_INTENT_ID_LENGTH = 32;
const ECDSA_PARAMS = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

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
  try {
    const token = canonicalizeStarknetFelt(value);
    if (token === "0x0") throw new Error();
    return token;
  } catch {
    throw new PrivateIntentError(
      `${label} must be a non-zero Starknet token address.`,
    );
  }
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
    sellToken: requireToken(intent.sellToken, "sellToken"),
    sellAmount: intent.sellAmount.toString(),
    buyToken: requireToken(intent.buyToken, "buyToken"),
    minBuyAmount: intent.minBuyAmount.toString(),
    expiresAt: intent.expiresAt,
    createdAt: intent.createdAt,
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!SIGNATURE_PATTERN.test(hex) || hex.length < 4 || hex.length % 2 !== 0) {
    return null;
  }
  const body = hex.slice(2);
  const bytes = new Uint8Array(body.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(value)) return null;
    bytes[index] = value;
  }
  return bytes;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return `0x${bytesToHex(new Uint8Array(digest))}`;
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
  readonly pool: StarknetPool;
  readonly helper: string;
  readonly sellToken: string;
  readonly sellAmount: bigint;
  readonly buyToken: string;
  readonly intentDigest: string;
  readonly solverId: string;
  readonly solverKey: string;
  readonly nonce: string;
  /** What the solver commits to deliver. Must satisfy minBuyAmount. */
  readonly buyAmount: bigint;
  readonly spreadBps: number;
  readonly pricingProvenance: string;
  readonly quotedAt: number;
  readonly quoteExpiresAt: number;
  readonly signature: string;
}

export type UnsignedSolverQuote = Omit<SolverQuote, "signature">;

export type QuoteOutcome =
  | { readonly kind: "quoted"; readonly quote: SolverQuote }
  | { readonly kind: "declined"; readonly reason: string };

export interface QuoteReplayStore {
  consume(nonce: string): boolean;
}

export function createMemoryQuoteReplayStore(): QuoteReplayStore {
  const seen = new Set<string>();
  return {
    consume(nonce) {
      if (seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    },
  };
}

export interface QuoteOptions {
  readonly solverId: string;
  readonly solverKey: string;
  readonly helper: string;
  readonly spreadBps: number;
  readonly quoteTtlSeconds: number;
  readonly now?: number;
  readonly nonce?: string;
  readonly sign: (
    canonical: string,
    quote: UnsignedSolverQuote,
  ) => Promise<string>;
}

export interface QuoteAcceptance {
  readonly helper: string;
  readonly verify: (
    canonical: string,
    signature: string,
    solverKey: string,
  ) => Promise<boolean>;
  readonly consumeNonce: (nonce: string) => boolean;
}

export function createQuoteNonce(): string {
  return `0x${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function canonicalSolverQuote(quote: UnsignedSolverQuote): string {
  return JSON.stringify({
    buyAmount: quote.buyAmount.toString(),
    buyToken: requireToken(quote.buyToken, "buyToken"),
    domain: quote.domain,
    helper: requireToken(quote.helper, "helper"),
    intentDigest: quote.intentDigest.toLowerCase(),
    nonce: quote.nonce.toLowerCase(),
    pool: quote.pool,
    pricingProvenance: quote.pricingProvenance,
    quoteExpiresAt: quote.quoteExpiresAt,
    quotedAt: quote.quotedAt,
    sellAmount: quote.sellAmount.toString(),
    sellToken: requireToken(quote.sellToken, "sellToken"),
    solverId: quote.solverId,
    solverKey: quote.solverKey,
    spreadBps: quote.spreadBps,
  });
}

export async function importQuotePrivateKey(
  jwk: JsonWebKey,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDSA_PARAMS, false, ["sign"]);
}

export async function importQuotePublicKey(
  jwk: JsonWebKey,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDSA_PARAMS, true, ["verify"]);
}

export async function signCanonicalQuote(
  canonical: string,
  privateKey: CryptoKey,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    ECDSA_SIGN,
    privateKey,
    new TextEncoder().encode(canonical),
  );
  return `0x${bytesToHex(new Uint8Array(signature))}`;
}

export async function verifyCanonicalQuote(
  canonical: string,
  signature: string,
  publicKey: CryptoKey,
): Promise<boolean> {
  const bytes = hexToBytes(signature);
  if (!bytes) return false;
  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return await crypto.subtle.verify(
      ECDSA_SIGN,
      publicKey,
      copy,
      new TextEncoder().encode(canonical),
    );
  } catch {
    return false;
  }
}

function assertQuoteShape(quote: UnsignedSolverQuote): void {
  if (quote.domain !== QUOTE_DOMAIN) {
    throw new PrivateIntentError(
      "The quote is outside the APP20 quote domain.",
    );
  }
  if (!quote.solverId.trim()) {
    throw new PrivateIntentError("The quote is missing a solver identity.");
  }
  if (!quote.solverKey.trim()) {
    throw new PrivateIntentError("The quote is missing a solver key.");
  }
  requireToken(quote.helper, "helper");
  requireToken(quote.sellToken, "sellToken");
  requireToken(quote.buyToken, "buyToken");
  requireAmount(quote.sellAmount, "sellAmount");
  requireAmount(quote.buyAmount, "buyAmount");
  requireUnixSeconds(quote.quotedAt, "quotedAt");
  requireUnixSeconds(quote.quoteExpiresAt, "quoteExpiresAt");
  if (!NONCE_PATTERN.test(quote.nonce)) {
    throw new PrivateIntentError(
      "The quote nonce must be 32 unpredictable bytes.",
    );
  }
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
  if (!options.solverKey.trim()) {
    throw new PrivateIntentError("solverKey is required.");
  }
  requireToken(options.helper, "helper");
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

  const unsigned: UnsignedSolverQuote = {
    domain: QUOTE_DOMAIN,
    pool: intent.pool,
    helper: requireToken(options.helper, "helper"),
    sellToken: requireToken(intent.sellToken, "sellToken"),
    sellAmount: intent.sellAmount,
    buyToken: requireToken(intent.buyToken, "buyToken"),
    intentDigest: await digestPrivateSwapIntent(intent),
    solverId: options.solverId,
    solverKey: options.solverKey,
    nonce: options.nonce ?? createQuoteNonce(),
    buyAmount: afterSpread,
    spreadBps: options.spreadBps,
    pricingProvenance: priced.provenance,
    quotedAt: now,
    quoteExpiresAt: Math.min(now + options.quoteTtlSeconds, intent.expiresAt),
  };
  assertQuoteShape(unsigned);
  const signature = (
    await options.sign(canonicalSolverQuote(unsigned), unsigned)
  )
    .trim()
    .toLowerCase();
  if (!SIGNATURE_PATTERN.test(signature)) {
    throw new PrivateIntentError("The solver returned an unusable signature.");
  }
  return { kind: "quoted", quote: { ...unsigned, signature } };
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

export async function acceptQuote(
  intent: PrivateSwapIntentV1,
  quote: SolverQuote,
  now: number,
  acceptance: QuoteAcceptance,
): Promise<IntentState> {
  assertPrivateSwapIntent(intent);
  assertQuoteShape(quote);
  if (!starknetFeltEquals(quote.helper, acceptance.helper)) {
    throw new PrivateIntentError("The quote is bound to a different helper.");
  }
  if (quote.pool !== intent.pool) {
    throw new PrivateIntentError("The quote is bound to a different pool.");
  }
  if (
    !starknetFeltEquals(quote.sellToken, intent.sellToken) ||
    !starknetFeltEquals(quote.buyToken, intent.buyToken) ||
    quote.sellAmount !== intent.sellAmount
  ) {
    throw new PrivateIntentError("The quote does not bind these trade terms.");
  }
  if (now + QUOTE_CLOCK_SKEW_SECONDS < quote.quotedAt) {
    throw new PrivateIntentError("The quote is dated in the future.");
  }
  if (now >= quote.quoteExpiresAt || now >= intent.expiresAt) {
    throw new PrivateIntentError("The quote expired before acceptance.");
  }
  if (quote.buyAmount < intent.minBuyAmount) {
    throw new PrivateIntentError("The quote is below the intent floor.");
  }
  const digest = await digestPrivateSwapIntent(intent);
  if (digest !== quote.intentDigest) {
    throw new PrivateIntentError("The quote does not bind this intent digest.");
  }
  const canonical = canonicalSolverQuote(quote);
  const authentic = await acceptance.verify(
    canonical,
    quote.signature,
    quote.solverKey,
  );
  if (!authentic) {
    throw new PrivateIntentError("The quote signature is not authentic.");
  }
  if (!acceptance.consumeNonce(quote.nonce)) {
    throw new PrivateIntentError("The quote nonce was already consumed.");
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
  if (
    deliveredBuyAmount < intent.minBuyAmount ||
    deliveredBuyAmount < state.quote.buyAmount
  ) {
    throw new PrivateIntentError(
      "Delivered amount is below the quoted fill; the escrow must not release.",
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
  const token = requireToken(buyToken, "buyToken");
  const position = inventory.find((entry) =>
    starknetFeltEquals(entry.token, token),
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
    const bought = requireToken(fill.buyToken, "buyToken");
    const sold = requireToken(fill.sellToken, "sellToken");
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
