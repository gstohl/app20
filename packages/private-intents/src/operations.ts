import { canonicalizeStarknetFelt } from "@app20/domain";
import type { FillRecord, StarknetPool } from "./index.js";

export const RISK_MANIFEST_DOMAIN = "app20/maker-risk-manifest/v1" as const;
export const RISK_EXCEPTION_DOMAIN = "app20/maker-risk-exception/v1" as const;
export const OPERATIONS_HAS_ATOMIC_CROSSING = false as const;
export const OPERATIONS_HAS_INVENTORY_PROOF = false as const;
export const MIN_PUBLIC_HEDGE_DWELL_SECONDS = 30 * 60;
export const DEFAULT_MAX_PUBLIC_HEDGE_DWELL_SECONDS = 4 * 60 * 60;

const HEX32 = /^0x[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const U256_MAX = (1n << 256n) - 1n;
const VERIFIED_RISK_MANIFEST = Symbol("app20.verified-risk-manifest");
const VERIFIED_RISK_EXCEPTION = Symbol("app20.verified-risk-exception");
const VERIFIED_RISK_MANIFESTS = new WeakSet<object>();
const VERIFIED_RISK_EXCEPTIONS = new WeakSet<object>();
export const MAX_EXPOSURE_SNAPSHOT_AGE_SECONDS = 5 * 60;

type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export type RiskApprovalRole = "risk" | "operations" | "security_compliance";

export type RiskManifestAssetV1 = Readonly<{
  token: string;
  denominationBaseUnits: string;
  minBatchBaseUnits: string;
  maxPerTradeBaseUnits: string;
  maxGrossExposureBaseUnits: string;
  maxNetExposureBaseUnits: string;
  maxDailyFilledBaseUnits: string;
}>;

export type RiskManifestVenueV1 = Readonly<{
  venueId: string;
  route: "public";
  enabled: boolean;
}>;

export type RiskManifestBodyV1 = Readonly<{
  domain: typeof RISK_MANIFEST_DOMAIN;
  version: 1;
  manifestId: string;
  previousManifestDigest: string | null;
  makerId: string;
  chainId: StarknetPool;
  registryRevision: string;
  issuedAt: number;
  validFrom: number;
  validUntil: number;
  minimumHedgeDwellSeconds: number;
  maximumHedgeDwellSeconds: number;
  assets: readonly RiskManifestAssetV1[];
  venues: readonly RiskManifestVenueV1[];
}>;

export type RiskManifestApprovalV1 = Readonly<{
  role: RiskApprovalRole;
  approverKeyId: string;
  signature: string;
}>;

export type SignedRiskManifestV1 = Readonly<{
  version: 1;
  body: RiskManifestBodyV1;
  bodyDigest: string;
  approvals: readonly RiskManifestApprovalV1[];
}>;

export type VerifiedRiskManifest = SignedRiskManifestV1 & {
  readonly [VERIFIED_RISK_MANIFEST]: true;
};

export type RiskExceptionKind =
  | "early-public-hedge"
  | "same-size-public-hedge"
  | "per-trade-cap-override";

export type RiskExceptionBodyV1 = Readonly<{
  domain: typeof RISK_EXCEPTION_DOMAIN;
  version: 1;
  exceptionId: string;
  manifestDigest: string;
  makerId: string;
  kind: RiskExceptionKind;
  token: string;
  maximumAmountBaseUnits: string;
  reason: string;
  issuedAt: number;
  expiresAt: number;
}>;

export type SignedRiskExceptionV1 = Readonly<{
  version: 1;
  body: RiskExceptionBodyV1;
  bodyDigest: string;
  approvals: readonly RiskManifestApprovalV1[];
}>;

export type VerifiedRiskException = SignedRiskExceptionV1 & {
  readonly [VERIFIED_RISK_EXCEPTION]: true;
};

export type ExposureSnapshotV1 = Readonly<{
  makerId: string;
  token: string;
  observedAt: number;
  grossExposureBaseUnits: string;
  netExposureBaseUnits: string;
  dailyFilledBaseUnits: string;
  outstandingEscrowBaseUnits: string;
  reconciliation: "current" | "stale" | "drift" | "unknown";
}>;

export type ExposureDecision = Readonly<{
  allowed: boolean;
  blocks: readonly string[];
  utilizationBps: Readonly<{
    trade: number;
    gross: number;
    net: number;
    daily: number;
  }>;
}>;

export type OperationalNettingPlan = Readonly<{
  mode: "independent-fill-netting";
  atomic: false;
  matchedFillDigests: readonly string[];
  residualExposure: readonly { token: string; amountBaseUnits: string }[];
  publicHedgeOrders: readonly {
    token: string;
    amountBaseUnits: string;
    venueId: string;
    earliestAt: number;
    correlationWarning: string;
  }[];
  deferred: readonly {
    token: string;
    amountBaseUnits: string;
    reason: string;
  }[];
  blocked: readonly {
    token: string;
    amountBaseUnits: string;
    reason: string;
  }[];
}>;

export type OperationsControlState = Readonly<{
  mode: "running" | "paused" | "drain-only";
  reason: string;
  updatedAt: number;
  updatedBy: string;
  claimsAndRefundsEnabled: true;
}>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export type BrowserSafeMakerOperations = Readonly<{
  makerId: string;
  mode: OperationsControlState["mode"];
  reconciliation: ExposureSnapshotV1["reconciliation"];
  activeReservations: number;
  quarantinedReservations: number;
  capacity: readonly {
    token: string;
    band: "none" | "small" | "medium" | "large";
    exposureUtilizationBps: number;
  }[];
  rawBalancesExposed: false;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .join(",") !==
    [...expected].sort((left, right) => left.localeCompare(right)).join(",")
  ) {
    throw new Error(`${label} schema is unsupported.`);
  }
}

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Canonical operations numbers must be safe integers.");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

