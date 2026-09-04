import {
  aggregateMids,
  decodeMakerMid,
  importQuotePublicKey,
  verifyCanonicalQuote,
  verifyMakerMid,
  type AggregatedMids,
  type MakerIndicativeMidV1,
  type MakerMidVerification,
} from "@app20/private-intents";
import { resolveLocalnetQuoteKey } from "@/lib/localnet-quote-authority";

export const LOCALNET_OPERATIONS_SCHEMA =
  "app20/rfq-operations-status/v1" as const;
export const LOCALNET_ECONOMIC_POLICY_ID =
  "app20/localnet-rfq-economics/fixture-v1" as const;
export const LOCALNET_APP20_FEE_POLICY_ID =
  "app20/localnet-app20-fee/zero-fixture-v1" as const;
const LOCALNET_REFERENCE_POLICY_ID =
  "app20/localnet-strk-usdc-reference/fixed-2-v1" as const;
export const LOCALNET_MAX_TOTAL_DEVIATION_BPS = 100;
export const LOCALNET_MAX_MAKER_SPREAD_BPS = 50;
const LOCALNET_STATUS_MAX_AGE_SECONDS = 30;

type OperationsMode = "running" | "paused" | "drain-only" | "stale" | "unknown";
type CapacityBand = "none" | "small" | "medium" | "large" | "unknown";
type MakerInvitationStatus =
  | "not-invited"
  | "responded"
  | "refused"
  | "unavailable";

type MakerKeyStatus = "valid" | "expired" | "rotated" | "revoked";

export type BrowserSafeMakerStatus = Readonly<{
  makerId: string;
  keyId: string;
  keyStatus: MakerKeyStatus;
  keyValidUntil: number;
  invitationStatus: MakerInvitationStatus;
  capacityBand: CapacityBand;
  eligible: boolean;
  rationale: string;
}>;

export type MakerDirectoryStatus = Readonly<{
  epoch: 0;
  checkpoint: "local-fixture-checkpoint-v1";
  validUntil: number;
}>;

export type MakerCohortSummary = Readonly<{
  governed: number;
  invited: number;
  responded: number;
  refused: number;
  unavailable: number;
}>;

export type DirectoryFreshnessState = "fresh" | "expiring" | "expired";

type RfqLockCounts = Readonly<{
  open: number;
  expiredAwaitingSettlement: number;
  settled: number;
}>;

type RfqTranscriptCounts = Readonly<{
  received: number;
  consistent: number;
}>;

export type RfqOperationsStatus = Readonly<{
  schema: typeof LOCALNET_OPERATIONS_SCHEMA;
  environment: "localnet";
  observedAt: number;
  validUntil: number;
  mode: Exclude<OperationsMode, "stale" | "unknown">;
  reason: string;
  claimsAndRefundsEnabled: true;
  directory: MakerDirectoryStatus;
  cohort: MakerCohortSummary;
  makers: readonly BrowserSafeMakerStatus[];
  mids?: readonly MakerIndicativeMidV1[];
  locks?: RfqLockCounts;
  transcripts?: RfqTranscriptCounts;
  /** Present only after every mid has passed browser-side fixture-key verification. */
  midAggregate?: AggregatedMids;
  rawInventoryExposed: false;
}>;

export type OperationsAvailability = Readonly<{
  mode: OperationsMode;
  reason: string;
  claimsAndRefundsEnabled: true;
  asOf: number;
  status?: RfqOperationsStatus;
  verifiedMids?: readonly MakerIndicativeMidV1[];
  midAggregate?: AggregatedMids;
  locks?: RfqLockCounts;
  transcripts?: RfqTranscriptCounts;
}>;

const SAFE_TEXT = /^[a-zA-Z0-9 .,:;/_()\-·]+$/;
const FORBIDDEN_KEYS =
  /(?:pid|account|balance|inventory|operationLog|logs?|private|secret|token)$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is malformed.`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort().join(",");
  if (actual !== [...expected].sort().join(","))
    throw new Error(`${label} schema is unsupported.`);
}

function safeText(value: unknown, label: string, maximum = 180): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    !SAFE_TEXT.test(value)
  ) {
    throw new Error(`${label} is unsafe or missing.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new Error(`${label} is invalid.`);
  return Number(value);
}

function assertNoForbiddenFields(value: unknown, path = "status"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoForbiddenFields(item, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key !== "rawInventoryExposed" && FORBIDDEN_KEYS.test(key)) {
      throw new Error(
        `Browser-safe operations status contains forbidden field ${path}.${key}.`,
      );
    }
    assertNoForbiddenFields(child, `${path}.${key}`);
  }
}

