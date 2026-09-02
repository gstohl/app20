import { canonicalizeStarknetFelt } from "@app20/domain";
import {
  PrivateIntentError,
  QUOTE_CLOCK_SKEW_SECONDS,
  isCanonicalQuoteSignature,
  type StarknetPool,
} from "./index.ts";
import {
  assertPrivateRfqV2,
  digestPrivateRfqV2,
  type PrivateRfqV2,
} from "./rfq-v2.ts";
import { assertPriceSchedule, type PriceSchedule } from "./schedule.ts";

export const QUOTE_V3_DOMAIN = "app20/private-intent-quote/v3" as const;

export type SolverQuoteV3 = Readonly<{
  domain: typeof QUOTE_V3_DOMAIN;
  version: 3;
  solverId: string;
  quoteKeyId: string;
  nonce: string;
  pool: StarknetPool;
  helper: string;
  escrowAddress: string;
  rfqDigest: string;
  rfqFelt: string;
  sellToken: string;
  buyToken: string;
  schedule: PriceSchedule;
  lockId: string;
  lockTicket: string;
  lockTransactionHash: string;
  lockExpiresAt: number;
  spreadBps: number;
  pricingProvenance: string;
  quotedAt: number;
  quoteExpiresAt: number;
  signature: string;
}>;

export type UnsignedSolverQuoteV3 = Omit<SolverQuoteV3, "signature">;
export type SolverQuoteV3Wire = Readonly<
  Omit<SolverQuoteV3, "schedule"> & {
    schedule: readonly Readonly<{ a: string; b: string }>[];
  }
>;

export type SolverQuoteV3LockOnChain = Readonly<{
  rfqId: string;
  takerCommitment: string;
  tokenA: string;
  tokenB: string;
  expiry: number;
  schedule: PriceSchedule;
  remainingB: bigint;
  status: "open";
}>;

export type SolverQuoteV3Verification = Readonly<{
  rfq: PrivateRfqV2;
  importPublicKey: (jwk: JsonWebKey) => Promise<CryptoKey>;
  verify: (
    canonical: string,
    signature: string,
    publicKey: CryptoKey,
  ) => Promise<boolean>;
  resolveKey: (
    solverId: string,
    quoteKeyId: string,
    at: number,
  ) => JsonWebKey | Promise<JsonWebKey>;
  lockOnChain: SolverQuoteV3LockOnChain;
}>;

const DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const MAX_U128 = (1n << 128n) - 1n;
const QUOTE_V3_WIRE_FIELDS = [
  "buyToken",
  "domain",
  "escrowAddress",
  "helper",
  "lockExpiresAt",
  "lockId",
  "lockTicket",
  "lockTransactionHash",
  "nonce",
  "pool",
  "pricingProvenance",
  "quoteExpiresAt",
  "quoteKeyId",
  "quotedAt",
  "rfqDigest",
  "rfqFelt",
  "schedule",
  "sellToken",
  "signature",
  "solverId",
  "spreadBps",
  "version",
] as const;
const QUOTE_V3_WIRE_FIELD_SET = new Set<string>(QUOTE_V3_WIRE_FIELDS);
const SCHEDULE_POINT_FIELDS = new Set(["a", "b"]);

function requireFelt(value: string, label: string, allowZero = false): string {
  let felt: string;
  try {
    felt = canonicalizeStarknetFelt(value);
  } catch {
    throw new PrivateIntentError(`${label} must be a Starknet felt.`);
  }
  if (!allowZero && felt === "0x0") {
    throw new PrivateIntentError(`${label} must not be zero.`);
  }
  return felt;
}

function requireDigest(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new PrivateIntentError(`${label} must be a 32-byte hex digest.`);
  }
  return normalized;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new PrivateIntentError(`${label} is required.`);
  return normalized;
}

function requireInteger(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new PrivateIntentError(
      `${label} must be a safe integer >= ${minimum}.`,
    );
  }
  return value;
}

function requirePool(value: StarknetPool): StarknetPool {
  if (
    value !== "starknet:SN_MAIN" &&
    value !== "starknet:SN_SEPOLIA" &&
    value !== "starknet:APP20_LOCALNET"
  ) {
    throw new PrivateIntentError(
      "pool must name a supported STRK20 deployment.",
    );
  }
  return value;
}

function canonicalSchedule(schedule: PriceSchedule) {
  assertPriceSchedule(schedule);
  return schedule.map((point) => ({
    a: point.a.toString(),
    b: point.b.toString(),
  }));
}

