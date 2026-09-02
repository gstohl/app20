import {
  canonicalizeStarknetFelt,
  formatTokenAmount as formatCanonicalTokenAmount,
  parseTokenAmount as parseCanonicalTokenAmount,
} from "@app20/domain";
import type { WALLET_API } from "@starknet-io/types-js";
import {
  decodeSolverQuoteV3,
  encodePrivateRfqV2,
  encodeSelectionTranscript,
  type PrivateRfqV2,
  type PriceSchedule,
  type SelectionTranscriptV1,
  type SolverQuoteV3,
  type UnsignedSolverQuote,
} from "@app20/private-intents";
import { takeAttemptTargetFromLifecycle } from "./rfq-lifecycle";
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
  verifyRfqOperationsMids,
  type BrowserSafeMakerStatus,
  type RfqOperationsStatus,
} from "./rfq-operations";

const LOCALNET_STATUS_TIMEOUT_MS = 5_000;
const LOCALNET_COMMAND_TIMEOUT_MS = 120_000;
const U128_MAX = (1n << 128n) - 1n;

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

export type LocalnetServerRecoveryDealV3 = Readonly<{
  source: "localnet-coordinator-and-chain";
  authority: "server-derived-resume-only";
  lifecycle: "v3";
  account: string;
  chainId: string;
  market: string;
  rfqId: string;
  dealId: string;
  intentDigest: string;
  createdAt: number;
  expiresAt: number;
  expected: Readonly<{
    tokenA: string;
    totalA: string;
    tokenB: string;
    totalB: string;
    fills: readonly Readonly<{
      lockId: string;
      amountA: string;
      amountB: string;
    }>[];
  }>;
  transactions: Readonly<{ take: string }>;
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

export type LocalnetV3Cohort = Readonly<{
  epoch: number;
  checkpoint: string;
  validUntil: number;
  makers: readonly Readonly<{ makerId: string; keyId: string }>[];
  binding: string;
}>;

export type LocalnetQuoteRefusalV3 = Readonly<{
  makerId: string;
  code?: string;
  reason: string;
  quoteDigest: string;
}>;

export type LocalnetQuotesV3Result = Readonly<{
  quotes: readonly SolverQuoteV3[];
  refusals: readonly LocalnetQuoteRefusalV3[];
  cohort: LocalnetV3Cohort;
}>;

export type LocalnetEscrowLock = Readonly<{
  status: "empty" | "open";
  tokenA: string;
  tokenB: string;
  rfqId: string;
  takerCommitment: string;
  expiry: number;
  schedule: PriceSchedule;
  remainingB: bigint;
  earnedA: bigint;
  ticket: string;
  proceedsSettled: boolean;
  collateralReleased: boolean;
}>;

export type LocalnetEscrowLockWithCreationEvidence =
  LocalnetEscrowLock &
    Readonly<{
      createdTransactionHash: string | null;
    }>;

export type LocalnetEscrowTake = Readonly<{
  tokenA: string;
  totalA: bigint;
  tokenB: string;
  totalB: bigint;
  fillCount: number;
  takenAt: number;
}>;

export type LocalnetTranscriptAcknowledgement = Readonly<{
  makerId: string;
  accepted: boolean;
  consistent: boolean;
  reason?: string;
}>;

export type LocalnetTakeTarget = Readonly<{
  account: string;
  chainId: string;
  rfqId: string;
  dealId: string;
  expected: Readonly<{
    tokenA: string;
    totalA: bigint;
    tokenB: string;
    totalB: bigint;
    fills: readonly Readonly<{
      lockId: string;
      amountA: bigint;
      amountB: bigint;
    }>[];
  }>;
  transactionHash?: string;
}>;

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

function exactResponseKeys(
  value: ApiResult,
  expected: readonly string[],
  label: string,
): void {
  if (Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) {
    throw new Error(`The local maker returned an unsupported ${label} schema.`);
  }
}

function asCanonicalFelt(
  value: unknown,
  label: string,
  allowZero = false,
): string {
  const text = asString(value, label);
  let canonical: string;
  try {
    canonical = canonicalizeStarknetFelt(text);
  } catch {
    throw new Error(`The local maker returned an invalid ${label}.`);
  }
  if (text !== canonical || (!allowZero && canonical === "0x0")) {
    throw new Error(`The local maker returned a non-canonical ${label}.`);
  }
  return canonical;
}

function asSha256Digest(value: unknown, label: string): string {
  const digest = asString(value, label).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`The local maker returned an invalid ${label}.`);
  }
  return digest;
}

