import {
  canonicalRfqAccount,
  canonicalRfqChainId,
  restoreRfqLifecycle,
  type RfqLifecycleRecord,
} from "@/app/rfq/rfq-lifecycle";
import type { BackupJsonValue } from "./backup-snapshot";

export const RFQ_HISTORY_AUTO_BACKUP_PREFIX =
  "app20/rfq-history-auto-backup/v1";
export const RFQ_HISTORY_BACKUP_MAX_RECORDS = 1_000;

export type RfqHistoryExport = Readonly<{
  records: readonly RfqLifecycleRecord[];
  count: number;
}>;

export type RfqHistoryStorage = Readonly<{
  list(chainId: string, account: string): Promise<unknown[]>;
  save(record: RfqLifecycleRecord): Promise<void>;
}>;

export type ImportRfqHistoryResult = Readonly<{
  imported: number;
  skipped: number;
  count: number;
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

function stripTakerSecret(
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
        stripTakerSecret(child, ancestors, `${path}[${index}]`),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain stored records.`);
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "takerSecret")
        .map(([key, child]) => [
          key,
          stripTakerSecret(child, ancestors, `${path}.${key}`),
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

function restoreBackupRow(value: unknown, now: number): RfqLifecycleRecord {
  const identity = sourceIdentity(value);
  const restored = restoreRfqLifecycle(value, {
    chainId: identity.chainId,
    account: identity.account,
    now,
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
  records: unknown[];
  count: number;
} {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== "count,records"
  ) {
    throw new Error("The RFQ history backup schema is unsupported.");
  }
  if (
    !Array.isArray(value.records) ||
    value.records.length > RFQ_HISTORY_BACKUP_MAX_RECORDS ||
    typeof value.count !== "number" ||
    !Number.isSafeInteger(value.count) ||
    value.count !== value.records.length
  ) {
    throw new Error("The RFQ history backup count is invalid.");
  }
  return { records: value.records, count: value.count };
}

export async function exportRfqHistory(
  storage: Pick<RfqHistoryStorage, "list">,
  chainId: string,
  account: string,
): Promise<RfqHistoryExport> {
  const normalizedChain = canonicalRfqChainId(chainId);
  const normalizedAccount = canonicalRfqAccount(account);
  const rows = await storage.list(normalizedChain, normalizedAccount);
  if (!Array.isArray(rows) || rows.length > RFQ_HISTORY_BACKUP_MAX_RECORDS) {
    throw new Error("RFQ history exceeds the bounded backup record count.");
  }
  const now = unixSeconds();
  const records = rows.map((row) => {
    const restored = restoreBackupRow(stripTakerSecret(row), now);
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
  return Object.freeze({
    records: Object.freeze(records),
    count: records.length,
  });
}

function markRestoredVerifyOnly(
  record: RfqLifecycleRecord,
  observedAt: number,
): RfqLifecycleRecord {
  return Object.freeze({
    ...record,
    evidenceAuthority: Object.freeze({
      ...record.evidenceAuthority,
      status: "local-non-authoritative" as const,
      observedAt,
    }),
  });
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
  value: unknown,
  options: Readonly<{ onConflict: "keep-newer" }>,
): Promise<ImportRfqHistoryResult> {
  if (options.onConflict !== "keep-newer") {
    throw new Error("RFQ history import supports only keep-newer conflicts.");
  }
  const parsed = parseExport(value);
  if (parsed.records.length === 0) {
    return Object.freeze({ imported: 0, skipped: 0, count: 0 });
  }
  const now = unixSeconds();
  const incoming = parsed.records.map((row) => ({
    identity: sourceIdentity(row),
    record: markRestoredVerifyOnly(
      restoreBackupRow(stripTakerSecret(row), now),
      now,
    ),
  }));
  const scopes = new Set(
    incoming.map(
      ({ identity }) => `${identity.chainId}\u0000${identity.account}`,
    ),
  );
  if (scopes.size !== 1) {
    throw new Error(
      "One RFQ history backup must contain exactly one wallet and chain scope.",
    );
  }
  const ids = new Set<string>();
  for (const { record } of incoming) {
    if (ids.has(record.rfqId)) {
      throw new Error("The RFQ history backup contains duplicate RFQ ids.");
    }
    ids.add(record.rfqId);
  }

  const scope = incoming[0]!.identity;
  const storedRows = await storage.list(scope.chainId, scope.account);
  const existingById = new Map<string, RfqLifecycleRecord>();
  for (const row of storedRows) {
    const restored = restoreBackupRow(row, now);
    existingById.set(restored.rfqId, restored);
  }

  let imported = 0;
  let skipped = 0;
  for (const entry of incoming) {
    const existing = existingById.get(entry.record.rfqId);
    if (existing && existing.updatedAt >= entry.identity.updatedAt) {
      skipped += 1;
      continue;
    }
    const prepared = existing
      ? prepareReplacementRecord(entry.record, existing)
      : prepareInitialRecord(entry.record);
    await storage.save(prepared);
    existingById.set(entry.record.rfqId, prepared);
    imported += 1;
  }
  return Object.freeze({ imported, skipped, count: parsed.count });
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
  return Object.freeze({ posted: true, count: history.count });
}
