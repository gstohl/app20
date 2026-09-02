import { sha256 } from "@noble/hashes/sha2.js";
import { localnetRuntimeEpoch } from "@/dev/localnet-runtime-epoch";
import { LOCALNET_CHAIN_ID } from "@/utils/constants";
import {
  RFQ_LIFECYCLE_SCHEMA_REVISION,
  RFQ_LIFECYCLE_V2_SCHEMA_REVISION,
  RFQ_LIFECYCLE_V1_SCHEMA_REVISION,
  HISTORICAL_APP20_LOCALNET_CHAIN_ID,
  assertRfqLifecycleAttemptTargets,
  assertRfqV3LifecycleBindings,
  canonicalLocalRfqId,
  canonicalRfqAccount,
  canonicalRfqChainId,
  isLocalRfqChain,
  finalizeRfqLifecycleForStorage,
  lifecycleMayForget,
  markRfqLifecyclePersisted,
  reviseRfqLifecycle,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

const DATABASE = "app20-rfq-resume";
const STORE = "lifecycle";
const FORBIDDEN_FIELD =
  /viewing.?key|maker.?secret|capability.?secret|raw.?balance|witness|note.?id|proof|private.?key|signing.?key/i;
const TOMBSTONE_SCHEMA = "app20/rfq-lifecycle-tombstone/v1" as const;

export interface RfqStorageTombstone {
  tombstoneSchema: typeof TOMBSTONE_SCHEMA;
  storageKey: string;
  storageRevision: number;
  recordDigest: string;
}

type RfqStoredRow = RfqLifecycleRecord | RfqStorageTombstone;

export const RFQ_STORAGE_DISCLOSURE =
  "Exact RFQ terms, selected quote or lock metadata, public settlement identifiers, attempt status, and the active v3 taker signing key are stored in this browser's IndexedDB. The signing key is removed when the RFQ becomes terminal and from restored backup records. Viewing keys, unrelated signing keys, notes, witnesses, proofs, and raw balances are never stored in RFQ records." as const;

function canonicalStorageRfqId(chainId: string, rfqId: string): string {
  return isLocalRfqChain(chainId) ? canonicalLocalRfqId(rfqId) : rfqId;
}

export function rfqStorageKey(
  input: Pick<RfqLifecycleRecord, "chainId" | "account" | "rfqId">,
  runtimeEpoch?: string,
): string {
  return [
    RFQ_LIFECYCLE_SCHEMA_REVISION,
    ...(runtimeEpoch ? [runtimeEpoch] : []),
    canonicalRfqChainId(input.chainId),
    canonicalRfqAccount(input.account),
    canonicalStorageRfqId(input.chainId, input.rfqId),
  ].join("|");
}

function storagePrefix(
  schema: string,
  chainId: string,
  account: string,
  runtimeEpoch?: string,
): string {
  return `${schema}|${runtimeEpoch ? `${runtimeEpoch}|` : ""}${canonicalRfqChainId(chainId)}|${canonicalRfqAccount(account)}|`;
}

function legacyStorageKey(
  input: Pick<RfqLifecycleRecord, "chainId" | "account" | "rfqId">,
  runtimeEpoch?: string,
): string {
  return [
    RFQ_LIFECYCLE_V2_SCHEMA_REVISION,
    ...(runtimeEpoch ? [runtimeEpoch] : []),
    canonicalRfqChainId(input.chainId),
    canonicalRfqAccount(input.account),
    canonicalStorageRfqId(input.chainId, input.rfqId),
  ].join("|");
}

function v1StorageKey(
  input: Pick<RfqLifecycleRecord, "chainId" | "account" | "rfqId">,
  runtimeEpoch?: string,
): string {
  return [
    RFQ_LIFECYCLE_V1_SCHEMA_REVISION,
    ...(runtimeEpoch ? [runtimeEpoch] : []),
    canonicalRfqChainId(input.chainId),
    canonicalRfqAccount(input.account),
    canonicalStorageRfqId(input.chainId, input.rfqId),
  ].join("|");
}

function assertSafe(value: unknown, path = "record"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafe(item, `${path}[${index}]`);
    });
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const disclosedTakerSigningKey =
      path === "record" && key === "takerSigningKey";
    if (FORBIDDEN_FIELD.test(key) && !disclosedTakerSigningKey) {
      throw new Error(
        `RFQ resume storage refuses sensitive field ${path}.${key}.`,
      );
    }
    assertSafe(child, `${path}.${key}`);
  }
}

export type RfqAliasMigrationScope = Readonly<{
  chainId: string;
  account: string;
  runtimeEpoch?: string;
}>;

export type RfqAliasMigrationPlan = Readonly<{
  deleteKeys: readonly string[];
  putEntries: readonly (readonly [string, unknown])[];
}>;

export interface RfqStorageBackend {
  /** Atomically canonicalizes every supported historical physical alias. */
  migrateAliases(scope: RfqAliasMigrationScope): Promise<void>;
  compareAndPut(key: string, value: RfqLifecycleRecord): Promise<void>;
  compareAndDelete(
    key: string,
    legacyKey: string,
    expected: RfqLifecycleRecord,
  ): Promise<void>;
  get(key: string): Promise<unknown>;
  list(prefix: string): Promise<unknown[]>;
  delete(key: string): Promise<void>;
}

