import { canonicalizeStarknetFelt } from "@app20/domain";
import { LOCALNET_CHAIN_ID } from "@/utils/constants";

export const RFQ_LIFECYCLE_SCHEMA_REVISION = "app20/rfq-lifecycle/v2" as const;
export const RFQ_LIFECYCLE_V1_SCHEMA_REVISION =
  "app20/rfq-lifecycle/v1" as const;
export const RFQ_RESUME_AUTHORITY_LABEL =
  "Local resume record · not settlement authority" as const;

export type RfqLifecycleState =
  | "draft"
  | "requesting"
  | "quoted"
  | "reviewing"
  | "submission-unknown"
  | "funded"
  | "filled"
  | "claimable"
  | "settled"
  | "expired"
  | "refundable"
  | "refunded"
  | "refused"
  | "cancel-pending"
  | "cancelled"
  | "reorged"
  | "quarantined";

export type RfqAttemptPhase =
  | "funding"
  | "fill"
  | "claim"
  | "refund"
  | "reservation-release";
export type RfqAttemptState =
  | "not-started"
  | "preparing"
  | "wallet-boundary-unknown"
  | "submitted-unknown"
  | "confirmed"
  | "reverted";

export type RfqReleaseAttemptTarget =
  | Readonly<{
      operation: "request-reservations";
      chainId: string;
      account: string;
      rfqId: string;
      requestDigest: string;
      releaseLeaseId: string;
    }>
  | Readonly<{
      operation: "funded-settlement-expiry";
      chainId: string;
      account: string;
      rfqId: string;
      requestDigest: string;
      dealId: string;
      escrowAddress: string;
      solverId: string;
      reservationId: string;
      reservationFence: string;
      quoteDigest: string;
    }>;

export type RfqFundingTicketAttemptTarget = Readonly<{
  operation: "funding-ticket";
  chainId: string;
  account: string;
  rfqId: string;
  requestDigest: string;
  dealId: string;
  solverId: string;
  reservationId: string;
  reservationFence: string;
  quoteDigest: string;
  sellToken: string;
  sellAmount: string;
  buyToken: string;
  buyAmount: string;
  deadline: number;
}>;

export type RfqMakerFillAttemptTarget = Readonly<{
  operation: "maker-fill";
  chainId: string;
  account: string;
  rfqId: string;
  requestDigest: string;
  dealId: string;
  solverId: string;
  reservationId: string;
  reservationFence: string;
  quoteDigest: string;
  sellToken: string;
  sellAmount: string;
  buyToken: string;
  buyAmount: string;
  deadline: number;
  ticketAddress: string;
}>;

export type RfqAttemptTarget =
  | RfqReleaseAttemptTarget
  | RfqFundingTicketAttemptTarget
  | RfqMakerFillAttemptTarget;

export type RfqPhaseAttempt = Readonly<{
  attemptId: string;
  state: Exclude<RfqAttemptState, "not-started">;
  createdAt: number;
  updatedAt: number;
  transactionHash?: string;
  observation?: string;
  walletBoundary?: "not-entered" | "entered";
  target?: RfqAttemptTarget;
}>;

export type RfqExactTerms = Readonly<{
  pairId: string;
  sellSymbol: string;
  sellAddress: string;
  sellDecimals: number;
  sellAmount: string;
  buySymbol: string;
  buyAddress: string;
  buyDecimals: number;
  minBuyAmount: string;
  buyAmount?: string;
  rfqExpiresAt: number;
}>;

/** Quote V1 and V2 remain explicitly labelled; local settlement currently uses V1. */
export type RfqSelectedQuote = Readonly<{
  version: "Quote V1" | "Quote V2";
  solverId: string;
  solverKey: string;
  nonce: string;
  reservationId: string;
  spreadBps: number;
  pricingProvenance: string;
  quotedAt: number;
  quoteExpiresAt: number;
  reservationExpiresAt: number;
  buyAmount: string;
  intentDigest: string;
  signature: string;
  quoteDigest?: string;
  reservationFence?: string;
}>;

export type RfqSettlementIdentity = Readonly<{
  version: "Localnet V2";
  escrowAddress: string;
  dealId: string;
  ticketAddress?: string;
  commitmentDigest?: string;
  deadline: number;
}>;

export type RfqLocalDealObservation = Readonly<{
  source: "localnet-deal";
  dealId: string;
  escrowAddress: string;
  status: 0 | 1 | 2 | 3 | 4;
  stage: "empty" | "funded" | "filled" | "settled" | "timed-out" | "expired";
  observedAt: number;
  legAToken?: string;
  legAAmount?: string;
  legBToken?: string;
  legBTerms?: string;
  legBAmount?: string;
  deadline?: number;
  ticket?: string;
  commitmentDigest?: string;
}>;

export type RfqEvidenceAuthority = Readonly<{
  status:
    | "local-non-authoritative"
    | "authoritative"
    | "stale"
    | "disagreement"
    | "reorged"
    | "quarantined";
  label: string;
  revision: number;
  observedAt: number;
}>;

export type RfqLifecycleRecord = Readonly<{
  schemaRevision: typeof RFQ_LIFECYCLE_SCHEMA_REVISION;
  authority: typeof RFQ_RESUME_AUTHORITY_LABEL;
  chainId: string;
  account: string;
  rfqId: string;
  state: RfqLifecycleState;
  updatedAt: number;
  /** Durable browser-storage CAS generation. */
  storageRevision: number;
  /** Present only on an unsaved successor and binds it to its exact predecessor. */
  storagePredecessorRevision?: number;
  terms?: RfqExactTerms;
  selectedQuote?: RfqSelectedQuote;
  settlement?: RfqSettlementIdentity;
  attempts: Readonly<Partial<Record<RfqAttemptPhase, RfqPhaseAttempt>>>;
  latestObservation?: RfqLocalDealObservation;
  evidenceAuthority: RfqEvidenceAuthority;
  requestDigest?: string;
  quoteExpiresAt?: number;
  reservationExpiresAt?: number;
  transactionHash?: string;
  reason?: string;
}>;

const STATES = new Set<RfqLifecycleState>([
  "draft",
  "requesting",
  "quoted",
  "reviewing",
  "submission-unknown",
  "funded",
  "filled",
  "claimable",
  "settled",
  "expired",
  "refundable",
  "refunded",
  "refused",
  "cancel-pending",
  "cancelled",
  "reorged",
  "quarantined",
]);

const ALLOWED: Readonly<
  Record<RfqLifecycleState, readonly RfqLifecycleState[]>
