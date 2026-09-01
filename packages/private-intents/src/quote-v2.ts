import { canonicalizeStarknetFelt } from "@app20/domain";
import {
  PrivateIntentError,
  QUOTE_CLOCK_SKEW_SECONDS,
  canonicalSolverQuote,
  isCanonicalQuoteSignature,
  type SolverQuote,
  type StarknetPool,
} from "#index";
import {
  MAX_RFQ_LIFETIME_SECONDS,
  MAX_RESERVATION_LIFETIME_SECONDS,
  resolveMakerQuoteKeyAt,
  type VerifiedMakerDirectoryEpochV1,
} from "#protocol";
import type { ReplayConsumeResult } from "#replay";

export const QUOTE_V2_DOMAIN = "app20/private-intent-quote/v2" as const;
const DIGEST = /^0x[0-9a-fA-F]{64}$/;
const NONCE = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_U256 = (1n << 256n) - 1n;
const QUOTE_V2_WIRE_FIELDS = [
  "buyAmount",
  "buyToken",
  "directoryDigest",
  "directoryEpoch",
  "domain",
  "escrowAddress",
  "escrowClassHash",
  "helper",
  "intentDigest",
  "nonce",
  "pool",
  "pricingProvenance",
  "quoteExpiresAt",
  "quoteKeyId",
  "quotedAt",
  "registryRevision",
  "reservationExpiresAt",
  "reservationFence",
  "reservationId",
  "rfqDigest",
  "sellAmount",
  "sellToken",
  "settlementContextDigest",
  "signature",
  "solverId",
  "spreadBps",
] as const;
const QUOTE_V2_WIRE_FIELD_SET = new Set<string>(QUOTE_V2_WIRE_FIELDS);

export type SolverQuoteV2 = Readonly<
  Omit<SolverQuote, "domain" | "solverKey"> & {
    domain: typeof QUOTE_V2_DOMAIN;
    quoteKeyId: string;
    directoryDigest: string;
    directoryEpoch: number;
    registryRevision: string;
    escrowAddress: string;
    escrowClassHash: string;
    /** Acyclic pre-quote context; the final commitment is built only after selection. */
    settlementContextDigest: string;
    rfqDigest: string;
    /** Monotonic reservation version signed by the maker. */
    reservationFence: bigint;
  }
>;
export type UnsignedSolverQuoteV2 = Omit<SolverQuoteV2, "signature">;
export type SolverQuoteV2Wire = Readonly<
  Omit<SolverQuoteV2, "sellAmount" | "buyAmount" | "reservationFence"> & {
    sellAmount: string;
    buyAmount: string;
    reservationFence: string;
  }
>;

function felt(value: string, label: string): string {
  let result: string;
  try {
    result = canonicalizeStarknetFelt(value);
  } catch {
    throw new PrivateIntentError(`${label} must be a Starknet felt.`);
  }
  if (result === "0x0")
    throw new PrivateIntentError(`${label} must not be zero.`);
  return result;
}
function digest(value: string, label: string): string {
  const result = value.toLowerCase();
  if (!DIGEST.test(result))
    throw new PrivateIntentError(`${label} must be a digest.`);
  return result;
}
function text(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new PrivateIntentError(`${label} is required.`);
  return result;
}
function integer(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new PrivateIntentError(
      `${label} must be a safe integer >= ${minimum}.`,
    );
  return value;
}
function amount(value: bigint, label: string): bigint {
  if (value <= 0n || value > MAX_U256)
    throw new PrivateIntentError(`${label} must be a positive u256 value.`);
  return value;
}

