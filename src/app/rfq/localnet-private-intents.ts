import {
  canonicalizeStarknetFelt,
  formatTokenAmount as formatCanonicalTokenAmount,
  parseTokenAmount as parseCanonicalTokenAmount,
} from "@app20/domain";
import type { WALLET_API } from "@starknet-io/types-js";
import type { UnsignedSolverQuote } from "@app20/private-intents";
import type {
  RfqFundingTicketAttemptTarget,
  RfqLifecycleRecord,
  RfqReleaseAttemptTarget,
} from "./rfq-lifecycle";
import {
  normalizeRfqAuthorityProjection,
  type RfqAuthorityProjection,
} from "./rfq-authority";
import {
  buildEscrowClaimActions,
  buildEscrowTimeoutActions,
} from "@/lib/escrow-actions";
import { localnetRuntimeEpoch } from "@/dev/localnet-runtime-epoch";
import { escrowHelperLocalnet } from "@/utils/constants";
import {
  normalizeMakerCohort,
  normalizeRfqOperationsStatus,
  type BrowserSafeMakerStatus,
  type RfqOperationsStatus,
} from "./rfq-operations";

const LOCALNET_STATUS_TIMEOUT_MS = 5_000;
const LOCALNET_COMMAND_TIMEOUT_MS = 120_000;

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

export type LocalnetServerRecoveryDeal = Readonly<{
  source: "localnet-coordinator-and-chain";
  authority: "server-derived-resume-only";
  account: string;
  chainId: string;
  market: string;
  rfqId: string;
  dealId: string;
  intentDigest: string;
  createdAt: number;
  expiresAt: number;
  fundingAttemptId: string;
  selection: Readonly<{
    solverId: string;
    reservationId: string;
    reservationFence: string;
    quoteDigest: string;
  }>;
  terms: Readonly<{
    sellToken: string;
    sellAmount: string;
    buyToken: string;
    buyAmount: string;
    deadline: number;
    ticketAddress: string;
  }>;
  observation: Readonly<Record<string, unknown>>;
  escrowAddress: string;
}>;

export type LocalnetIntentTerms = {
  account: string;
  chainId: string;
  rfqId: string;
  dealId: string;
  intentDigest: string;
  solverId: string;
  reservationId: string;
  reservationFence: string;
  quoteDigest: string;
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  buyAmount: bigint;
  deadline: number;
  ticketAddress: string;
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

export class LocalnetCommandRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalnetCommandRejectedError";
  }
}

export function localnetCommandWasRejected(error: unknown): boolean {
  return error instanceof LocalnetCommandRejectedError;
}

function asRecord(value: unknown): ApiResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The local maker returned a malformed response.");
  }
  return value as ApiResult;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`The local maker omitted ${label}.`);
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
    throw new Error(`The local maker returned an invalid ${label}.`);
  }
}

function asPositiveBigInt(value: unknown, label: string): bigint {
  const text = asString(value, label);
  if (!/^(?:0|[1-9]\d*)$/.test(text)) {
    throw new Error(`The local maker returned an invalid ${label}.`);
  }
  const parsed = BigInt(text);
  if (parsed <= 0n) {
    throw new Error(`The local maker returned an empty ${label}.`);
  }
  return parsed;
}

function asSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`The local maker returned an invalid ${label}.`);
  }
  return Number(value);
}

function asOfferList(value: unknown): ApiResult[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("No private maker returned a quote.");
  }
  return value.map((offer) => asRecord(offer));
}

function localnetFetchSignal(
  timeoutMs: number,
  user?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!user) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, user]);
  }
  const controller = new AbortController();
  const onAbort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  user.addEventListener("abort", onAbort, { once: true });
  timeout.addEventListener("abort", onAbort, { once: true });
  if (user.aborted || timeout.aborted) onAbort();
  return controller.signal;
}