> = {
  draft: ["requesting", "cancelled", "quarantined"],
  requesting: ["quoted", "refused", "cancel-pending", "quarantined"],
  quoted: ["reviewing", "expired", "cancel-pending", "quarantined"],
  reviewing: ["submission-unknown", "expired", "cancel-pending", "quarantined"],
  "submission-unknown": ["reviewing", "funded", "refundable", "quarantined"],
  funded: ["filled", "expired", "refundable", "quarantined"],
  filled: ["claimable", "quarantined"],
  claimable: ["settled", "quarantined"],
  settled: ["quarantined"],
  expired: ["refundable", "cancel-pending", "cancelled", "quarantined"],
  refundable: ["refunded", "quarantined"],
  refunded: ["quarantined"],
  refused: ["cancelled", "quarantined"],
  "cancel-pending": ["cancelled", "expired", "quarantined"],
  cancelled: ["quarantined"],
  reorged: ["quarantined"],
  quarantined: ["cancel-pending"],
};

function text(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} is invalid.`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`${label} is invalid.`);
  return Number(value);
}

function decimal(value: unknown, label: string, positive = false): string {
  const parsed = text(value, label);
  if (!/^(?:0|[1-9]\d*)$/.test(parsed) || (positive && BigInt(parsed) <= 0n)) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

export function canonicalRfqAccount(value: string): string {
  const parsed = text(value, "account");
  try {
    const felt = BigInt(parsed);
    if (felt < 0n) throw new Error();
    return `0x${felt.toString(16)}`;
  } catch {
    throw new Error("account is invalid.");
  }
}

function starknetShortStringFelt(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

/** Historical APP20 builds used this different physical local-chain felt. */
export const HISTORICAL_APP20_LOCALNET_CHAIN_ID =
  starknetShortStringFelt("APP20_LOCALNET");

const NAMED_STARKNET_CHAIN_IDS: Readonly<Record<string, string>> =
  Object.freeze({
    SN_MAIN: starknetShortStringFelt("SN_MAIN"),
    SN_SEPOLIA: starknetShortStringFelt("SN_SEPOLIA"),
    // The protocol name and the short-string name of the configured devnet both
    // identify the one wallet/backend chain. Neither may create a storage scope.
    APP20_LOCALNET: LOCALNET_CHAIN_ID,
    QUIETLINE_LOCAL: LOCALNET_CHAIN_ID,
  });

export function canonicalRfqChainId(value: string): string {
  const parsed = text(value, "chainId").trim();
  const unprefixed = parsed.toUpperCase().startsWith("STARKNET:")
    ? parsed.slice("starknet:".length)
    : parsed;
  const named = NAMED_STARKNET_CHAIN_IDS[unprefixed.toUpperCase()];
  if (named) return named;
  try {
    if (/^0x[0-9a-f]+$/i.test(unprefixed)) {
      const felt = `0x${BigInt(unprefixed).toString(16)}`;
      return felt === HISTORICAL_APP20_LOCALNET_CHAIN_ID
        ? LOCALNET_CHAIN_ID
        : felt;
    }
  } catch {
    throw new Error("chainId is invalid.");
  }
  return unprefixed.toLowerCase();
}

export function canonicalLocalRfqId(value: string): string {
  try {
    return canonicalizeStarknetFelt(text(value, "local RFQ ID"));
  } catch {
    throw new Error("local RFQ ID must be a bounded Starknet felt.");
  }
}

export function isLocalRfqChain(value: string): boolean {
  try {
    return canonicalRfqChainId(value) === LOCALNET_CHAIN_ID;
  } catch {
    return false;
  }
}

function canonicalExecutableId(value: string, chainId: string): string {
  return isLocalRfqChain(chainId)
    ? canonicalLocalRfqId(value)
    : text(value, "rfqId");
}

function sameIdentity(left: string, right: string): boolean {
  try {
    return canonicalizeStarknetFelt(left) === canonicalizeStarknetFelt(right);
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}

const persistedStorageRevisions = new WeakMap<object, number>();

/** Marks the exact in-memory snapshot after its atomic storage commit. */
export function markRfqLifecyclePersisted(record: RfqLifecycleRecord): void {
  persistedStorageRevisions.set(record, record.storageRevision);
}

/** Removes transient predecessor metadata before a committed row is stored. */
export function finalizeRfqLifecycleForStorage(
  record: RfqLifecycleRecord,
): RfqLifecycleRecord {
  const { storagePredecessorRevision: _transient, ...durable } = record;
  return Object.freeze(durable);
}

/**
 * Creates one CAS-bound successor. Multiple in-memory edits before one save keep
 * the same exact durable predecessor; edits after save advance from the newly
 * committed generation.
 */
export function reviseRfqLifecycle(
  record: RfqLifecycleRecord,
  patch: Partial<RfqLifecycleRecord>,
): RfqLifecycleRecord {
  const committedRevision = persistedStorageRevisions.get(record);
  const predecessor =
    committedRevision ??
    record.storagePredecessorRevision ??
    record.storageRevision;
  return Object.freeze({
    ...record,
    ...patch,
    storageRevision: predecessor + 1,
    storagePredecessorRevision: predecessor,
  });
}

function defaultEvidenceAuthority(now: number): RfqEvidenceAuthority {
  return Object.freeze({
    status: "local-non-authoritative",
    label: "Local devnet observation · not canonical settlement authority",
    revision: 0,
    observedAt: now,
  });
}

export function createRfqLifecycleRecord(input: {
  chainId: string;
  account: string;
  rfqId: string;
  state?: RfqLifecycleState;
  now: number;
  terms?: RfqExactTerms;
  selectedQuote?: RfqSelectedQuote;
  settlement?: RfqSettlementIdentity;
  requestDigest?: string;
}): RfqLifecycleRecord {
  const now = timestamp(input.now, "now");
  const chainId = canonicalRfqChainId(input.chainId);
  const rfqId = canonicalExecutableId(input.rfqId, chainId);
  const settlement = input.settlement
    ? Object.freeze({
        ...input.settlement,
        dealId: isLocalRfqChain(chainId)
          ? canonicalLocalRfqId(input.settlement.dealId)
          : input.settlement.dealId,
        ...(input.settlement.ticketAddress && isLocalRfqChain(chainId)
          ? {
              ticketAddress: canonicalizeStarknetFelt(
                input.settlement.ticketAddress,
              ),
            }
          : {}),
      })
    : undefined;
  if (settlement && isLocalRfqChain(chainId) && settlement.dealId !== rfqId)
    throw new Error(
      "Local deal identity must equal the canonical RFQ identity.",
    );
  return Object.freeze({
    schemaRevision: RFQ_LIFECYCLE_SCHEMA_REVISION,
    authority: RFQ_RESUME_AUTHORITY_LABEL,
    chainId,
    account: canonicalRfqAccount(input.account),
    rfqId,
    state: input.state ?? "draft",
    updatedAt: now,
    storageRevision: 0,
    ...(input.terms ? { terms: input.terms } : {}),
    ...(input.selectedQuote ? { selectedQuote: input.selectedQuote } : {}),
    ...(settlement ? { settlement } : {}),
    ...(input.requestDigest
      ? { requestDigest: text(input.requestDigest, "requestDigest") }
      : {}),
    attempts: Object.freeze({}),
    evidenceAuthority: defaultEvidenceAuthority(now),
  });
}

type TransitionPatch = Partial<
  Omit<
    RfqLifecycleRecord,
    | "schemaRevision"
    | "authority"
    | "chainId"
    | "account"
    | "rfqId"
    | "state"
    | "updatedAt"
  >
>;

export function transitionRfqLifecycle(
  record: RfqLifecycleRecord,
  state: RfqLifecycleState,
  now: number,
  patch: TransitionPatch = {},
): RfqLifecycleRecord {
  if (state === "reorged") {
    throw new Error(
      "Only an increasing evidence-authority signal may mark an RFQ reorged.",
    );
  }
  if (!ALLOWED[record.state].includes(state)) {
    throw new Error(
      `RFQ lifecycle cannot transition from ${record.state} to ${state}.`,
    );
  }
  if (state === "submission-unknown") {
    const attempt = patch.attempts?.funding ?? record.attempts.funding;
    if (
      !attempt ||
      !(
        (attempt.state === "submitted-unknown" &&
          Boolean(attempt.transactionHash)) ||
        (attempt.state === "wallet-boundary-unknown" &&
          attempt.walletBoundary === "entered")
      )
    ) {
      throw new Error(
        "submission-unknown requires a submitted hash or durable hashless wallet-boundary evidence.",
      );
    }
  }
  if (record.state === "submission-unknown" && state === "reviewing") {
    const attempt = patch.attempts?.funding ?? record.attempts.funding;
    if (!attempt || attempt.state !== "reverted") {
      throw new Error(
        "Only a proven reverted funding attempt may return to deliberate review.",
      );
    }
  }
  const next = reviseRfqLifecycle(record, {
    ...patch,
    state,
    updatedAt: timestamp(now, "now"),
  });
  assertRfqLifecycleAttemptTargets(next);
  return next;
}

function targetCommonMatchesRecord(
  record: RfqLifecycleRecord,
  target: RfqAttemptTarget,
): boolean {
  return (
    canonicalRfqChainId(target.chainId) ===
      canonicalRfqChainId(record.chainId) &&
    canonicalRfqAccount(target.account) ===
      canonicalRfqAccount(record.account) &&
    sameIdentity(target.rfqId, record.rfqId) &&
    target.requestDigest === record.requestDigest
  );
}

function settlementTargetMatchesRecord(
  record: RfqLifecycleRecord,
  target: RfqFundingTicketAttemptTarget | RfqMakerFillAttemptTarget,
): boolean {
  const { terms, selectedQuote, settlement } = record;
  return Boolean(
    targetCommonMatchesRecord(record, target) &&
      terms &&
      selectedQuote &&
      settlement &&
      sameIdentity(target.dealId, settlement.dealId) &&
      target.solverId === selectedQuote.solverId &&
      target.reservationId === selectedQuote.reservationId &&
      target.reservationFence === selectedQuote.reservationFence &&
      target.quoteDigest === selectedQuote.quoteDigest &&
      sameIdentity(target.sellToken, terms.sellAddress) &&
      target.sellAmount === terms.sellAmount &&
      sameIdentity(target.buyToken, terms.buyAddress) &&
      target.buyAmount === selectedQuote.buyAmount &&
      target.deadline === settlement.deadline &&
      selectedQuote.intentDigest === record.requestDigest,
  );
}

export function fundingTicketAttemptTargetFromLifecycle(
  record: RfqLifecycleRecord,
): RfqFundingTicketAttemptTarget {
  if (
    !record.requestDigest ||
    !record.terms ||
    !record.selectedQuote?.reservationFence ||
    !record.selectedQuote.quoteDigest ||
    !record.settlement
  )
    throw new Error(
      "Exact request, quote, reservation, terms, and settlement are required for a funding ticket.",
    );
  return Object.freeze({
    operation: "funding-ticket",
    chainId: record.chainId,
    account: record.account,
    rfqId: record.rfqId,
    requestDigest: record.requestDigest,
    dealId: record.settlement.dealId,
    solverId: record.selectedQuote.solverId,
    reservationId: record.selectedQuote.reservationId,
    reservationFence: record.selectedQuote.reservationFence,
    quoteDigest: record.selectedQuote.quoteDigest,
    sellToken: record.terms.sellAddress,
    sellAmount: record.terms.sellAmount,
    buyToken: record.terms.buyAddress,
    buyAmount: record.selectedQuote.buyAmount,
    deadline: record.settlement.deadline,
  });
}

/** Enforces the phase/target matrix against immutable lifecycle bindings. */
export function assertRfqLifecycleAttemptTargets(
  record: RfqLifecycleRecord,
): void {
  for (const phase of [
    "funding",
    "fill",
    "claim",
    "refund",
    "reservation-release",
  ] as const) {
    const attempt = record.attempts[phase];
    if (!attempt) continue;
    const target = attempt.target;
    if (phase === "claim" || phase === "refund") {
      if (target) throw new Error(`${phase} must not carry an attempt target.`);
      continue;
    }
    if (!target)
      throw new Error(`${phase} requires its exact immutable attempt target.`);
    if (!targetCommonMatchesRecord(record, target))
      throw new Error(`${phase} attempt target changed lifecycle scope.`);
    if (phase === "funding") {
      if (
        target.operation !== "funding-ticket" ||
        !settlementTargetMatchesRecord(record, target)
      )
        throw new Error("funding ticket target contradicts immutable terms.");
      continue;
    }
    if (phase === "fill") {
      if (
        target.operation !== "maker-fill" ||
        !settlementTargetMatchesRecord(record, target) ||
        !record.settlement?.ticketAddress ||
        !sameIdentity(target.ticketAddress, record.settlement.ticketAddress)
      )
        throw new Error("maker-fill target contradicts immutable terms.");
      continue;
    }
    if (
      target.operation !== "request-reservations" &&
      target.operation !== "funded-settlement-expiry"
    )
      throw new Error("reservation-release requires an exact release target.");
    if (target.operation === "funded-settlement-expiry") {
      if (
        !record.settlement ||
        !record.selectedQuote ||
        !sameIdentity(target.dealId, record.settlement.dealId) ||
        !sameIdentity(target.escrowAddress, record.settlement.escrowAddress) ||
        target.solverId !== record.selectedQuote.solverId ||
        target.reservationId !== record.selectedQuote.reservationId ||
        target.reservationFence !== record.selectedQuote.reservationFence ||
        target.quoteDigest !== record.selectedQuote.quoteDigest
      )
        throw new Error(
          "funded reservation-release target contradicts immutable terms.",
        );
    }
  }
}

export function beginRfqPhaseAttempt(
  record: RfqLifecycleRecord,
  phase: RfqAttemptPhase,
  attemptId: string,
  now: number,
  target?: RfqAttemptTarget,
): RfqLifecycleRecord {
  const allowedStates: Readonly<
    Record<RfqAttemptPhase, readonly RfqLifecycleState[]>
  > = {
    funding: ["reviewing"],
    fill: ["funded"],
    claim: ["claimable"],
    refund: ["refundable"],
    "reservation-release": ["quoted", "reviewing", "cancel-pending", "funded"],
  };
  if (!allowedStates[phase].includes(record.state)) {
    throw new Error(`${phase} cannot begin while the RFQ is ${record.state}.`);
  }
  const existing = record.attempts[phase];
  if (existing?.state === "confirmed") {
    throw new Error(
      `${phase} is already confirmed and cannot be submitted again.`,
    );
  }
  if (
    existing &&
    (existing.state === "preparing" ||
      existing.state === "wallet-boundary-unknown" ||
      existing.state === "submitted-unknown")
  ) {
    throw new Error(
      `${phase} already has an unknown attempt; verify it before retrying.`,
    );
  }
  const stamp = timestamp(now, "now");
  const targetOperation = target?.operation;
  if (
    (phase === "reservation-release" &&
      targetOperation !== "request-reservations" &&
      targetOperation !== "funded-settlement-expiry") ||
    (phase === "funding" && targetOperation !== "funding-ticket") ||
    (phase === "fill" && targetOperation !== "maker-fill") ||
    ((phase === "claim" || phase === "refund") && target)
  ) {
    throw new Error(`${phase} requires its exact immutable attempt target.`);
  }
  const attempt: RfqPhaseAttempt = Object.freeze({
    attemptId: text(attemptId, "attemptId"),
    state: "preparing",
    createdAt: stamp,
    updatedAt: stamp,
    ...(target ? { target: Object.freeze({ ...target }) } : {}),
  });
  const next = reviseRfqLifecycle(record, {
    attempts: Object.freeze({ ...record.attempts, [phase]: attempt }),
    updatedAt: stamp,
  });
  assertRfqLifecycleAttemptTargets(next);
  return next;
}

export function updateRfqPhaseAttempt(
  record: RfqLifecycleRecord,
  phase: RfqAttemptPhase,
  state: Exclude<RfqAttemptState, "not-started" | "preparing">,
  now: number,
  patch: Pick<
    Partial<RfqPhaseAttempt>,
    "transactionHash" | "observation" | "walletBoundary"
  > = {},
): RfqLifecycleRecord {
  const current = record.attempts[phase];
  if (!current) throw new Error(`${phase} has no persisted attempt.`);
  if (current.state === "confirmed")
    throw new Error(`${phase} is already confirmed.`);
  if (
    state === "submitted-unknown" &&
    !patch.transactionHash &&
    !current.transactionHash
  ) {
    throw new Error(
      "A submitted-unknown attempt requires its transaction hash.",
    );
  }
  if (
    state === "wallet-boundary-unknown" &&
    (patch.walletBoundary ?? current.walletBoundary) !== "entered"
  ) {
    throw new Error(
      "A hashless unknown attempt requires durable wallet-boundary evidence.",
    );
  }
  const stamp = timestamp(now, "now");
  const attempt = Object.freeze({
    ...current,
    ...patch,
    state,
    updatedAt: stamp,
  });
  return reviseRfqLifecycle(record, {
    attempts: Object.freeze({ ...record.attempts, [phase]: attempt }),
    ...(phase === "funding" && attempt.transactionHash
      ? { transactionHash: attempt.transactionHash }
      : {}),
    updatedAt: stamp,
  });
}

function parseTerms(value: unknown): RfqExactTerms | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const row = value as Record<string, unknown>;
  const sellDecimals = nonNegativeInteger(row.sellDecimals, "sellDecimals");
  const buyDecimals = nonNegativeInteger(row.buyDecimals, "buyDecimals");
  if (sellDecimals > 255 || buyDecimals > 255) throw new Error();
  return Object.freeze({
    pairId: text(row.pairId, "pairId"),
    sellSymbol: text(row.sellSymbol, "sellSymbol", 32),
    sellAddress: text(row.sellAddress, "sellAddress"),
    sellDecimals,
    sellAmount: decimal(row.sellAmount, "sellAmount", true),
    buySymbol: text(row.buySymbol, "buySymbol", 32),
    buyAddress: text(row.buyAddress, "buyAddress"),
    buyDecimals,
    minBuyAmount: decimal(row.minBuyAmount, "minBuyAmount", true),
    ...(row.buyAmount === undefined
      ? {}
      : { buyAmount: decimal(row.buyAmount, "buyAmount", true) }),
    rfqExpiresAt: timestamp(row.rfqExpiresAt, "rfqExpiresAt"),
  });
}

function parseSelectedQuote(value: unknown): RfqSelectedQuote | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const row = value as Record<string, unknown>;
  if (row.version !== "Quote V1" && row.version !== "Quote V2")
    throw new Error();
  const spreadBps = nonNegativeInteger(row.spreadBps, "spreadBps");
  return Object.freeze({
    version: row.version,
    solverId: text(row.solverId, "solverId"),
    solverKey: text(row.solverKey, "solverKey"),
    nonce: text(row.nonce, "nonce"),
    reservationId: text(row.reservationId, "reservationId"),
    spreadBps,
    pricingProvenance: text(row.pricingProvenance, "pricingProvenance"),
    quotedAt: timestamp(row.quotedAt, "quotedAt"),
    quoteExpiresAt: timestamp(row.quoteExpiresAt, "quoteExpiresAt"),
    reservationExpiresAt: timestamp(
      row.reservationExpiresAt,
      "reservationExpiresAt",
    ),
    buyAmount: decimal(row.buyAmount, "buyAmount", true),
    intentDigest: text(row.intentDigest, "intentDigest"),
    signature: text(row.signature, "signature"),
    ...(row.quoteDigest === undefined
      ? {}
      : { quoteDigest: text(row.quoteDigest, "quoteDigest") }),
    ...(row.reservationFence === undefined
      ? {}
      : {
          reservationFence: decimal(
            row.reservationFence,
            "reservationFence",
            true,
          ),
        }),
  });
}

function parseSettlement(
  value: unknown,
  local: boolean,
): RfqSettlementIdentity | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const row = value as Record<string, unknown>;
  if (row.version !== "Localnet V2") throw new Error();
  return Object.freeze({
    version: row.version,
    escrowAddress: text(row.escrowAddress, "escrowAddress"),
    dealId: local
      ? canonicalLocalRfqId(text(row.dealId, "dealId"))
      : text(row.dealId, "dealId"),
    ...(row.ticketAddress === undefined
      ? {}
      : {
          ticketAddress: local
            ? canonicalLocalRfqId(text(row.ticketAddress, "ticketAddress"))
            : text(row.ticketAddress, "ticketAddress"),
        }),
    ...(row.commitmentDigest === undefined
      ? {}
      : { commitmentDigest: text(row.commitmentDigest, "commitmentDigest") }),
    deadline: timestamp(row.deadline, "deadline"),
  });
}

function parseAttemptTarget(value: unknown): RfqAttemptTarget {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const row = value as Record<string, unknown>;
  const targetChainId = canonicalRfqChainId(
    text(row.chainId, "target chainId"),
  );
  const common = {
    chainId: targetChainId,
    account: canonicalRfqAccount(text(row.account, "target account")),
    rfqId: canonicalExecutableId(
      text(row.rfqId, "target rfqId"),
      targetChainId,
    ),
    requestDigest: text(row.requestDigest, "target requestDigest"),
  };
  if (row.operation === "request-reservations") {
    return Object.freeze({
      operation: row.operation,
      ...common,
      releaseLeaseId: text(row.releaseLeaseId, "target releaseLeaseId"),
    });
  }
  if (row.operation === "funding-ticket") {
    return Object.freeze({
      operation: row.operation,
      ...common,
      dealId: canonicalExecutableId(
        text(row.dealId, "target dealId"),
        targetChainId,
      ),
      solverId: text(row.solverId, "target solverId"),
      reservationId: text(row.reservationId, "target reservationId"),
      reservationFence: decimal(
        row.reservationFence,
        "target reservationFence",
        true,
      ),
      quoteDigest: text(row.quoteDigest, "target quoteDigest"),
      sellToken: text(row.sellToken, "target sellToken"),
      sellAmount: decimal(row.sellAmount, "target sellAmount", true),
      buyToken: text(row.buyToken, "target buyToken"),
      buyAmount: decimal(row.buyAmount, "target buyAmount", true),
      deadline: timestamp(row.deadline, "target deadline"),
    });
  }
  if (row.operation === "maker-fill") {
    return Object.freeze({
      operation: row.operation,
      ...common,
      dealId: canonicalExecutableId(
        text(row.dealId, "target dealId"),
        targetChainId,
      ),
      solverId: text(row.solverId, "target solverId"),
      reservationId: text(row.reservationId, "target reservationId"),
      reservationFence: decimal(
        row.reservationFence,
        "target reservationFence",
        true,
      ),
      quoteDigest: text(row.quoteDigest, "target quoteDigest"),
      sellToken: text(row.sellToken, "target sellToken"),
      sellAmount: decimal(row.sellAmount, "target sellAmount", true),
      buyToken: text(row.buyToken, "target buyToken"),
      buyAmount: decimal(row.buyAmount, "target buyAmount", true),
      deadline: timestamp(row.deadline, "target deadline"),
      ticketAddress: text(row.ticketAddress, "target ticketAddress"),
    });
  }
  if (row.operation !== "funded-settlement-expiry") throw new Error();
  return Object.freeze({
    operation: row.operation,
    ...common,
    dealId: canonicalExecutableId(
      text(row.dealId, "target dealId"),
      targetChainId,
    ),
    escrowAddress: text(row.escrowAddress, "target escrowAddress"),
    solverId: text(row.solverId, "target solverId"),
    reservationId: text(row.reservationId, "target reservationId"),
    reservationFence: decimal(
      row.reservationFence,
      "target reservationFence",
      true,
    ),
    quoteDigest: text(row.quoteDigest, "target quoteDigest"),
  });
}

function parseAttempts(value: unknown): RfqLifecycleRecord["attempts"] {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const phases: readonly RfqAttemptPhase[] = [
    "funding",
    "fill",
    "claim",
    "refund",
    "reservation-release",
  ];
  const result: Partial<Record<RfqAttemptPhase, RfqPhaseAttempt>> = {};
  for (const phase of phases) {
    const candidate = (value as Record<string, unknown>)[phase];
    if (candidate === undefined) continue;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error();
    const row = candidate as Record<string, unknown>;
    if (
      ![
        "preparing",
        "wallet-boundary-unknown",
        "submitted-unknown",
        "confirmed",
        "reverted",
      ].includes(String(row.state))
    )
      throw new Error();
    result[phase] = Object.freeze({
      attemptId: text(row.attemptId, "attemptId"),
      state: row.state as RfqPhaseAttempt["state"],
      createdAt: timestamp(row.createdAt, "createdAt"),
      updatedAt: timestamp(row.updatedAt, "updatedAt"),
      ...(row.transactionHash === undefined
        ? {}
        : { transactionHash: text(row.transactionHash, "transactionHash") }),
      ...(row.observation === undefined
        ? {}
        : { observation: text(row.observation, "observation") }),
      ...(row.walletBoundary === undefined
        ? {}
        : row.walletBoundary === "not-entered" ||
            row.walletBoundary === "entered"
          ? { walletBoundary: row.walletBoundary }
          : (() => {
              throw new Error();
            })()),
      ...(row.target === undefined
        ? {}
        : { target: parseAttemptTarget(row.target) }),
    });
    const targetOperation = result[phase]?.target?.operation;
    if (
      (phase === "reservation-release" &&
        targetOperation !== "request-reservations" &&
        targetOperation !== "funded-settlement-expiry") ||
      (phase === "funding" && targetOperation !== "funding-ticket") ||
      (phase === "fill" && targetOperation !== "maker-fill") ||
      ((phase === "claim" || phase === "refund") && targetOperation)
    )
      throw new Error();
    if (
      result[phase]?.state === "submitted-unknown" &&
      !result[phase]?.transactionHash
    )
      throw new Error();
    if (
      result[phase]?.state === "wallet-boundary-unknown" &&
      result[phase]?.walletBoundary !== "entered"
    )
      throw new Error();
  }
  return Object.freeze(result);
}

function parseObservation(
  value: unknown,
  local: boolean,
): RfqLocalDealObservation | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const row = value as Record<string, unknown>;
  if (row.source !== "localnet-deal") throw new Error();
  const status = nonNegativeInteger(row.status, "status");
  if (
    status > 4 ||
    !["empty", "funded", "filled", "settled", "timed-out", "expired"].includes(
      String(row.stage),
    )
  )
    throw new Error();
  return Object.freeze({
    source: "localnet-deal",
    dealId: local
      ? canonicalLocalRfqId(text(row.dealId, "dealId"))
      : text(row.dealId, "dealId"),
    escrowAddress: text(row.escrowAddress, "escrowAddress"),
    status: status as RfqLocalDealObservation["status"],
    stage: row.stage as RfqLocalDealObservation["stage"],
    observedAt: timestamp(row.observedAt, "observedAt"),
    ...(row.legAToken === undefined
      ? {}
      : { legAToken: text(row.legAToken, "legAToken") }),
    ...(row.legAAmount === undefined
      ? {}
      : { legAAmount: decimal(row.legAAmount, "legAAmount") }),
    ...(row.legBToken === undefined
      ? {}
      : { legBToken: text(row.legBToken, "legBToken") }),
    ...(row.legBTerms === undefined
      ? {}
      : { legBTerms: decimal(row.legBTerms, "legBTerms") }),
    ...(row.legBAmount === undefined
      ? {}
      : { legBAmount: decimal(row.legBAmount, "legBAmount") }),
    ...(row.deadline === undefined
      ? {}
      : { deadline: timestamp(row.deadline, "deadline") }),
    ...(row.ticket === undefined ? {} : { ticket: text(row.ticket, "ticket") }),
    ...(row.commitmentDigest === undefined
      ? {}
      : { commitmentDigest: text(row.commitmentDigest, "commitmentDigest") }),
  });
}

function parseEvidenceAuthority(
  value: unknown,
  now: number,
): RfqEvidenceAuthority {
  if (value === undefined) return defaultEvidenceAuthority(now);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const row = value as Record<string, unknown>;
  const statuses = [
    "local-non-authoritative",
    "authoritative",
    "stale",
    "disagreement",
    "reorged",
    "quarantined",
  ];
  if (!statuses.includes(String(row.status))) throw new Error();
  return Object.freeze({
    status: row.status as RfqEvidenceAuthority["status"],
    label: text(row.label, "authority label"),
    revision: nonNegativeInteger(row.revision, "authority revision"),
    observedAt: timestamp(row.observedAt, "authority observedAt"),
  });
}

function quarantine(
  context: { chainId: string; account: string; now: number },
  reason: string,
  rfqId = "malformed-local-record",
): RfqLifecycleRecord {
  return Object.freeze({
    schemaRevision: RFQ_LIFECYCLE_SCHEMA_REVISION,
    authority: RFQ_RESUME_AUTHORITY_LABEL,
    chainId: canonicalRfqChainId(context.chainId),
    account: canonicalRfqAccount(context.account),
    rfqId,
    state: "quarantined",
    updatedAt: context.now,
    storageRevision: 0,
    attempts: Object.freeze({}),
    evidenceAuthority: Object.freeze({
      status: "quarantined",
      label: "Quarantined browser record · not settlement authority",
      revision: 0,
      observedAt: context.now,
    }),
    reason,
  });
}

function migrateV1(
  row: Record<string, unknown>,
  context: { chainId: string; account: string; now: number },
): RfqLifecycleRecord {
  let rfqId =
    typeof row.rfqId === "string" && row.rfqId.trim()
      ? row.rfqId
      : "malformed-v1-record";
  if (isLocalRfqChain(context.chainId)) {
    try {
      rfqId = canonicalLocalRfqId(rfqId);
    } catch {
      rfqId = "malformed-local-record";
    }
  }
  const migrated = quarantine(
    context,
    "Lifecycle v1 omitted exact terms and settlement bindings; it was migrated to v2 quarantine and no action was retried.",
    rfqId,
  );
  if (typeof row.transactionHash !== "string" || !row.transactionHash.trim())
    return migrated;
  const attempt: RfqPhaseAttempt = Object.freeze({
    attemptId: `migrated-v1:${rfqId}`,
    state: "submitted-unknown",
    createdAt: context.now,
    updatedAt: context.now,
    transactionHash: row.transactionHash,
    observation: "Migrated hash requires manual verification.",
  });
  return Object.freeze({
    ...migrated,
    transactionHash: row.transactionHash,
    attempts: Object.freeze({ funding: attempt }),
  });
}

export function restoreRfqLifecycle(
  value: unknown,
  context: { chainId: string; account: string; now: number },
): RfqLifecycleRecord {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const row = value as Record<string, unknown>;
    if (row.schemaRevision === RFQ_LIFECYCLE_V1_SCHEMA_REVISION)
      return migrateV1(row, context);
    if (
      row.schemaRevision !== RFQ_LIFECYCLE_SCHEMA_REVISION ||
      row.authority !== RFQ_RESUME_AUTHORITY_LABEL
    )
      throw new Error();
    const state = row.state;
    if (typeof state !== "string" || !STATES.has(state as RfqLifecycleState))
      throw new Error();
    const updatedAt = timestamp(row.updatedAt, "updatedAt");
    const chainId = canonicalRfqChainId(text(row.chainId, "chainId"));
    const record: RfqLifecycleRecord = {
      schemaRevision: RFQ_LIFECYCLE_SCHEMA_REVISION,
      authority: RFQ_RESUME_AUTHORITY_LABEL,
      chainId,
      account: canonicalRfqAccount(text(row.account, "account")),
      rfqId: canonicalExecutableId(text(row.rfqId, "rfqId"), chainId),
      state: state as RfqLifecycleState,
      updatedAt,
      storageRevision:
        row.storageRevision === undefined
          ? 0
          : nonNegativeInteger(row.storageRevision, "storageRevision"),
      ...(parseTerms(row.terms) ? { terms: parseTerms(row.terms) } : {}),
      ...(parseSelectedQuote(row.selectedQuote)
        ? { selectedQuote: parseSelectedQuote(row.selectedQuote) }
        : {}),
      ...(parseSettlement(row.settlement, isLocalRfqChain(chainId))
        ? {
            settlement: parseSettlement(
              row.settlement,
              isLocalRfqChain(chainId),
            ),
          }
        : {}),
      attempts: parseAttempts(row.attempts),
      ...(parseObservation(row.latestObservation, isLocalRfqChain(chainId))
        ? {
            latestObservation: parseObservation(
              row.latestObservation,
              isLocalRfqChain(chainId),
            ),
          }
        : {}),
      evidenceAuthority: parseEvidenceAuthority(
        row.evidenceAuthority,
        updatedAt,
      ),
      ...(row.requestDigest === undefined
        ? {}
        : { requestDigest: text(row.requestDigest, "requestDigest") }),
      ...(row.quoteExpiresAt === undefined
        ? {}
        : { quoteExpiresAt: timestamp(row.quoteExpiresAt, "quoteExpiresAt") }),
      ...(row.reservationExpiresAt === undefined
        ? {}
        : {
            reservationExpiresAt: timestamp(
              row.reservationExpiresAt,
              "reservationExpiresAt",
            ),
          }),
      ...(row.transactionHash === undefined
        ? {}
        : { transactionHash: text(row.transactionHash, "transactionHash") }),
      ...(row.reason === undefined
        ? {}
        : { reason: text(row.reason, "reason") }),
    };
    if (
      record.chainId !== canonicalRfqChainId(context.chainId) ||
      record.account !== canonicalRfqAccount(context.account)
    ) {
      return reviseRfqLifecycle(record, {
        state: "quarantined",
        reason:
          "Wallet account or chain does not match this local resume record.",
        updatedAt: context.now,
      });
    }
    if (
      record.state === "reorged" &&
      (record.evidenceAuthority.status !== "reorged" ||
        record.evidenceAuthority.revision <= 0)
    ) {
      return reviseRfqLifecycle(record, {
        state: "quarantined",
        reason:
          "A reorged state requires an increasing evidence-authority signal.",
        updatedAt: context.now,
      });
    }
    let targetMatchesRecord = true;
    try {
      assertRfqLifecycleAttemptTargets(record);
    } catch {
      targetMatchesRecord = false;
    }
    const releaseTarget = record.attempts["reservation-release"]?.target;
    if (
      releaseTarget?.operation === "request-reservations" &&
      !["cancel-pending", "cancelled"].includes(record.state)
    )
      targetMatchesRecord = false;
    if (
      releaseTarget?.operation === "funded-settlement-expiry" &&
      !["funded", "refundable", "refunded"].includes(record.state)
    )
      targetMatchesRecord = false;
    const identityBindingsOk =
      (!record.selectedQuote ||
        !record.requestDigest ||
        record.selectedQuote.intentDigest === record.requestDigest) &&
      (!record.settlement ||
        sameIdentity(record.settlement.dealId, record.rfqId));
    const requiresTermsAndQuote = [
      "quoted",
      "reviewing",
      "submission-unknown",
      "funded",
      "filled",
      "claimable",
      "settled",
      "refundable",
      "refunded",
    ].includes(record.state);
    const requiresSettlement = [
      "submission-unknown",
      "funded",
      "filled",
      "claimable",
      "settled",
      "refundable",
      "refunded",
    ].includes(record.state);
    const terminalInvariantOk =
      record.state === "settled"
        ? record.latestObservation?.status === 3 &&
          record.attempts.claim?.state === "confirmed"
        : record.state === "refunded"
          ? record.latestObservation?.status === 4 &&
            record.attempts.refund?.state === "confirmed"
          : true;
    const submissionInvariantOk =
      record.state !== "submission-unknown" ||
      (record.attempts.funding?.state === "submitted-unknown" &&
        Boolean(record.attempts.funding.transactionHash)) ||
      (record.attempts.funding?.state === "wallet-boundary-unknown" &&
        record.attempts.funding.walletBoundary === "entered");
    if (
      (requiresTermsAndQuote && (!record.terms || !record.selectedQuote)) ||
      (requiresSettlement && !record.settlement) ||
      !terminalInvariantOk ||
      !submissionInvariantOk ||
      !targetMatchesRecord ||
      !identityBindingsOk
    ) {
      return reviseRfqLifecycle(record, {
        state: "quarantined",
        reason:
          "The restored lifecycle state contradicts its exact terms, settlement, observation, or attempt evidence.",
        updatedAt: context.now,
      });
    }
    if (
      (record.state === "quoted" || record.state === "reviewing") &&
      ((record.quoteExpiresAt ?? record.selectedQuote?.quoteExpiresAt ?? 0) <=
        context.now ||
        (record.reservationExpiresAt ??
          record.selectedQuote?.reservationExpiresAt ??
          0) <= context.now)
    ) {
      return reviseRfqLifecycle(record, {
        state: "expired",
        reason:
          "The restored quote or reservation expired. Acceptance is disabled.",
        updatedAt: context.now,
      });
    }
    return Object.freeze(record);
  } catch {
    return quarantine(
      context,
      "Malformed local resume record; no transaction was retried.",
    );
  }
}

export function rfqHasFundingEvidence(record: RfqLifecycleRecord): boolean {
  const attempt = record.attempts.funding;
  return Boolean(
    (attempt &&
      (attempt.walletBoundary === "entered" ||
        attempt.state === "wallet-boundary-unknown" ||
        attempt.state === "submitted-unknown" ||
        attempt.state === "confirmed" ||
        attempt.transactionHash)) ||
      (record.latestObservation?.status ?? 0) > 0 ||
      [
        "submission-unknown",
        "funded",
        "filled",
        "claimable",
        "settled",
        "refundable",
        "refunded",
      ].includes(record.state),
  );
}

export function lifecycleMayForget(record: RfqLifecycleRecord): boolean {
  return ["settled", "refunded", "cancelled", "refused"].includes(record.state);
}

export function lifecycleMaySubmit(
  record: RfqLifecycleRecord,
  now: number,
): boolean {
  const funding = record.attempts.funding;
  return (
    record.state === "reviewing" &&
    !funding &&
    (record.quoteExpiresAt ?? record.selectedQuote?.quoteExpiresAt ?? 0) >
      now &&
    (record.reservationExpiresAt ??
      record.selectedQuote?.reservationExpiresAt ??
      0) > now
  );
}

function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}

function observationFrom(
  value: Record<string, unknown>,
  now: number,
): RfqLocalDealObservation {
  const status = Number(value.status);
  if (!Number.isSafeInteger(status) || status < 0 || status > 4)
    throw new Error("Unknown local chain deal status.");
  const stages = ["empty", "funded", "filled", "settled", "timed-out"] as const;
  const identity = {
    source: "localnet-deal" as const,
    dealId: text(value.dealId, "dealId"),
    escrowAddress: text(value.escrowAddress, "escrowAddress"),
    status: status as RfqLocalDealObservation["status"],
    stage: stages[status],
    observedAt: timestamp(now, "now"),
  };
  if (status === 0) return Object.freeze(identity);
  return Object.freeze({
    ...identity,
    ...(value.legAToken === undefined
      ? {}
      : { legAToken: text(value.legAToken, "legAToken") }),
    ...(value.legAAmount === undefined
      ? {}
      : { legAAmount: decimal(value.legAAmount, "legAAmount") }),
    ...(value.legBToken === undefined
      ? {}
      : { legBToken: text(value.legBToken, "legBToken") }),
    ...(value.legBTerms === undefined
      ? {}
      : { legBTerms: decimal(value.legBTerms, "legBTerms") }),
    ...(value.legBAmount === undefined
      ? {}
      : { legBAmount: decimal(value.legBAmount, "legBAmount") }),
    ...(value.deadline === undefined
      ? {}
      : { deadline: timestamp(value.deadline, "deadline") }),
    ...(value.ticket === undefined
      ? {}
      : { ticket: text(value.ticket, "ticket") }),
    ...(value.commitmentDigest === undefined
      ? {}
      : { commitmentDigest: text(value.commitmentDigest, "commitmentDigest") }),
  });
}

function quarantineRecord(
  record: RfqLifecycleRecord,
  now: number,
  reason: string,
): RfqLifecycleRecord {
  return reviseRfqLifecycle(record, {
    state: "quarantined",
    updatedAt: now,
    reason,
  });
}

/** Read-only reconciliation. It binds identity and exact public terms and never submits or retries. */
export function reconcileRfqLifecycleWithLocalDeal(
  record: RfqLifecycleRecord,
  value: unknown,
  now: number,
): RfqLifecycleRecord {
  try {
    if (!record.settlement || !record.terms || !record.selectedQuote) {
      return quarantineRecord(
        record,
        now,
        "Local reconciliation requires persisted exact terms, selected quote, and settlement identity.",
      );
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Malformed local chain observation.");
    const observation = observationFrom(value as Record<string, unknown>, now);
    if (
      !sameFelt(observation.dealId, record.settlement.dealId) ||
      !sameFelt(observation.escrowAddress, record.settlement.escrowAddress)
    ) {
      return quarantineRecord(
        record,
        now,
        "Local chain observation does not match the persisted deal and escrow identity.",
      );
    }
    if (
      record.settlement.commitmentDigest &&
      observation.commitmentDigest !== record.settlement.commitmentDigest
    ) {
      return quarantineRecord(
        record,
        now,
        "Local chain observation does not match the persisted commitment.",
      );
    }
    if (observation.status > 0) {
      const bindingsOk =
        observation.legAToken &&
        sameFelt(observation.legAToken, record.terms.sellAddress) &&
        observation.legAAmount === record.terms.sellAmount &&
        observation.legBToken &&
        sameFelt(observation.legBToken, record.terms.buyAddress) &&
        observation.legBTerms === record.selectedQuote.buyAmount &&
        observation.deadline === record.settlement.deadline &&
        observation.ticket &&
        (!record.settlement.ticketAddress ||
          sameFelt(observation.ticket, record.settlement.ticketAddress));
      if (!bindingsOk)
        return quarantineRecord(
          record,
          now,
          "Local chain deal terms contradict the persisted RFQ settlement binding.",
        );
      if (
        (observation.status === 2 || observation.status === 3) &&
        observation.legBAmount !== record.selectedQuote.buyAmount
      ) {
        return quarantineRecord(
          record,
          now,
          "Observed fill amount contradicts the selected exact quote.",
        );
      }
    }

    let attempts = record.attempts;
    const confirm = (phase: RfqAttemptPhase, label: string) => {
      const attempt = attempts[phase];
      if (attempt?.state === "confirmed") return;
      if (!attempt && phase === "funding") return;
      attempts = Object.freeze({
        ...attempts,
        [phase]: Object.freeze(
          attempt
            ? {
                ...attempt,
                state: "confirmed",
                updatedAt: now,
                observation: label,
              }
            : {
                attemptId: `observed:${phase}:${observation.dealId}`,
                state: "confirmed",
                createdAt: now,
                updatedAt: now,
                observation: label,
              },
        ),
      });
    };
    let state = record.state;
    if (
      (record.state === "settled" && observation.status !== 3) ||
      (record.state === "refunded" && observation.status !== 4)
    ) {
      return quarantineRecord(
        record,
        now,
        "A non-authoritative local observation contradicts the persisted terminal outcome.",
      );
    }
    if (observation.status === 0) {
      if (
        [
          "funded",
          "filled",
          "claimable",
          "settled",
          "refundable",
          "refunded",
        ].includes(state)
      ) {
        return quarantineRecord(
          record,
          now,
          "Browser lifecycle contradicts an empty local chain deal.",
        );
      }
    } else if (observation.status === 1) {
      confirm("funding", "Exact funded deal observed on local devnet.");
      if (
        ["reviewing", "submission-unknown", "funded"].includes(state) ||
        (state === "expired" && record.latestObservation?.stage !== "expired")
      )
        state = "funded";
      else if (!["expired", "refundable"].includes(state))
        return quarantineRecord(
          record,
          now,
          "Funded observation contradicts the browser lifecycle phase.",
        );
    } else if (observation.status === 2) {
      confirm("funding", "Exact funded deal observed on local devnet.");
      confirm("fill", "Exact maker fill observed on local devnet.");
      if (!["settled", "refunded"].includes(state)) state = "claimable";
    } else if (observation.status === 3) {
      confirm("funding", "Exact funded deal observed on local devnet.");
      confirm("fill", "Exact maker fill observed on local devnet.");
      confirm("claim", "Exact claim outcome observed on local devnet.");
      state = "settled";
    } else {
      confirm("funding", "Exact funded deal observed on local devnet.");
      confirm("refund", "Exact timeout outcome observed on local devnet.");
      state = "refunded";
    }
    const latestObservation =
      observation.status === 1 &&
      ["expired", "refundable"].includes(state) &&
      record.latestObservation?.stage === "expired"
        ? record.latestObservation
        : observation;
    return reviseRfqLifecycle(record, {
      state,
      attempts,
      latestObservation,
      updatedAt: now,
    });
  } catch (error: unknown) {
    return quarantineRecord(
      record,
      now,
      error instanceof Error
        ? error.message
        : "Malformed local chain observation.",
    );
  }
}

/** Records expiry only from the local harness response, never from a browser clock guess. */
export function observeLocalSettlementExpiry(
  record: RfqLifecycleRecord,
  expiredAt: number,
): RfqLifecycleRecord {
  if (record.state !== "funded" || !record.settlement)
    throw new Error(
      "Only a confirmed funded deal can observe settlement expiry.",
    );
  const stamp = timestamp(expiredAt, "expiredAt");
  if (stamp < record.settlement.deadline)
    throw new Error(
      "Settlement expiry was not observed at or after its deadline.",
    );
  const previous = record.latestObservation;
  const latestObservation: RfqLocalDealObservation = Object.freeze({
    source: "localnet-deal",
    dealId: record.settlement.dealId,
    escrowAddress: record.settlement.escrowAddress,
    status: 1,
    stage: "expired",
    observedAt: stamp,
    ...(previous?.legAToken ? { legAToken: previous.legAToken } : {}),
    ...(previous?.legAAmount ? { legAAmount: previous.legAAmount } : {}),
    ...(previous?.legBToken ? { legBToken: previous.legBToken } : {}),
    ...(previous?.legBTerms ? { legBTerms: previous.legBTerms } : {}),
    ...(previous?.legBAmount ? { legBAmount: previous.legBAmount } : {}),
    deadline: record.settlement.deadline,
    ...(record.settlement.ticketAddress
      ? { ticket: record.settlement.ticketAddress }
      : {}),
  });
  return reviseRfqLifecycle(record, {
    state: "refundable",
    latestObservation,
    updatedAt: stamp,
  });
}

export function applyRfqAuthoritySignal(
  record: RfqLifecycleRecord,
  signal: RfqEvidenceAuthority,
): RfqLifecycleRecord {
  if (signal.revision <= record.evidenceAuthority.revision)
    throw new Error("Evidence authority revision must increase.");
  if (signal.status === "reorged") {
    if (record.state !== "settled" && record.state !== "refunded") {
      throw new Error(
        "Only a terminal observed outcome can be marked reorged.",
      );
    }
    return reviseRfqLifecycle(record, {
      state: "reorged",
      evidenceAuthority: signal,
      updatedAt: signal.observedAt,
      reason: "Authority reported canonical membership loss.",
    });
  }
  return reviseRfqLifecycle(record, {
    evidenceAuthority: signal,
    updatedAt: signal.observedAt,
  });
}