function asCanonicalDecimal(
  value: unknown,
  label: string,
  positive = false,
): bigint {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value) ||
    (positive && BigInt(value) === 0n)
  ) {
    throw new Error(`The local maker returned an invalid ${label}.`);
  }
  return BigInt(value);
}

function asNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`The local maker returned an invalid ${label}.`);
  }
  return Number(value);
}

function normalizeV3Cohort(value: unknown): LocalnetV3Cohort {
  const cohort = asRecord(value);
  exactResponseKeys(
    cohort,
    ["epoch", "checkpoint", "validUntil", "makers", "binding"],
    "maker cohort",
  );
  const epoch = asNonNegativeSafeInteger(cohort.epoch, "cohort epoch");
  const validUntil = asSafeInteger(cohort.validUntil, "cohort validUntil");
  if (!Array.isArray(cohort.makers) || cohort.makers.length === 0) {
    throw new Error("The local maker returned an empty maker cohort.");
  }
  const makers = cohort.makers.map((value, index) => {
    const maker = asRecord(value);
    exactResponseKeys(maker, ["makerId", "keyId"], `cohort maker ${index}`);
    return Object.freeze({
      makerId: asString(maker.makerId, `cohort maker ${index} makerId`),
      keyId: asString(maker.keyId, `cohort maker ${index} keyId`),
    });
  });
  if (new Set(makers.map(({ makerId }) => makerId)).size !== makers.length) {
    throw new Error("The local maker returned duplicate cohort identities.");
  }
  return Object.freeze({
    epoch,
    checkpoint: asString(cohort.checkpoint, "cohort checkpoint"),
    validUntil,
    makers: Object.freeze(makers),
    binding: asString(cohort.binding, "cohort binding"),
  });
}

function normalizeSchedule(
  value: unknown,
  status: "empty" | "open",
): PriceSchedule {
  if (
    !Array.isArray(value) ||
    (status === "open" && (value.length < 1 || value.length > 4)) ||
    (status === "empty" && value.length !== 0)
  ) {
    throw new Error("The local maker returned an invalid lock schedule.");
  }
  let previousA = 0n;
  let previousB = 0n;
  const schedule = value.map((candidate, index) => {
    const point = asRecord(candidate);
    exactResponseKeys(point, ["a", "b"], `lock schedule point ${index}`);
    const a = asCanonicalDecimal(
      point.a,
      `lock schedule point ${index} a`,
      true,
    );
    const b = asCanonicalDecimal(
      point.b,
      `lock schedule point ${index} b`,
      true,
    );
    if (a > U128_MAX || b > U128_MAX) {
      throw new Error("The local maker returned an overflowing lock schedule.");
    }
    if (index > 0 && (a <= previousA || b < previousB)) {
      throw new Error("The local maker returned an invalid lock schedule.");
    }
    previousA = a;
    previousB = b;
    return Object.freeze({ a, b });
  });
  return Object.freeze(schedule);
}

function encodeTakeTarget(target: LocalnetTakeTarget): Record<string, unknown> {
  const rfqId = canonicalizeStarknetFelt(target.rfqId);
  const dealId = canonicalizeStarknetFelt(target.dealId);
  if (rfqId !== dealId || rfqId === "0x0") {
    throw new Error(
      "Local deal identity must equal the canonical RFQ identity.",
    );
  }
  const tokenA = canonicalizeStarknetFelt(target.expected.tokenA);
  const tokenB = canonicalizeStarknetFelt(target.expected.tokenB);
  if (tokenA === "0x0" || tokenB === "0x0" || tokenA === tokenB) {
    throw new Error("The Take target must bind two distinct non-zero tokens.");
  }
  if (
    !Array.isArray(target.expected.fills) ||
    target.expected.fills.length < 1 ||
    target.expected.fills.length > 4
  ) {
    throw new Error("The Take target requires between one and four fills.");
  }
  const fills = target.expected.fills.map((fill, index) => {
    const lockId = canonicalizeStarknetFelt(fill.lockId);
    if (
      lockId === "0x0" ||
      typeof fill.amountA !== "bigint" ||
      fill.amountA <= 0n ||
      typeof fill.amountB !== "bigint" ||
      fill.amountB <= 0n ||
      fill.amountA > U128_MAX ||
      fill.amountB > U128_MAX
    ) {
      throw new Error(`The Take target fill ${index} is invalid.`);
    }
    return {
      lockId,
      amountA: fill.amountA.toString(),
      amountB: fill.amountB.toString(),
    };
  });
  if (new Set(fills.map(({ lockId }) => lockId)).size !== fills.length) {
    throw new Error("The Take target lock ids must be distinct.");
  }
  const totalA = target.expected.fills.reduce(
    (sum, fill) => sum + fill.amountA,
    0n,
  );
  const totalB = target.expected.fills.reduce(
    (sum, fill) => sum + fill.amountB,
    0n,
  );
  if (
    target.expected.totalA !== totalA ||
    target.expected.totalB !== totalB ||
    totalA > U128_MAX ||
    totalB > U128_MAX
  ) {
    throw new Error("The Take target totals contradict its exact fills.");
  }
  return {
    account: target.account,
    chainId: target.chainId,
    rfqId,
    dealId,
    expected: {
      tokenA,
      totalA: totalA.toString(),
      tokenB,
      totalB: totalB.toString(),
      fills,
    },
    ...(target.transactionHash
      ? { transactionHash: canonicalizeStarknetFelt(target.transactionHash) }
      : {}),
  };
}

