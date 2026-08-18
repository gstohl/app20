export const APP20_INTENT_DOMAIN = "app20/intent/v1" as const;

export type AccountRef = {
  id: string;
  chainId: string;
  address: string;
  signer: "ready" | "privy" | "near" | "injected" | "hardware";
  custody: "user" | "embedded" | "shared";
  capabilities: readonly string[];
  policyMode: "none" | "advisory" | "backend-gated" | "cryptographic";
};

export type AssetRef = {
  chainId: string;
  assetId: string;
  decimals: number;
};

export type ChainAccountRef = {
  chainId: string;
  address: string;
};

export type CrossChainIntentV1 = {
  version: 1;
  intentId: string;
  revision: number;
  kind: "cross-chain";
  sourceAccount: AccountRef;
  destinationAccount: ChainAccountRef;
  refundAccount: ChainAccountRef;
  sourceAsset: AssetRef;
  destinationAsset: AssetRef;
  amount: string;
  minimumOutput: string;
  maximumFee: string;
  slippageBps: number;
  deadline: string;
  providerId: "near-intents:1click";
  swapMode: "exact-input" | "exact-output" | "flex-input";
  fundingMode: "origin-chain" | "intents" | "confidential-intents";
  deliveryMode: "destination-chain" | "intents" | "confidential-intents";
  refundMode: "origin-chain" | "intents" | "confidential-intents";
  privacyMode: "public" | "confidential-basic" | "confidential-advanced";
  disclosedTo: readonly (
    | "intents-provider"
    | "solver"
    | "source-chain"
    | "destination-chain"
    | "policy-enclave"
  )[];
  createdAt: string;
  expiresAt: string;
};

export const CROSS_CHAIN_STAGES = [
  "DRAFT",
  "VALIDATING",
  "PREFLIGHT_POLICY",
  "QUOTING",
  "AWAITING_REVIEW",
  "BUILDING",
  "AWAITING_FINAL_POLICY",
  "AWAITING_SIGNATURE",
  "SUBMITTING",
  "SUBMITTED",
  "SOURCE_CONFIRMING",
  "SOURCE_FINALIZED",
  "SETTLEMENT_PENDING",
  "DESTINATION_CONFIRMING",
  "COMPLETED",
  "AWAITING_PREREQUISITE",
  "BLOCKED",
  "MANUAL_REVIEW",
  "EXPIRED",
  "CANCELLED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "SUBMISSION_UNKNOWN",
  "REFUND_PENDING",
  "REFUNDED",
  "REORGED",
] as const;

export type CrossChainStage = (typeof CROSS_CHAIN_STAGES)[number];

export type CrossChainLifecycleState = Readonly<{
  stage: CrossChainStage;
  intentId: string;
  revision: number;
  intentDigest: string;
  expiresAt: string;
  deadline: string;
}>;

const TERMINAL_STAGES = new Set<CrossChainStage>([
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "FAILED_FINAL",
  "REFUNDED",
]);

const PRE_SUBMISSION_STAGES = new Set<CrossChainStage>([
  "DRAFT",
  "VALIDATING",
  "PREFLIGHT_POLICY",
  "QUOTING",
  "AWAITING_REVIEW",
  "BUILDING",
  "AWAITING_FINAL_POLICY",
  "AWAITING_SIGNATURE",
  "AWAITING_PREREQUISITE",
  "BLOCKED",
  "FAILED_RETRYABLE",
]);

const REVISION_GATED_NEXT_STAGES = new Set<CrossChainStage>([
  "VALIDATING",
  "PREFLIGHT_POLICY",
  "QUOTING",
  "BUILDING",
  "AWAITING_FINAL_POLICY",
  "AWAITING_SIGNATURE",
  "SUBMITTING",
]);

const ALLOWED_TRANSITIONS: Readonly<
  Record<CrossChainStage, readonly CrossChainStage[]>
