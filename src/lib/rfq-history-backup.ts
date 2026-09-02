import {
  canonicalRfqAccount,
  canonicalRfqChainId,
  lifecycleMayForget,
  restoreRfqLifecycle,
  type RfqLifecycleRecord,
} from "@/app/rfq/rfq-lifecycle";
import {
  normalizeRfqPortableTombstone,
  rfqLifecycleRecordDigest,
  type RfqPortableTombstone,
} from "@/app/rfq/rfq-storage";
import {
  normalizeBackupSnapshotContext,
  verifyBackupSnapshot,
  type BackupJsonValue,
  type BackupSnapshotContext,
} from "./backup-snapshot";

export const RFQ_HISTORY_AUTO_BACKUP_PREFIX =
  "app20/rfq-history-auto-backup/v1";
export const RFQ_HISTORY_BACKUP_SCHEMA = "app20/rfq-history-backup/v2" as const;
export const RFQ_HISTORY_RESTORE_HIGH_WATER_PREFIX =
  "app20/rfq-history-restore-high-water/v1";
export const RFQ_HISTORY_BACKUP_MAX_ENTRIES = 1_000;
export const RFQ_HISTORY_BACKUP_MAX_BYTES = 1_000_000;
export const RFQ_HISTORY_BACKUP_MAX_RECORDS = RFQ_HISTORY_BACKUP_MAX_ENTRIES;

export type RfqHistoryExport = Readonly<{
  schema: typeof RFQ_HISTORY_BACKUP_SCHEMA;
  chainId: string;
  account: string;
  records: readonly RfqLifecycleRecord[];
  tombstones: readonly RfqPortableTombstone[];
  count: number;
  tombstoneCount: number;
}>;

export type RfqHistoryStorage = Readonly<{
  list(chainId: string, account: string): Promise<unknown[]>;
  listTombstones(
    chainId: string,
    account: string,
  ): Promise<RfqPortableTombstone[]>;
  save(record: RfqLifecycleRecord): Promise<void>;
  saveTombstone(tombstone: RfqPortableTombstone): Promise<void>;
}>;

export type ImportRfqHistoryResult = Readonly<{
  imported: number;
  skipped: number;
  tombstonesImported: number;
  tombstonesSkipped: number;
  count: number;
  tombstoneCount: number;
}>;

export type ImportRfqHistoryOptions = Readonly<{
  onConflict: "keep-newer";
  mailboxSeed: Uint8Array;
  snapshotContext: BackupSnapshotContext;
  sequenceStorage: Pick<Storage, "getItem" | "setItem">;
  now?: number;
}>;

export type ExportAndPostRfqHistoryInput = Readonly<{
  preferenceStorage: Pick<Storage, "getItem">;
  storage: RfqHistoryStorage;
  chainId: string;
  account: string;
  post: (history: RfqHistoryExport) => void | Promise<void>;
}>;

function unixSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertBoundedHistoryBytes(value: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error("The RFQ history backup is not valid bounded JSON.");
  }
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).length > RFQ_HISTORY_BACKUP_MAX_BYTES
  )
    throw new Error("The RFQ history backup exceeds the 1 MB payload limit.");
}