async function postTakeState(
  path: string,
  target: LocalnetTakeTarget,
  attemptId: string,
): Promise<void> {
  const result = await postLocalnet(path, {
    ...encodeTakeTarget(target),
    attemptId: asString(attemptId, "attemptId"),
  });
  exactResponseKeys(result, ["ok"], "Take command");
  if (result.ok !== true)
    throw new Error("The local maker rejected the Take command.");
}

export async function requestQuotesV3(input: {
  account: string;
  chainId: string;
  rfq: PrivateRfqV2;
  cohort: LocalnetV3Cohort;
  signal?: AbortSignal;
}): Promise<LocalnetQuotesV3Result> {
  const requestedCohort = normalizeV3Cohort(input.cohort);
  const result = await postLocalnet(
    "/private-intents/quotes",
    {
      account: input.account,
      chainId: input.chainId,
      rfq: encodePrivateRfqV2(input.rfq),
      cohort: requestedCohort,
    },
    input.signal,
  );
  exactResponseKeys(result, ["quotes", "refusals", "cohort"], "quote v3");
  if (!Array.isArray(result.quotes) || !Array.isArray(result.refusals)) {
    throw new Error("The local maker returned a malformed quote v3 response.");
  }
  const quotes = result.quotes.map((quote) => decodeSolverQuoteV3(quote));
  const refusals = result.refusals.map((candidate, index) => {
    const refusal = asRecord(candidate);
    exactResponseKeys(
      refusal,
      refusal.code === undefined
        ? ["makerId", "reason", "quoteDigest"]
        : ["makerId", "code", "reason", "quoteDigest"],
      `quote refusal ${index}`,
    );
    const quoteDigest = asSha256Digest(
      refusal.quoteDigest,
      `quote refusal ${index} quoteDigest`,
    );
    return Object.freeze({
      makerId: asString(refusal.makerId, `quote refusal ${index} makerId`),
      ...(refusal.code === undefined
        ? {}
        : {
            code: asString(
              refusal.code,
              `quote refusal ${index} code`,
            ),
          }),
      reason: asString(refusal.reason, `quote refusal ${index} reason`),
      quoteDigest,
    });
  });
  const cohort = normalizeV3Cohort(result.cohort);
  if (
    cohort.epoch !== requestedCohort.epoch ||
    cohort.checkpoint !== requestedCohort.checkpoint ||
    cohort.validUntil !== requestedCohort.validUntil ||
    cohort.binding !== requestedCohort.binding ||
    cohort.makers.length !== requestedCohort.makers.length ||
    cohort.makers.some(
      (maker, index) =>
        maker.makerId !== requestedCohort.makers[index]?.makerId ||
        maker.keyId !== requestedCohort.makers[index]?.keyId,
    )
  ) {
    throw new Error(
      "The local maker returned a different authenticated cohort.",
    );
  }
  const outcomeIds = [
    ...quotes.map((quote) => quote.solverId),
    ...refusals.map((refusal) => refusal.makerId),
  ];
  if (
    new Set(outcomeIds).size !== outcomeIds.length ||
    outcomeIds.length !== cohort.makers.length ||
    outcomeIds.some(
      (makerId) => !cohort.makers.some((maker) => maker.makerId === makerId),
    ) ||
    quotes.some(
      (quote) =>
        !cohort.makers.some(
          (maker) =>
            maker.makerId === quote.solverId &&
            maker.keyId === quote.quoteKeyId,
        ),
    )
  ) {
    throw new Error("The local maker returned contradictory cohort outcomes.");
  }
  return Object.freeze({
    quotes: Object.freeze(quotes),
    refusals: Object.freeze(refusals),
    cohort,
  });
}