async function sha256Digest(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function text(value: unknown, label: string, maximumLength = 128): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.toLowerCase();
  if (!DIGEST.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function hex32(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.toLowerCase();
  if (!HEX32.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe-integer timestamp.`);
  }
  return Number(value);
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw new Error(`${label} is outside the reviewed limit.`);
  }
  return Number(value);
}

function units(
  value: unknown,
  label: string,
  options: { positive?: boolean } = {},
): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error(`${label} must be canonical decimal base units.`);
  }
  const parsed = BigInt(value);
  if (parsed > U256_MAX || (options.positive && parsed <= 0n)) {
    throw new Error(`${label} is outside the reviewed u256 range.`);
  }
  return value;
}

function signedUnits(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be canonical signed decimal base units.`);
  }
  const parsed = BigInt(value);
  if (parsed < -U256_MAX || parsed > U256_MAX || value === "-0") {
    throw new Error(`${label} is outside the reviewed range.`);
  }
  return parsed.toString();
}

function felt(value: unknown, label: string): string {
  try {
    const normalized = canonicalizeStarknetFelt(String(value ?? ""));
    if (normalized === "0x0") throw new Error();
    return normalized;
  } catch {
    throw new Error(`${label} is not a canonical Starknet felt.`);
  }
}

function chainId(value: unknown): StarknetPool {
  if (
    value !== "starknet:SN_MAIN" &&
    value !== "starknet:SN_SEPOLIA" &&
    value !== "starknet:APP20_LOCALNET"
  ) {
    throw new Error("Risk manifest chain is unsupported.");
  }
  return value;
}

function normalizeAsset(value: unknown): RiskManifestAssetV1 {
  const asset = record(value, "Risk-manifest asset");
  exactKeys(
    asset,
    [
      "token",
      "denominationBaseUnits",
      "minBatchBaseUnits",
      "maxPerTradeBaseUnits",
      "maxGrossExposureBaseUnits",
      "maxNetExposureBaseUnits",
      "maxDailyFilledBaseUnits",
    ],
    "Risk-manifest asset",
  );
  const normalized: RiskManifestAssetV1 = {
    token: felt(asset.token, "Risk token"),
    denominationBaseUnits: units(
      asset.denominationBaseUnits,
      "Risk denomination",
      { positive: true },
    ),
    minBatchBaseUnits: units(asset.minBatchBaseUnits, "Risk minimum batch", {
      positive: true,
    }),
    maxPerTradeBaseUnits: units(
      asset.maxPerTradeBaseUnits,
      "Risk per-trade cap",
      { positive: true },
    ),
    maxGrossExposureBaseUnits: units(
      asset.maxGrossExposureBaseUnits,
      "Risk gross-exposure cap",
      { positive: true },
    ),
    maxNetExposureBaseUnits: units(
      asset.maxNetExposureBaseUnits,
      "Risk net-exposure cap",
      { positive: true },
    ),
    maxDailyFilledBaseUnits: units(
      asset.maxDailyFilledBaseUnits,
      "Risk daily-filled cap",
      { positive: true },
    ),
  };
  if (
    BigInt(normalized.minBatchBaseUnits) <
    BigInt(normalized.denominationBaseUnits)
  ) {
    throw new Error("Risk minimum batch must be at least one denomination.");
  }
  const perTrade = BigInt(normalized.maxPerTradeBaseUnits);
  if (
    perTrade > BigInt(normalized.maxGrossExposureBaseUnits) ||
    perTrade > BigInt(normalized.maxNetExposureBaseUnits) ||
    perTrade > BigInt(normalized.maxDailyFilledBaseUnits)
  ) {
    throw new Error(
      "Risk per-trade cap cannot exceed gross, net, or daily caps.",
    );
  }
  return normalized;
}

function normalizeVenue(value: unknown): RiskManifestVenueV1 {
  const venue = record(value, "Risk-manifest venue");
  exactKeys(venue, ["venueId", "route", "enabled"], "Risk-manifest venue");
  if (venue.route !== "public" || typeof venue.enabled !== "boolean") {
    throw new Error("Risk-manifest venue is invalid.");
  }
  return {
    venueId: text(venue.venueId, "Risk venue id"),
    route: "public",
    enabled: venue.enabled,
  };
}

export function normalizeRiskManifestBody(value: unknown): RiskManifestBodyV1 {
  const body = record(value, "Risk manifest");
  exactKeys(
    body,
    [
      "domain",
      "version",
      "manifestId",
      "previousManifestDigest",
      "makerId",
      "chainId",
      "registryRevision",
      "issuedAt",
      "validFrom",
      "validUntil",
      "minimumHedgeDwellSeconds",
      "maximumHedgeDwellSeconds",
      "assets",
      "venues",
    ],
    "Risk manifest",
  );
  if (body.domain !== RISK_MANIFEST_DOMAIN || body.version !== 1) {
    throw new Error("Risk manifest domain or version is invalid.");
  }
  const issuedAt = timestamp(body.issuedAt, "Risk manifest issue time");
  const validFrom = timestamp(body.validFrom, "Risk manifest validity start");
  const validUntil = timestamp(body.validUntil, "Risk manifest validity end");
  if (validFrom < issuedAt || validUntil <= validFrom) {
    throw new Error("Risk manifest validity window is invalid.");
  }
  const minimumHedgeDwellSeconds = integer(
    body.minimumHedgeDwellSeconds,
    "Minimum public-hedge dwell",
    MIN_PUBLIC_HEDGE_DWELL_SECONDS,
    24 * 60 * 60,
  );
  const maximumHedgeDwellSeconds = integer(
    body.maximumHedgeDwellSeconds,
    "Maximum public-hedge dwell",
    minimumHedgeDwellSeconds,
    7 * 24 * 60 * 60,
  );
  if (!Array.isArray(body.assets) || body.assets.length === 0) {
    throw new Error("Risk manifest needs at least one asset policy.");
  }
  if (!Array.isArray(body.venues)) {
    throw new Error("Risk manifest venues must be an array.");
  }
  const assets = body.assets
    .map(normalizeAsset)
    .sort((left, right) => left.token.localeCompare(right.token));
  const assetTokens = new Set(assets.map((asset) => asset.token));
  if (assetTokens.size !== assets.length) {
    throw new Error("Risk manifest asset policies must be unique.");
  }
  const venues = body.venues
    .map(normalizeVenue)
    .sort((left, right) => left.venueId.localeCompare(right.venueId));
  const venueIds = new Set(venues.map((venue) => venue.venueId));
  if (venueIds.size !== venues.length) {
    throw new Error("Risk manifest venues must be unique.");
  }
  return {
    domain: RISK_MANIFEST_DOMAIN,
    version: 1,
    manifestId: hex32(body.manifestId, "Risk manifest id"),
    previousManifestDigest:
      body.previousManifestDigest === null
        ? null
        : digest(body.previousManifestDigest, "Previous risk manifest digest"),
    makerId: text(body.makerId, "Risk maker id"),
    chainId: chainId(body.chainId),
    registryRevision: text(body.registryRevision, "Risk registry revision"),
    issuedAt,
    validFrom,
    validUntil,
    minimumHedgeDwellSeconds,
    maximumHedgeDwellSeconds,
    assets,
    venues,
  };
}

export function canonicalRiskManifestBody(body: RiskManifestBodyV1): string {
  const normalized = normalizeRiskManifestBody(body);
  return canonicalJson({
    ...normalized,
    assets: normalized.assets.map((asset) => ({ ...asset })),
    venues: normalized.venues.map((venue) => ({ ...venue })),
  });
}

export async function riskManifestBodyDigest(
  body: RiskManifestBodyV1,
): Promise<string> {
  return sha256Digest(canonicalRiskManifestBody(body));
}

function normalizeApproval(value: unknown): RiskManifestApprovalV1 {
  const approval = record(value, "Risk approval");
  exactKeys(approval, ["role", "approverKeyId", "signature"], "Risk approval");
  if (
    !["risk", "operations", "security_compliance"].includes(
      String(approval.role),
    )
  ) {
    throw new Error("Risk approval role is invalid.");
  }
  if (
    typeof approval.signature !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(approval.signature)
  ) {
    throw new Error("Risk approval signature is invalid.");
  }
  return {
    role: approval.role as RiskApprovalRole,
    approverKeyId: text(approval.approverKeyId, "Risk approver key id"),
    signature: approval.signature.toLowerCase(),
  };
}

export async function verifyRiskManifest(
  value: unknown,
  input: {
    now: number;
    verifyApproval: (
      bodyDigest: string,
      approval: RiskManifestApprovalV1,
    ) => Promise<boolean>;
  },
): Promise<VerifiedRiskManifest> {
  const manifest = record(value, "Signed risk manifest");
  exactKeys(
    manifest,
    ["version", "body", "bodyDigest", "approvals"],
    "Signed risk manifest",
  );
  if (manifest.version !== 1 || !Array.isArray(manifest.approvals)) {
    throw new Error("Signed risk manifest is invalid.");
  }
  const body = normalizeRiskManifestBody(manifest.body);
  const bodyDigest = await riskManifestBodyDigest(body);
  if (digest(manifest.bodyDigest, "Risk manifest digest") !== bodyDigest) {
    throw new Error("Risk manifest digest does not match its body.");
  }
  const now = timestamp(input.now, "Risk manifest verification time");
  if (now < body.validFrom || now > body.validUntil) {
    throw new Error("Risk manifest is not currently valid.");
  }
  const approvals = manifest.approvals.map(normalizeApproval);
  const approvers = new Set(
    approvals.map((approval) => approval.approverKeyId),
  );
  if (approvers.size !== approvals.length) {
    throw new Error("Risk manifest approvals must use distinct approvers.");
  }
  const roles = new Set(approvals.map((approval) => approval.role));
  if (!roles.has("risk") || !roles.has("operations")) {
    throw new Error("Risk manifest requires Risk and Operations approval.");
  }
  for (const approval of approvals) {
    if (!(await input.verifyApproval(bodyDigest, approval))) {
      throw new Error("Risk manifest approval signature is invalid.");
    }
  }
  const verified = deepFreeze({
    version: 1 as const,
    body: deepFreeze(body),
    bodyDigest,
    approvals: deepFreeze(approvals),
    [VERIFIED_RISK_MANIFEST]: true as const,
  });
  VERIFIED_RISK_MANIFESTS.add(verified);
  return verified;
}

function normalizeExceptionBody(value: unknown): RiskExceptionBodyV1 {
  const body = record(value, "Risk exception");
  exactKeys(
    body,
    [
      "domain",
      "version",
      "exceptionId",
      "manifestDigest",
      "makerId",
      "kind",
      "token",
      "maximumAmountBaseUnits",
      "reason",
      "issuedAt",
      "expiresAt",
    ],
    "Risk exception",
  );
  if (
    body.domain !== RISK_EXCEPTION_DOMAIN ||
    body.version !== 1 ||
    ![
      "early-public-hedge",
      "same-size-public-hedge",
      "per-trade-cap-override",
    ].includes(String(body.kind))
  ) {
    throw new Error("Risk exception domain, version, or kind is invalid.");
  }
  const issuedAt = timestamp(body.issuedAt, "Risk exception issue time");
  const expiresAt = timestamp(body.expiresAt, "Risk exception expiry");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 24 * 60 * 60) {
    throw new Error("Risk exception lifetime is invalid.");
  }
  return {
    domain: RISK_EXCEPTION_DOMAIN,
    version: 1,
    exceptionId: hex32(body.exceptionId, "Risk exception id"),
    manifestDigest: digest(
      body.manifestDigest,
      "Risk exception manifest digest",
    ),
    makerId: text(body.makerId, "Risk exception maker id"),
    kind: body.kind as RiskExceptionKind,
    token: felt(body.token, "Risk exception token"),
    maximumAmountBaseUnits: units(
      body.maximumAmountBaseUnits,
      "Risk exception maximum amount",
      { positive: true },
    ),
    reason: text(body.reason, "Risk exception reason", 500),
    issuedAt,
    expiresAt,
  };
}