async function getLocalnet(
  path: string,
  signal?: AbortSignal,
): Promise<ApiResult> {
  if (!API_BASE) throw new Error("The build has no localnet wallet API.");
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { accept: "application/json" },
    signal: localnetFetchSignal(LOCALNET_STATUS_TIMEOUT_MS, signal),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The local operations service returned unreadable JSON.");
  }
  const envelope = asRecord(payload);
  if (!response.ok)
    throw new Error(
      typeof envelope.error === "string"
        ? envelope.error
        : "The local operations service is unavailable.",
    );
  return asRecord(envelope.result);
}

function canonicalizeLocalIdentityBody<TBody extends object>(
  body: TBody,
): TBody {
  const candidate = body as TBody & { rfqId?: unknown; dealId?: unknown };
  const rfqId =
    candidate.rfqId === undefined
      ? undefined
      : canonicalizeStarknetFelt(String(candidate.rfqId));
  const dealId =
    candidate.dealId === undefined
      ? undefined
      : canonicalizeStarknetFelt(String(candidate.dealId));
  if (rfqId !== undefined && dealId !== undefined && rfqId !== dealId)
    throw new Error(
      "Local deal identity must equal the canonical RFQ identity.",
    );
  return {
    ...body,
    ...(rfqId === undefined ? {} : { rfqId }),
    ...(dealId === undefined ? {} : { dealId }),
  };
}

async function postLocalnet<TBody extends object>(
  path: string,
  body: TBody,
  signal?: AbortSignal,
): Promise<ApiResult> {
  if (!API_BASE) {
    throw new Error("The build has no localnet wallet API.");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...canonicalizeLocalIdentityBody(body),
      runtimeEpoch: localnetRuntimeEpoch(),
    }),
    signal: localnetFetchSignal(LOCALNET_COMMAND_TIMEOUT_MS, signal),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The local maker returned unreadable JSON.");
  }
  const envelope = asRecord(payload);
  if (!response.ok) {
    throw new LocalnetCommandRejectedError(
      typeof envelope.error === "string"
        ? envelope.error
        : "The local maker rejected the request.",
    );
  }
  return asRecord(envelope.result);
}

export async function readLocalnetRfqOperationsStatus(): Promise<RfqOperationsStatus> {
  return normalizeRfqOperationsStatus(
    await getLocalnet("/rfq/operations/status"),
  );
}

export async function readLocalnetUnresolvedDeals(input: {
  account: string;
  chainId: string;
  sellToken: string;
  buyToken: string;
}): Promise<readonly LocalnetServerRecoveryDeal[]> {
  const result = await postLocalnet("/rfq/unresolved-deals", input);
  if (
    result.schema !== "app20/localnet-unresolved-deals/v1" ||
    result.environment !== "localnet" ||
    result.rawInventoryExposed !== false ||
    !Array.isArray(result.deals)
  )
    throw new Error(
      "The local recovery service returned a malformed envelope.",
    );
  return Object.freeze(
    result.deals.map((value) => {
      const deal = asRecord(value);
      const selection = asRecord(deal.selection);
      const terms = asRecord(deal.terms);
      if (
        deal.source !== "localnet-coordinator-and-chain" ||
        deal.authority !== "server-derived-resume-only"
      )
        throw new Error(
          "The local recovery service omitted its authority label.",
        );
      const createdAt = asSafeInteger(deal.createdAt, "createdAt");
      const expiresAt = asSafeInteger(deal.expiresAt, "expiresAt");
      const deadline = asSafeInteger(terms.deadline, "deadline");
      return Object.freeze({
        source: deal.source,
        authority: deal.authority,
        account: asCanonicalAddress(deal.account, "account"),
        chainId: asCanonicalAddress(deal.chainId, "chainId"),
        market: asString(deal.market, "market"),
        rfqId: asCanonicalAddress(deal.rfqId, "rfqId"),
        dealId: asCanonicalAddress(deal.dealId, "dealId"),
        intentDigest: asString(deal.intentDigest, "intentDigest"),
        createdAt,
        expiresAt,
        fundingAttemptId: asString(deal.fundingAttemptId, "fundingAttemptId"),
        selection: Object.freeze({
          solverId: asString(selection.solverId, "solverId"),
          reservationId: asString(selection.reservationId, "reservationId"),
          reservationFence: asPositiveBigInt(
            selection.reservationFence,
            "reservationFence",
          ).toString(),
          quoteDigest: asString(selection.quoteDigest, "quoteDigest"),
        }),
        terms: Object.freeze({
          sellToken: asCanonicalAddress(terms.sellToken, "sellToken"),
          sellAmount: asPositiveBigInt(
            terms.sellAmount,
            "sellAmount",
          ).toString(),
          buyToken: asCanonicalAddress(terms.buyToken, "buyToken"),
          buyAmount: asPositiveBigInt(terms.buyAmount, "buyAmount").toString(),
          deadline,
          ticketAddress: asCanonicalAddress(
            terms.ticketAddress,
            "ticketAddress",
          ),
        }),
        observation: Object.freeze(asRecord(deal.observation)),
        escrowAddress: asCanonicalAddress(deal.escrowAddress, "escrowAddress"),
      });
    }),
  );
}