export async function readEscrowLock(
  lockId: string,
  signal?: AbortSignal,
): Promise<LocalnetEscrowLockWithCreationEvidence> {
  const result = await postLocalnet(
    "/escrow/lock",
    { lockId: canonicalizeStarknetFelt(lockId) },
    signal,
  );
  exactResponseKeys(result, ["lock"], "escrow lock");
  const lock = asRecord(result.lock);
  exactResponseKeys(
    lock,
    [
      "status",
      "tokenA",
      "tokenB",
      "rfqId",
      "takerCommitment",
      "expiry",
      "schedule",
      "remainingB",
      "earnedA",
      "ticket",
      "createdTransactionHash",
      "proceedsSettled",
      "collateralReleased",
    ],
    "escrow lock",
  );
  if (lock.status !== "empty" && lock.status !== "open") {
    throw new Error("The local maker returned an invalid lock status.");
  }
  if (
    typeof lock.proceedsSettled !== "boolean" ||
    typeof lock.collateralReleased !== "boolean"
  ) {
    throw new Error("The local maker returned invalid lock settlement flags.");
  }
  const status = lock.status;
  const normalized = Object.freeze({
    status,
    tokenA: asCanonicalFelt(lock.tokenA, "lock tokenA", status === "empty"),
    tokenB: asCanonicalFelt(lock.tokenB, "lock tokenB", status === "empty"),
    rfqId: asCanonicalFelt(lock.rfqId, "lock rfqId", status === "empty"),
    takerCommitment: asCanonicalFelt(
      lock.takerCommitment,
      "lock takerCommitment",
      status === "empty",
    ),
    expiry: asNonNegativeSafeInteger(lock.expiry, "lock expiry"),
    schedule: normalizeSchedule(lock.schedule, status),
    remainingB: asCanonicalDecimal(lock.remainingB, "lock remainingB"),
    earnedA: asCanonicalDecimal(lock.earnedA, "lock earnedA"),
    ticket: asCanonicalFelt(lock.ticket, "lock ticket", status === "empty"),
    createdTransactionHash:
      lock.createdTransactionHash === null
        ? null
        : asCanonicalFelt(
            lock.createdTransactionHash,
            "lock createdTransactionHash",
          ),
    proceedsSettled: lock.proceedsSettled,
    collateralReleased: lock.collateralReleased,
  });
  if (normalized.remainingB > U128_MAX || normalized.earnedA > U128_MAX) {
    throw new Error("The local maker returned overflowing lock balances.");
  }
  if (
    status === "empty" &&
    (normalized.tokenA !== "0x0" ||
      normalized.tokenB !== "0x0" ||
      normalized.rfqId !== "0x0" ||
      normalized.takerCommitment !== "0x0" ||
      normalized.expiry !== 0 ||
      normalized.remainingB !== 0n ||
      normalized.earnedA !== 0n ||
      normalized.ticket !== "0x0" ||
      normalized.createdTransactionHash !== null ||
      normalized.proceedsSettled ||
      normalized.collateralReleased)
  ) {
    throw new Error("The local maker returned a contradictory empty lock.");
  }
  return normalized;
}

export async function readEscrowTake(
  dealId: string,
  signal?: AbortSignal,
): Promise<LocalnetEscrowTake | null> {
  const result = await postLocalnet(
    "/escrow/take",
    { dealId: canonicalizeStarknetFelt(dealId) },
    signal,
  );
  exactResponseKeys(result, ["take"], "escrow Take");
  if (result.take === null) return null;
  const take = asRecord(result.take);
  exactResponseKeys(
    take,
    ["tokenA", "totalA", "tokenB", "totalB", "fillCount", "takenAt"],
    "escrow Take",
  );
  const fillCount = asSafeInteger(take.fillCount, "Take fillCount");
  const tokenA = asCanonicalFelt(take.tokenA, "Take tokenA");
  const tokenB = asCanonicalFelt(take.tokenB, "Take tokenB");
  const totalA = asCanonicalDecimal(take.totalA, "Take totalA", true);
  const totalB = asCanonicalDecimal(take.totalB, "Take totalB", true);
  if (
    fillCount > 4 ||
    tokenA === tokenB ||
    totalA > U128_MAX ||
    totalB > U128_MAX
  ) {
    throw new Error("The local maker returned an invalid Take record.");
  }
  return Object.freeze({
    tokenA,
    totalA,
    tokenB,
    totalB,
    fillCount,
    takenAt: asSafeInteger(take.takenAt, "Take takenAt"),
  });
}