function canonicalBackupJson(value: BackupJsonValue): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalBackupJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, child]) =>
          `${JSON.stringify(key)}:${canonicalBackupJson(child)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stripTakerAuthorizationSecrets(
  value: unknown,
  ancestors = new Set<object>(),
  path = "record",
): BackupJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} contains a value that RFQ backup cannot encode.`);
  }
  if (ancestors.has(value)) {
    throw new Error(`${path} contains a circular reference.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child, index) =>
        stripTakerAuthorizationSecrets(child, ancestors, `${path}[${index}]`),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain stored records.`);
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "takerSecret" && key !== "takerSigningKey")
        .map(([key, child]) => [
          key,
          stripTakerAuthorizationSecrets(child, ancestors, `${path}.${key}`),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function sourceIdentity(value: unknown): {
  chainId: string;
  account: string;
  rfqId: string;
  updatedAt: number;
} {
  if (!isRecord(value)) {
    throw new Error("The RFQ history backup contains a non-object row.");
  }
  if (
    typeof value.chainId !== "string" ||
    typeof value.account !== "string" ||
    typeof value.rfqId !== "string" ||
    typeof value.updatedAt !== "number" ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt <= 0
  ) {
    throw new Error("The RFQ history backup contains an invalid row identity.");
  }
  return {
    chainId: canonicalRfqChainId(value.chainId),
    account: canonicalRfqAccount(value.account),
    rfqId: value.rfqId,
    updatedAt: value.updatedAt,
  };
}

function restoreBackupRow(
  value: unknown,
  now: number,
  fromBackup = false,
): RfqLifecycleRecord {
  const identity = sourceIdentity(value);
  const restored = restoreRfqLifecycle(value, {
    chainId: identity.chainId,
    account: identity.account,
    now,
    ...(fromBackup ? { fromBackup: true } : {}),
  });
  if (
    restored.chainId !== identity.chainId ||
    restored.account !== identity.account ||
    restored.rfqId !== identity.rfqId ||
    restored.rfqId === "malformed-local-record"
  ) {
    throw new Error("The RFQ history backup row failed lifecycle validation.");
  }
  return restored;
}

function parseExport(value: unknown): {
  chainId: string;
  account: string;
  records: unknown[];
  tombstones: unknown[];
  count: number;
  tombstoneCount: number;
} {
  const expectedKeys = [
    "account",
    "chainId",
    "count",
    "records",
    "schema",
    "tombstoneCount",
    "tombstones",
  ];
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== expectedKeys.join(",") ||
    value.schema !== RFQ_HISTORY_BACKUP_SCHEMA ||
    typeof value.chainId !== "string" ||
    typeof value.account !== "string"
  ) {
    throw new Error("The RFQ history backup schema is unsupported.");
  }
  assertBoundedHistoryBytes(value);
  if (
    !Array.isArray(value.records) ||
    !Array.isArray(value.tombstones) ||
    value.records.length + value.tombstones.length >
      RFQ_HISTORY_BACKUP_MAX_ENTRIES ||
    typeof value.count !== "number" ||
    !Number.isSafeInteger(value.count) ||
    value.count !== value.records.length ||
    typeof value.tombstoneCount !== "number" ||
    !Number.isSafeInteger(value.tombstoneCount) ||
    value.tombstoneCount !== value.tombstones.length
  ) {
    throw new Error("The RFQ history backup count is invalid.");
  }
  return {
    chainId: canonicalRfqChainId(value.chainId),
    account: canonicalRfqAccount(value.account),
    records: value.records,
    tombstones: value.tombstones,
    count: value.count,
    tombstoneCount: value.tombstoneCount,
  };
}

function assertUniqueHistoryIds(
  records: readonly RfqLifecycleRecord[],
  tombstones: readonly RfqPortableTombstone[],
): void {
  const recordIds = new Set<string>();
  for (const record of records) {
    if (recordIds.has(record.rfqId))
      throw new Error("The RFQ history backup contains duplicate RFQ ids.");
    recordIds.add(record.rfqId);
  }
  const tombstoneIds = new Set<string>();
  for (const tombstone of tombstones) {
    if (tombstoneIds.has(tombstone.rfqId))
      throw new Error(
        "The RFQ history backup contains duplicate tombstone RFQ ids.",
      );
    if (recordIds.has(tombstone.rfqId))
      throw new Error(
        "The RFQ history backup ambiguously contains both a record and tombstone for one RFQ id.",
      );
    tombstoneIds.add(tombstone.rfqId);
  }
}

export async function exportRfqHistory(
  storage: Pick<RfqHistoryStorage, "list" | "listTombstones">,
  chainId: string,
  account: string,
): Promise<RfqHistoryExport> {
  const normalizedChain = canonicalRfqChainId(chainId);
  const normalizedAccount = canonicalRfqAccount(account);
  const [rows, storedTombstones] = await Promise.all([
    storage.list(normalizedChain, normalizedAccount),
    storage.listTombstones(normalizedChain, normalizedAccount),
  ]);
  if (
    !Array.isArray(rows) ||
    !Array.isArray(storedTombstones) ||
    rows.length + storedTombstones.length > RFQ_HISTORY_BACKUP_MAX_ENTRIES
  ) {
    throw new Error("RFQ history exceeds the bounded backup entry count.");
  }
  const now = unixSeconds();
  const records = rows.map((row) => {
    const restored = markRestoredVerifyOnly(
      restoreBackupRow(stripTakerAuthorizationSecrets(row), now, true),
      now,
    );
    if (
      restored.chainId !== normalizedChain ||
      restored.account !== normalizedAccount
    ) {
      throw new Error(
        "RFQ history storage returned a row outside its requested scope.",
      );
    }
    return Object.freeze(restored);
  });
  const tombstones = storedTombstones.map((value) =>
    normalizeRfqPortableTombstone(value, {
      chainId: normalizedChain,
      account: normalizedAccount,
    }),
  );
  assertUniqueHistoryIds(records, tombstones);
  const history = Object.freeze({
    schema: RFQ_HISTORY_BACKUP_SCHEMA,
    chainId: normalizedChain,
    account: normalizedAccount,
    records: Object.freeze(records),
    tombstones: Object.freeze(tombstones),
    count: records.length,
    tombstoneCount: tombstones.length,
  });
  assertBoundedHistoryBytes(history);
  return history;
}

function markRestoredVerifyOnly(
  record: RfqLifecycleRecord,
  observedAt: number,
): RfqLifecycleRecord {
  const { takerSigningKey: _removedSigningKey, ...withoutSigningKey } = record;
  return Object.freeze({
    ...withoutSigningKey,
    evidenceAuthority: Object.freeze({
      ...record.evidenceAuthority,
      status: "local-non-authoritative" as const,
      observedAt,
    }),
    ...(record.mode === "v3" ? { restoredFromBackup: true as const } : {}),
  });
}

function comparableBackupRecord(
  value: RfqLifecycleRecord,
  now: number,
): string {
  const normalized = markRestoredVerifyOnly(
    restoreBackupRow(stripTakerAuthorizationSecrets(value), now, true),
    now,
  );
  const {
    storageRevision: _storageRevision,
    storagePredecessorRevision: _storagePredecessorRevision,
    ...comparable
  } = normalized;
  return canonicalBackupJson(stripTakerAuthorizationSecrets(comparable));
}

function restoreHighWaterKey(context: BackupSnapshotContext): string {
  const normalized = normalizeBackupSnapshotContext(context);
  return [
    RFQ_HISTORY_RESTORE_HIGH_WATER_PREFIX,
    normalized.chainId,
    normalized.owner,
    normalized.helperAddress,
    normalized.mailboxFingerprint,
  ].join("/");
}

function assertRestoreHighWater(
  storage: Pick<Storage, "getItem">,
  context: BackupSnapshotContext,
  snapshot: Readonly<{ seq: number; digest: string }>,
): void {
  const key = restoreHighWaterKey(context);
  const raw = storage.getItem(key);
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("The RFQ backup restore high-water is malformed.");
    }
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).sort().join(",") !== "digest,seq" ||
      typeof parsed.seq !== "number" ||
      !Number.isSafeInteger(parsed.seq) ||
      parsed.seq < 0 ||
      typeof parsed.digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(parsed.digest)
    )
      throw new Error("The RFQ backup restore high-water is malformed.");
    if (snapshot.seq < parsed.seq)
      throw new Error(
        "RFQ history restore rejected an authenticated backup sequence rollback.",
      );
    if (snapshot.seq === parsed.seq && snapshot.digest !== parsed.digest)
      throw new Error(
        "RFQ history restore rejected conflicting authenticated snapshots at one sequence.",
      );
  }
}