export function canonicalSolverQuoteV2(quote: UnsignedSolverQuoteV2): string {
  if (quote.domain !== QUOTE_V2_DOMAIN)
    throw new PrivateIntentError("Only production quote v2 is accepted.");
  amount(quote.sellAmount, "sellAmount");
  amount(quote.buyAmount, "buyAmount");
  amount(quote.reservationFence, "reservationFence");
  if (!NONCE.test(quote.nonce))
    throw new PrivateIntentError(
      "Quote nonce must be a 32-byte lowercase digest.",
    );
  integer(quote.directoryEpoch, "directoryEpoch");
  integer(quote.spreadBps, "spreadBps");
  integer(quote.quotedAt, "quotedAt", 1);
  integer(quote.quoteExpiresAt, "quoteExpiresAt", 1);
  integer(quote.reservationExpiresAt, "reservationExpiresAt", 1);
  if (
    quote.quoteExpiresAt <= quote.quotedAt ||
    quote.reservationExpiresAt < quote.quoteExpiresAt
  )
    throw new PrivateIntentError(
      "Quote timestamps must be strictly ordered within the reservation window.",
    );
  return JSON.stringify({
    buyAmount: quote.buyAmount.toString(),
    buyToken: felt(quote.buyToken, "buyToken"),
    directoryDigest: digest(quote.directoryDigest, "directoryDigest"),
    directoryEpoch: quote.directoryEpoch,
    domain: quote.domain,
    escrowAddress: felt(quote.escrowAddress, "escrowAddress"),
    escrowClassHash: felt(quote.escrowClassHash, "escrowClassHash"),
    helper: felt(quote.helper, "helper"),
    intentDigest: digest(quote.intentDigest, "intentDigest"),
    nonce: quote.nonce,
    pool: quote.pool,
    pricingProvenance: text(quote.pricingProvenance, "pricingProvenance"),
    quoteExpiresAt: quote.quoteExpiresAt,
    quoteKeyId: text(quote.quoteKeyId, "quoteKeyId"),
    quotedAt: quote.quotedAt,
    registryRevision: text(quote.registryRevision, "registryRevision"),
    reservationExpiresAt: quote.reservationExpiresAt,
    reservationFence: quote.reservationFence.toString(),
    reservationId: digest(quote.reservationId, "reservationId"),
    rfqDigest: digest(quote.rfqDigest, "rfqDigest"),
    sellAmount: quote.sellAmount.toString(),
    sellToken: felt(quote.sellToken, "sellToken"),
    settlementContextDigest: digest(
      quote.settlementContextDigest,
      "settlementContextDigest",
    ),
    solverId: text(quote.solverId, "solverId"),
    spreadBps: quote.spreadBps,
  });
}

export function encodeSolverQuoteV2(quote: SolverQuoteV2): SolverQuoteV2Wire {
  canonicalSolverQuoteV2(quote);
  return Object.freeze({
    ...quote,
    sellAmount: quote.sellAmount.toString(),
    buyAmount: quote.buyAmount.toString(),
    reservationFence: quote.reservationFence.toString(),
  });
}
export function decodeSolverQuoteV2(value: unknown): SolverQuoteV2 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PrivateIntentError("Quote v2 wire payload must be an object.");
  const item = value as Record<string, unknown>;
  for (const field of QUOTE_V2_WIRE_FIELDS) {
    if (!(field in item))
      throw new PrivateIntentError(`Quote v2 ${field} is required.`);
  }
  for (const field of Object.keys(item)) {
    if (!QUOTE_V2_WIRE_FIELD_SET.has(field))
      throw new PrivateIntentError(`Quote v2 field ${field} is unsupported.`);
  }
  if (
    typeof item.sellAmount !== "string" ||
    !DECIMAL.test(item.sellAmount) ||
    typeof item.buyAmount !== "string" ||
    !DECIMAL.test(item.buyAmount) ||
    typeof item.reservationFence !== "string" ||
    !DECIMAL.test(item.reservationFence)
  )
    throw new PrivateIntentError(
      "Quote v2 wire amounts and fence must be canonical decimal strings.",
    );
  const quote = {
    ...item,
    sellAmount: BigInt(item.sellAmount),
    buyAmount: BigInt(item.buyAmount),
    reservationFence: BigInt(item.reservationFence),
  } as SolverQuoteV2;
  if (typeof quote.signature !== "string")
    throw new PrivateIntentError("Quote v2 signature is required.");
  if (!isCanonicalQuoteSignature(quote.signature))
    throw new PrivateIntentError(
      "Quote v2 signature must use canonical raw low-S P-256 encoding.",
    );
  canonicalSolverQuoteV2(quote);
  return Object.freeze(quote);
}
export async function digestSolverQuoteV2(
  quote: SolverQuoteV2,
): Promise<string> {
  if (!isCanonicalQuoteSignature(quote.signature)) {
    throw new PrivateIntentError(
      "Quote v2 digest requires canonical raw low-S P-256 encoding.",
    );
  }
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          canonical: canonicalSolverQuoteV2(quote),
          signature: quote.signature,
        }),
      ),
    ),
  );
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export type AsyncQuoteReplayStore = Readonly<{
  consume(input: {
    quoteKeyId: string;
    nonce: string;
    quoteDigest: string;
    makerId: string;
    now: number;
  }): Promise<ReplayConsumeResult>;
}>;
export function createMemoryQuoteV2ReplayStore(): AsyncQuoteReplayStore {
  const entries = new Map<string, string>();
  return {
    async consume(input) {
      const key = `${input.makerId}:${input.quoteKeyId}:${input.nonce}`;
      const prior = entries.get(key);
      if (!prior) {
        entries.set(key, input.quoteDigest);
        return { kind: "accepted" };
      }
      return prior === input.quoteDigest
        ? { kind: "idempotent", envelopeDigest: prior }
        : { kind: "conflict" };
    },
  };
}