function normalizeMaker(value: unknown): BrowserSafeMakerStatus {
  const maker = record(value, "Maker status");
  exactKeys(
    maker,
    [
      "makerId",
      "keyId",
      "keyStatus",
      "keyValidUntil",
      "invitationStatus",
      "capacityBand",
      "eligible",
      "rationale",
    ],
    "Maker status",
  );
  if (
    !["valid", "expired", "rotated", "revoked"].includes(
      String(maker.keyStatus),
    )
  )
    throw new Error("Maker key status is unsupported.");
  const keyValidUntil = timestamp(
    maker.keyValidUntil,
    "Maker key validity time",
  );
  if (
    !["not-invited", "responded", "refused", "unavailable"].includes(
      String(maker.invitationStatus),
    )
  ) {
    throw new Error("Maker invitation status is unsupported.");
  }
  if (
    !["none", "small", "medium", "large", "unknown"].includes(
      String(maker.capacityBand),
    )
  ) {
    throw new Error("Maker capacity band is unsupported.");
  }
  if (typeof maker.eligible !== "boolean")
    throw new Error("Maker eligibility is missing.");
  if (
    maker.eligible &&
    (maker.keyStatus !== "valid" ||
      maker.invitationStatus === "refused" ||
      maker.invitationStatus === "unavailable" ||
      maker.capacityBand === "none" ||
      maker.capacityBand === "unknown")
  ) {
    throw new Error(
      "Maker eligibility contradicts its browser-safe invitation or capacity status.",
    );
  }
  return Object.freeze({
    makerId: safeText(maker.makerId, "Maker id"),
    keyId: safeText(maker.keyId, "Maker key id"),
    keyStatus: maker.keyStatus as MakerKeyStatus,
    keyValidUntil,
    invitationStatus: maker.invitationStatus as MakerInvitationStatus,
    capacityBand: maker.capacityBand as CapacityBand,
    eligible: maker.eligible,
    rationale: safeText(maker.rationale, "Maker rationale"),
  });
}

export function normalizeMakerCohort(
  value: unknown,
  observedAt?: number,
): readonly BrowserSafeMakerStatus[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Maker cohort is unavailable.");
  const makers = value
    .map(normalizeMaker)
    .sort((left, right) => left.makerId.localeCompare(right.makerId));
  if (new Set(makers.map((maker) => maker.makerId)).size !== makers.length)
    throw new Error("Maker cohort contains duplicate identities.");
  if (
    observedAt !== undefined &&
    makers.some(
      (maker) =>
        (maker.keyStatus === "valid") !== maker.keyValidUntil > observedAt,
    )
  )
    throw new Error("Maker key status contradicts its validity deadline.");
  return Object.freeze(makers);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`${label} is invalid.`);
  return Number(value);
}

function normalizeCohortSummary(
  value: unknown,
  makers: readonly BrowserSafeMakerStatus[],
): MakerCohortSummary {
  const summary = record(value, "Maker cohort summary");
  exactKeys(
    summary,
    ["governed", "invited", "responded", "refused", "unavailable"],
    "Maker cohort summary",
  );
  const normalized = Object.freeze({
    governed: nonNegativeInteger(summary.governed, "Governed maker count"),
    invited: nonNegativeInteger(summary.invited, "Invited maker count"),
    responded: nonNegativeInteger(summary.responded, "Maker response count"),
    refused: nonNegativeInteger(summary.refused, "Maker refusal count"),
    unavailable: nonNegativeInteger(
      summary.unavailable,
      "Unavailable maker count",
    ),
  });
  const expected = {
    governed: makers.length,
    invited: makers.filter((maker) => maker.invitationStatus !== "not-invited")
      .length,
    responded: makers.filter((maker) => maker.invitationStatus === "responded")
      .length,
    refused: makers.filter((maker) => maker.invitationStatus === "refused")
      .length,
    unavailable: makers.filter(
      (maker) => maker.invitationStatus === "unavailable",
    ).length,
  };
  if (
    Object.entries(expected).some(
      ([key, count]) => normalized[key as keyof MakerCohortSummary] !== count,
    )
  )
    throw new Error("Maker cohort summary contradicts the governed makers.");
  return normalized;
}

export function directoryFreshnessState(
  directory: MakerDirectoryStatus,
  now: number,
): DirectoryFreshnessState {
  if (now >= directory.validUntil) return "expired";
  if (directory.validUntil - now <= 10) return "expiring";
  return "fresh";
}

