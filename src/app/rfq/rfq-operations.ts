export const LOCALNET_OPERATIONS_SCHEMA =
  "app20/rfq-operations-status/v1" as const;
export const LOCALNET_ECONOMIC_POLICY_ID =
  "app20/localnet-rfq-economics/fixture-v1" as const;
export const LOCALNET_APP20_FEE_POLICY_ID =
  "app20/localnet-app20-fee/zero-fixture-v1" as const;
export const LOCALNET_REFERENCE_POLICY_ID =
  "app20/localnet-strk-usdc-reference/fixed-2-v1" as const;
export const LOCALNET_MAX_TOTAL_DEVIATION_BPS = 100;
export const LOCALNET_MAX_MAKER_SPREAD_BPS = 50;
export const LOCALNET_STATUS_MAX_AGE_SECONDS = 30;

export type OperationsMode =
  | "running"
  | "paused"
  | "drain-only"
  | "stale"
  | "unknown";
export type CapacityBand = "none" | "small" | "medium" | "large" | "unknown";
export type MakerInvitationStatus =
  | "not-invited"
  | "responded"
  | "refused"
  | "unavailable";

export type BrowserSafeMakerStatus = Readonly<{
  makerId: string;
  keyId: string;
  invitationStatus: MakerInvitationStatus;
  capacityBand: CapacityBand;
  eligible: boolean;
  rationale: string;
}>;

export type RfqOperationsStatus = Readonly<{
  schema: typeof LOCALNET_OPERATIONS_SCHEMA;
  environment: "localnet";
  observedAt: number;
  validUntil: number;
  mode: Exclude<OperationsMode, "stale" | "unknown">;
  reason: string;
  claimsAndRefundsEnabled: true;
  directory: Readonly<{
    epoch: 0;
    checkpoint: "local-fixture-checkpoint-v1";
    validUntil: number;
  }>;
  makers: readonly BrowserSafeMakerStatus[];
  rawInventoryExposed: false;
}>;

export type OperationsAvailability = Readonly<{
  mode: OperationsMode;
  reason: string;
  claimsAndRefundsEnabled: true;
  status?: RfqOperationsStatus;
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
      "invitationStatus",
      "capacityBand",
      "eligible",
      "rationale",
    ],
    "Maker status",
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
    (maker.invitationStatus === "refused" ||
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
    invitationStatus: maker.invitationStatus as MakerInvitationStatus,
    capacityBand: maker.capacityBand as CapacityBand,
    eligible: maker.eligible,
    rationale: safeText(maker.rationale, "Maker rationale"),
  });
}

export function normalizeMakerCohort(
  value: unknown,
): readonly BrowserSafeMakerStatus[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Maker cohort is unavailable.");
  const makers = value
    .map(normalizeMaker)
    .sort((left, right) => left.makerId.localeCompare(right.makerId));
  if (new Set(makers.map((maker) => maker.makerId)).size !== makers.length)
    throw new Error("Maker cohort contains duplicate identities.");
  return Object.freeze(makers);
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
      "makers",
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
  const makers = normalizeMakerCohort(status.makers);
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
    makers: Object.freeze(makers),
    rawInventoryExposed: false,
  });
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
    });
  if (status.observedAt > now + 5) {
    return Object.freeze({
      mode: "unknown",
      reason: "Localnet operations status is dated in the future.",
      claimsAndRefundsEnabled: true,
    });
  }
  if (now >= status.validUntil || now >= status.directory.validUntil) {
    return Object.freeze({
      mode: "stale",
      reason: "Localnet incident or maker-directory status is stale.",
      claimsAndRefundsEnabled: true,
      status,
    });
  }
  return Object.freeze({
    mode: status.mode,
    reason: status.reason,
    claimsAndRefundsEnabled: true,
    status,
  });
}

export function gateRfqAction(
  availability: OperationsAvailability,
  action: "request" | "fund" | "fill" | "claim" | "refund",
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
  const eligibleMakers = availability.status?.makers.filter(
    (maker) => maker.eligible,
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

export function humanTokenUnits(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals) || "0";
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}