const ATTEMPT_RANK = Object.freeze({
  preparing: 1,
  "wallet-boundary-unknown": 2,
  "submitted-unknown": 2,
  reverted: 3,
  confirmed: 4,
} as const);

const VALUE_STATES = new Set([
  "submission-unknown",
  "funded",
  "filled",
  "claimable",
  "settled",
  "refundable",
  "refunded",
]);

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new Error("RFQ storage cannot digest an undefined record.");
  return encoded;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function valueDigest(value: unknown): string {
  return `sha256:${bytesToHex(
    sha256(new TextEncoder().encode(canonicalJson(value))),
  )}`;
}

function recordDigest(record: RfqLifecycleRecord): string {
  return valueDigest(finalizeRfqLifecycleForStorage(record));
}

export function isRfqStorageTombstone(
  value: unknown,
): value is RfqStorageTombstone {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RfqStorageTombstone>;
  return (
    candidate.tombstoneSchema === TOMBSTONE_SCHEMA &&
    typeof candidate.storageKey === "string" &&
    Number.isSafeInteger(candidate.storageRevision) &&
    typeof candidate.recordDigest === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(candidate.recordDigest)
  );
}

export function createRfqStorageTombstone(
  storageKey: string,
  expected: RfqLifecycleRecord,
): RfqStorageTombstone {
  return Object.freeze({
    tombstoneSchema: TOMBSTONE_SCHEMA,
    storageKey,
    storageRevision: Number.isSafeInteger(expected.storageRevision)
      ? expected.storageRevision
      : 0,
    recordDigest: recordDigest(expected),
  });
}

function assertPreserved(prior: unknown, next: unknown, label: string): void {
  if (prior !== undefined && !sameJson(prior, next))
    throw new Error(`RFQ storage rejected removal or replacement of ${label}.`);
}

function isExactTicketPersistenceTransition(
  prior: RfqLifecycleRecord,
  replacement: RfqLifecycleRecord,
): boolean {
  const priorSettlement = prior.settlement;
  const nextSettlement = replacement.settlement;
  if (
    !priorSettlement ||
    !nextSettlement ||
    priorSettlement.ticketAddress !== undefined ||
    nextSettlement.ticketAddress === undefined
  )
    return false;
  const { ticketAddress: _priorTicket, ...priorCore } = priorSettlement;
  const { ticketAddress: nextTicket, ...nextCore } = nextSettlement;
  if (canonicalJson(priorCore) !== canonicalJson(nextCore)) return false;
  try {
    if (canonicalLocalRfqId(nextTicket) !== nextTicket || nextTicket === "0x0")
      return false;
  } catch {
    return false;
  }
  const priorAttempt = prior.attempts.funding;
  const nextAttempt = replacement.attempts.funding;
  return Boolean(
    priorAttempt &&
      nextAttempt &&
      priorAttempt.attemptId === nextAttempt.attemptId &&
      priorAttempt.target?.operation === "funding-ticket" &&
      nextAttempt.target?.operation === "funding-ticket" &&
      sameJson(priorAttempt.target, nextAttempt.target) &&
      canonicalLocalRfqId(priorAttempt.target.dealId) ===
        canonicalLocalRfqId(nextSettlement.dealId),
  );
}

