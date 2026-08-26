import {
  canonicalizeStarknetFelt,
  formatTokenAmount as formatCanonicalTokenAmount,
  parseTokenAmount as parseCanonicalTokenAmount,
} from "@app20/domain";
import type { WALLET_API } from "@starknet-io/types-js";
import type { UnsignedSolverQuote } from "@app20/private-intents";
import {
  buildEscrowClaimActions,
  buildEscrowTimeoutActions,
} from "@/lib/escrow-actions";

const API_BASE =
  import.meta.env.VITE_E2E_WALLET === true
    ? import.meta.env.VITE_LOCALNET_WALLET_URL
    : import.meta.env.MODE === "test"
      ? "http://app20.test"
      : "";

export type LocalnetSolverOffer = {
  solverId: string;
  solverKey: string;
  grossBuyAmount: bigint;
  sellToken: string;
  buyToken: string;
  spreadBps: number;
  provenance: string;
  nonce: string;
  reservationId: string;
  reservationExpiresAt: number;
};

export type LocalnetIntentTerms = {
  dealId: string;
  intentDigest: string;
  solverId: string;
  reservationId: string;
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  buyAmount: bigint;
};

export type LocalnetMarketToken = {
  symbol: "STRK" | "USDC";
  address: string;
  decimals: 6 | 18;
};

export function parseLocalnetTokenAmount(
  value: string,
  token: LocalnetMarketToken,
): bigint {
  try {
    return parseCanonicalTokenAmount(value, token);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid amount.";
    if (/at most \d+ decimal places/i.test(message)) {
      throw new Error(
        `${token.symbol} supports at most ${token.decimals} decimal places.`,
      );
    }
    if (/greater than zero/i.test(message)) {
      throw new Error(`${token.symbol} amount must be greater than zero.`);
    }
    if (/u128/i.test(message)) {
      throw new Error(`${token.symbol} amount does not fit the escrow.`);
    }
    throw new Error(`Enter a positive decimal ${token.symbol} amount.`);
  }
}

export function formatLocalnetTokenAmount(
  amount: bigint,
  token: LocalnetMarketToken,
  maxFraction: number = token.decimals,
): string {
  const canonical = formatCanonicalTokenAmount(amount, token);
  const [whole, fraction = ""] = canonical.split(".");
  const bounded = fraction.slice(
    0,
    Math.max(0, Math.min(maxFraction, token.decimals)),
  );
  return bounded ? `${whole}.${bounded}` : (whole as string);
}

type ApiResult = Record<string, unknown>;

function asRecord(value: unknown): ApiResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The local solver returned a malformed response.");
  }
  return value as ApiResult;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`The local solver omitted ${label}.`);
  }
  return value;
}

function asCanonicalAddress(value: unknown, label: string): string {
  const text = asString(value, label);
  try {
    const address = canonicalizeStarknetFelt(text);
    if (address === "0x0") throw new Error();
    return address;
  } catch {
    throw new Error(`The local solver returned an invalid ${label}.`);
  }
}

function asPositiveBigInt(value: unknown, label: string): bigint {
  const text = asString(value, label);
  if (!/^(?:0|[1-9]\d*)$/.test(text)) {
    throw new Error(`The local solver returned an invalid ${label}.`);
  }
  const parsed = BigInt(text);
  if (parsed <= 0n) {
    throw new Error(`The local solver returned an empty ${label}.`);
  }
  return parsed;
}

function asSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`The local solver returned an invalid ${label}.`);
  }
  return Number(value);
}

function asOfferList(value: unknown): ApiResult[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("No private maker returned a quote.");
  }
  return value.map((offer) => asRecord(offer));
}

async function postLocalnet<TBody extends object>(
  path: string,
  body: TBody,
): Promise<ApiResult> {
  if (!API_BASE) {
    throw new Error("The build has no localnet wallet API.");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The local solver returned unreadable JSON.");
  }
  const envelope = asRecord(payload);
  if (!response.ok) {
    throw new Error(
      typeof envelope.error === "string"
        ? envelope.error
        : "The local solver rejected the request.",
    );
  }
  return asRecord(envelope.result);
}