/** Candidate hashes are never authority; the server re-reads and decodes each one. */
export async function readLocalnetRfqAuthority(
  record: RfqLifecycleRecord,
): Promise<RfqAuthorityProjection> {
  if (
    !record.requestDigest ||
    !record.settlement ||
    (record.state !== "settled" && record.state !== "refunded")
  )
    throw new Error(
      "Only an observed terminal RFQ can request authority verification.",
    );
  const funding = record.attempts.funding?.transactionHash;
  const fill = record.attempts.fill?.transactionHash;
  const terminal =
    record.state === "settled"
      ? record.attempts.claim?.transactionHash
      : record.attempts.refund?.transactionHash;
  if (!funding || !terminal || (record.state === "settled" && !fill))
    throw new Error(
      "Exact lifecycle transaction candidates are incomplete; verification remains unavailable.",
    );
  return normalizeRfqAuthorityProjection(
    await postLocalnet("/rfq/authority/verify", {
      account: record.account,
      chainId: record.chainId,
      rfqId: record.rfqId,
      dealId: record.settlement.dealId,
      intentDigest: record.requestDigest,
      transactions:
        record.state === "settled"
          ? { fund: funding, fill, claim: terminal }
          : { fund: funding, timeout: terminal },
    }),
  );
}

export type LocalnetQuoteRequestResult = Readonly<{
  offers: readonly LocalnetSolverOffer[];
  cohort: readonly BrowserSafeMakerStatus[];
}>;

export async function requestLocalnetSolverQuotes(input: {
  account: string;
  chainId: string;
  rfqId: string;
  intentDigest: string;
  createdAt: number;
  expiresAt: number;
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  minBuyAmount: bigint;
  cohort: Readonly<{
    epoch: number;
    checkpoint: string;
    validUntil: number;
    makers: readonly Readonly<{ makerId: string; keyId: string }>[];
    binding: string;
  }>;
  signal?: AbortSignal;
}): Promise<LocalnetQuoteRequestResult> {
  const result = await postLocalnet(
    "/private-intents/quotes",
    {
      account: input.account,
      chainId: input.chainId,
      rfqId: input.rfqId,
      intentDigest: input.intentDigest,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      sellToken: input.sellToken,
      sellAmount: input.sellAmount.toString(),
      buyToken: input.buyToken,
      minBuyAmount: input.minBuyAmount.toString(),
      cohort: input.cohort,
    },
    input.signal,
  );
  const offers =
    Array.isArray(result.offers) && result.offers.length > 0
      ? asOfferList(result.offers).map((offer) => ({
          solverId: asString(offer.solverId, "solverId"),
          solverKey: asString(offer.solverKey, "solverKey"),
          grossBuyAmount: asPositiveBigInt(
            offer.grossBuyAmount,
            "grossBuyAmount",
          ),
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
        }))
      : [];
  return Object.freeze({
    offers: Object.freeze(offers),
    cohort: normalizeMakerCohort(result.cohort),
  });
}