export function assertRfqStorageReplacement(
  existing: unknown,
  replacement: RfqLifecycleRecord,
): void {
  if (isRfqStorageTombstone(existing))
    throw new Error(
      "RFQ storage permanently rejected a lifecycle successor for a forgotten RFQ ID.",
    );
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    if (
      replacement.storageRevision !== 0 &&
      replacement.storagePredecessorRevision !== replacement.storageRevision - 1
    )
      throw new Error(
        "RFQ storage rejected an unbound initial lifecycle snapshot.",
      );
    return;
  }
  const prior = existing as RfqLifecycleRecord;
  const durablePriorRevision = Number.isSafeInteger(prior.storageRevision)
    ? prior.storageRevision
    : 0;
  const durablePrior = finalizeRfqLifecycleForStorage(prior);
  const durableReplacement = finalizeRfqLifecycleForStorage(replacement);
  if (sameJson(durablePrior, durableReplacement)) return;
  if (
    replacement.storagePredecessorRevision !== durablePriorRevision ||
    replacement.storageRevision !== durablePriorRevision + 1
  )
    throw new Error(
      "RFQ storage rejected a stale lifecycle snapshot without its exact predecessor revision.",
    );

  if (prior.terms) {
    const next = replacement.terms;
    const { buyAmount: _priorBuyAmount, ...priorCore } = prior.terms;
    const { buyAmount: _nextBuyAmount, ...nextCore } =
      next ?? ({} as typeof prior.terms);
    if (
      !next ||
      !sameJson(priorCore, nextCore) ||
      (prior.terms.buyAmount !== undefined &&
        prior.terms.buyAmount !== next.buyAmount)
    )
      throw new Error(
        "RFQ storage rejected removal or replacement of exact RFQ terms.",
      );
  }
  if (prior.selectedQuote) {
    const next = replacement.selectedQuote;
    const {
      quoteDigest: _priorDigest,
      reservationFence: _priorFence,
      ...priorCore
    } = prior.selectedQuote;
    const {
      quoteDigest: _nextDigest,
      reservationFence: _nextFence,
      ...nextCore
    } = next ?? ({} as typeof prior.selectedQuote);
    if (
      !next ||
      !sameJson(priorCore, nextCore) ||
      (prior.selectedQuote.quoteDigest !== undefined &&
        prior.selectedQuote.quoteDigest !== next.quoteDigest) ||
      (prior.selectedQuote.reservationFence !== undefined &&
        prior.selectedQuote.reservationFence !== next.reservationFence)
    )
      throw new Error(
        "RFQ storage rejected removal or replacement of selected quote identity.",
      );
  }
  if (
    prior.settlement !== undefined &&
    !isExactTicketPersistenceTransition(prior, replacement) &&
    canonicalJson(prior.settlement) !== canonicalJson(replacement.settlement)
  )
    throw new Error(
      "RFQ storage rejected removal or replacement of settlement identity.",
    );
  assertPreserved(
    prior.requestDigest,
    replacement.requestDigest,
    "request identity",
  );
  assertPreserved(
    prior.transactionHash,
    replacement.transactionHash,
    "funding transaction hash",
  );
  if (prior.attempts.take?.state !== "reverted") {
    assertPreserved(
      prior.takeTransactionHash,
      replacement.takeTransactionHash,
      "Take transaction hash",
    );
  }
  if (prior.mode !== replacement.mode)
    throw new Error("RFQ storage rejected replacement of lifecycle mode.");
  if (prior.mode === "v3") {
    if (
      prior.restoredFromBackup &&
      (replacement.restoredFromBackup !== true ||
        replacement.takerSigningKey !== undefined)
    ) {
      throw new Error(
        "RFQ storage cannot make a backup-restored record executable.",
      );
    }
    assertPreserved(prior.bucket, replacement.bucket, "v3 size bucket");
    assertPreserved(
      prior.takerCommitment,
      replacement.takerCommitment,
      "v3 taker commitment",
    );
    assertPreserved(prior.fills, replacement.fills, "v3 exact fills");
    assertPreserved(
      prior.transcriptAcknowledgements,
      replacement.transcriptAcknowledgements,
      "v3 transcript acknowledgements",
    );
    if (
      prior.takerSigningKey !== undefined &&
      prior.takerSigningKey !== replacement.takerSigningKey &&
      !["settled", "expired", "refused", "cancelled"].includes(
        replacement.state,
      ) &&
      replacement.restoredFromBackup !== true
    ) {
      throw new Error(
        "RFQ storage rejected replacement of the v3 taker signing key.",
      );
    }
  }

  if (prior.latestObservation) {
    const next = replacement.latestObservation;
    if (
      !next ||
      next.status < prior.latestObservation.status ||
      (next.status === prior.latestObservation.status &&
        prior.latestObservation.stage === "expired" &&
        next.stage !== "expired")
    )
      throw new Error(
        "RFQ storage rejected removal or downgrade of chain observation evidence.",
      );
  }
  if (
    prior.evidenceAuthority.status !== "local-non-authoritative" &&
    replacement.evidenceAuthority.status === "local-non-authoritative"
  )
    throw new Error(
      "RFQ storage rejected removal of unresolved authority evidence.",
    );
  // Browser-persisted revision numbers are not a trusted authority high-water.
  // A runtime-bound verifier may replace a forged large number with its lower
  // server-owned revision, while the conservative status rule above keeps
  // unresolved evidence from becoming locally actionable.

  for (const phase of [
    "funding",
    "fill",
    "claim",
    "refund",
    "reservation-release",
    "take",
  ] as const) {
    const attempt = prior.attempts?.[phase];
    if (!attempt) continue;
    const next = replacement.attempts[phase];
    const protectedAttempt =
      attempt.state !== "reverted" || next?.attemptId === attempt.attemptId;
    if (!next && protectedAttempt)
      throw new Error(
        `RFQ storage rejected removal of the ${phase} attempt evidence.`,
      );
    if (!next) continue;
    if (next.attemptId !== attempt.attemptId) {
      if (protectedAttempt)
        throw new Error(
          `RFQ storage rejected a sibling snapshot that would erase the ${phase} attempt evidence.`,
        );
      continue;
    }
    if (ATTEMPT_RANK[next.state] < ATTEMPT_RANK[attempt.state])
      throw new Error(
        `RFQ storage rejected a same-attempt ${phase} state downgrade.`,
      );
    assertPreserved(
      attempt.transactionHash,
      next.transactionHash,
      `${phase} transaction hash`,
    );
    assertPreserved(attempt.target, next.target, `${phase} immutable target`);
    if (
      attempt.walletBoundary === "entered" &&
      next.walletBoundary !== "entered"
    )
      throw new Error(
        `RFQ storage rejected removal of the ${phase} wallet-boundary evidence.`,
      );
  }

  if (
    VALUE_STATES.has(prior.state) &&
    !VALUE_STATES.has(replacement.state) &&
    replacement.state !== "quarantined" &&
    replacement.state !== "reorged"
  )
    throw new Error(
      "RFQ storage rejected downgrade of value-bearing lifecycle evidence.",
    );
  if (
    (prior.state === "settled" || prior.state === "refunded") &&
    replacement.state !== prior.state &&
    replacement.state !== "quarantined" &&
    replacement.state !== "reorged"
  )
    throw new Error(
      "RFQ storage rejected downgrade of terminal lifecycle evidence.",
    );
}