export type QuoteV2Verification = Readonly<{
  directory: VerifiedMakerDirectoryEpochV1;
  expected: Readonly<{
    pool: StarknetPool;
    helper: string;
    intentDigest: string;
    rfqDigest: string;
    directoryDigest: string;
    directoryEpoch: number;
    registryRevision: string;
    escrowAddress: string;
    escrowClassHash: string;
    settlementContextDigest: string;
    sellToken: string;
    sellAmount: bigint;
    buyToken: string;
    minBuyAmount: bigint;
    rfqCreatedAt: number;
    rfqResponseDeadline: number;
    rfqExpiresAt: number;
  }>;
  verify: (
    canonical: string,
    signature: string,
    publicKey: CryptoKey,
  ) => Promise<boolean>;
  importPublicKey: (jwk: JsonWebKey) => Promise<CryptoKey>;
  replay?: AsyncQuoteReplayStore;
}>;

export async function verifySolverQuoteV2(
  quote: SolverQuoteV2,
  now: number,
  input: QuoteV2Verification,
): Promise<"accepted" | "idempotent"> {
  const canonical = canonicalSolverQuoteV2(quote);
  if (!isCanonicalQuoteSignature(quote.signature)) {
    throw new PrivateIntentError(
      "Quote v2 signature must use canonical raw low-S P-256 encoding.",
    );
  }
  integer(now, "now", 1);
  const expected = input.expected;
  integer(expected.rfqCreatedAt, "rfqCreatedAt", 1);
  integer(expected.rfqResponseDeadline, "rfqResponseDeadline", 1);
  integer(expected.rfqExpiresAt, "rfqExpiresAt", 1);
  if (
    expected.rfqResponseDeadline <= expected.rfqCreatedAt ||
    expected.rfqExpiresAt <= expected.rfqResponseDeadline ||
    expected.rfqExpiresAt - expected.rfqCreatedAt > MAX_RFQ_LIFETIME_SECONDS
  )
    throw new PrivateIntentError(
      "Expected RFQ timestamps are not ordered or bounded.",
    );
  if (
    digest(expected.directoryDigest, "expected directoryDigest") !==
      digest(input.directory.digest, "verified directoryDigest") ||
    expected.directoryEpoch !== input.directory.body.epoch ||
    expected.registryRevision !== input.directory.body.registryRevision ||
    expected.pool !== input.directory.body.chainId
  )
    throw new PrivateIntentError(
      "Quote v2 verification context does not match the verified maker directory checkpoint.",
    );
  if (
    quote.pool !== expected.pool ||
    felt(quote.helper, "helper") !== felt(expected.helper, "expected helper") ||
    digest(quote.intentDigest, "intentDigest") !==
      digest(expected.intentDigest, "expected intentDigest") ||
    digest(quote.rfqDigest, "rfqDigest") !==
      digest(expected.rfqDigest, "expected rfqDigest") ||
    digest(quote.directoryDigest, "directoryDigest") !==
      digest(expected.directoryDigest, "expected directoryDigest") ||
    quote.directoryEpoch !== expected.directoryEpoch ||
    quote.registryRevision !== expected.registryRevision ||
    felt(quote.escrowAddress, "escrowAddress") !==
      felt(expected.escrowAddress, "expected escrowAddress") ||
    felt(quote.escrowClassHash, "escrowClassHash") !==
      felt(expected.escrowClassHash, "expected escrowClassHash") ||
    digest(quote.settlementContextDigest, "settlementContextDigest") !==
      digest(
        expected.settlementContextDigest,
        "expected settlementContextDigest",
      ) ||
    felt(quote.sellToken, "sellToken") !==
      felt(expected.sellToken, "expected sellToken") ||
    quote.sellAmount !== expected.sellAmount ||
    felt(quote.buyToken, "buyToken") !==
      felt(expected.buyToken, "expected buyToken") ||
    quote.buyAmount < expected.minBuyAmount
  )
    throw new PrivateIntentError(
      "Quote v2 does not match the authenticated RFQ/settlement context.",
    );
  if (
    input.directory.status !== "active" ||
    now < input.directory.body.validFrom ||
    now >= input.directory.body.validUntil
  )
    throw new PrivateIntentError(
      "Quote v2 requires an active maker directory at verification time.",
    );
  if (
    quote.quotedAt > now + QUOTE_CLOCK_SKEW_SECONDS ||
    quote.quotedAt < expected.rfqCreatedAt - QUOTE_CLOCK_SKEW_SECONDS ||
    now > quote.quotedAt + MAX_RESERVATION_LIFETIME_SECONDS ||
    quote.quoteExpiresAt <= now ||
    quote.reservationExpiresAt <= now ||
    quote.quoteExpiresAt > expected.rfqExpiresAt ||
    quote.reservationExpiresAt > expected.rfqExpiresAt ||
    quote.quoteExpiresAt > input.directory.body.validUntil ||
    quote.reservationExpiresAt > input.directory.body.validUntil ||
    quote.quoteExpiresAt - quote.quotedAt > MAX_RESERVATION_LIFETIME_SECONDS ||
    quote.reservationExpiresAt - quote.quotedAt >
      MAX_RESERVATION_LIFETIME_SECONDS
  )
    throw new PrivateIntentError(
      "Quote v2 is outside its active RFQ, directory, or reservation window.",
    );
  const keyAtQuote = resolveMakerQuoteKeyAt(
    input.directory,
    quote.solverId,
    quote.quoteKeyId,
    quote.quotedAt,
  );
  const keyNow = resolveMakerQuoteKeyAt(
    input.directory,
    quote.solverId,
    quote.quoteKeyId,
    now,
  );
  if (keyAtQuote.keyId !== keyNow.keyId)
    throw new PrivateIntentError("Quote v2 key changed before verification.");
  if (
    !(await input.verify(
      canonical,
      quote.signature,
      await input.importPublicKey(keyNow.publicKey),
    ))
  )
    throw new PrivateIntentError("Quote v2 signature verification failed.");
  if (!input.replay) return "accepted";
  const replay = await input.replay.consume({
    quoteKeyId: quote.quoteKeyId,
    nonce: quote.nonce,
    quoteDigest: await digestSolverQuoteV2(quote),
    makerId: quote.solverId,
    now,
  });
  if (replay.kind === "conflict")
    throw new PrivateIntentError("Quote v2 replay conflict was refused.");
  return replay.kind;
}