export function summarizeMakerCohort(
  makers: readonly BrowserSafeMakerStatus[],
  governed = makers.length,
): MakerCohortSummary {
  return Object.freeze({
    governed,
    invited: makers.filter((maker) => maker.invitationStatus !== "not-invited")
      .length,
    responded: makers.filter((maker) => maker.invitationStatus === "responded")
      .length,
    refused: makers.filter((maker) => maker.invitationStatus === "refused")
      .length,
    unavailable: makers.filter(
      (maker) => maker.invitationStatus === "unavailable",
    ).length,
  });
}

export function normalizeRfqOperationsStatus(
  value: unknown,
): RfqOperationsStatus {
  assertNoForbiddenFields(value);
  const status = record(value, "RFQ operations status");
  exactKeys(
    status,
    [
      "schema",
      "environment",
      "observedAt",
      "validUntil",
      "mode",
      "reason",
      "claimsAndRefundsEnabled",
      "directory",
      "cohort",
      "makers",
      "mids",
      "locks",
      "transcripts",
      "rawInventoryExposed",
    ],
    "RFQ operations status",
  );
  if (
    status.schema !== LOCALNET_OPERATIONS_SCHEMA ||
    status.environment !== "localnet"
  )
    throw new Error("RFQ operations environment is unsupported.");
  if (!["running", "paused", "drain-only"].includes(String(status.mode)))
    throw new Error("RFQ operations mode is unsupported.");
  if (
    status.claimsAndRefundsEnabled !== true ||
    status.rawInventoryExposed !== false
  )
    throw new Error("RFQ recovery or inventory boundary is invalid.");
  const observedAt = timestamp(
    status.observedAt,
    "Operations observation time",
  );
  const validUntil = timestamp(status.validUntil, "Operations validity time");
  if (
    validUntil <= observedAt ||
    validUntil - observedAt > LOCALNET_STATUS_MAX_AGE_SECONDS
  )
    throw new Error("RFQ operations freshness window is invalid.");
  const directory = record(status.directory, "Maker directory status");
  exactKeys(
    directory,
    ["epoch", "checkpoint", "validUntil"],
    "Maker directory status",
  );
  if (
    directory.epoch !== 0 ||
    directory.checkpoint !== "local-fixture-checkpoint-v1"
  )
    throw new Error("Maker directory checkpoint is unsupported.");
  const directoryValidUntil = timestamp(
    directory.validUntil,
    "Maker directory validity time",
  );
  const makers = normalizeMakerCohort(status.makers, observedAt);
  const cohort = normalizeCohortSummary(status.cohort, makers);
  if (!Array.isArray(status.mids))
    throw new Error("Maker indicative mids are malformed.");
  const mids = status.mids.map((mid) => decodeMakerMid(mid));
  if (new Set(mids.map((mid) => mid.makerId)).size !== mids.length)
    throw new Error("Maker indicative mids contain duplicate identities.");
  for (const mid of mids) {
    const maker = makers.find(({ makerId }) => makerId === mid.makerId);
    if (!maker || maker.keyId !== mid.quoteKeyId)
      throw new Error("Maker indicative mid key binding is not governed.");
  }
  const locks = record(status.locks, "RFQ lock counts");
  exactKeys(
    locks,
    ["open", "expiredAwaitingSettlement", "settled"],
    "RFQ lock counts",
  );
  const normalizedLocks = Object.freeze({
    open: nonNegativeInteger(locks.open, "Open lock count"),
    expiredAwaitingSettlement: nonNegativeInteger(
      locks.expiredAwaitingSettlement,
      "Expired lock count",
    ),
    settled: nonNegativeInteger(locks.settled, "Settled lock count"),
  });
  const transcripts = record(status.transcripts, "RFQ transcript counts");
  exactKeys(transcripts, ["received", "consistent"], "RFQ transcript counts");
  const normalizedTranscripts = Object.freeze({
    received: nonNegativeInteger(
      transcripts.received,
      "Received transcript count",
    ),
    consistent: nonNegativeInteger(
      transcripts.consistent,
      "Consistent transcript count",
    ),
  });
  if (normalizedTranscripts.consistent > normalizedTranscripts.received)
    throw new Error("RFQ transcript counts are contradictory.");
  return Object.freeze({
    schema: LOCALNET_OPERATIONS_SCHEMA,
    environment: "localnet",
    observedAt,
    validUntil,
    mode: status.mode as RfqOperationsStatus["mode"],
    reason: safeText(status.reason, "Operations reason"),
    claimsAndRefundsEnabled: true,
    directory: Object.freeze({
      epoch: 0,
      checkpoint: "local-fixture-checkpoint-v1",
      validUntil: directoryValidUntil,
    }),
    cohort,
    makers: Object.freeze(makers),
    mids: Object.freeze(mids),
    locks: normalizedLocks,
    transcripts: normalizedTranscripts,
    rawInventoryExposed: false,
  });
}