> = {
  DRAFT: ["VALIDATING", "EXPIRED", "CANCELLED"],
  VALIDATING: [
    "PREFLIGHT_POLICY",
    "AWAITING_PREREQUISITE",
    "BLOCKED",
    "EXPIRED",
    "FAILED_FINAL",
    "CANCELLED",
  ],
  PREFLIGHT_POLICY: [
    "QUOTING",
    "BLOCKED",
    "MANUAL_REVIEW",
    "EXPIRED",
    "CANCELLED",
  ],
  QUOTING: [
    "AWAITING_REVIEW",
    "AWAITING_PREREQUISITE",
    "EXPIRED",
    "BLOCKED",
    "FAILED_RETRYABLE",
    "CANCELLED",
  ],
  AWAITING_REVIEW: ["BUILDING", "VALIDATING", "EXPIRED", "CANCELLED"],
  BUILDING: [
    "AWAITING_FINAL_POLICY",
    "AWAITING_PREREQUISITE",
    "FAILED_RETRYABLE",
    "EXPIRED",
    "CANCELLED",
  ],
  AWAITING_FINAL_POLICY: [
    "AWAITING_SIGNATURE",
    "BLOCKED",
    "MANUAL_REVIEW",
    "EXPIRED",
    "CANCELLED",
  ],
  AWAITING_SIGNATURE: ["SUBMITTING", "EXPIRED", "CANCELLED"],
  SUBMITTING: [
    "SUBMITTED",
    "SUBMISSION_UNKNOWN",
    "FAILED_RETRYABLE",
    "FAILED_FINAL",
  ],
  SUBMITTED: ["SOURCE_CONFIRMING", "FAILED_FINAL", "REORGED"],
  SOURCE_CONFIRMING: ["SOURCE_FINALIZED", "FAILED_FINAL", "REORGED"],
  SOURCE_FINALIZED: [
    "SETTLEMENT_PENDING",
    "REFUND_PENDING",
    "FAILED_FINAL",
    "REORGED",
  ],
  SETTLEMENT_PENDING: [
    "DESTINATION_CONFIRMING",
    "REFUND_PENDING",
    "FAILED_FINAL",
    "MANUAL_REVIEW",
  ],
  DESTINATION_CONFIRMING: [
    "COMPLETED",
    "REFUND_PENDING",
    "FAILED_FINAL",
    "REORGED",
  ],
  COMPLETED: [],
  AWAITING_PREREQUISITE: ["VALIDATING", "EXPIRED", "CANCELLED", "FAILED_FINAL"],
  BLOCKED: ["VALIDATING", "EXPIRED", "CANCELLED", "FAILED_FINAL"],
  MANUAL_REVIEW: [
    "VALIDATING",
    "REFUND_PENDING",
    "EXPIRED",
    "FAILED_FINAL",
    "CANCELLED",
  ],
  EXPIRED: [],
  CANCELLED: [],
  FAILED_RETRYABLE: ["VALIDATING", "EXPIRED", "FAILED_FINAL", "CANCELLED"],
  FAILED_FINAL: [],
  SUBMISSION_UNKNOWN: ["SUBMITTED", "MANUAL_REVIEW", "FAILED_FINAL"],
  REFUND_PENDING: ["REFUNDED", "MANUAL_REVIEW", "FAILED_FINAL", "REORGED"],
  REFUNDED: [],
  REORGED: [
    "SOURCE_CONFIRMING",
    "DESTINATION_CONFIRMING",
    "REFUND_PENDING",
    "MANUAL_REVIEW",
    "FAILED_FINAL",
  ],
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function assertExactKeys(
  value: UnknownRecord,
  label: string,
  keys: readonly string[],
): void {
  const unknownKey = Object.keys(value).find((key) => !keys.includes(key));
  if (unknownKey !== undefined) {
    throw new Error(`${label} contains an unrecognized field (${unknownKey}).`);
  }
  const missingKey = keys.find((key) => !Object.hasOwn(value, key));
  if (missingKey !== undefined) {
    throw new Error(`${label} is missing required field ${missingKey}.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
}

function assertOpaqueIdentifier(
  label: string,
  value: unknown,
  maximumLength = 512,
): asserts value is string {
  assertString(value, label);
  if (
    value.length === 0 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f\s]/u.test(value)
  ) {
    throw new Error(`${label} is malformed.`);
  }
}

function assertChainId(label: string, value: unknown): asserts value is string {
  assertString(value, label);
  if (!/^[a-z0-9][a-z0-9-]{1,31}:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a canonical chain identifier.`);
  }
}

function assertIntentId(value: unknown): asserts value is string {
  assertString(value, "intentId");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) {
    throw new Error(
      "intentId must be a canonical identifier encoding at least 128 bits of unpredictable input.",
    );
  }
}