export async function signLocalnetSolverQuote(
  canonical: string,
  quote: UnsignedSolverQuote,
  signal?: AbortSignal,
): Promise<string> {
  const result = await postLocalnet(
    "/private-intents/sign-quote",
    {
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
    },
    signal,
  );
  const signature = asString(result.signature, "signature").toLowerCase();
  if (asString(result.canonical, "canonical") !== canonical) {
    throw new Error("The maker signed a different quote payload.");
  }
  return signature;
}

export type LocalnetSelectionAuthorization = Readonly<{
  solverId: string;
  reservationFence: string;
  quoteDigest: string;
}>;

export async function selectLocalnetSolverQuote(input: {
  intentDigest: string;
  selectedReservationId: string;
}): Promise<LocalnetSelectionAuthorization> {
  const result = await postLocalnet("/private-intents/select-quote", input);
  return Object.freeze({
    solverId: asString(result.solverId, "selected solverId"),
    reservationFence: asPositiveBigInt(
      result.reservationFence,
      "reservationFence",
    ).toString(),
    quoteDigest: asString(result.quoteDigest, "quoteDigest"),
  });
}

export async function releaseLocalnetRfqReservations(
  target: Extract<
    RfqReleaseAttemptTarget,
    { operation: "request-reservations" }
  >,
): Promise<void> {
  await postLocalnet("/private-intents/release-intent", target);
}

export async function prepareLocalnetFunding(
  terms: LocalnetIntentTerms,
  attemptId: string,
): Promise<void> {
  await postLocalnet("/private-intents/funding-prepare", {
    ...terms,
    sellAmount: terms.sellAmount.toString(),
    buyAmount: terms.buyAmount.toString(),
    attemptId,
  });
}

export async function markLocalnetFundingUnknown(
  terms: LocalnetIntentTerms,
  attemptId: string,
): Promise<void> {
  await postLocalnet("/private-intents/funding-unknown", {
    ...terms,
    sellAmount: terms.sellAmount.toString(),
    buyAmount: terms.buyAmount.toString(),
    attemptId,
  });
}

export async function abandonLocalnetFunding(
  terms: LocalnetIntentTerms,
  attemptId: string,
): Promise<void> {
  await postLocalnet("/private-intents/funding-abandon", {
    ...terms,
    sellAmount: terms.sellAmount.toString(),
    buyAmount: terms.buyAmount.toString(),
    attemptId,
  });
}

export async function observeLocalnetFunding(
  terms: LocalnetIntentTerms,
  attemptId: string,
): Promise<void> {
  await postLocalnet("/private-intents/funding-observe", {
    ...terms,
    sellAmount: terms.sellAmount.toString(),
    buyAmount: terms.buyAmount.toString(),
    attemptId,
  });
}

export async function convergeLocalnetPrivateIntent(
  terms: LocalnetIntentTerms,
  attemptId: string,
  status: 1 | 2 | 3 | 4,
): Promise<void> {
  await postLocalnet("/private-intents/converge", {
    ...terms,
    sellAmount: terms.sellAmount.toString(),
    buyAmount: terms.buyAmount.toString(),
    attemptId,
    status,
  });
}

export async function askLocalnetSolverToFill(
  terms: LocalnetIntentTerms,
  attemptId: string,
): Promise<string> {
  const result = await postLocalnet("/private-intents/solve", {
    account: terms.account,
    chainId: terms.chainId,
    rfqId: terms.rfqId,
    dealId: terms.dealId,
    intentDigest: terms.intentDigest,
    solverId: terms.solverId,
    reservationId: terms.reservationId,
    reservationFence: terms.reservationFence,
    quoteDigest: terms.quoteDigest,
    sellToken: terms.sellToken,
    sellAmount: terms.sellAmount.toString(),
    buyToken: terms.buyToken,
    buyAmount: terms.buyAmount.toString(),
    deadline: terms.deadline,
    ticketAddress: terms.ticketAddress,
    attemptId,
  });
  return asString(result.transaction_hash, "maker transaction hash");
}