export async function postSelectionTranscript(input: {
  /** Retained as optional caller context; the wire request is transcript-scoped. */
  account?: string;
  chainId?: string;
  rfqDigest: string;
  transcript: SelectionTranscriptV1;
  signal?: AbortSignal;
}): Promise<readonly LocalnetTranscriptAcknowledgement[]> {
  const rfqDigest = input.rfqDigest.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(rfqDigest)) {
    throw new Error("The selection transcript RFQ digest is invalid.");
  }
  const transcript = encodeSelectionTranscript(input.transcript);
  if (transcript.rfqDigest !== rfqDigest) {
    throw new Error("The selection transcript belongs to a different RFQ.");
  }
  const makerIds = transcript.entries.map(({ makerId }) => makerId);
  if (new Set(makerIds).size !== makerIds.length || makerIds.length === 0) {
    throw new Error("The selection transcript maker identities are invalid.");
  }
  const result = await postLocalnet(
    "/private-intents/transcript",
    {
      rfqDigest,
      transcript,
      makerIds,
    },
    input.signal,
  );
  exactResponseKeys(result, ["acknowledgements"], "transcript acknowledgement");
  if (!Array.isArray(result.acknowledgements)) {
    throw new Error(
      "The local maker returned malformed transcript acknowledgements.",
    );
  }
  const acknowledgements = result.acknowledgements.map((candidate, index) => {
    const acknowledgement = asRecord(candidate);
    const expected =
      acknowledgement.reason === undefined
        ? ["makerId", "accepted", "consistent"]
        : ["makerId", "accepted", "consistent", "reason"];
    exactResponseKeys(
      acknowledgement,
      expected,
      `transcript acknowledgement ${index}`,
    );
    if (
      typeof acknowledgement.accepted !== "boolean" ||
      typeof acknowledgement.consistent !== "boolean"
    ) {
      throw new Error(
        "The local maker returned invalid transcript acknowledgement flags.",
      );
    }
    return Object.freeze({
      makerId: asString(
        acknowledgement.makerId,
        `transcript acknowledgement ${index} makerId`,
      ),
      accepted: acknowledgement.accepted,
      consistent: acknowledgement.consistent,
      ...(acknowledgement.reason === undefined
        ? {}
        : {
            reason: asString(
              acknowledgement.reason,
              `transcript acknowledgement ${index} reason`,
            ),
          }),
    });
  });
  if (
    acknowledgements.length !== makerIds.length ||
    new Set(acknowledgements.map(({ makerId }) => makerId)).size !==
      acknowledgements.length ||
    acknowledgements.some(({ makerId }) => !makerIds.includes(makerId))
  ) {
    throw new Error(
      "The local maker returned contradictory transcript acknowledgements.",
    );
  }
  return Object.freeze(acknowledgements);
}

export function localnetTakeTargetFromLifecycle(
  record: RfqLifecycleRecord,
): LocalnetTakeTarget {
  const target = takeAttemptTargetFromLifecycle(record);
  return Object.freeze({
    account: target.account,
    chainId: target.chainId,
    rfqId: target.rfqId,
    dealId: target.dealId,
    expected: Object.freeze({
      tokenA: target.expected.tokenA,
      totalA: BigInt(target.expected.totalA),
      tokenB: target.expected.tokenB,
      totalB: BigInt(target.expected.totalB),
      fills: Object.freeze(
        target.expected.fills.map((fill) =>
          Object.freeze({
            lockId: fill.lockId,
            amountA: BigInt(fill.amountA),
            amountB: BigInt(fill.amountB),
          }),
        ),
      ),
    }),
    ...(record.takeTransactionHash
      ? { transactionHash: record.takeTransactionHash }
      : {}),
  });
}