function assertBaseUnits(
  label: string,
  value: unknown,
  allowZero = false,
): asserts value is string {
  assertString(value, label);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(
      `${label} must be a canonical non-negative base-unit integer.`,
    );
  }
  if (!allowZero && value === "0") {
    throw new Error(`${label} must be greater than zero.`);
  }
}

function parseCanonicalTimestamp(label: string, value: unknown): number {
  assertString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`${label} must be a canonical RFC 3339 UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  const normalizedInput = value.replace(".000Z", "Z");
  const normalizedParsed = Number.isFinite(parsed)
    ? new Date(parsed).toISOString().replace(".000Z", "Z")
    : "";
  if (normalizedParsed !== normalizedInput) {
    throw new Error(
      `${label} must be a real canonical RFC 3339 UTC timestamp.`,
    );
  }
  return parsed;
}

function assertEnum(
  label: string,
  value: unknown,
  allowed: readonly string[],
): asserts value is string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} is not supported.`);
  }
}

function assertSafeNonNegativeInteger(
  label: string,
  value: unknown,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function assertUniqueIdentifiers(
  label: string,
  value: unknown,
  validate: (entryLabel: string, entry: unknown) => void,
): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
  if (value.length > 64) throw new Error(`${label} contains too many values.`);
  value.forEach((entry, index) => validate(`${label}[${index}]`, entry));
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} cannot contain duplicates.`);
  }
}

const INTENT_FIELDS = [
  "version",
  "intentId",
  "revision",
  "kind",
  "sourceAccount",
  "destinationAccount",
  "refundAccount",
  "sourceAsset",
  "destinationAsset",
  "amount",
  "minimumOutput",
  "maximumFee",
  "slippageBps",
  "deadline",
  "providerId",
  "swapMode",
  "fundingMode",
  "deliveryMode",
  "refundMode",
  "privacyMode",
  "disclosedTo",
  "createdAt",
  "expiresAt",
] as const;

const SOURCE_ACCOUNT_FIELDS = [
  "id",
  "chainId",
  "address",
  "signer",
  "custody",
  "capabilities",
  "policyMode",
] as const;
const CHAIN_ACCOUNT_FIELDS = ["chainId", "address"] as const;
const ASSET_FIELDS = ["chainId", "assetId", "decimals"] as const;

export function assertCrossChainIntent(
  value: unknown,
): asserts value is CrossChainIntentV1 {
  const intent = record(value, "CrossChainIntentV1");
  assertExactKeys(intent, "CrossChainIntentV1", INTENT_FIELDS);
  const sourceAccount = record(intent.sourceAccount, "sourceAccount");
  const destinationAccount = record(
    intent.destinationAccount,
    "destinationAccount",
  );
  const refundAccount = record(intent.refundAccount, "refundAccount");
  const sourceAsset = record(intent.sourceAsset, "sourceAsset");
  const destinationAsset = record(intent.destinationAsset, "destinationAsset");
  assertExactKeys(sourceAccount, "sourceAccount", SOURCE_ACCOUNT_FIELDS);
  assertExactKeys(
    destinationAccount,
    "destinationAccount",
    CHAIN_ACCOUNT_FIELDS,
  );
  assertExactKeys(refundAccount, "refundAccount", CHAIN_ACCOUNT_FIELDS);
  assertExactKeys(sourceAsset, "sourceAsset", ASSET_FIELDS);
  assertExactKeys(destinationAsset, "destinationAsset", ASSET_FIELDS);

  if (intent.version !== 1 || intent.kind !== "cross-chain") {
    throw new Error("Unsupported APP20 intent version or kind.");
  }
  assertIntentId(intent.intentId);
  assertSafeNonNegativeInteger("revision", intent.revision);

  assertOpaqueIdentifier("sourceAccount.id", sourceAccount.id, 256);
  assertChainId("sourceAccount.chainId", sourceAccount.chainId);
  assertOpaqueIdentifier("sourceAccount.address", sourceAccount.address);
  assertEnum("sourceAccount.signer", sourceAccount.signer, [
    "ready",
    "privy",
    "near",
    "injected",
    "hardware",
  ]);
  assertEnum("sourceAccount.custody", sourceAccount.custody, [
    "user",
    "embedded",
    "shared",
  ]);
  assertEnum("sourceAccount.policyMode", sourceAccount.policyMode, [
    "none",
    "advisory",
    "backend-gated",
    "cryptographic",
  ]);
  assertUniqueIdentifiers(
    "sourceAccount.capabilities",
    sourceAccount.capabilities,
    (label, entry) => assertOpaqueIdentifier(label, entry, 128),
  );

  assertChainId("destinationAccount.chainId", destinationAccount.chainId);
  assertOpaqueIdentifier(
    "destinationAccount.address",
    destinationAccount.address,
  );
  assertChainId("refundAccount.chainId", refundAccount.chainId);
  assertOpaqueIdentifier("refundAccount.address", refundAccount.address);
  assertChainId("sourceAsset.chainId", sourceAsset.chainId);
  assertOpaqueIdentifier("sourceAsset.assetId", sourceAsset.assetId);
  assertChainId("destinationAsset.chainId", destinationAsset.chainId);
  assertOpaqueIdentifier("destinationAsset.assetId", destinationAsset.assetId);

  if (sourceAccount.chainId !== sourceAsset.chainId) {
    throw new Error(
      "The source account and source asset must use the same chain.",
    );
  }
  if (destinationAccount.chainId !== destinationAsset.chainId) {
    throw new Error(
      "The destination account and destination asset must use the same chain.",
    );
  }
  if (sourceAsset.chainId === destinationAsset.chainId) {
    throw new Error(
      "A cross-chain intent requires different source and destination chains.",
    );
  }

  for (const [label, decimals] of [
    ["sourceAsset.decimals", sourceAsset.decimals],
    ["destinationAsset.decimals", destinationAsset.decimals],
  ] as const) {
    if (
      !Number.isInteger(decimals) ||
      (decimals as number) < 0 ||
      (decimals as number) > 255
    ) {
      throw new Error(`${label} must be an integer between 0 and 255.`);
    }
  }

  assertBaseUnits("amount", intent.amount);
  assertBaseUnits("minimumOutput", intent.minimumOutput);
  assertBaseUnits("maximumFee", intent.maximumFee, true);
  if (
    !Number.isInteger(intent.slippageBps) ||
    (intent.slippageBps as number) < 0 ||
    (intent.slippageBps as number) > 10_000
  ) {
    throw new Error("slippageBps must be an integer between 0 and 10,000.");
  }

  const deadline = parseCanonicalTimestamp("deadline", intent.deadline);
  const createdAt = parseCanonicalTimestamp("createdAt", intent.createdAt);
  const expiresAt = parseCanonicalTimestamp("expiresAt", intent.expiresAt);
  if (createdAt > expiresAt) {
    throw new Error("createdAt cannot be later than expiresAt.");
  }
  if (expiresAt > deadline) {
    throw new Error("expiresAt cannot be later than deadline.");
  }

  assertEnum("providerId", intent.providerId, ["near-intents:1click"]);
  assertEnum("swapMode", intent.swapMode, [
    "exact-input",
    "exact-output",
    "flex-input",
  ]);
  assertEnum("fundingMode", intent.fundingMode, [
    "origin-chain",
    "intents",
    "confidential-intents",
  ]);
  assertEnum("deliveryMode", intent.deliveryMode, [
    "destination-chain",
    "intents",
    "confidential-intents",
  ]);
  assertEnum("refundMode", intent.refundMode, [
    "origin-chain",
    "intents",
    "confidential-intents",
  ]);
  assertEnum("privacyMode", intent.privacyMode, [
    "public",
    "confidential-basic",
    "confidential-advanced",
  ]);
  assertUniqueIdentifiers("disclosedTo", intent.disclosedTo, (label, entry) =>
    assertEnum(label, entry, [
      "intents-provider",
      "solver",
      "source-chain",
      "destination-chain",
      "policy-enclave",
    ]),
  );

  if (
    intent.refundMode === "origin-chain" &&
    refundAccount.chainId !== sourceAccount.chainId
  ) {
    throw new Error(
      "An origin-chain refund account must use the source account chain.",
    );
  }
}

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function canonicalJson(value: CanonicalJson): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Canonical numeric values must be safe integers.");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const valueRecord = value as {
    readonly [key: string]: CanonicalJson;
  };
  return `{${Object.keys(valueRecord)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(valueRecord[key])}`)
    .join(",")}}`;
}