export async function selectBestSolverQuoteV2(
  quotes: readonly SolverQuoteV2[],
  now: number,
  input: QuoteV2Verification,
): Promise<SolverQuoteV2> {
  if (!quotes.length)
    throw new PrivateIntentError("No invited-maker quote v2 is available.");
  const identities = new Set<string>();
  for (const quote of quotes) {
    if (identities.has(quote.solverId))
      throw new PrivateIntentError(
        "Only one quote per invited maker is accepted.",
      );
    identities.add(quote.solverId);
    await verifySolverQuoteV2(quote, now, input);
  }
  return [...quotes].sort((a, b) => {
    if (a.buyAmount !== b.buyAmount) return a.buyAmount > b.buyAmount ? -1 : 1;
    if (a.quoteExpiresAt !== b.quoteExpiresAt)
      return a.quoteExpiresAt > b.quoteExpiresAt ? -1 : 1;
    const solverOrder = a.solverId.localeCompare(b.solverId);
    if (solverOrder !== 0) return solverOrder;
    return a.reservationId.localeCompare(b.reservationId);
  })[0]!;
}
export function assertQuoteIsV2(
  value: SolverQuoteV2 | SolverQuote,
): asserts value is SolverQuoteV2 {
  if (value.domain !== QUOTE_V2_DOMAIN) {
    void canonicalSolverQuote(value as SolverQuote);
    throw new PrivateIntentError(
      "Localnet quote v1 cannot settle Escrow VNext.",
    );
  }
}