export function assertRfqStorageRemoval(
  existing: unknown,
  expected: RfqLifecycleRecord,
): void {
  if (!lifecycleMayForget(expected))
    throw new Error(
      "RFQ storage refused removal of unresolved or value-bearing lifecycle evidence.",
    );
  if (isRfqStorageTombstone(existing)) {
    // A tombstone is already the strongest possible forget-wins evidence for
    // this canonical ID. Repeating removal must not depend on an obsolete alias
    // record digest.
    return;
  }
  if (existing === undefined) return;
  if (
    !existing ||
    typeof existing !== "object" ||
    Array.isArray(existing) ||
    !sameJson(
      finalizeRfqLifecycleForStorage(existing as RfqLifecycleRecord),
      finalizeRfqLifecycleForStorage(expected),
    )
  )
    throw new Error(
      "RFQ storage rejected stale removal without the exact terminal snapshot.",
    );
}

export function replaceRfqWithTombstone(
  existing: unknown,
  storageKey: string,
  expected: RfqLifecycleRecord,
): RfqStorageTombstone {
  assertRfqStorageRemoval(existing, expected);
  if (isRfqStorageTombstone(existing)) return existing;
  return createRfqStorageTombstone(storageKey, expected);
}

type ParsedPhysicalKey = Readonly<{
  key: string;
  schema:
    | typeof RFQ_LIFECYCLE_SCHEMA_REVISION
    | typeof RFQ_LIFECYCLE_V2_SCHEMA_REVISION
    | typeof RFQ_LIFECYCLE_V1_SCHEMA_REVISION;
  chainId: string;
  account: string;
  rfqId: string;
}>;

function parsePhysicalKey(
  key: unknown,
  runtimeEpoch?: string,
): ParsedPhysicalKey | undefined {
  if (typeof key !== "string") return undefined;
  const parts = key.split("|");
  const schema = parts.shift();
  if (
    schema !== RFQ_LIFECYCLE_SCHEMA_REVISION &&
    schema !== RFQ_LIFECYCLE_V2_SCHEMA_REVISION &&
    schema !== RFQ_LIFECYCLE_V1_SCHEMA_REVISION
  )
    return undefined;
  if (runtimeEpoch !== undefined) {
    if (parts.shift() !== runtimeEpoch) return undefined;
  }
  const chainId = parts.shift();
  const account = parts.shift();
  const rfqId = parts.join("|");
  if (!chainId || !account || !rfqId) return undefined;
  return { key, schema, chainId, account, rfqId };
}

function isSupportedLocalnetAlias(value: string): boolean {
  const unprefixed = value.toUpperCase().startsWith("STARKNET:")
    ? value.slice("starknet:".length)
    : value;
  const upper = unprefixed.toUpperCase();
  if (upper === "APP20_LOCALNET" || upper === "QUIETLINE_LOCAL") return true;
  try {
    const felt = `0x${BigInt(unprefixed).toString(16)}`;
    return (
      felt === LOCALNET_CHAIN_ID || felt === HISTORICAL_APP20_LOCALNET_CHAIN_ID
    );
  } catch {
    return false;
  }
}

function canonicalPhysicalKey(
  schema: ParsedPhysicalKey["schema"],
  scope: RfqAliasMigrationScope,
  rfqId: string,
): string {
  return [
    schema,
    ...(scope.runtimeEpoch ? [scope.runtimeEpoch] : []),
    LOCALNET_CHAIN_ID,
    canonicalRfqAccount(scope.account),
    rfqId,
  ].join("|");
}

function conflictTombstone(
  key: string,
  candidates: readonly unknown[],
): RfqStorageTombstone {
  const revisions = candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return [];
    const revision = (candidate as { storageRevision?: unknown })
      .storageRevision;
    return Number.isSafeInteger(revision) ? [Number(revision)] : [];
  });
  return Object.freeze({
    tombstoneSchema: TOMBSTONE_SCHEMA,
    storageKey: key,
    storageRevision: Math.max(0, ...revisions),
    recordDigest: valueDigest(candidates),
  });
}