export async function expireLocalnetPrivateIntent(
  terms: LocalnetIntentTerms,
): Promise<number> {
  const result = await postLocalnet("/private-intents/expire", {
    account: terms.account,
    chainId: terms.chainId,
    rfqId: terms.rfqId,
    dealId: terms.dealId,
    intentDigest: terms.intentDigest,
    solverId: terms.solverId,
    reservationId: terms.reservationId,
    reservationFence: terms.reservationFence,
    quoteDigest: terms.quoteDigest,
    sellToken: terms.sellToken,
    sellAmount: terms.sellAmount.toString(),
    buyToken: terms.buyToken,
    buyAmount: terms.buyAmount.toString(),
    deadline: terms.deadline,
    ticketAddress: terms.ticketAddress,
  });
  if (
    typeof result.expiredAt !== "number" ||
    !Number.isSafeInteger(result.expiredAt)
  ) {
    throw new Error("The local maker returned an invalid expiry timestamp.");
  }
  return result.expiredAt;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function createLocalnetIntentId(): string {
  const bytes = new Uint8Array(31);
  do {
    globalThis.crypto.getRandomValues(bytes);
  } while (bytes[0]! < 0x10);
  const value = `0x${bytesToHex(bytes)}`;
  bytes.fill(0);
  return value;
}

export function fundingTicketAttemptTarget(
  terms: Omit<LocalnetIntentTerms, "ticketAddress">,
): RfqFundingTicketAttemptTarget {
  const rfqId = canonicalizeStarknetFelt(terms.rfqId);
  const dealId = canonicalizeStarknetFelt(terms.dealId);
  if (dealId !== rfqId)
    throw new Error(
      "Local deal identity must equal the canonical RFQ identity.",
    );
  return Object.freeze({
    operation: "funding-ticket",
    chainId: terms.chainId,
    account: terms.account,
    rfqId,
    requestDigest: terms.intentDigest,
    dealId,
    solverId: terms.solverId,
    reservationId: terms.reservationId,
    reservationFence: terms.reservationFence,
    quoteDigest: terms.quoteDigest,
    sellToken: terms.sellToken,
    sellAmount: terms.sellAmount.toString(),
    buyToken: terms.buyToken,
    buyAmount: terms.buyAmount.toString(),
    deadline: terms.deadline,
  });
}

export async function ensureLocalnetMailEscrowTicket(
  dealId: string,
): Promise<string> {
  const result = await postLocalnet("/escrow/ensure-mail-ticket", {
    dealId: canonicalizeStarknetFelt(dealId),
  });
  return asCanonicalAddress(result.ticketAddress, "ticketAddress");
}

export async function ensureLocalnetEscrowTicket(input: {
  target: RfqFundingTicketAttemptTarget;
  attemptId: string;
}): Promise<string> {
  const result = await postLocalnet("/escrow/ensure-ticket", {
    ...input.target,
    attemptId: input.attemptId,
  });
  return asCanonicalAddress(result.ticketAddress, "ticketAddress");
}

export async function readLocalnetEscrowDeal(
  dealId: string,
): Promise<ApiResult> {
  const canonicalDealId = canonicalizeStarknetFelt(dealId);
  const result = await postLocalnet("/escrow/deal", {
    dealId: canonicalDealId,
  });
  return Object.freeze({
    ...result,
    dealId: canonicalDealId,
    escrowAddress: escrowHelperLocalnet,
  });
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
  return builder({
    ...input,
    dealId: canonicalizeStarknetFelt(input.dealId),
    ticketAddress: canonicalizeStarknetFelt(input.ticketAddress),
  });
}