export async function riskExceptionBodyDigest(
  body: RiskExceptionBodyV1,
): Promise<string> {
  return sha256Digest(canonicalJson({ ...normalizeExceptionBody(body) }));
}

export async function verifyRiskException(
  value: unknown,
  manifest: VerifiedRiskManifest,
  input: {
    now: number;
    verifyApproval: (
      bodyDigest: string,
      approval: RiskManifestApprovalV1,
    ) => Promise<boolean>;
  },
): Promise<VerifiedRiskException> {
  requireVerifiedRiskManifest(manifest);
  const exception = record(value, "Signed risk exception");
  exactKeys(
    exception,
    ["version", "body", "bodyDigest", "approvals"],
    "Signed risk exception",
  );
  if (exception.version !== 1 || !Array.isArray(exception.approvals)) {
    throw new Error("Signed risk exception is invalid.");
  }
  const body = normalizeExceptionBody(exception.body);
  const bodyDigest = await riskExceptionBodyDigest(body);
  if (
    digest(exception.bodyDigest, "Risk exception digest") !== bodyDigest ||
    body.manifestDigest !== manifest.bodyDigest ||
    body.makerId !== manifest.body.makerId
  ) {
    throw new Error(
      "Risk exception does not bind the active manifest and maker.",
    );
  }
  const now = timestamp(input.now, "Risk exception verification time");
  if (now < body.issuedAt || now > body.expiresAt) {
    throw new Error("Risk exception is not currently valid.");
  }
  const approvals = exception.approvals.map(normalizeApproval);
  const approvers = new Set(
    approvals.map((approval) => approval.approverKeyId),
  );
  const riskApprovers = approvals.reduce((keys, approval) => {
    if (approval.role === "risk") keys.add(approval.approverKeyId);
    return keys;
  }, new Set<string>());
  if (
    approvers.size !== approvals.length ||
    riskApprovers.size < 2 ||
    !approvals.some((approval) => approval.role === "security_compliance")
  ) {
    throw new Error(
      "Risk exception requires two distinct Risk approvers and Security/Compliance.",
    );
  }
  for (const approval of approvals) {
    if (!(await input.verifyApproval(bodyDigest, approval))) {
      throw new Error("Risk exception approval signature is invalid.");
    }
  }
  const verified = deepFreeze({
    version: 1 as const,
    body: deepFreeze(body),
    bodyDigest,
    approvals: deepFreeze(approvals),
    [VERIFIED_RISK_EXCEPTION]: true as const,
  });
  VERIFIED_RISK_EXCEPTIONS.add(verified);
  return verified;
}