function canonicalizeLocalIdentityFields(
  row: Record<string, unknown>,
  parsed: ParsedPhysicalKey,
  scope: RfqAliasMigrationScope,
): Record<string, unknown> | undefined {
  const canonicalId = canonicalLocalRfqId(parsed.rfqId);
  if (canonicalLocalRfqId(String(row.rfqId)) !== canonicalId) return undefined;
  if (
    !isSupportedLocalnetAlias(String(row.chainId)) ||
    canonicalRfqAccount(String(row.account)) !==
      canonicalRfqAccount(scope.account)
  )
    return undefined;

  const canonicalSettlement = (() => {
    if (row.settlement === undefined) return undefined;
    if (
      !row.settlement ||
      typeof row.settlement !== "object" ||
      Array.isArray(row.settlement)
    )
      throw new Error();
    const settlement = row.settlement as Record<string, unknown>;
    const dealId = canonicalLocalRfqId(String(settlement.dealId));
    if (dealId !== canonicalId) throw new Error();
    return {
      ...settlement,
      dealId,
      ...(settlement.ticketAddress === undefined
        ? {}
        : {
            ticketAddress: canonicalLocalRfqId(
              String(settlement.ticketAddress),
            ),
          }),
    };
  })();

  const attempts =
    row.attempts &&
    typeof row.attempts === "object" &&
    !Array.isArray(row.attempts)
      ? Object.fromEntries(
          Object.entries(row.attempts).map(([phase, attempt]) => {
            if (
              !attempt ||
              typeof attempt !== "object" ||
              Array.isArray(attempt)
            )
              return [phase, attempt];
            const target = (attempt as Record<string, unknown>).target;
            if (!target || typeof target !== "object" || Array.isArray(target))
              return [phase, attempt];
            const original = target as Record<string, unknown>;
            // Immutable target evidence is validated before any alias rewrite.
            if (
              !isSupportedLocalnetAlias(String(original.chainId)) ||
              canonicalRfqAccount(String(original.account)) !==
                canonicalRfqAccount(scope.account) ||
              canonicalLocalRfqId(String(original.rfqId)) !== canonicalId
            )
              throw new Error();
            const targetDealId =
              original.dealId === undefined
                ? undefined
                : canonicalLocalRfqId(String(original.dealId));
            if (targetDealId !== undefined && targetDealId !== canonicalId)
              throw new Error();
            return [
              phase,
              {
                ...(attempt as Record<string, unknown>),
                target: {
                  ...original,
                  chainId: LOCALNET_CHAIN_ID,
                  account: canonicalRfqAccount(scope.account),
                  rfqId: canonicalId,
                  ...(targetDealId === undefined
                    ? {}
                    : { dealId: targetDealId }),
                  ...(original.ticketAddress === undefined
                    ? {}
                    : {
                        ticketAddress: canonicalLocalRfqId(
                          String(original.ticketAddress),
                        ),
                      }),
                },
              },
            ];
          }),
        )
      : row.attempts;

  const latestObservation = (() => {
    if (
      !row.latestObservation ||
      typeof row.latestObservation !== "object" ||
      Array.isArray(row.latestObservation)
    )
      return row.latestObservation;
    const observation = row.latestObservation as Record<string, unknown>;
    const dealId = canonicalLocalRfqId(String(observation.dealId));
    if (dealId !== canonicalId) throw new Error();
    return { ...observation, dealId };
  })();

  return {
    ...row,
    chainId: LOCALNET_CHAIN_ID,
    account: canonicalRfqAccount(scope.account),
    rfqId: canonicalId,
    ...(canonicalSettlement === undefined
      ? {}
      : { settlement: canonicalSettlement }),
    ...(attempts === undefined ? {} : { attempts }),
    ...(latestObservation === undefined ? {} : { latestObservation }),
  };
}

function canonicalizeAliasRecord(
  value: unknown,
  parsed: ParsedPhysicalKey,
  scope: RfqAliasMigrationScope,
): RfqLifecycleRecord | Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const row = value as Record<string, unknown>;
  if (row.schemaRevision !== parsed.schema) return undefined;
  try {
    const canonical = canonicalizeLocalIdentityFields(row, parsed, scope);
    if (!canonical) return undefined;
    if (parsed.schema === RFQ_LIFECYCLE_SCHEMA_REVISION)
      assertRfqLifecycleAttemptTargets(canonical as RfqLifecycleRecord);
    return canonical;
  } catch {
    return undefined;
  }
}

function canonicalizeStorageRecord(
  record: RfqLifecycleRecord,
): RfqLifecycleRecord {
  if (!isLocalRfqChain(record.chainId)) return record;
  const parsed: ParsedPhysicalKey = {
    key: "storage-boundary",
    schema: record.schemaRevision,
    chainId: record.chainId,
    account: record.account,
    rfqId: record.rfqId,
  };
  const canonical = canonicalizeAliasRecord(record, parsed, {
    chainId: record.chainId,
    account: record.account,
  });
  if (!canonical)
    throw new Error(
      "Local RFQ lifecycle identity is opaque, noncanonical, or contradictory.",
    );
  return canonical as RfqLifecycleRecord;
}

function strongerRecord(
  left: RfqLifecycleRecord,
  right: RfqLifecycleRecord,
): RfqLifecycleRecord | undefined {
  if (sameJson(left, right)) return left;
  const mayReplace = (
    prior: RfqLifecycleRecord,
    candidate: RfqLifecycleRecord,
  ): boolean => {
    try {
      assertRfqStorageReplacement(prior, {
        ...candidate,
        storageRevision: prior.storageRevision + 1,
        storagePredecessorRevision: prior.storageRevision,
      });
      return true;
    } catch {
      return false;
    }
  };
  const rightDominates = mayReplace(left, right);
  const leftDominates = mayReplace(right, left);
  if (rightDominates && !leftDominates) return right;
  if (leftDominates && !rightDominates) return left;
  if (rightDominates && leftDominates) {
    if (right.storageRevision > left.storageRevision) return right;
    if (left.storageRevision > right.storageRevision) return left;
    return right.updatedAt > left.updatedAt ? right : left;
  }
  return undefined;
}

/**
 * Plans an atomic, fail-closed migration of every known local-chain physical
 * alias. Conflicting siblings become a canonical tombstone rather than
 * selecting a row with weaker evidence.
 */