function persistRestoreHighWater(
  storage: Pick<Storage, "setItem">,
  context: BackupSnapshotContext,
  snapshot: Readonly<{ seq: number; digest: string }>,
): void {
  storage.setItem(
    restoreHighWaterKey(context),
    JSON.stringify({ seq: snapshot.seq, digest: snapshot.digest }),
  );
}

function prepareInitialRecord(record: RfqLifecycleRecord): RfqLifecycleRecord {
  const {
    storagePredecessorRevision: _predecessor,
    storageRevision: _revision,
    ...rest
  } = record;
  return Object.freeze({ ...rest, storageRevision: 0 });
}

function prepareReplacementRecord(
  record: RfqLifecycleRecord,
  existing: RfqLifecycleRecord,
): RfqLifecycleRecord {
  return Object.freeze({
    ...record,
    storageRevision: existing.storageRevision + 1,
    storagePredecessorRevision: existing.storageRevision,
  });
}

export async function importRfqHistory(
  storage: RfqHistoryStorage,
  snapshotValue: unknown,
  options: ImportRfqHistoryOptions,
): Promise<ImportRfqHistoryResult> {
  if (options.onConflict !== "keep-newer") {
    throw new Error("RFQ history import supports only keep-newer conflicts.");
  }
  const verificationNow = options.now ?? Date.now();
  const snapshot = verifyBackupSnapshot(snapshotValue, {
    ...options.snapshotContext,
    mailboxSeed: options.mailboxSeed,
    kind: "rfq-resume",
    now: verificationNow,
  });
  const parsed = parseExport(snapshot.payload);
  if (
    parsed.chainId !== canonicalRfqChainId(snapshot.chainId) ||
    parsed.account !== canonicalRfqAccount(snapshot.owner)
  )
    throw new Error(
      "The authenticated RFQ history payload contradicts its wallet or chain scope.",
    );
  assertRestoreHighWater(
    options.sequenceStorage,
    options.snapshotContext,
    snapshot,
  );
  const now = Math.floor(verificationNow / 1_000);
  const incoming = parsed.records.map((row) => {
    const identity = sourceIdentity(row);
    const record = markRestoredVerifyOnly(
      restoreBackupRow(stripTakerAuthorizationSecrets(row), now, true),
      now,
    );
    if (
      identity.chainId !== parsed.chainId ||
      identity.account !== parsed.account ||
      (record.mode === "v3" &&
        (record.restoredFromBackup !== true ||
          record.takerSigningKey !== undefined))
    )
      throw new Error(
        "The RFQ history backup row failed its authenticated scope or verify-only invariant.",
      );
    return { identity, record };
  });
  const incomingTombstones = parsed.tombstones.map((value) =>
    normalizeRfqPortableTombstone(value, parsed),
  );
  assertUniqueHistoryIds(
    incoming.map(({ record }) => record),
    incomingTombstones,
  );

  const [storedRows, storedTombstones] = await Promise.all([
    storage.list(parsed.chainId, parsed.account),
    storage.listTombstones(parsed.chainId, parsed.account),
  ]);
  if (
    !Array.isArray(storedRows) ||
    !Array.isArray(storedTombstones) ||
    storedRows.length + storedTombstones.length > RFQ_HISTORY_BACKUP_MAX_ENTRIES
  )
    throw new Error("Local RFQ history exceeds the bounded merge entry count.");

  const existingById = new Map<string, RfqLifecycleRecord>();
  for (const row of storedRows) {
    const restored = restoreBackupRow(row, now);
    if (existingById.has(restored.rfqId))
      throw new Error("Local RFQ history contains duplicate RFQ ids.");
    existingById.set(restored.rfqId, restored);
  }
  const localTombstones = storedTombstones.map((value) =>
    normalizeRfqPortableTombstone(value, parsed),
  );
  const localTombstoneById = new Map<string, RfqPortableTombstone>();
  for (const tombstone of localTombstones) {
    if (localTombstoneById.has(tombstone.rfqId))
      throw new Error("Local RFQ history contains duplicate tombstone ids.");
    localTombstoneById.set(tombstone.rfqId, tombstone);
  }

  for (const { record } of incoming) {
    if (localTombstoneById.has(record.rfqId))
      throw new Error(
        "RFQ history restore refused to resurrect a locally forgotten RFQ.",
      );
  }

  const tombstonesToSave: RfqPortableTombstone[] = [];
  let tombstonesSkipped = 0;
  for (const tombstone of incomingTombstones) {
    const localTombstone = localTombstoneById.get(tombstone.rfqId);
    if (localTombstone) {
      if (localTombstone.recordDigest !== tombstone.recordDigest)
        throw new Error(
          "RFQ history restore found conflicting authenticated tombstones.",
        );
      tombstonesSkipped += 1;
      continue;
    }
    const existing = existingById.get(tombstone.rfqId);
    if (
      existing &&
      existing.restoredFromBackup !== true &&
      (!lifecycleMayForget(existing) ||
        rfqLifecycleRecordDigest(existing) !== tombstone.recordDigest)
    )
      throw new Error(
        "RFQ history restore refused a tombstone over unresolved or nonmatching local evidence.",
      );
    tombstonesToSave.push(tombstone);
  }

  const recordsToSave: RfqLifecycleRecord[] = [];
  let skipped = 0;
  for (const entry of incoming) {
    const existing = existingById.get(entry.record.rfqId);
    if (existing && existing.updatedAt > entry.identity.updatedAt) {
      skipped += 1;
      continue;
    }
    if (existing && existing.updatedAt === entry.identity.updatedAt) {
      if (
        comparableBackupRecord(existing, now) !==
        comparableBackupRecord(entry.record, now)
      )
        throw new Error(
          "RFQ history restore found ambiguous same-time lifecycle records.",
        );
      skipped += 1;
      continue;
    }
    recordsToSave.push(
      existing
        ? prepareReplacementRecord(entry.record, existing)
        : prepareInitialRecord(entry.record),
    );
  }

  persistRestoreHighWater(
    options.sequenceStorage,
    options.snapshotContext,
    snapshot,
  );
  for (const tombstone of tombstonesToSave)
    await storage.saveTombstone(tombstone);
  for (const record of recordsToSave) await storage.save(record);

  return Object.freeze({
    imported: recordsToSave.length,
    skipped,
    tombstonesImported: tombstonesToSave.length,
    tombstonesSkipped,
    count: parsed.count,
    tombstoneCount: parsed.tombstoneCount,
  });
}