export function prepareLocalnetTake(
  target: LocalnetTakeTarget,
  attemptId: string,
): Promise<void> {
  return postTakeState("/private-intents/take-prepare", target, attemptId);
}

export function markLocalnetTakeUnknown(
  target: LocalnetTakeTarget,
  attemptId: string,
): Promise<void> {
  return postTakeState("/private-intents/take-unknown", target, attemptId);
}

export function abandonLocalnetTake(
  target: LocalnetTakeTarget,
  attemptId: string,
): Promise<void> {
  return postTakeState("/private-intents/take-abandon", target, attemptId);
}

export function observeLocalnetTake(
  target: LocalnetTakeTarget,
  attemptId: string,
): Promise<void> {
  return postTakeState("/private-intents/take-observe", target, attemptId);
}

export async function convergeLocalnetTake(
  target: LocalnetTakeTarget,
  attemptId: string,
  observed: "taken" | "absent",
): Promise<void> {
  const result = await postLocalnet("/private-intents/take-converge", {
    ...encodeTakeTarget(target),
    attemptId: asString(attemptId, "attemptId"),
    observed,
  });
  exactResponseKeys(result, ["ok"], "Take convergence");
  if (result.ok !== true)
    throw new Error("The local maker rejected Take convergence.");
}

export type LocalnetRfqV3Config = Readonly<{
  lockTicketClassHash: string;
  escrowAbiVersion: 3;
  ipfsProxyPath: "/__app20_localnet_ipfs";
}>;

export async function readLocalnetRfqV3Config(): Promise<LocalnetRfqV3Config> {
  const config = await getLocalnet("/config");
  if (
    config.escrowAbiVersion !== 3 ||
    config.ipfsProxyPath !== "/__app20_localnet_ipfs"
  ) {
    throw new Error("The localnet RFQ v3 configuration is unavailable.");
  }
  return Object.freeze({
    lockTicketClassHash: asCanonicalFelt(
      config.lockTicketClassHash,
      "lockTicketClassHash",
    ),
    escrowAbiVersion: 3,
    ipfsProxyPath: "/__app20_localnet_ipfs",
  });
}

export async function readLocalnetRfqOperationsStatus(): Promise<RfqOperationsStatus> {
  const status = normalizeRfqOperationsStatus(
    await getLocalnet("/rfq/operations/status"),
  );
  return verifyRfqOperationsMids(status, Math.floor(Date.now() / 1_000));
}

export async function readLocalnetV3UnresolvedDeal(input: {
  target: LocalnetTakeTarget;
  intentDigest: string;
  takeTransactionHash: string;
}): Promise<RfqAuthorityProjection> {
  const { transactionHash: _candidateHash, ...encoded } = encodeTakeTarget(
    input.target,
  );
  return normalizeRfqAuthorityProjection(
    await postLocalnet("/rfq/unresolved-deals", {
      ...encoded,
      intentDigest: asSha256Digest(input.intentDigest, "intentDigest"),
      lifecycle: "v3",
      transactions: {
        take: canonicalizeStarknetFelt(input.takeTransactionHash),
      },
    }),
  );
}

export const readLocalnetUnresolvedDealV3 = readLocalnetV3UnresolvedDeal;

export async function readLocalnetUnresolvedDealsIncludingV3(input: {
  account: string;
  chainId: string;
  sellToken: string;
  buyToken: string;
}): Promise<
  readonly (LocalnetServerRecoveryDeal | LocalnetServerRecoveryDealV3)[]
