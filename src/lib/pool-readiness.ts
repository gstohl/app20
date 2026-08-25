export const POOL_READINESS_DEFINITIONS = [
  {
    key: "correctNetwork",
    label: "Correct network",
    missingEvidence: "No current network evidence is available.",
  },
  {
    key: "ownerAccount",
    label: "Owner account",
    missingEvidence: "No current owner-account evidence is available.",
  },
  {
    key: "allowedContracts",
    label: "Allowed token contracts",
    missingEvidence: "No current token allowlist evidence is available.",
  },
  {
    key: "requiredBalances",
    label: "Required balances",
    missingEvidence: "No current authoritative balance evidence is available.",
  },
  {
    key: "factoryAddress",
    label: "Factory address",
    missingEvidence: "No reviewed production factory address is available.",
  },
  {
    key: "abiHash",
    label: "ABI hash",
    missingEvidence: "No reviewed production factory ABI hash is available.",
  },
  {
    key: "calldata",
    label: "Deployment calldata",
    missingEvidence: "No reviewed production deployment calldata is available.",
  },
  {
    key: "independentReview",
    label: "Independent review",
    missingEvidence: "No independent contract-review evidence is available.",
  },
  {
    key: "fundingApprovals",
    label: "Funding approvals",
    missingEvidence: "No funding-approval evidence is available.",
  },
  {
    key: "walletConfirmation",
    label: "Wallet confirmation",
    missingEvidence: "No wallet-confirmation evidence is available.",
  },
] as const;

export type PoolReadinessKey =
  (typeof POOL_READINESS_DEFINITIONS)[number]["key"];
export type PoolReadinessStatus = "pass" | "block" | "unknown";
export type PoolEvidenceFreshness = "current" | "stale" | "unknown";

export type PoolReadinessEvidenceInput = Readonly<{
  status: PoolReadinessStatus;
  evidence: string;
  freshness?: PoolEvidenceFreshness;
}>;

export type PoolReadinessInput = Readonly<
  Partial<Record<PoolReadinessKey, PoolReadinessEvidenceInput>>
>;

export type PoolReadinessCheck = Readonly<{
  key: PoolReadinessKey;
  label: string;
  status: PoolReadinessStatus;
  evidence: string;
  freshness: PoolEvidenceFreshness;
}>;

export type PoolReadiness = Readonly<{
  checks: Readonly<Record<PoolReadinessKey, PoolReadinessCheck>>;
  blockedBy: readonly PoolReadinessKey[];
  deployment: Readonly<{
    status: "block";
    evidence: string;
  }>;
}>;

function hasStatus(value: unknown): value is PoolReadinessStatus {
  return value === "pass" || value === "block" || value === "unknown";
}

function hasFreshness(value: unknown): value is PoolEvidenceFreshness {
  return value === "current" || value === "stale" || value === "unknown";
}

function normalizeCheck(
  definition: (typeof POOL_READINESS_DEFINITIONS)[number],
  input: PoolReadinessEvidenceInput | undefined,
): PoolReadinessCheck {
  if (!input || !hasStatus(input.status)) {
    return Object.freeze({
      key: definition.key,
      label: definition.label,
      status: "unknown" as const,
      evidence: definition.missingEvidence,
      freshness: "unknown" as const,
    });
  }

  const suppliedEvidence =
    typeof input.evidence === "string" ? input.evidence.trim() : "";
  const evidence = suppliedEvidence || definition.missingEvidence;
  const freshness = hasFreshness(input.freshness)
    ? input.freshness
    : ("unknown" as const);

  let status: PoolReadinessStatus = input.status;
  if (freshness === "stale") {
    status = "block";
  } else if (
    status === "pass" &&
    (freshness !== "current" || suppliedEvidence.length === 0)
  ) {
    status = "unknown";
  }

  return Object.freeze({
    key: definition.key,
    label: definition.label,
    status,
    evidence,
    freshness,
  });
}

/**
 * Build an informational, fail-closed evidence matrix. Even a matrix containing
 * current passing evidence is not a deployment authorization; deployment stays
 * unavailable until a separately reviewed execution design exists.
 */
export function buildPoolReadiness(
  input: PoolReadinessInput = {},
): PoolReadiness {
  const mutableChecks = {} as Record<PoolReadinessKey, PoolReadinessCheck>;
  const blockedBy: PoolReadinessKey[] = [];

  for (const definition of POOL_READINESS_DEFINITIONS) {
    const check = normalizeCheck(definition, input[definition.key]);
    mutableChecks[definition.key] = check;
    if (check.status !== "pass") blockedBy.push(definition.key);
  }

  const evidence =
    blockedBy.length > 0
      ? "Deployment is unavailable; readiness includes blocked, unknown, missing, or stale evidence."
      : "Passing readiness evidence is informational only; deployment is unavailable in this proposal-only model.";

  return Object.freeze({
    checks: Object.freeze(mutableChecks),
    blockedBy: Object.freeze(blockedBy),
    deployment: Object.freeze({ status: "block" as const, evidence }),
  });
}
