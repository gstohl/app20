import { fillsDigest } from "@app20/private-intents";
import {
  applyRfqAuthoritySignal,
  canonicalLocalRfqId,
  canonicalRfqAccount,
  canonicalRfqChainId,
  takeAttemptTargetFromLifecycle,
  type RfqEvidenceAuthority,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

export const RFQ_AUTHORITY_PROJECTION_SOURCE =
  "localnet-chain-authority" as const;

export type RfqAuthorityStatus = RfqEvidenceAuthority["status"];

/**
 * Labels are derived from the enum so a persisted or relayed row can never
 * choose the words a person reads next to a settlement outcome.
 */
const LABELS: Readonly<Record<RfqAuthorityStatus, string>> = Object.freeze({
  "local-non-authoritative": "Local observation · not settlement authority",
  authoritative: "Finalized on the configured chain",
  stale: "Verification pending",
  disagreement: "Reader disagreement · unverified",
  reorged: "Reorg-invalidated · canonical membership lost",
  quarantined: "Quarantined · needs manual reconciliation",
});

const DETAIL: Readonly<Record<RfqAuthorityStatus, string>> = Object.freeze({
  "local-non-authoritative":
    "This browser watched the local devnet reach this outcome. No configured-chain verifier confirmed it, so it is not proof that value moved.",
  authoritative:
    "A configured chain authority confirmed the finalized settlement events for this exact deal.",
  stale:
    "The last authority answer is too old to trust. Re-check before treating this outcome as complete.",
  disagreement:
    "Configured readers disagreed about this deal. Nothing is retried automatically; reconcile before acting.",
  reorged:
    "The block carrying this outcome left the canonical chain. Treat the settlement as unresolved and reconcile with the maker; nothing was resubmitted.",
  quarantined:
    "This record is held aside for manual reconciliation. It cannot drive an action or be forgotten.",
});

export type RfqAuthorityTone =
  | "neutral"
  | "pending"
  | "verified"
  | "warning"
  | "critical";

const TONE: Readonly<Record<RfqAuthorityStatus, RfqAuthorityTone>> =
  Object.freeze({
    "local-non-authoritative": "neutral",
    authoritative: "verified",
    stale: "pending",
    disagreement: "warning",
    reorged: "critical",
    quarantined: "critical",
  });

export type RfqAuthorityPresentation = Readonly<{
  status: RfqAuthorityStatus;
  label: string;
  detail: string;
  tone: RfqAuthorityTone;
  /** True when the presented authority must stop every value-moving control. */
  blocksValueActions: boolean;
  /** True only while a terminal projection remains unresolved or contradicted. */
  needsReconciliation: boolean;
  revision: number;
  observedAt: number;
}>;

export function rfqAuthorityLabel(status: RfqAuthorityStatus): string {
  return LABELS[status];
}

/**
 * A restored record is only ever a convenience row. An `authoritative` answer
 * captured before a reload is presented as pending until a live authority
 * repeats it, so a forged or simply old IndexedDB row cannot keep claiming a
 * finalized settlement.
 */
export function displayedRfqAuthority(
  record: RfqLifecycleRecord,
): RfqEvidenceAuthority {
  const persisted = record.evidenceAuthority;
  // Browser rows cannot carry the session-only verifier capability that M8–M10
  // will introduce. Until that capability is bound here, even an enum-valid
  // `authoritative` value is presented conservatively as stale.
  const liveUntil = LIVE_AUTHORITY_RECORDS.get(record) ?? 0;
  const status: RfqAuthorityStatus =
    persisted.status === "authoritative" &&
    Math.floor(Date.now() / 1_000) >= liveUntil
      ? "stale"
      : persisted.status;
  return Object.freeze({
    status,
    label: LABELS[status],
    revision: persisted.revision,
    observedAt: persisted.observedAt,
  });
}

export function rfqAuthorityPresentation(
  record: RfqLifecycleRecord,
): RfqAuthorityPresentation {
  const authority = displayedRfqAuthority(record);
  return Object.freeze({
    status: authority.status,
    label: authority.label,
    detail: DETAIL[authority.status],
    tone: TONE[authority.status],
    blocksValueActions: authority.status !== "local-non-authoritative",
    needsReconciliation:
      authority.status !== "local-non-authoritative" &&
      authority.status !== "authoritative",
    revision: authority.revision,
    observedAt: authority.observedAt,
  });
}

export type RfqAuthorityProjection = Readonly<{
  source: typeof RFQ_AUTHORITY_PROJECTION_SOURCE;
  runtimeEpoch: string;
  chainId: string;
  account: string;
  rfqId: string;
  dealId: string;
  lifecycle?: "v2" | "v3";
  status: RfqAuthorityStatus;
  revision: number;
  observedAt: number;
  validUntil: number;
  fillsDigest?: string;
  lockTaken?: readonly Readonly<{
    lockId: string;
    amountA: string;
  }>[];
}>;

/**
 * A live mark is both non-serializable and short-lived. Persisted rows never
 * inherit it, and an open tab automatically demotes the row when the server's
 * validity window ends.
 */
const LIVE_AUTHORITY_RECORDS = new WeakMap<object, number>();

const STATUSES: readonly RfqAuthorityStatus[] = [
  "local-non-authoritative",
  "authoritative",
  "stale",
  "disagreement",
  "reorged",
  "quarantined",
];

function exactText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    throw new Error(`The authority projection ${label} is invalid.`);
  return value;
}

function exactInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new Error(`The authority projection ${label} is invalid.`);
  return Number(value);
}

function exactFelt(value: unknown, label: string, allowZero = false): string {
  const text = exactText(value, label);
  let parsed: bigint;
  try {
    parsed = BigInt(text);
  } catch {
    throw new Error(`The authority projection ${label} is invalid.`);
  }
  if (
    parsed < 0n ||
    parsed >= 1n << 252n ||
    (!allowZero && parsed === 0n) ||
    text !== `0x${parsed.toString(16)}`
  )
    throw new Error(`The authority projection ${label} is invalid.`);
  return text;
}

function exactAmount(value: unknown, label: string): string {
  const text = exactText(value, label);
  if (!/^[1-9][0-9]*$/.test(text) || BigInt(text) >= 1n << 128n)
    throw new Error(`The authority projection ${label} is invalid.`);
  return text;
}

/**
 * Parses a server-shaped authority answer. Labels supplied by the caller are
 * discarded; only the enumerated status survives.
 */
export function normalizeRfqAuthorityProjection(
  value: unknown,
): RfqAuthorityProjection {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The authority projection is not an object.");
  const row = value as Record<string, unknown>;
  if (row.source !== RFQ_AUTHORITY_PROJECTION_SOURCE)
    throw new Error("The authority projection source is not recognized.");
  const status = exactText(row.status, "status");
  if (!STATUSES.includes(status as RfqAuthorityStatus))
    throw new Error("The authority projection status is not recognized.");
  const runtimeEpoch = exactText(row.runtimeEpoch, "runtime epoch");
  if (!/^[0-9a-f]{32}$/.test(runtimeEpoch))
    throw new Error("The authority projection runtime epoch is invalid.");
  const lifecycle =
    row.lifecycle === undefined
      ? undefined
      : row.lifecycle === "v2" || row.lifecycle === "v3"
        ? row.lifecycle
        : (() => {
            throw new Error(
              "The authority projection lifecycle is not recognized.",
            );
          })();
  const takeEvidencePresent =
    row.fillsDigest !== undefined || row.lockTaken !== undefined;
  let normalizedFillsDigest: string | undefined;
  let normalizedLockTaken:
    | readonly Readonly<{ lockId: string; amountA: string }>[]
    | undefined;
  if (takeEvidencePresent) {
    if (
      lifecycle !== "v3" ||
      row.fillsDigest === undefined ||
      !Array.isArray(row.lockTaken) ||
      row.lockTaken.length < 1 ||
      row.lockTaken.length > 4
    )
      throw new Error("The authority projection Take evidence is incomplete.");
    normalizedFillsDigest = exactFelt(
      row.fillsDigest,
      "fills digest",
      true,
    );
    normalizedLockTaken = Object.freeze(
      row.lockTaken.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("The authority projection LockTaken row is invalid.");
        const fill = value as Record<string, unknown>;
        if (
          Object.keys(fill).sort().join(",") !== "amountA,lockId"
        )
          throw new Error("The authority projection LockTaken schema is invalid.");
        return Object.freeze({
          lockId: exactFelt(fill.lockId, `LockTaken ${index} lock id`),
          amountA: exactAmount(fill.amountA, `LockTaken ${index} amount`),
        });
      }),
    );
    if (
      new Set(normalizedLockTaken.map(({ lockId }) => lockId)).size !==
      normalizedLockTaken.length
    )
      throw new Error("The authority projection reused a LockTaken lock id.");
  }
  if (
    lifecycle === "v3" &&
    status === "authoritative" &&
    (!normalizedFillsDigest || !normalizedLockTaken)
  )
    throw new Error("The authoritative v3 projection lacks Take evidence.");
  const observedAt = exactInteger(row.observedAt, "observation time", 1);
  const validUntil = exactInteger(row.validUntil, "validity deadline", 1);
  if (validUntil <= observedAt)
    throw new Error(
      "The authority projection validity deadline must follow its observation.",
    );
  return Object.freeze({
    source: RFQ_AUTHORITY_PROJECTION_SOURCE,
    runtimeEpoch,
    chainId: canonicalRfqChainId(exactText(row.chainId, "chain")),
    account: canonicalRfqAccount(exactText(row.account, "account")),
    rfqId: exactText(row.rfqId, "RFQ id"),
    dealId: exactText(row.dealId, "deal id"),
    ...(lifecycle ? { lifecycle } : {}),
    status: status as RfqAuthorityStatus,
    revision: exactInteger(row.revision, "revision", 1),
    observedAt,
    validUntil,
    ...(normalizedFillsDigest && normalizedLockTaken
      ? {
          fillsDigest: normalizedFillsDigest,
          lockTaken: normalizedLockTaken,
        }
      : {}),
  });
}