function autoBackupKey(chainId: string, account: string): string {
  return `${RFQ_HISTORY_AUTO_BACKUP_PREFIX}/${canonicalRfqChainId(chainId)}/${canonicalRfqAccount(account)}`;
}

export function isRfqHistoryAutoBackupEnabled(
  storage: Pick<Storage, "getItem">,
  chainId: string,
  account: string,
): boolean {
  return storage.getItem(autoBackupKey(chainId, account)) === "enabled";
}

export function setRfqHistoryAutoBackupEnabled(
  storage: Pick<Storage, "setItem" | "removeItem">,
  chainId: string,
  account: string,
  enabled: boolean,
): void {
  const key = autoBackupKey(chainId, account);
  if (enabled) storage.setItem(key, "enabled");
  else storage.removeItem(key);
}

export async function exportAndPostRfqHistoryIfEnabled(
  input: ExportAndPostRfqHistoryInput,
): Promise<Readonly<{ posted: boolean; count: number }>> {
  if (
    !isRfqHistoryAutoBackupEnabled(
      input.preferenceStorage,
      input.chainId,
      input.account,
    )
  ) {
    return Object.freeze({ posted: false, count: 0 });
  }
  const history = await exportRfqHistory(
    input.storage,
    input.chainId,
    input.account,
  );
  await input.post(history);
  return Object.freeze({
    posted: true,
    count: history.count + history.tombstoneCount,
  });
}