export function canonicalizeCrossChainIntent(
  intent: CrossChainIntentV1,
): string {
  assertCrossChainIntent(intent);
  const canonical: CanonicalJson = {
    domain: APP20_INTENT_DOMAIN,
    intent: {
      amount: intent.amount,
      createdAt: intent.createdAt,
      deadline: intent.deadline,
      deliveryMode: intent.deliveryMode,
      destinationAccount: {
        address: intent.destinationAccount.address,
        chainId: intent.destinationAccount.chainId,
      },
      destinationAsset: {
        assetId: intent.destinationAsset.assetId,
        chainId: intent.destinationAsset.chainId,
        decimals: intent.destinationAsset.decimals,
      },
      disclosedTo: [...intent.disclosedTo].sort(),
      expiresAt: intent.expiresAt,
      fundingMode: intent.fundingMode,
      intentId: intent.intentId,
      kind: intent.kind,
      maximumFee: intent.maximumFee,
      minimumOutput: intent.minimumOutput,
      privacyMode: intent.privacyMode,
      providerId: intent.providerId,
      refundAccount: {
        address: intent.refundAccount.address,
        chainId: intent.refundAccount.chainId,
      },
      refundMode: intent.refundMode,
      revision: intent.revision,
      slippageBps: intent.slippageBps,
      sourceAccount: {
        address: intent.sourceAccount.address,
        capabilities: [...intent.sourceAccount.capabilities].sort(),
        chainId: intent.sourceAccount.chainId,
        custody: intent.sourceAccount.custody,
        id: intent.sourceAccount.id,
        policyMode: intent.sourceAccount.policyMode,
        signer: intent.sourceAccount.signer,
      },
      sourceAsset: {
        assetId: intent.sourceAsset.assetId,
        chainId: intent.sourceAsset.chainId,
        decimals: intent.sourceAsset.decimals,
      },
      swapMode: intent.swapMode,
      version: intent.version,
    },
  };
  return canonicalJson(canonical);
}