/**
 * Binds a normalized projection to one exact record. Every coordinate must
 * match; a mismatched or non-increasing answer is refused rather than shown.
 */
export function rfqAuthoritySignalForRecord(
  projection: RfqAuthorityProjection,
  record: RfqLifecycleRecord,
  runtimeEpoch: string,
): RfqEvidenceAuthority {
  if (projection.runtimeEpoch !== runtimeEpoch)
    throw new Error("The authority projection is from another local runtime.");
  if (projection.chainId !== record.chainId)
    throw new Error("The authority projection is bound to another chain.");
  if (projection.account !== record.account)
    throw new Error("The authority projection is bound to another account.");
  if (projection.rfqId !== record.rfqId)
    throw new Error("The authority projection is bound to another RFQ.");
  if (projection.lifecycle && projection.lifecycle !== record.mode)
    throw new Error("The authority projection is bound to another lifecycle.");
  if (
    record.mode === "v3" &&
    projection.status === "authoritative" &&
    projection.lifecycle !== "v3"
  )
    throw new Error("The authoritative projection omitted its v3 lifecycle.");
  if (record.mode === "v3" && projection.status === "authoritative") {
    if (!projection.fillsDigest || !projection.lockTaken)
      throw new Error("The authoritative v3 projection omitted Take evidence.");
    const target = takeAttemptTargetFromLifecycle(record);
    const expectedDigest = fillsDigest(
      target.expected.fills.map((fill) => ({
        lockId: fill.lockId,
        amountA: BigInt(fill.amountA),
      })),
    );
    if (
      canonicalLocalRfqId(projection.fillsDigest) !== expectedDigest ||
      projection.lockTaken.length !== target.expected.fills.length ||
      projection.lockTaken.some(
        (fill, index) =>
          fill.lockId !== target.expected.fills[index].lockId ||
          fill.amountA !== target.expected.fills[index].amountA,
      )
    )
      throw new Error(
        "The authoritative v3 projection changed the exact fill composition.",
      );
  }
  const dealId = record.settlement?.dealId;
  if (!dealId || projection.dealId !== dealId)
    throw new Error("The authority projection is bound to another deal.");
  if (projection.revision <= record.evidenceAuthority.revision)
    throw new Error("The authority projection revision must increase.");
  return Object.freeze({
    status: projection.status,
    label: LABELS[projection.status],
    revision: projection.revision,
    observedAt: projection.observedAt,
  });
}

function applyLiveRfqAuthorityProjection(
  record: RfqLifecycleRecord,
  projection: RfqAuthorityProjection,
  runtimeEpoch: string,
): RfqLifecycleRecord {
  const next = applyRfqAuthoritySignal(
    record,
    rfqAuthoritySignalForRecord(projection, record, runtimeEpoch),
  );
  if (projection.status === "authoritative")
    LIVE_AUTHORITY_RECORDS.set(next, projection.validUntil);
  return next;
}

/**
 * Reads and applies one server projection as a single operation. Callers
 * cannot inject a projection into the in-memory finality mark: the only public
 * entry point obtains the value from the local authority service itself.
 */
export async function refreshLiveRfqAuthority(
  record: RfqLifecycleRecord,
  runtimeEpoch: string,
): Promise<RfqLifecycleRecord> {
  const { readLocalnetRfqAuthority } = await import(
    "./localnet-private-intents"
  );
  const projection = await readLocalnetRfqAuthority(record);
  return applyLiveRfqAuthorityProjection(record, projection, runtimeEpoch);
}