export async function requestLocalnetSolverQuotes(input: {
  intentDigest: string;
  createdAt: number;
  expiresAt: number;
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  minBuyAmount: bigint;
}): Promise<LocalnetSolverOffer[]> {
  const result = await postLocalnet("/private-intents/quotes", {
    intentDigest: input.intentDigest,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    sellToken: input.sellToken,
    sellAmount: input.sellAmount.toString(),
    buyToken: input.buyToken,
    minBuyAmount: input.minBuyAmount.toString(),
  });
  return asOfferList(result.offers).map((offer) => ({
    solverId: asString(offer.solverId, "solverId"),
    solverKey: asString(offer.solverKey, "solverKey"),
    grossBuyAmount: asPositiveBigInt(offer.grossBuyAmount, "grossBuyAmount"),
    sellToken: asCanonicalAddress(offer.sellToken, "sellToken"),
    buyToken: asCanonicalAddress(offer.buyToken, "buyToken"),
    spreadBps: asSafeInteger(offer.spreadBps, "spreadBps"),
    provenance: asString(offer.provenance, "provenance"),
    nonce: asString(offer.nonce, "nonce"),
    reservationId: asString(offer.reservationId, "reservationId"),
    reservationExpiresAt: asSafeInteger(
      offer.reservationExpiresAt,
      "reservationExpiresAt",
    ),
  }));
}

export async function signLocalnetSolverQuote(
  canonical: string,
  quote: UnsignedSolverQuote,
): Promise<string> {
  const result = await postLocalnet("/private-intents/sign-quote", {
    canonical,
    domain: quote.domain,
    pool: quote.pool,
    helper: quote.helper,
    sellToken: quote.sellToken,
    sellAmount: quote.sellAmount.toString(),
    buyToken: quote.buyToken,
    intentDigest: quote.intentDigest,
    solverId: quote.solverId,
    solverKey: quote.solverKey,
    nonce: quote.nonce,
    reservationId: quote.reservationId,
    reservationExpiresAt: quote.reservationExpiresAt,
    buyAmount: quote.buyAmount.toString(),
    spreadBps: quote.spreadBps,
    pricingProvenance: quote.pricingProvenance,
    quotedAt: quote.quotedAt,
    quoteExpiresAt: quote.quoteExpiresAt,
  });
  const signature = asString(result.signature, "signature").toLowerCase();
  if (asString(result.canonical, "canonical") !== canonical) {
    throw new Error("The solver signed a different quote payload.");
  }
  return signature;
}

export async function selectLocalnetSolverQuote(input: {
  intentDigest: string;
  selectedReservationId: string;
}): Promise<void> {
  await postLocalnet("/private-intents/select-quote", input);
}

export async function releaseLocalnetSolverQuote(
  reservationId: string,
): Promise<void> {
  await postLocalnet("/private-intents/release-quote", { reservationId });
}

export async function askLocalnetSolverToFill(
  terms: LocalnetIntentTerms,
): Promise<string> {
  const result = await postLocalnet("/private-intents/solve", {
    dealId: terms.dealId,
    intentDigest: terms.intentDigest,
    solverId: terms.solverId,
    reservationId: terms.reservationId,
    sellToken: terms.sellToken,
    sellAmount: terms.sellAmount.toString(),
    buyToken: terms.buyToken,
    buyAmount: terms.buyAmount.toString(),
  });
  return asString(result.transaction_hash, "solver transaction hash");
}

export async function expireLocalnetPrivateIntent(
  terms: LocalnetIntentTerms,
): Promise<number> {
  const result = await postLocalnet("/private-intents/expire", {
    dealId: terms.dealId,
    intentDigest: terms.intentDigest,
    solverId: terms.solverId,
    reservationId: terms.reservationId,
    sellToken: terms.sellToken,
    sellAmount: terms.sellAmount.toString(),
    buyToken: terms.buyToken,
    buyAmount: terms.buyAmount.toString(),
  });
  if (
    typeof result.expiredAt !== "number" ||
    !Number.isSafeInteger(result.expiredAt)
  ) {
    throw new Error("The local solver returned an invalid expiry timestamp.");
  }
  return result.expiredAt;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function createLocalnetIntentId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(31));
  const value = `0x${bytesToHex(bytes)}`;
  bytes.fill(0);
  return value;
}

export async function ensureLocalnetEscrowTicket(input: {
  dealId: string;
}): Promise<string> {
  const result = await postLocalnet("/escrow/ensure-ticket", input);
  return asString(result.ticketAddress, "ticketAddress");
}

export async function readLocalnetEscrowDeal(
  dealId: string,
): Promise<ApiResult> {
  return postLocalnet("/escrow/deal", { dealId });
}

export function buildLocalnetIntentPayoutActions(input: {
  operation: "claim" | "timeout";
  escrowAddress: string;
  recoveryAddress: string;
  ticketAddress: string;
  dealId: string;
  payoutToken: string;
}): WALLET_API.STRK20_ACTION[] {
  const builder =
    input.operation === "claim"
      ? buildEscrowClaimActions
      : buildEscrowTimeoutActions;
  return builder(input);
}