export async function verifyRfqOperationsMids(
  status: RfqOperationsStatus,
  now: number,
  verification: MakerMidVerification = {
    importPublicKey: importQuotePublicKey,
    verify: verifyCanonicalQuote,
    resolveKey: resolveLocalnetQuoteKey,
  },
): Promise<RfqOperationsStatus> {
  const mids = status.mids ?? [];
  await Promise.all(mids.map((mid) => verifyMakerMid(mid, now, verification)));
  return Object.freeze({
    ...status,
    mids: Object.freeze(mids),
    midAggregate: aggregateMids(mids),
  });
}

function eligibleMakerIds(
  status: RfqOperationsStatus | undefined,
  now: number,
): string {
  return (
    status?.makers
      .filter(
        (maker) =>
          maker.eligible &&
          maker.keyStatus === "valid" &&
          maker.keyValidUntil > now,
      )
      .map((maker) => maker.makerId)
      .join(",") ?? ""
  );
}

/** Fingerprint of gating-relevant operations state, excluding the raw clock. */
function operationsAvailabilityFingerprint(
  availability: OperationsAvailability,
): string {
  return [
    availability.mode,
    availability.reason,
    String(availability.claimsAndRefundsEnabled),
    eligibleMakerIds(availability.status, availability.asOf),
    availability.status?.validUntil ?? 0,
    availability.status?.directory.validUntil ?? 0,
  ].join("|");
}

export type OperationsRefreshSnapshot = Readonly<{
  status: RfqOperationsStatus | null;
  now: number;
}>;

/** Couples a fetched status to the browser time observed after that fetch. */
export function synchronizeOperationsRefresh(
  status: RfqOperationsStatus | null,
  now: number,
): OperationsRefreshSnapshot {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error(
      "Operations refresh time must be a non-negative timestamp.",
    );
  }
  return Object.freeze({ status, now });
}

export function shouldPublishOperationsClock(
  status: RfqOperationsStatus | null,
  previousNow: number,
  nextNow: number,
): boolean {
  if (nextNow === previousNow) return false;
  return (
    operationsAvailabilityFingerprint(
      operationsAvailability(status, previousNow),
    ) !==
    operationsAvailabilityFingerprint(operationsAvailability(status, nextNow))
  );
}

export function operationsAvailability(
  status: RfqOperationsStatus | null,
  now: number,
): OperationsAvailability {
  if (!status)
    return Object.freeze({
      mode: "unknown",
      reason: "Browser-safe localnet operations status is unavailable.",
      claimsAndRefundsEnabled: true,
      asOf: now,
      verifiedMids: Object.freeze([]),
      midAggregate: Object.freeze({
        medianE18: 0n,
        dispersionBps: 0,
        count: 0,
      }),
    });
  if (status.observedAt > now + 5) {
    return Object.freeze({
      mode: "unknown",
      reason: "Localnet operations status is dated in the future.",
      claimsAndRefundsEnabled: true,
      asOf: now,
      verifiedMids: status.midAggregate
        ? (status.mids ?? Object.freeze([]))
        : Object.freeze([]),
      midAggregate: status.midAggregate,
      locks: status.locks,
      transcripts: status.transcripts,
    });
  }
  if (
    now >= status.validUntil ||
    directoryFreshnessState(status.directory, now) !== "fresh"
  ) {
    return Object.freeze({
      mode: "stale",
      reason: "Localnet incident or maker-directory status is stale.",
      claimsAndRefundsEnabled: true,
      asOf: now,
      status,
      verifiedMids: status.midAggregate
        ? (status.mids ?? Object.freeze([]))
        : Object.freeze([]),
      midAggregate: status.midAggregate,
      locks: status.locks,
      transcripts: status.transcripts,
    });
  }
  return Object.freeze({
    mode: status.mode,
    reason: status.reason,
    claimsAndRefundsEnabled: true,
    asOf: now,
    status,
    verifiedMids: status.midAggregate
      ? (status.mids ?? Object.freeze([]))
      : Object.freeze([]),
    midAggregate: status.midAggregate,
    locks: status.locks,
    transcripts: status.transcripts,
  });
}