> {
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
      if (
        deal.source !== "localnet-coordinator-and-chain" ||
        deal.authority !== "server-derived-resume-only"
      )
        throw new Error(
          "The local recovery service omitted its authority label.",
        );
      const createdAt = asSafeInteger(deal.createdAt, "createdAt");
      const expiresAt = asSafeInteger(deal.expiresAt, "expiresAt");
      if (deal.lifecycle === "v3") {
        const expected = asRecord(deal.expected);
        const transactions = asRecord(deal.transactions);
        exactResponseKeys(
          expected,
          ["tokenA", "totalA", "tokenB", "totalB", "fills"],
          "unresolved v3 expected terms",
        );
        if (
          !Array.isArray(expected.fills) ||
          expected.fills.length < 1 ||
          expected.fills.length > 4
        ) {
          throw new Error(
            "The local recovery service returned invalid v3 fills.",
          );
        }
        const fills = expected.fills.map((candidate, index) => {
          const fill = asRecord(candidate);
          exactResponseKeys(
            fill,
            ["lockId", "amountA", "amountB"],
            `unresolved v3 fill ${index}`,
          );
          return Object.freeze({
            lockId: asCanonicalFelt(
              fill.lockId,
              `unresolved fill ${index} lockId`,
            ),
            amountA: asCanonicalDecimal(
              fill.amountA,
              `unresolved fill ${index} amountA`,
              true,
            ).toString(),
            amountB: asCanonicalDecimal(
              fill.amountB,
              `unresolved fill ${index} amountB`,
              true,
            ).toString(),
          });
        });
        if (new Set(fills.map(({ lockId }) => lockId)).size !== fills.length)
          throw new Error(
            "The local recovery service returned duplicate v3 locks.",
          );
        const totalA = asCanonicalDecimal(
          expected.totalA,
          "unresolved totalA",
          true,
        );
        const totalB = asCanonicalDecimal(
          expected.totalB,
          "unresolved totalB",
          true,
        );
        if (
          fills.reduce((sum, fill) => sum + BigInt(fill.amountA), 0n) !==
            totalA ||
          fills.reduce((sum, fill) => sum + BigInt(fill.amountB), 0n) !== totalB
        )
          throw new Error("The local recovery v3 totals contradict its fills.");
        exactResponseKeys(transactions, ["take"], "unresolved v3 transactions");
        return Object.freeze({
          source: deal.source,
          authority: deal.authority,
          lifecycle: "v3" as const,
          account: asCanonicalFelt(deal.account, "account"),
          chainId: asCanonicalFelt(deal.chainId, "chainId"),
          market: asString(deal.market, "market"),
          rfqId: asCanonicalFelt(deal.rfqId, "rfqId"),
          dealId: asCanonicalFelt(deal.dealId, "dealId"),
          intentDigest: asSha256Digest(deal.intentDigest, "intentDigest"),
          createdAt,
          expiresAt,
          expected: Object.freeze({
            tokenA: asCanonicalFelt(expected.tokenA, "unresolved tokenA"),
            totalA: totalA.toString(),
            tokenB: asCanonicalFelt(expected.tokenB, "unresolved tokenB"),
            totalB: totalB.toString(),
            fills: Object.freeze(fills),
          }),
          transactions: Object.freeze({
            take: asCanonicalFelt(
              transactions.take,
              "unresolved Take transaction",
            ),
          }),
          observation: Object.freeze(asRecord(deal.observation)),
          escrowAddress: asCanonicalFelt(deal.escrowAddress, "escrowAddress"),
        });
      }
      const selection = asRecord(deal.selection);
      const terms = asRecord(deal.terms);
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

export async function readLocalnetUnresolvedDeals(input: {
  account: string;
  chainId: string;
  sellToken: string;
  buyToken: string;
}): Promise<readonly LocalnetServerRecoveryDeal[]> {
  const deals = await readLocalnetUnresolvedDealsIncludingV3(input);
  return Object.freeze(
    deals.filter(
      (deal): deal is LocalnetServerRecoveryDeal => !("lifecycle" in deal),
    ),
  );
}

export async function readLocalnetUnresolvedDealsV3(input: {
  account: string;
  chainId: string;
  sellToken: string;
  buyToken: string;
}): Promise<readonly LocalnetServerRecoveryDealV3[]> {
  const deals = await readLocalnetUnresolvedDealsIncludingV3(input);
  return Object.freeze(
    deals.filter(
      (deal): deal is LocalnetServerRecoveryDealV3 =>
        "lifecycle" in deal && deal.lifecycle === "v3",
    ),
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
  if (record.mode === "v3") {
    const take =
      record.takeTransactionHash ?? record.attempts.take?.transactionHash;
    if (record.state !== "settled" || !take) {
      throw new Error(
        "Exact lifecycle Take candidate is incomplete; verification remains unavailable.",
      );
    }
    const target = takeAttemptTargetFromLifecycle(record);
    return normalizeRfqAuthorityProjection(
      await postLocalnet("/rfq/authority/verify", {
        account: record.account,
        chainId: record.chainId,
        rfqId: record.rfqId,
        dealId: record.settlement.dealId,
        intentDigest: record.requestDigest,
        lifecycle: "v3",
        expected: target.expected,
        transactions: { take: canonicalizeStarknetFelt(take) },
      }),
    );
  }
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