export function planRfqAliasMigration(
  entries: readonly (readonly [IDBValidKey | string, unknown])[],
  scope: RfqAliasMigrationScope,
): RfqAliasMigrationPlan {
  if (canonicalRfqChainId(scope.chainId) !== LOCALNET_CHAIN_ID) {
    return { deleteKeys: [], putEntries: [] };
  }
  const account = canonicalRfqAccount(scope.account);
  const matches = entries.flatMap(([key, value]) => {
    const parsed = parsePhysicalKey(key, scope.runtimeEpoch);
    if (
      !parsed ||
      !isSupportedLocalnetAlias(parsed.chainId) ||
      canonicalRfqAccount(parsed.account) !== account
    )
      return [];
    let canonicalId: string;
    try {
      canonicalId = canonicalLocalRfqId(parsed.rfqId);
    } catch {
      // Opaque local legacy identities are retained only as hidden conflict
      // tombstones and can never become executable lifecycle authorities.
      canonicalId = parsed.rfqId;
    }
    return [{ parsed, value, canonicalId }];
  });
  const byId = new Map<string, typeof matches>();
  for (const match of matches)
    byId.set(match.canonicalId, [
      ...(byId.get(match.canonicalId) ?? []),
      match,
    ]);

  const deleteKeys: string[] = [];
  const putEntries: Array<readonly [string, unknown]> = [];
  for (const [rfqId, candidates] of byId) {
    deleteKeys.push(...candidates.map(({ parsed }) => parsed.key));
    const canonicalCurrent = canonicalPhysicalKey(
      RFQ_LIFECYCLE_SCHEMA_REVISION,
      scope,
      rfqId,
    );
    const tombstones = candidates
      .map(({ value }) => value)
      .filter(isRfqStorageTombstone);
    if (tombstones.length) {
      const strongest = tombstones.reduce((left, right) =>
        right.storageRevision > left.storageRevision ? right : left,
      );
      putEntries.push([
        canonicalCurrent,
        Object.freeze({ ...strongest, storageKey: canonicalCurrent }),
      ]);
      continue;
    }

    const canonicalized = candidates.map(({ parsed, value }) => ({
      schema: parsed.schema,
      value: canonicalizeAliasRecord(value, parsed, scope),
      raw: value,
    }));
    if (canonicalized.some(({ value }) => value === undefined)) {
      putEntries.push([
        canonicalCurrent,
        conflictTombstone(
          canonicalCurrent,
          canonicalized.map(({ raw }) => raw),
        ),
      ]);
      continue;
    }
    const current = canonicalized
      .filter(({ schema }) => schema === RFQ_LIFECYCLE_SCHEMA_REVISION)
      .map(({ value }) => value as RfqLifecycleRecord);
    let strongestCurrent: RfqLifecycleRecord | undefined = current[0];
    for (const candidate of current.slice(1)) {
      strongestCurrent = strongerRecord(strongestCurrent!, candidate);
      if (!strongestCurrent) break;
    }
    const v2 = canonicalized.filter(
      ({ schema }) => schema === RFQ_LIFECYCLE_V2_SCHEMA_REVISION,
    );
    const v1 = canonicalized.filter(
      ({ schema }) => schema === RFQ_LIFECYCLE_V1_SCHEMA_REVISION,
    );
    const conflictingV2 =
      v2.length > 1 && v2.some(({ value }) => !sameJson(value, v2[0]!.value));
    const conflictingV1 =
      v1.length > 1 && v1.some(({ value }) => !sameJson(value, v1[0]!.value));
    if (
      (current.length && !strongestCurrent) ||
      conflictingV2 ||
      conflictingV1
    ) {
      putEntries.push([
        canonicalCurrent,
        conflictTombstone(
          canonicalCurrent,
          canonicalized.map(({ value }) => value),
        ),
      ]);
      continue;
    }
    if (strongestCurrent)
      putEntries.push([
        canonicalCurrent,
        finalizeRfqLifecycleForStorage(strongestCurrent),
      ]);
    if (v2.length)
      putEntries.push([
        canonicalPhysicalKey(RFQ_LIFECYCLE_V2_SCHEMA_REVISION, scope, rfqId),
        v2[0]!.value,
      ]);
    if (v1.length)
      putEntries.push([
        canonicalPhysicalKey(RFQ_LIFECYCLE_V1_SCHEMA_REVISION, scope, rfqId),
        v1[0]!.value,
      ]);
  }
  return { deleteKeys, putEntries };
}