function requireVerifiedRiskManifest(manifest: VerifiedRiskManifest): void {
  if (
    manifest[VERIFIED_RISK_MANIFEST] !== true ||
    !VERIFIED_RISK_MANIFESTS.has(manifest)
  ) {
    throw new Error("Risk manifest must come from approval verification.");
  }
}

function requireVerifiedRiskException(exception: VerifiedRiskException): void {
  if (
    exception[VERIFIED_RISK_EXCEPTION] !== true ||
    !VERIFIED_RISK_EXCEPTIONS.has(exception)
  ) {
    throw new Error("Risk exception must come from approval verification.");
  }
}

function assetPolicy(
  manifest: VerifiedRiskManifest,
  token: string,
): RiskManifestAssetV1 {
  const normalized = felt(token, "Exposure token");
  const policy = manifest.body.assets.find(
    (asset) => asset.token === normalized,
  );
  if (!policy)
    throw new Error("The active risk manifest does not allow this token.");
  return policy;
}

function utilization(value: bigint, maximum: bigint): number {
  if (maximum <= 0n) return 10_000;
  const absolute = value < 0n ? -value : value;
  const bps = (absolute * 10_000n + maximum - 1n) / maximum;
  return Number(bps > 10_000n ? 10_000n : bps);
}

export function assessExposure(
  manifest: VerifiedRiskManifest,
  snapshot: ExposureSnapshotV1,
  proposedTradeBaseUnits: string,
  decisionTime: number,
  exception?: VerifiedRiskException,
): ExposureDecision {
  requireVerifiedRiskManifest(manifest);
  if (exception) requireVerifiedRiskException(exception);
  const decidedAt = timestamp(decisionTime, "Exposure decision time");
  if (snapshot.makerId !== manifest.body.makerId) {
    throw new Error(
      "Exposure snapshot maker does not match the risk manifest.",
    );
  }
  const policy = assetPolicy(manifest, snapshot.token);
  const proposed = BigInt(
    units(proposedTradeBaseUnits, "Proposed trade", { positive: true }),
  );
  const gross = BigInt(
    units(snapshot.grossExposureBaseUnits, "Gross exposure"),
  );
  const net = BigInt(
    signedUnits(snapshot.netExposureBaseUnits, "Net exposure"),
  );
  const daily = BigInt(units(snapshot.dailyFilledBaseUnits, "Daily filled"));
  const outstanding = BigInt(
    units(snapshot.outstandingEscrowBaseUnits, "Outstanding escrow"),
  );
  const observedAt = timestamp(
    snapshot.observedAt,
    "Exposure observation time",
  );
  const blocks: string[] = [];
  if (
    observedAt > decidedAt ||
    decidedAt - observedAt > MAX_EXPOSURE_SNAPSHOT_AGE_SECONDS
  ) {
    blocks.push("Maker exposure evidence is future-dated or stale.");
  }
  if (
    decidedAt < manifest.body.validFrom ||
    decidedAt > manifest.body.validUntil
  ) {
    blocks.push("The risk manifest is not valid at the decision time.");
  }
  if (
    observedAt < manifest.body.validFrom ||
    observedAt > manifest.body.validUntil
  ) {
    blocks.push(
      "The risk manifest is not valid for this exposure observation.",
    );
  }
  if (snapshot.reconciliation !== "current") {
    blocks.push("Maker reconciliation is not current.");
  }
  const exceptionCovers =
    exception?.body.kind === "per-trade-cap-override" &&
    exception.body.manifestDigest === manifest.bodyDigest &&
    exception.body.makerId === manifest.body.makerId &&
    exception.body.token === policy.token &&
    decidedAt >= exception.body.issuedAt &&
    decidedAt <= exception.body.expiresAt &&
    proposed <= BigInt(exception.body.maximumAmountBaseUnits);
  if (proposed > BigInt(policy.maxPerTradeBaseUnits) && !exceptionCovers) {
    blocks.push("Proposed trade exceeds the per-trade cap.");
  }
  if (
    gross + outstanding + proposed >
    BigInt(policy.maxGrossExposureBaseUnits)
  ) {
    blocks.push("Proposed trade exceeds the gross-exposure cap.");
  }
  if (
    (net < 0n ? -net : net) + proposed >
    BigInt(policy.maxNetExposureBaseUnits)
  ) {
    blocks.push("Proposed trade exceeds the net-exposure cap.");
  }
  if (daily + proposed > BigInt(policy.maxDailyFilledBaseUnits)) {
    blocks.push("Proposed trade exceeds the daily-filled cap.");
  }
  return {
    allowed: blocks.length === 0,
    blocks,
    utilizationBps: {
      trade: utilization(proposed, BigInt(policy.maxPerTradeBaseUnits)),
      gross: utilization(
        gross + outstanding + proposed,
        BigInt(policy.maxGrossExposureBaseUnits),
      ),
      net: utilization(
        (net < 0n ? -net : net) + proposed,
        BigInt(policy.maxNetExposureBaseUnits),
      ),
      daily: utilization(
        daily + proposed,
        BigInt(policy.maxDailyFilledBaseUnits),
      ),
    },
  };
}