function canonicalBody(quote: UnsignedSolverQuoteV3) {
  if (quote.domain !== QUOTE_V3_DOMAIN || quote.version !== 3) {
    throw new PrivateIntentError("Only solver quote v3 is supported.");
  }
  if (!NONCE_PATTERN.test(quote.nonce)) {
    throw new PrivateIntentError(
      "Quote v3 nonce must be a 32-byte lowercase digest.",
    );
  }
  const sellToken = requireFelt(quote.sellToken, "sellToken");
  const buyToken = requireFelt(quote.buyToken, "buyToken");
  if (sellToken === buyToken) {
    throw new PrivateIntentError("sellToken and buyToken must differ.");
  }
  const lockExpiresAt = requireInteger(quote.lockExpiresAt, "lockExpiresAt", 1);
  const quotedAt = requireInteger(quote.quotedAt, "quotedAt", 1);
  const quoteExpiresAt = requireInteger(
    quote.quoteExpiresAt,
    "quoteExpiresAt",
    1,
  );
  if (quoteExpiresAt <= quotedAt || quoteExpiresAt > lockExpiresAt) {
    throw new PrivateIntentError(
      "Quote v3 expiry must be after quoting and no later than its lock expiry.",
    );
  }
  const spreadBps = requireInteger(quote.spreadBps, "spreadBps");
  if (spreadBps >= 10_000) {
    throw new PrivateIntentError("spreadBps must be an integer in [0, 10000).");
  }
  return {
    buyToken,
    domain: quote.domain,
    escrowAddress: requireFelt(quote.escrowAddress, "escrowAddress"),
    helper: requireFelt(quote.helper, "helper"),
    lockExpiresAt,
    lockId: requireFelt(quote.lockId, "lockId"),
    lockTicket: requireFelt(quote.lockTicket, "lockTicket"),
    lockTransactionHash: requireFelt(
      quote.lockTransactionHash,
      "lockTransactionHash",
    ),
    nonce: quote.nonce,
    pool: requirePool(quote.pool),
    pricingProvenance: requireText(
      quote.pricingProvenance,
      "pricingProvenance",
    ),
    quoteExpiresAt,
    quoteKeyId: requireText(quote.quoteKeyId, "quoteKeyId"),
    quotedAt,
    rfqDigest: requireDigest(quote.rfqDigest, "rfqDigest"),
    rfqFelt: requireFelt(quote.rfqFelt, "rfqFelt"),
    schedule: canonicalSchedule(quote.schedule),
    sellToken,
    solverId: requireText(quote.solverId, "solverId"),
    spreadBps,
    version: quote.version,
  };
}

export function canonicalSolverQuoteV3(quote: UnsignedSolverQuoteV3): string {
  return JSON.stringify(canonicalBody(quote));
}