export function createRfqLifecycleStorage(
  backend: RfqStorageBackend,
  runtimeEpoch?: string,
) {
  const migrateAliases = (chainId: string, account: string) =>
    backend.migrateAliases({ chainId, account, runtimeEpoch });
  return Object.freeze({
    async save(record: RfqLifecycleRecord): Promise<void> {
      assertSafe(record);
      const canonical = canonicalizeStorageRecord(record);
      assertRfqLifecycleAttemptTargets(canonical);
      assertRfqV3LifecycleBindings(canonical);
      await migrateAliases(canonical.chainId, canonical.account);
      const key = rfqStorageKey(canonical, runtimeEpoch);
      await backend.compareAndPut(key, canonical);
      markRfqLifecyclePersisted(record);
      if (canonical !== record) markRfqLifecyclePersisted(canonical);
    },
    async load(
      input: Pick<RfqLifecycleRecord, "chainId" | "account" | "rfqId">,
    ): Promise<unknown> {
      await migrateAliases(input.chainId, input.account);
      const row = await backend.get(rfqStorageKey(input, runtimeEpoch));
      if (isRfqStorageTombstone(row)) return undefined;
      if (row !== undefined) return row;
      const v2 = await backend.get(legacyStorageKey(input, runtimeEpoch));
      if (isRfqStorageTombstone(v2)) return undefined;
      if (v2 !== undefined) return v2;
      const v1 = await backend.get(v1StorageKey(input, runtimeEpoch));
      return isRfqStorageTombstone(v1) ? undefined : v1;
    },
    async authorize(record: RfqLifecycleRecord): Promise<RfqLifecycleRecord> {
      const canonical = canonicalizeStorageRecord(record);
      assertRfqLifecycleAttemptTargets(canonical);
      assertRfqV3LifecycleBindings(canonical);
      await migrateAliases(canonical.chainId, canonical.account);
      const lease = reviseRfqLifecycle(canonical, {
        updatedAt: canonical.updatedAt,
      });
      await backend.compareAndPut(
        rfqStorageKey(canonical, runtimeEpoch),
        lease,
      );
      markRfqLifecyclePersisted(lease);
      return lease;
    },
    async list(chainId: string, account: string): Promise<unknown[]> {
      await migrateAliases(chainId, account);
      const [current, v2, v1] = await Promise.all([
        backend.list(
          storagePrefix(
            RFQ_LIFECYCLE_SCHEMA_REVISION,
            chainId,
            account,
            runtimeEpoch,
          ),
        ),
        backend.list(
          storagePrefix(
            RFQ_LIFECYCLE_V2_SCHEMA_REVISION,
            chainId,
            account,
            runtimeEpoch,
          ),
        ),
        backend.list(
          storagePrefix(
            RFQ_LIFECYCLE_V1_SCHEMA_REVISION,
            chainId,
            account,
            runtimeEpoch,
          ),
        ),
      ]);
      const rows: unknown[] = [];
      const visibleIds = new Set<string>();
      const shadowedLegacyKeys: string[] = [];
      const rowId = (value: unknown): string | undefined => {
        if (isRfqStorageTombstone(value)) {
          const marker = value.storageKey.split("|").at(-1);
          return marker || undefined;
        }
        const id =
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as { rfqId?: unknown }).rfqId
            : undefined;
        return typeof id === "string" ? id : undefined;
      };
      for (const value of current) {
        const id = rowId(value);
        if (id) visibleIds.add(id);
        if (!isRfqStorageTombstone(value)) rows.push(value);
      }
      for (const value of v2) {
        const id = rowId(value);
        if (id && visibleIds.has(id)) {
          shadowedLegacyKeys.push(
            legacyStorageKey({ chainId, account, rfqId: id }, runtimeEpoch),
          );
          continue;
        }
        if (id) visibleIds.add(id);
        if (!isRfqStorageTombstone(value)) rows.push(value);
      }
      for (const value of v1) {
        const id = rowId(value);
        if (id && visibleIds.has(id)) {
          shadowedLegacyKeys.push(
            v1StorageKey({ chainId, account, rfqId: id }, runtimeEpoch),
          );
          continue;
        }
        if (id) visibleIds.add(id);
        if (!isRfqStorageTombstone(value)) rows.push(value);
      }
      await Promise.all(
        shadowedLegacyKeys.map((key) =>
          backend.delete(key).catch(() => undefined),
        ),
      );
      return rows;
    },
    async remove(record: RfqLifecycleRecord): Promise<void> {
      const canonical = canonicalizeStorageRecord(record);
      await migrateAliases(canonical.chainId, canonical.account);
      const key = rfqStorageKey(canonical, runtimeEpoch);
      await backend.compareAndDelete(
        key,
        legacyStorageKey(canonical, runtimeEpoch),
        canonical,
      );
      await backend.delete(v1StorageKey(canonical, runtimeEpoch));
    },
    async removeLegacy(
      input: Pick<RfqLifecycleRecord, "chainId" | "account" | "rfqId">,
    ): Promise<void> {
      await migrateAliases(input.chainId, input.account);
      await Promise.all([
        backend.delete(legacyStorageKey(input, runtimeEpoch)),
        backend.delete(v1StorageKey(input, runtimeEpoch)),
      ]);
    },
    async clearAll(
      chainId: string,
      account: string,
      expected: readonly RfqLifecycleRecord[],
    ): Promise<void> {
      for (const record of expected) {
        if (
          canonicalRfqChainId(record.chainId) !==
            canonicalRfqChainId(chainId) ||
          canonicalRfqAccount(record.account) !== canonicalRfqAccount(account)
        )
          throw new Error("RFQ storage clear scope changed before removal.");
        await this.remove(record);
      }
      const remaining = await this.list(chainId, account);
      if (remaining.length)
        throw new Error(
          "RFQ storage preserved a concurrent or non-terminal row during clear-all.",
        );
    },
  });
}

function abortIndexedDbTransaction(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already be aborting or inactive after a compare fail.
  }
}

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    throw new Error("IndexedDB is unavailable.");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed."));
  });
}

export function waitForIndexedDbRequests(
  transaction: IDBTransaction,
  requests: readonly IDBRequest[],
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const results: unknown[] = new Array(requests.length);
    const succeeded = new Array(requests.length).fill(false);
    let settled = false;
    const fail = (error?: unknown) => {
      if (settled) return;
      settled = true;
      reject(
        error ??
          transaction.error ??
          requests.find((request) => request.error)?.error ??
          new Error("IndexedDB transaction aborted before commit."),
      );
    };
    requests.forEach((request, index) => {
      request.onsuccess = () => {
        results[index] = request.result;
        succeeded[index] = true;
      };
      request.onerror = () => fail(request.error);
    });
    transaction.onerror = () => fail();
    transaction.onabort = () => fail();
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      if (succeeded.some((ok) => !ok)) {
        reject(
          new Error("IndexedDB transaction completed without its request."),
        );
        return;
      }
      resolve(results);
    };
  });
}