export function planOperationalNetting(
  manifest: VerifiedRiskManifest,
  fills: readonly (FillRecord & {
    fillDigest: string;
    finalized: boolean;
    principalNettingConsent: boolean;
    filledAt: number;
  })[],
  now: number,
  exception?: VerifiedRiskException,
): OperationalNettingPlan {
  requireVerifiedRiskManifest(manifest);
  if (exception) requireVerifiedRiskException(exception);
  const evaluationTime = timestamp(now, "Operations planning time");
  if (
    evaluationTime < manifest.body.validFrom ||
    evaluationTime > manifest.body.validUntil
  ) {
    throw new Error("The risk manifest is not valid at the planning time.");
  }
  const exposure = new Map<string, bigint>();
  const matchedFillDigests: string[] = [];
  const seenFillDigests = new Set<string>();
  let latestFillAt = 0;
  for (const fill of fills) {
    if (!fill.finalized) continue;
    if (!fill.principalNettingConsent) {
      throw new Error(
        "Operational netting requires both users' principal-netting consent.",
      );
    }
    const sellToken = felt(fill.sellToken, "Fill sell token");
    const buyToken = felt(fill.buyToken, "Fill buy token");
    if (
      fill.sellAmount <= 0n ||
      fill.sellAmount > U256_MAX ||
      fill.buyAmount <= 0n ||
      fill.buyAmount > U256_MAX
    ) {
      throw new Error(
        "Operational netting fill amounts must be positive u256 values.",
      );
    }
    const fillDigest = digest(fill.fillDigest, "Finalized fill digest");
    if (seenFillDigests.has(fillDigest)) {
      throw new Error(
        "Operational netting cannot count a finalized fill twice.",
      );
    }
    seenFillDigests.add(fillDigest);
    matchedFillDigests.push(fillDigest);
    exposure.set(buyToken, (exposure.get(buyToken) ?? 0n) + fill.buyAmount);
    exposure.set(sellToken, (exposure.get(sellToken) ?? 0n) - fill.sellAmount);
    latestFillAt = Math.max(
      latestFillAt,
      timestamp(fill.filledAt, "Fill time"),
    );
  }
  const venue = manifest.body.venues.find((candidate) => candidate.enabled);
  const residualExposure = [...exposure.entries()]
    .map(([token, amount]) => ({ token, amountBaseUnits: amount.toString() }))
    .sort((left, right) => left.token.localeCompare(right.token));
  const publicHedgeOrders: OperationalNettingPlan["publicHedgeOrders"][number][] =
    [];
  const deferred: OperationalNettingPlan["deferred"][number][] = [];
  const blocked: OperationalNettingPlan["blocked"][number][] = [];
  for (const residual of residualExposure) {
    const amount = BigInt(residual.amountBaseUnits);
    if (amount <= 0n) continue;
    const policy = assetPolicy(manifest, residual.token);
    if (amount < BigInt(policy.minBatchBaseUnits)) {
      deferred.push({
        token: residual.token,
        amountBaseUnits: amount.toString(),
        reason: "Residual is below the approved public-restock batch floor.",
      });
      continue;
    }
    if (!venue) {
      blocked.push({
        token: residual.token,
        amountBaseUnits: amount.toString(),
        reason: "No approved public restocking venue is enabled.",
      });
      continue;
    }
    const earliestAt = latestFillAt + manifest.body.minimumHedgeDwellSeconds;
    const earlyException =
      exception?.body.kind === "early-public-hedge" &&
      exception.body.manifestDigest === manifest.bodyDigest &&
      exception.body.makerId === manifest.body.makerId &&
      exception.body.token === residual.token &&
      evaluationTime >= exception.body.issuedAt &&
      evaluationTime <= exception.body.expiresAt &&
      amount <= BigInt(exception.body.maximumAmountBaseUnits);
    if (evaluationTime < earliestAt && !earlyException) {
      deferred.push({
        token: residual.token,
        amountBaseUnits: amount.toString(),
        reason: "The minimum public-hedge dwell has not elapsed.",
      });
      continue;
    }
    const denomination = BigInt(policy.denominationBaseUnits);
    const unitsRequired = (amount + denomination - 1n) / denomination;
    publicHedgeOrders.push({
      token: residual.token,
      amountBaseUnits: (unitsRequired * denomination).toString(),
      venueId: venue.venueId,
      earliestAt: earlyException ? evaluationTime : earliestAt,
      correlationWarning:
        "This public restock can correlate with prior APP20 fills. Batching and denomination do not make it private.",
    });
  }
  return {
    mode: "independent-fill-netting",
    atomic: false,
    matchedFillDigests: matchedFillDigests.sort((left, right) =>
      left.localeCompare(right),
    ),
    residualExposure,
    publicHedgeOrders,
    deferred,
    blocked,
  };
}