export function encodeSolverQuoteV3(quote: SolverQuoteV3): SolverQuoteV3Wire {
  const body = canonicalBody(quote);
  if (!isCanonicalQuoteSignature(quote.signature)) {
    throw new PrivateIntentError(
      "Quote v3 signature must use canonical raw low-S P-256 encoding.",
    );
  }
  return Object.freeze({
    ...body,
    schedule: Object.freeze(
      body.schedule.map((point) => Object.freeze({ ...point })),
    ),
    signature: quote.signature,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeSchedule(value: unknown): PriceSchedule {
  if (!Array.isArray(value)) {
    throw new PrivateIntentError("Quote v3 wire schedule must be an array.");
  }
  const schedule = value.map((point, index) => {
    if (!isRecord(point)) {
      throw new PrivateIntentError(
        `Quote v3 schedule point ${index} must be an object.`,
      );
    }
    for (const field of ["a", "b"] as const) {
      if (!(field in point)) {
        throw new PrivateIntentError(
          `Quote v3 schedule point ${index}.${field} is required.`,
        );
      }
    }
    for (const field of Object.keys(point)) {
      if (!SCHEDULE_POINT_FIELDS.has(field)) {
        throw new PrivateIntentError(
          `Quote v3 schedule point field ${field} is unsupported.`,
        );
      }
    }
    if (
      typeof point.a !== "string" ||
      !DECIMAL_PATTERN.test(point.a) ||
      typeof point.b !== "string" ||
      !DECIMAL_PATTERN.test(point.b)
    ) {
      throw new PrivateIntentError(
        "Quote v3 wire schedule values must be canonical decimal strings.",
      );
    }
    return Object.freeze({ a: BigInt(point.a), b: BigInt(point.b) });
  });
  assertPriceSchedule(schedule);
  return Object.freeze(schedule);
}

export function decodeSolverQuoteV3(value: unknown): SolverQuoteV3 {
  if (!isRecord(value)) {
    throw new PrivateIntentError("Quote v3 wire payload must be an object.");
  }
  for (const field of QUOTE_V3_WIRE_FIELDS) {
    if (!(field in value)) {
      throw new PrivateIntentError(`Quote v3 ${field} is required.`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!QUOTE_V3_WIRE_FIELD_SET.has(field)) {
      throw new PrivateIntentError(`Quote v3 field ${field} is unsupported.`);
    }
  }
  const quote = {
    ...value,
    schedule: decodeSchedule(value.schedule),
  } as SolverQuoteV3;
  if (typeof quote.signature !== "string") {
    throw new PrivateIntentError("Quote v3 signature is required.");
  }
  if (!isCanonicalQuoteSignature(quote.signature)) {
    throw new PrivateIntentError(
      "Quote v3 signature must use canonical raw low-S P-256 encoding.",
    );
  }
  canonicalBody(quote);
  return Object.freeze(quote);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestSolverQuoteV3(
  quote: UnsignedSolverQuoteV3 | SolverQuoteV3,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalSolverQuoteV3(quote)),
  );
  return `0x${bytesToHex(new Uint8Array(digest))}`;
}

function schedulesEqual(left: PriceSchedule, right: PriceSchedule): boolean {
  try {
    return (
      JSON.stringify(canonicalSchedule(left)) ===
      JSON.stringify(canonicalSchedule(right))
    );
  } catch {
    return false;
  }
}

function sameJwk(left: JsonWebKey, right: JsonWebKey): boolean {
  return (
    left.kty === right.kty &&
    left.crv === right.crv &&
    left.x === right.x &&
    left.y === right.y
  );
}

export async function verifySolverQuoteV3(
  quote: SolverQuoteV3,
  now: number,
  input: SolverQuoteV3Verification,
): Promise<void> {
  const canonical = canonicalSolverQuoteV3(quote);
  if (!isCanonicalQuoteSignature(quote.signature)) {
    throw new PrivateIntentError(
      "Quote v3 signature must use canonical raw low-S P-256 encoding.",
    );
  }
  requireInteger(now, "now", 1);
  assertPrivateRfqV2(input.rfq);
  const expectedRfqDigest = await digestPrivateRfqV2(input.rfq);
  const firstPoint = quote.schedule[0]!;
  const lastPoint = quote.schedule[quote.schedule.length - 1]!;
  if (
    quote.pool !== input.rfq.chainId ||
    requireFelt(quote.helper, "helper") !==
      requireFelt(input.rfq.settlementHelper, "settlementHelper") ||
    requireFelt(quote.escrowAddress, "escrowAddress") !==
      requireFelt(input.rfq.settlementHelper, "settlementHelper") ||
    requireDigest(quote.rfqDigest, "rfqDigest") !== expectedRfqDigest ||
    requireFelt(quote.rfqFelt, "rfqFelt") !==
      requireFelt(input.rfq.rfqFelt, "rfqFelt") ||
    requireFelt(quote.sellToken, "sellToken") !==
      requireFelt(input.rfq.sellToken, "sellToken") ||
    requireFelt(quote.buyToken, "buyToken") !==
      requireFelt(input.rfq.buyToken, "buyToken") ||
    quote.lockExpiresAt !== input.rfq.lockExpiresAt ||
    firstPoint.a < input.rfq.sellBucketMinBaseUnits ||
    lastPoint.a > input.rfq.sellBucketMaxBaseUnits
  ) {
    throw new PrivateIntentError(
      "Quote v3 does not match the authenticated RFQ context.",
    );
  }
  if (
    quote.quotedAt > now + QUOTE_CLOCK_SKEW_SECONDS ||
    quote.quotedAt < input.rfq.createdAt - QUOTE_CLOCK_SKEW_SECONDS ||
    quote.quotedAt > input.rfq.responseDeadline + QUOTE_CLOCK_SKEW_SECONDS ||
    now >= quote.quoteExpiresAt ||
    now >= input.rfq.expiresAt ||
    quote.quoteExpiresAt > input.rfq.expiresAt
  ) {
    throw new PrivateIntentError(
      "Quote v3 is outside its active RFQ or lock window.",
    );
  }

  const lock = input.lockOnChain;
  if (
    lock.status !== "open" ||
    requireFelt(lock.rfqId, "lock.rfqId") !==
      requireFelt(input.rfq.rfqFelt, "rfqFelt") ||
    requireFelt(lock.takerCommitment, "lock.takerCommitment", true) !==
      requireFelt(input.rfq.takerCommitment, "takerCommitment", true) ||
    requireFelt(lock.tokenA, "lock.tokenA") !==
      requireFelt(input.rfq.sellToken, "sellToken") ||
    requireFelt(lock.tokenB, "lock.tokenB") !==
      requireFelt(input.rfq.buyToken, "buyToken") ||
    lock.expiry !== quote.lockExpiresAt ||
    !schedulesEqual(lock.schedule, quote.schedule) ||
    typeof lock.remainingB !== "bigint" ||
    lock.remainingB < lastPoint.b ||
    lock.remainingB > MAX_U128
  ) {
    throw new PrivateIntentError(
      "Quote v3 does not match its open on-chain lock.",
    );
  }

  const keyAtQuote = await input.resolveKey(
    quote.solverId,
    quote.quoteKeyId,
    quote.quotedAt,
  );
  const keyNow = await input.resolveKey(quote.solverId, quote.quoteKeyId, now);
  if (!sameJwk(keyAtQuote, keyNow)) {
    throw new PrivateIntentError("Quote v3 key changed before verification.");
  }
  const publicKey = await input.importPublicKey(keyNow);
  if (!(await input.verify(canonical, quote.signature, publicKey))) {
    throw new PrivateIntentError("Quote v3 signature verification failed.");
  }
}
