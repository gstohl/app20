const MAX_U256 = (1n << 256n) - 1n;
export const MAX_PRIVACY_EVIDENCE_VALIDITY_SECONDS = 24 * 60 * 60;

export type PrivacyFindingLevel = "fact" | "warning" | "unavailable" | "block";

export type PrivacyFindingTopic =
  | "amount-fingerprinting"
  | "denomination"
  | "note-maturity"
  | "timing-correlation"
  | "invited-makers"
  | "public-settlement";

export type Freshness = "current" | "stale" | "unavailable";

export type EvidenceStamp = Readonly<{
  provenance: string;
  observedAt: number;
  validUntil: number;
}>;

export type PrivacyFinding = Readonly<{
  id: string;
  topic: PrivacyFindingTopic;
  level: PrivacyFindingLevel;
  message: string;
  provenance: string;
  observedAt: number | null;
  validUntil: number | null;
  freshness: Freshness;
}>;

export type PrivacyPreflightInput = Readonly<{
  amount: bigint;
  asset: string;
  network: string;
  now: number;
  requiresMatureNote?: boolean;
  amountFrequency?: EvidenceStamp & {
    exactAmountObservationCount: number;
    cohortObservationCount: number;
  };
  denominationAlternatives?: EvidenceStamp & {
    amounts: readonly bigint[];
  };
  noteMaturity?: EvidenceStamp & {
    mature: boolean;
    requiredForQuote?: boolean;
  };
  timingCorrelation?: EvidenceStamp & {
    correlation: "observed" | "not-observed";
  };
  invitedMakerDisclosure?: EvidenceStamp & {
    makerCount: number;
    disclosedFields: readonly string[];
  };
  publicSettlementLeakage?: EvidenceStamp & {
    publicFields: readonly string[];
  };
}>;

export type PrivacyPreflight = Readonly<{
  version: 1;
  asset: string;
  network: string;
  amountBaseUnits: string;
  evaluatedAt: number;
  findings: readonly PrivacyFinding[];
}>;

function requireTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive unix-seconds timestamp.`);
  }
  return value;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requirePositiveU256(value: bigint, label: string): bigint {
  if (value <= 0n || value > MAX_U256) {
    throw new Error(`${label} must be a positive u256 value.`);
  }
  return value;
}

function stamp(
  evidence: EvidenceStamp | undefined,
  now: number,
): Pick<
  PrivacyFinding,
  "provenance" | "observedAt" | "validUntil" | "freshness"
> {
  if (!evidence) {
    return {
      provenance: "not-provided",
      observedAt: null,
      validUntil: null,
      freshness: "unavailable",
    };
  }
  const provenance = requireText(evidence.provenance, "evidence provenance");
  requireTimestamp(evidence.observedAt, "evidence observedAt");
  requireTimestamp(evidence.validUntil, "evidence validUntil");
  if (evidence.observedAt > now) {
    throw new Error("evidence observedAt must not be in the future.");
  }
  if (evidence.validUntil < evidence.observedAt) {
    throw new Error("evidence validUntil must not precede observedAt.");
  }
  if (
    evidence.validUntil - evidence.observedAt >
    MAX_PRIVACY_EVIDENCE_VALIDITY_SECONDS
  ) {
    throw new Error("evidence validity window exceeds the reviewed limit.");
  }
  return {
    provenance,
    observedAt: evidence.observedAt,
    validUntil: evidence.validUntil,
    freshness: now <= evidence.validUntil ? "current" : "stale",
  };
}

function finding(
  input: Omit<PrivacyFinding, keyof ReturnType<typeof stamp>>,
  evidence: EvidenceStamp | undefined,
  now: number,
): PrivacyFinding {
  return { ...input, ...stamp(evidence, now) };
}

function unavailable(
  id: string,
  topic: PrivacyFindingTopic,
  message: string,
  evidence: EvidenceStamp | undefined,
  now: number,
  staleLevel: "unavailable" | "block" = "unavailable",
): PrivacyFinding {
  const metadata = stamp(evidence, now);
  return {
    id,
    topic,
    level: staleLevel === "block" ? "block" : "unavailable",
    message:
      metadata.freshness === "stale"
        ? `${message} The available evidence is stale.`
        : message,
    ...metadata,
  };
}

function uniqueSortedBigints(values: readonly bigint[]): bigint[] {
  return [...new Set(values.map((value) => value.toString()))]
    .map(BigInt)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function uniqueSortedText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

/**
 * Produces a deterministic, evidence-labelled privacy preflight. It reports
 * observations and unavailable inputs; it deliberately does not compute a
 * privacy or anonymity score.
 */
export function evaluatePrivacyPreflight(
  input: PrivacyPreflightInput,
): PrivacyPreflight {
  requirePositiveU256(input.amount, "amount");
  const now = requireTimestamp(input.now, "now");
  const asset = requireText(input.asset, "asset");
  const network = requireText(input.network, "network");
  const findings: PrivacyFinding[] = [];

  const frequency = input.amountFrequency;
  const frequencyStamp = stamp(frequency, now);
  if (!frequency || frequencyStamp.freshness !== "current") {
    findings.push(
      unavailable(
        "amount-frequency",
        "amount-fingerprinting",
        "Exact-amount frequency is unavailable; no anonymity claim can be made.",
        frequency,
        now,
      ),
    );
  } else {
    if (
      !Number.isSafeInteger(frequency.exactAmountObservationCount) ||
      frequency.exactAmountObservationCount < 0 ||
      !Number.isSafeInteger(frequency.cohortObservationCount) ||
      frequency.cohortObservationCount <= 0 ||
      frequency.exactAmountObservationCount > frequency.cohortObservationCount
    ) {
      throw new Error("amount-frequency counts are invalid.");
    }
    findings.push(
      finding(
        {
          id: "amount-frequency",
          topic: "amount-fingerprinting",
          level:
            frequency.exactAmountObservationCount <= 1 ? "warning" : "fact",
          message: `The exact base-unit amount appeared ${frequency.exactAmountObservationCount} time(s) in a ${frequency.cohortObservationCount}-observation cohort. This is evidence, not an anonymity score.`,
        },
        frequency,
        now,
      ),
    );
  }

  const denominations = input.denominationAlternatives;
  const denominationStamp = stamp(denominations, now);
  if (!denominations || denominationStamp.freshness !== "current") {
    findings.push(
      unavailable(
        "denomination-alternatives",
        "denomination",
        "Evidence-backed denomination alternatives are unavailable.",
        denominations,
        now,
      ),
    );
  } else {
    const amounts = uniqueSortedBigints(
      denominations.amounts.map((amount, index) =>
        requirePositiveU256(amount, `denomination amount ${index}`),
      ),
    ).filter((amount) => amount !== input.amount);
    findings.push(
      finding(
        {
          id: "denomination-alternatives",
          topic: "denomination",
          level: amounts.length ? "fact" : "unavailable",
          message: amounts.length
            ? `Available base-unit alternatives: ${amounts.map(String).join(", ")}. Changing the amount is always the user's choice.`
            : "No distinct positive denomination alternative is present in the supplied evidence.",
        },
        denominations,
        now,
      ),
    );
  }

  const maturity = input.noteMaturity;
  const maturityRequired =
    input.requiresMatureNote === true || maturity?.requiredForQuote === true;
  const maturityStamp = stamp(maturity, now);
  if (!maturity || maturityStamp.freshness !== "current") {
    findings.push(
      unavailable(
        "note-maturity",
        "note-maturity",
        "Local note/shield maturity is unavailable and has not been inferred.",
        maturity,
        now,
        maturityRequired ? "block" : "unavailable",
      ),
    );
  } else {
    findings.push(
      finding(
        {
          id: "note-maturity",
          topic: "note-maturity",
          level: maturity.mature
            ? "fact"
            : maturityRequired
              ? "block"
              : "warning",
          message: maturity.mature
            ? "Supplied local evidence reports the note/shield as mature."
            : "Supplied local evidence reports the note/shield as not mature.",
        },
        maturity,
        now,
      ),
    );
  }

  const timing = input.timingCorrelation;
  const timingStamp = stamp(timing, now);
  if (!timing || timingStamp.freshness !== "current") {
    findings.push(
      unavailable(
        "timing-correlation",
        "timing-correlation",
        "Timing-correlation evidence is unavailable; no unlinkability claim can be made.",
        timing,
        now,
      ),
    );
  } else {
    findings.push(
      finding(
        {
          id: "timing-correlation",
          topic: "timing-correlation",
          level: timing.correlation === "observed" ? "warning" : "fact",
          message:
            timing.correlation === "observed"
              ? "The supplied evidence observed timing correlation."
              : "The supplied evidence did not observe timing correlation; this does not prove unlinkability.",
        },
        timing,
        now,
      ),
    );
  }

  const makers = input.invitedMakerDisclosure;
  const makerStamp = stamp(makers, now);
  if (!makers || makerStamp.freshness !== "current") {
    findings.push(
      unavailable(
        "invited-maker-disclosure",
        "invited-makers",
        "Invited-maker disclosure is unavailable.",
        makers,
        now,
        "block",
      ),
    );
  } else {
    if (!Number.isSafeInteger(makers.makerCount) || makers.makerCount < 1) {
      throw new Error("makerCount must be a positive integer.");
    }
    const fields = uniqueSortedText(makers.disclosedFields);
    findings.push(
      finding(
        {
          id: "invited-maker-disclosure",
          topic: "invited-makers",
          level: "warning",
          message: `${makers.makerCount} invited maker(s) receive: ${fields.length ? fields.join(", ") : "request metadata"}. The RFQ is not a public book.`,
        },
        makers,
        now,
      ),
    );
  }

  const settlement = input.publicSettlementLeakage;
  const settlementStamp = stamp(settlement, now);
  if (!settlement || settlementStamp.freshness !== "current") {
    findings.push(
      unavailable(
        "public-settlement",
        "public-settlement",
        "Public-settlement leakage evidence is unavailable.",
        settlement,
        now,
        "block",
      ),
    );
  } else {
    const fields = uniqueSortedText(settlement.publicFields);
    findings.push(
      finding(
        {
          id: "public-settlement",
          topic: "public-settlement",
          level: fields.length ? "warning" : "fact",
          message: fields.length
            ? `First-version settlement publicly reveals: ${fields.join(", ")}.`
            : "The supplied settlement evidence names no public fields; this is not a privacy guarantee.",
        },
        settlement,
        now,
      ),
    );
  }

  return {
    version: 1,
    asset,
    network,
    amountBaseUnits: input.amount.toString(),
    evaluatedAt: now,
    findings,
  };
}

export const buildPrivacyPreflight = evaluatePrivacyPreflight;

export function requiresInformedConfirmation(
  preflight: PrivacyPreflight,
): boolean {
  return preflight.findings.some(
    (item) => item.level === "warning" || item.level === "unavailable",
  );
}

export function canProceedFromPrivacyPreflight(
  preflight: PrivacyPreflight,
  informedConfirmation: boolean,
): boolean {
  if (preflight.findings.some((item) => item.level === "block")) return false;
  return !requiresInformedConfirmation(preflight) || informedConfirmation;
}