export function transitionOperationsControl(
  current: OperationsControlState,
  input: {
    mode: OperationsControlState["mode"];
    reason: string;
    updatedAt: number;
    updatedBy: string;
  },
): OperationsControlState {
  const updatedAt = timestamp(input.updatedAt, "Operations control time");
  if (updatedAt <= current.updatedAt) {
    throw new Error("Operations control updates must be monotonic.");
  }
  return {
    mode: input.mode,
    reason: text(input.reason, "Operations control reason", 500),
    updatedAt,
    updatedBy: text(input.updatedBy, "Operations control actor"),
    claimsAndRefundsEnabled: true,
  };
}

export function browserSafeMakerOperations(input: {
  makerId: string;
  control: OperationsControlState;
  reconciliation: ExposureSnapshotV1["reconciliation"];
  activeReservations: number;
  quarantinedReservations: number;
  capacities: readonly {
    token: string;
    availableBaseUnits: bigint;
    exposureBaseUnits: bigint;
    exposureCapBaseUnits: bigint;
    smallThresholdBaseUnits: bigint;
    mediumThresholdBaseUnits: bigint;
  }[];
}): BrowserSafeMakerOperations {
  return {
    makerId: text(input.makerId, "Operations maker id"),
    mode: input.control.mode,
    reconciliation: input.reconciliation,
    activeReservations: integer(
      input.activeReservations,
      "Active reservation count",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    quarantinedReservations: integer(
      input.quarantinedReservations,
      "Quarantined reservation count",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    capacity: input.capacities.map((capacity) => {
      const available = capacity.availableBaseUnits;
      if (
        available < 0n ||
        capacity.smallThresholdBaseUnits <= 0n ||
        capacity.mediumThresholdBaseUnits <= capacity.smallThresholdBaseUnits ||
        capacity.exposureCapBaseUnits <= 0n
      ) {
        throw new Error("Capacity bands or exposure cap are invalid.");
      }
      let band: BrowserSafeMakerOperations["capacity"][number]["band"];
      if (available <= 0n) {
        band = "none";
      } else if (available < capacity.smallThresholdBaseUnits) {
        band = "small";
      } else if (available < capacity.mediumThresholdBaseUnits) {
        band = "medium";
      } else {
        band = "large";
      }
      return {
        token: felt(capacity.token, "Capacity token"),
        band,
        exposureUtilizationBps: utilization(
          capacity.exposureBaseUnits,
          capacity.exposureCapBaseUnits,
        ),
      };
    }),
    rawBalancesExposed: false,
  };
}