export function waitForIndexedDbTransaction<T>(
  transaction: IDBTransaction,
  request: IDBRequest<T>,
): Promise<T> {
  return waitForIndexedDbRequests(transaction, [request]).then(
    ([result]) => result as T,
  );
}

function runIndexedDbMutation(
  transaction: IDBTransaction,
  start: (fail: (error: unknown) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error?: unknown) => {
      if (settled) return;
      settled = true;
      reject(
        error ??
          transaction.error ??
          new Error("IndexedDB transaction aborted before commit."),
      );
    };
    start(fail);
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    transaction.onerror = () => fail();
    transaction.onabort = () => fail();
  });
}

export function createIndexedDbRfqStorage(
  runtimeEpoch = localnetRuntimeEpoch(),
) {
  const backend: RfqStorageBackend = {
    async migrateAliases(scope) {
      const db = await openDatabase();
      try {
        const transaction = db.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        await runIndexedDbMutation(transaction, (fail) => {
          const keysRequest = store.getAllKeys();
          const valuesRequest = store.getAll();
          let keys: IDBValidKey[] | undefined;
          let values: unknown[] | undefined;
          const apply = () => {
            if (!keys || !values) return;
            const snapshotKeys = keys;
            const snapshotValues = values;
            try {
              if (snapshotKeys.length !== snapshotValues.length) {
                throw new Error(
                  "IndexedDB alias migration read an inconsistent key/value snapshot.",
                );
              }
              const plan = planRfqAliasMigration(
                snapshotKeys.map(
                  (key, index) => [key, snapshotValues[index]] as const,
                ),
                scope,
              );
              for (const key of plan.deleteKeys) store.delete(key);
              for (const [key, value] of plan.putEntries) store.put(value, key);
            } catch (error: unknown) {
              fail(error);
              abortIndexedDbTransaction(transaction);
            }
          };
          keysRequest.onsuccess = () => {
            keys = keysRequest.result;
            apply();
          };
          valuesRequest.onsuccess = () => {
            values = valuesRequest.result;
            apply();
          };
          keysRequest.onerror = () => fail(keysRequest.error);
          valuesRequest.onerror = () => fail(valuesRequest.error);
        });
      } finally {
        db.close();
      }
    },
    async compareAndPut(key, value) {
      const db = await openDatabase();
      try {
        const transaction = db.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        await runIndexedDbMutation(transaction, (fail) => {
          const get = store.get(key);
          get.onerror = () =>
            fail(get.error ?? new Error("IndexedDB compare read failed."));
          get.onsuccess = () => {
            try {
              assertRfqStorageReplacement(get.result, value);
              store.put(finalizeRfqLifecycleForStorage(value), key);
            } catch (error: unknown) {
              fail(error);
              abortIndexedDbTransaction(transaction);
            }
          };
        });
      } finally {
        db.close();
      }
    },
    async compareAndDelete(key, legacyKey, expected) {
      const db = await openDatabase();
      try {
        const transaction = db.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        await runIndexedDbMutation(transaction, (fail) => {
          const get = store.get(key);
          get.onerror = () =>
            fail(
              get.error ?? new Error("IndexedDB delete compare read failed."),
            );
          get.onsuccess = () => {
            try {
              store.put(
                replaceRfqWithTombstone(get.result, key, expected),
                key,
              );
              store.delete(legacyKey);
            } catch (error: unknown) {
              fail(error);
              abortIndexedDbTransaction(transaction);
            }
          };
        });
      } finally {
        db.close();
      }
    },
    async get(key) {
      const db = await openDatabase();
      try {
        const transaction = db.transaction(STORE);
        return await waitForIndexedDbTransaction(
          transaction,
          transaction.objectStore(STORE).get(key),
        );
      } finally {
        db.close();
      }
    },
    async list(prefix) {
      const db = await openDatabase();
      try {
        const transaction = db.transaction(STORE);
        const store = transaction.objectStore(STORE);
        const [keys, storedRows] = await waitForIndexedDbRequests(transaction, [
          store.getAllKeys(),
          store.getAll(),
        ]);
        if (!Array.isArray(keys) || !Array.isArray(storedRows))
          throw new Error("IndexedDB list read an inconsistent snapshot.");
        if (keys.length !== storedRows.length)
          throw new Error(
            "IndexedDB list read an inconsistent key/value snapshot.",
          );
        return storedRows.filter(
          (_row: RfqStoredRow, index: number) =>
            typeof keys[index] === "string" &&
            String(keys[index]).startsWith(prefix),
        );
      } finally {
        db.close();
      }
    },
    async delete(key) {
      const db = await openDatabase();
      try {
        const transaction = db.transaction(STORE, "readwrite");
        await waitForIndexedDbTransaction(
          transaction,
          transaction.objectStore(STORE).delete(key),
        );
      } finally {
        db.close();
      }
    },
  };
  return createRfqLifecycleStorage(backend, runtimeEpoch);
}