export function gateRfqAction(
  availability: OperationsAvailability,
  action: "request" | "fund" | "fill" | "take" | "claim" | "refund",
  selectedMakerId?: string,
): Readonly<{ allowed: boolean; reason: string }> {
  if (action === "claim" || action === "refund") {
    return Object.freeze({
      allowed: true,
      reason: "Claims and refunds remain enabled in every incident mode.",
    });
  }
  if (availability.mode !== "running") {
    return Object.freeze({
      allowed: false,
      reason: `RFQ ${action} is blocked while operations are ${availability.mode}. Claims and refunds remain available.`,
    });
  }
  const eligibleMakers =
    availability.status?.makers.filter(
      (maker) =>
        maker.eligible &&
        maker.keyStatus === "valid" &&
        maker.keyValidUntil > availability.asOf,
    ) ?? [];
  if (eligibleMakers.length === 0) {
    return Object.freeze({
      allowed: false,
      reason: `RFQ ${action} is blocked because no maker is currently eligible. Claims and refunds remain available.`,
    });
  }
  if (
    selectedMakerId &&
    !eligibleMakers.some((maker) => maker.makerId === selectedMakerId)
  ) {
    return Object.freeze({
      allowed: false,
      reason: `RFQ ${action} is blocked because the selected maker is not currently eligible. Claims and refunds remain available.`,
    });
  }
  return Object.freeze({
    allowed: true,
    reason: "Browser-safe operations status is fresh and running.",
  });
}

export type LocalnetEconomicReview = Readonly<{
  policyId: typeof LOCALNET_ECONOMIC_POLICY_ID;
  referencePolicyId: typeof LOCALNET_REFERENCE_POLICY_ID;
  referenceGrossBuyAmount: bigint;
  minimumPolicyFloor: bigint;
  reviewedFloor: bigint;
  maximumTotalDeviationBps: number;
  maximumMakerSpreadBps: number;
  perTradeCapBaseUnits: bigint;
  fullFillOnly: true;
}>;

export function localnetEconomicReview(input: {
  pairId: "STRK_USDC" | "USDC_STRK";
  sellAmount: bigint;
  requestedFloor?: bigint;
  surface: "swap" | "block";
}): LocalnetEconomicReview {
  if (input.sellAmount <= 0n) throw new Error("Sell amount must be positive.");
  const referenceGrossBuyAmount =
    input.pairId === "STRK_USDC"
      ? (input.sellAmount * 2n * 10n ** 6n) / 10n ** 18n
      : (input.sellAmount * 10n ** 18n) / (2n * 10n ** 6n);
  if (referenceGrossBuyAmount <= 0n)
    throw new Error(
      "Sell amount is below the localnet reference denomination.",
    );
  const floorNumerator =
    referenceGrossBuyAmount * BigInt(10_000 - LOCALNET_MAX_TOTAL_DEVIATION_BPS);
  const minimumPolicyFloor = (floorNumerator + 9_999n) / 10_000n;
  const reviewedFloor =
    input.surface === "swap"
      ? minimumPolicyFloor
      : (input.requestedFloor ?? 0n);
  if (
    reviewedFloor < minimumPolicyFloor ||
    reviewedFloor > referenceGrossBuyAmount
  ) {
    throw new Error(
      `Minimum receive must remain within the reviewed 0–${LOCALNET_MAX_TOTAL_DEVIATION_BPS} bps deviation band.`,
    );
  }
  const perTradeCapBaseUnits =
    input.pairId === "STRK_USDC" ? 50n * 10n ** 18n : 100n * 10n ** 6n;
  if (input.sellAmount > perTradeCapBaseUnits)
    throw new Error(
      "Sell amount exceeds the named localnet fixture per-trade cap.",
    );
  return Object.freeze({
    policyId: LOCALNET_ECONOMIC_POLICY_ID,
    referencePolicyId: LOCALNET_REFERENCE_POLICY_ID,
    referenceGrossBuyAmount,
    minimumPolicyFloor,
    reviewedFloor,
    maximumTotalDeviationBps: LOCALNET_MAX_TOTAL_DEVIATION_BPS,
    maximumMakerSpreadBps: LOCALNET_MAX_MAKER_SPREAD_BPS,
    perTradeCapBaseUnits,
    fullFillOnly: true,
  });
}