export async function digestCrossChainIntent(
  intent: CrossChainIntentV1,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeCrossChainIntent(intent));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `0x${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function isCrossChainStage(value: unknown): value is CrossChainStage {
  return (
    typeof value === "string" &&
    (CROSS_CHAIN_STAGES as readonly string[]).includes(value)
  );
}

/**
 * Checks only the stage topology. Persisted execution must use
 * transitionCrossChainLifecycle(), which also binds the active intent revision.
 */
export function transitionCrossChainStage(
  current: CrossChainStage,
  next: CrossChainStage,
): CrossChainStage {
  if (!isCrossChainStage(current) || !isCrossChainStage(next)) {
    throw new Error("Unknown APP20 cross-chain stage.");
  }
  if (TERMINAL_STAGES.has(current)) {
    throw new Error(`Cannot leave terminal APP20 stage ${current}.`);
  }
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new Error(`Invalid APP20 stage transition: ${current} -> ${next}.`);
  }
  return next;
}

export function canTransitionCrossChainStage(
  current: CrossChainStage,
  next: CrossChainStage,
): boolean {
  return (
    isCrossChainStage(current) &&
    isCrossChainStage(next) &&
    !TERMINAL_STAGES.has(current) &&
    ALLOWED_TRANSITIONS[current].includes(next)
  );
}

function assertNow(now: number): void {
  if (!Number.isFinite(now)) throw new Error("Lifecycle time must be finite.");
}

function intentHasExpired(intent: CrossChainIntentV1, now: number): boolean {
  return (
    Date.parse(intent.expiresAt) <= now || Date.parse(intent.deadline) <= now
  );
}

export async function createCrossChainLifecycle(
  intent: CrossChainIntentV1,
  now = Date.now(),
): Promise<CrossChainLifecycleState> {
  assertCrossChainIntent(intent);
  assertNow(now);
  if (intentHasExpired(intent, now)) {
    throw new Error("Cannot start a lifecycle for an expired intent revision.");
  }
  return Object.freeze({
    stage: "DRAFT" as const,
    intentId: intent.intentId,
    revision: intent.revision,
    intentDigest: await digestCrossChainIntent(intent),
    expiresAt: intent.expiresAt,
    deadline: intent.deadline,
  });
}

/**
 * Advances a persisted lifecycle only when the caller supplies the exact active
 * intent revision used to create it. A changed, stale, or expired revision must
 * be restarted as a new lifecycle; post-submission reconciliation remains
 * possible after user authorization expires.
 */
export async function transitionCrossChainLifecycle(
  state: CrossChainLifecycleState,
  activeIntent: CrossChainIntentV1,
  next: CrossChainStage,
  now = Date.now(),
): Promise<CrossChainLifecycleState> {
  assertCrossChainIntent(activeIntent);
  assertNow(now);
  if (!isCrossChainStage(state.stage)) {
    throw new Error("Lifecycle contains an unknown APP20 stage.");
  }
  if (
    state.intentId !== activeIntent.intentId ||
    state.revision !== activeIntent.revision
  ) {
    throw new Error("The lifecycle refers to a stale intent revision.");
  }
  const activeDigest = await digestCrossChainIntent(activeIntent);
  if (state.intentDigest !== activeDigest) {
    throw new Error(
      "Intent terms changed without a revision increment; the lifecycle is stale.",
    );
  }
  if (
    state.expiresAt !== activeIntent.expiresAt ||
    state.deadline !== activeIntent.deadline
  ) {
    throw new Error(
      "The lifecycle expiry binding does not match the active intent.",
    );
  }

  transitionCrossChainStage(state.stage, next);
  const expired = intentHasExpired(activeIntent, now);
  if (
    expired &&
    next !== "EXPIRED" &&
    (PRE_SUBMISSION_STAGES.has(state.stage) ||
      REVISION_GATED_NEXT_STAGES.has(next))
  ) {
    throw new Error("The active intent revision has expired.");
  }
  if (!expired && next === "EXPIRED") {
    throw new Error("The active intent revision has not expired.");
  }

  return Object.freeze({ ...state, stage: next });
}
