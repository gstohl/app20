import { describe, expect, it, vi } from "vitest";
import { LOCALNET_CHAIN_ID } from "@/utils/constants";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  finalizeRfqLifecycleForStorage,
  lifecycleMaySubmit,
  restoreRfqLifecycle,
  reviseRfqLifecycle,
  takeAttemptTargetFromLifecycle,
  transitionRfqLifecycle,
  type RfqLifecycleRecord,
} from "@/app/rfq/rfq-lifecycle";
import {
  assertRfqStorageReplacement,
  assertRfqStorageTombstoneReplacement,
  createRfqLifecycleStorage,
  planRfqAliasMigration,
  replaceRfqWithTombstone,
  type RfqPortableTombstone,
  type RfqStorageBackend,
} from "@/app/rfq/rfq-storage";
import { createBackupSnapshot } from "./backup-snapshot";
import {
  RFQ_HISTORY_BACKUP_SCHEMA,
  exportAndPostRfqHistoryIfEnabled,
  exportRfqHistory,
  importRfqHistory,
  isRfqHistoryAutoBackupEnabled,
  setRfqHistoryAutoBackupEnabled,
  type RfqHistoryExport,
} from "./rfq-history-backup";

const CHAIN = LOCALNET_CHAIN_ID;
const ACCOUNT = "0xa11ce";
const NOW = 1_900_000_000;
const NOW_MS = NOW * 1_000;
const MAILBOX_SEED = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const SNAPSHOT_CONTEXT = Object.freeze({
  owner: ACCOUNT,
  chainId: CHAIN,
  helperAddress: "0x1234",
  mailboxFingerprint: "ab".repeat(32),
});

function record(
  rfqId: string,
  updatedAt = NOW,
  revision = 0,
  state: RfqLifecycleRecord["state"] = "draft",
): RfqLifecycleRecord {
  const created = createRfqLifecycleRecord({
    chainId: CHAIN,
    account: ACCOUNT,
    rfqId,
    state,
    now: updatedAt,
  });
  return Object.freeze({ ...created, storageRevision: revision });
}

function reviewingV3(rfqId = "0x77"): RfqLifecycleRecord {
  const created = createRfqLifecycleRecord({
    mode: "v3",
    chainId: CHAIN,
    account: ACCOUNT,
    rfqId,
    state: "reviewing",
    now: NOW,
    requestDigest: `0x${"11".repeat(32)}`,
    terms: {
      pairId: "STRK_USDC",
      sellSymbol: "STRK",
      sellAddress: "0x1",
      sellDecimals: 18,
      sellAmount: "100",
      buySymbol: "USDC",
      buyAddress: "0x2",
      buyDecimals: 6,
      minBuyAmount: "190",
      buyAmount: "200",
      rfqExpiresAt: NOW + 600,
    },
    settlement: {
      version: "Localnet V3",
      escrowAddress: "0x5",
      dealId: rfqId,
      deadline: NOW + 600,
    },
    bucket: { min: "50", max: "100" },
    takerCommitment:
      "0x746db56abc4d9fab4832ee42e92e96bbbf8cf4c9fd063b8515bda90d1e8aa5d",
    takerSigningKey: "0x66",
    fills: [
      {
        makerId: "maker-a",
        lockId: "0x41",
        amountA: "100",
        amountB: "200",
        lockExpiresAt: NOW + 600,
      },
    ],
  });
  return reviseRfqLifecycle(created, { quoteExpiresAt: NOW + 300 });
}

function historyPayload(
  records: readonly unknown[],
  tombstones: readonly unknown[] = [],
  overrides: Readonly<Record<string, unknown>> = {},
): RfqHistoryExport {
  return {
    schema: RFQ_HISTORY_BACKUP_SCHEMA,
    chainId: CHAIN,
    account: ACCOUNT,
    records: records as readonly RfqLifecycleRecord[],
    tombstones: tombstones as readonly RfqPortableTombstone[],
    count: records.length,
    tombstoneCount: tombstones.length,
    ...overrides,
  } as RfqHistoryExport;
}

function authenticatedSnapshot(payload: unknown, seq = 1) {
  return createBackupSnapshot({
    ...SNAPSHOT_CONTEXT,
    mailboxSeed: MAILBOX_SEED,
    kind: "rfq-resume",
    seq,
    now: NOW_MS,
    payload,
  });
}

class MemoryPreferences {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function importOptions(sequenceStorage = new MemoryPreferences()) {
  return {
    onConflict: "keep-newer" as const,
    mailboxSeed: MAILBOX_SEED,
    snapshotContext: SNAPSHOT_CONTEXT,
    sequenceStorage,
    now: NOW_MS,
  };
}

function memoryLifecycleStorage(epoch: string) {
  const rows = new Map<string, unknown>();
  const backend: RfqStorageBackend = {
    async migrateAliases(scope) {
      const plan = planRfqAliasMigration([...rows], scope);
      for (const key of plan.deleteKeys) rows.delete(String(key));
      for (const [key, value] of plan.putEntries)
        rows.set(key, structuredClone(value));
    },
    async compareAndPut(key, value) {
      assertRfqStorageReplacement(rows.get(key), value);
      rows.set(key, structuredClone(finalizeRfqLifecycleForStorage(value)));
    },
    async compareAndPutTombstone(key, value) {
      rows.set(
        key,
        structuredClone(
          assertRfqStorageTombstoneReplacement(rows.get(key), key, value),
        ),
      );
    },
    async compareAndDelete(key, legacyKey, expected) {
      rows.set(
        key,
        structuredClone(replaceRfqWithTombstone(rows.get(key), key, expected)),
      );
      rows.delete(legacyKey);
    },
    async get(key) {
      return rows.get(key);
    },
    async list(prefix) {
      return [...rows]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => structuredClone(value));
    },
    async delete(key) {
      rows.delete(key);
    },
  };
  return {
    storage: createRfqLifecycleStorage(backend, epoch),
    rows,
  };
}

async function exportedRows(
  rows: readonly RfqLifecycleRecord[],
  tombstones: readonly RfqPortableTombstone[] = [],
) {
  return exportRfqHistory(
    {
      list: async () => rows.slice(),
      listTombstones: async () => tombstones.slice(),
    },
    CHAIN,
    ACCOUNT,
  );
}

describe("RFQ history backup adapter", () => {
  it("exports active v3 lifecycle rows as durable verify-only records and recursively strips secrets", async () => {
    const unsafe = {
      ...reviewingV3(),
      takerSecret: "0xlegacy",
      extension: {
        takerSecret: "nested-legacy",
        takerSigningKey: "nested-signing",
        safe: true,
      },
    } as unknown as RfqLifecycleRecord;
    const exported = await exportedRows([unsafe]);

    expect(exported).toMatchObject({
      schema: RFQ_HISTORY_BACKUP_SCHEMA,
      chainId: CHAIN,
      account: ACCOUNT,
      count: 1,
      tombstoneCount: 0,
    });
    expect(JSON.stringify(exported)).not.toMatch(
      /takerSecret|takerSigningKey|nested-signing/,
    );
    expect(exported.records[0]).toMatchObject({
      rfqId: "0x77",
      mode: "v3",
      state: "reviewing",
      restoredFromBackup: true,
      evidenceAuthority: { status: "local-non-authoritative" },
    });
  });

  it("persists v3 verify-only provenance across import, reload, export, and re-import", async () => {
    const source = reviewingV3();
    const firstExport = await exportedRows([source]);
    const firstSnapshot = authenticatedSnapshot(firstExport, 1);
    const first = memoryLifecycleStorage("backup-first");
    const sequenceStorage = new MemoryPreferences();

    await expect(
      importRfqHistory(
        first.storage,
        firstSnapshot,
        importOptions(sequenceStorage),
      ),
    ).resolves.toEqual({
      imported: 1,
      skipped: 0,
      tombstonesImported: 0,
      tombstonesSkipped: 0,
      count: 1,
      tombstoneCount: 0,
    });

    const reloaded = restoreRfqLifecycle(await first.storage.load(source), {
      chainId: CHAIN,
      account: ACCOUNT,
      now: NOW + 1,
    });
    expect(reloaded).toMatchObject({
      mode: "v3",
      state: "reviewing",
      restoredFromBackup: true,
      terms: source.terms,
      fills: source.fills,
      evidenceAuthority: { status: "local-non-authoritative" },
      storageRevision: 0,
    });
    expect(reloaded).not.toHaveProperty("takerSigningKey");
    expect(lifecycleMaySubmit(reloaded, NOW + 1)).toBe(false);
    expect(() =>
      beginRfqPhaseAttempt(
        reloaded,
        "take",
        "take-from-backup",
        NOW + 1,
        takeAttemptTargetFromLifecycle(reloaded),
      ),
    ).toThrow(/signing authority|verification-only/i);

    const secondExport = await exportRfqHistory(first.storage, CHAIN, ACCOUNT);
    expect(secondExport.records[0]).toMatchObject({
      restoredFromBackup: true,
    });
    expect(JSON.stringify(secondExport)).not.toContain("takerSigningKey");

    const second = memoryLifecycleStorage("backup-second");
    await importRfqHistory(
      second.storage,
      authenticatedSnapshot(secondExport, 2),
      importOptions(sequenceStorage),
    );
    const reimported = restoreRfqLifecycle(await second.storage.load(source), {
      chainId: CHAIN,
      account: ACCOUNT,
      now: NOW + 2,
    });
    expect(reimported).toMatchObject({
      mode: "v3",
      restoredFromBackup: true,
      terms: source.terms,
      fills: source.fills,
    });
    expect(reimported).not.toHaveProperty("takerSigningKey");
    expect(lifecycleMaySubmit(reimported, NOW + 2)).toBe(false);
  });

  it("marks terminal v3 exports as restored even though no signing key is needed", async () => {
    const expired = transitionRfqLifecycle(
      reviewingV3("0x78"),
      "expired",
      NOW + 1,
      { reason: "The quote expired." },
    );
    const exported = await exportedRows([expired]);
    expect(exported.records[0]).toMatchObject({
      mode: "v3",
      state: "expired",
      restoredFromBackup: true,
    });
    expect(exported.records[0]).not.toHaveProperty("takerSigningKey");
  });

  it("keeps newer local rows and CAS-binds a newer authenticated replacement", async () => {
    const destination = memoryLifecycleStorage("backup-merge");
    const local = record("0x3", NOW, 0);
    await destination.storage.save(local);
    const sequences = new MemoryPreferences();

    await expect(
      importRfqHistory(
        destination.storage,
        authenticatedSnapshot(historyPayload([record("0x3", NOW - 1)]), 1),
        importOptions(sequences),
      ),
    ).resolves.toMatchObject({ imported: 0, skipped: 1 });

    const newer = reviseRfqLifecycle(local, { updatedAt: NOW + 1 });
    await expect(
      importRfqHistory(
        destination.storage,
        authenticatedSnapshot(historyPayload([newer]), 2),
        importOptions(sequences),
      ),
    ).resolves.toMatchObject({ imported: 1, skipped: 0 });
    expect(await destination.storage.load(local)).toMatchObject({
      storageRevision: 1,
      updatedAt: NOW + 1,
    });
  });

  it("authenticates before merge and rejects malformed, legacy, mixed-scope, duplicate, and ambiguous payloads", async () => {
    const destination = memoryLifecycleStorage("backup-invalid");
    const attempt = (payload: unknown, seq: number) =>
      importRfqHistory(
        destination.storage,
        authenticatedSnapshot(payload, seq),
        importOptions(new MemoryPreferences()),
      );

    await expect(
      attempt(historyPayload([], [], { count: 1 }), 1),
    ).rejects.toThrow(/count/i);
    await expect(attempt({ records: [], count: 0 }, 2)).rejects.toThrow(
      /schema/i,
    );
    await expect(attempt(historyPayload([{ nope: true }]), 3)).rejects.toThrow(
      /identity/i,
    );
    await expect(
      attempt(historyPayload([record("0x4"), record("0x4")]), 4),
    ).rejects.toThrow(/duplicate/i);
    await expect(
      attempt(
        historyPayload([
          record("0x5"),
          createRfqLifecycleRecord({
            chainId: "0x1",
            account: ACCOUNT,
            rfqId: "0x6",
            now: NOW,
          }),
        ]),
        5,
      ),
    ).rejects.toThrow(/scope/i);
    await expect(
      attempt(
        historyPayload(
          [record("0x7")],
          [
            {
              tombstoneSchema: "app20/rfq-history-tombstone/v1",
              chainId: CHAIN,
              account: ACCOUNT,
              rfqId: "0x7",
              storageRevision: 0,
              recordDigest: `sha256:${"00".repeat(32)}`,
            },
          ],
        ),
        6,
      ),
    ).rejects.toThrow(/both a record and tombstone|ambiguously/i);

    await expect(
      attempt(
        historyPayload([{ ...record("0x8"), extension: "é".repeat(500_001) }]),
        7,
      ),
    ).rejects.toThrow(/1 MB payload limit/i);

    const valid = authenticatedSnapshot(historyPayload([record("0x9")]), 8);
    const tampered = { ...valid, seq: 0xffff_ffff };
    await expect(
      importRfqHistory(
        destination.storage,
        tampered,
        importOptions(new MemoryPreferences()),
      ),
    ).rejects.toThrow(/authentication/i);
    expect(await destination.storage.list(CHAIN, ACCOUNT)).toEqual([]);
  });

  it("ports tombstones to a fresh database and rejects rollback or authenticated record resurrection", async () => {
    const source = memoryLifecycleStorage("backup-source-delete");
    const active = reviewingV3("0x90");
    await source.storage.save(active);
    const oldHistory = await exportRfqHistory(source.storage, CHAIN, ACCOUNT);
    const expired = transitionRfqLifecycle(active, "expired", NOW + 1, {
      reason: "The quote expired.",
    });
    await source.storage.save(expired);
    await source.storage.remove(expired);
    const deletionHistory = await exportRfqHistory(
      source.storage,
      CHAIN,
      ACCOUNT,
    );
    expect(deletionHistory).toMatchObject({ count: 0, tombstoneCount: 1 });
    expect(deletionHistory.tombstones[0]).toMatchObject({
      rfqId: "0x90",
      tombstoneSchema: "app20/rfq-history-tombstone/v1",
      recordDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });

    const destination = memoryLifecycleStorage("backup-destination-delete");
    const sequences = new MemoryPreferences();
    await importRfqHistory(
      destination.storage,
      authenticatedSnapshot(deletionHistory, 2),
      importOptions(sequences),
    );
    expect(await destination.storage.list(CHAIN, ACCOUNT)).toEqual([]);
    expect(
      await destination.storage.listTombstones(CHAIN, ACCOUNT),
    ).toHaveLength(1);

    await expect(
      importRfqHistory(
        destination.storage,
        authenticatedSnapshot(oldHistory, 1),
        importOptions(sequences),
      ),
    ).rejects.toThrow(/sequence rollback/i);
    await expect(
      importRfqHistory(
        destination.storage,
        authenticatedSnapshot(oldHistory, 3),
        importOptions(sequences),
      ),
    ).rejects.toThrow(/resurrect|forgotten/i);
    expect(await destination.storage.list(CHAIN, ACCOUNT)).toEqual([]);
  });

  it("lets a newer portable tombstone remove an older verify-only v3 restore, but never unresolved live authority", async () => {
    const source = memoryLifecycleStorage("backup-source-order");
    const active = reviewingV3("0x91");
    await source.storage.save(active);
    const oldHistory = await exportRfqHistory(source.storage, CHAIN, ACCOUNT);
    const expired = transitionRfqLifecycle(active, "expired", NOW + 1, {
      reason: "The quote expired.",
    });
    await source.storage.save(expired);
    await source.storage.remove(expired);
    const deletionHistory = await exportRfqHistory(
      source.storage,
      CHAIN,
      ACCOUNT,
    );

    const destination = memoryLifecycleStorage("backup-destination-order");
    const sequences = new MemoryPreferences();
    await importRfqHistory(
      destination.storage,
      authenticatedSnapshot(oldHistory, 1),
      importOptions(sequences),
    );
    expect(await destination.storage.list(CHAIN, ACCOUNT)).toHaveLength(1);
    await importRfqHistory(
      destination.storage,
      authenticatedSnapshot(deletionHistory, 2),
      importOptions(sequences),
    );
    expect(await destination.storage.list(CHAIN, ACCOUNT)).toEqual([]);

    const liveDestination = memoryLifecycleStorage("backup-live-order");
    await liveDestination.storage.save(reviewingV3("0x91"));
    await expect(
      importRfqHistory(
        liveDestination.storage,
        authenticatedSnapshot(deletionHistory, 2),
        importOptions(new MemoryPreferences()),
      ),
    ).rejects.toThrow(/unresolved|nonmatching/i);
    expect(await liveDestination.storage.list(CHAIN, ACCOUNT)).toHaveLength(1);
  });

  it("rejects conflicting same-sequence snapshots and malformed restore high-water state", async () => {
    const destination = memoryLifecycleStorage("backup-high-water");
    const sequenceStorage = new MemoryPreferences();
    const first = authenticatedSnapshot(historyPayload([record("0xa0")]), 10);
    await importRfqHistory(
      destination.storage,
      first,
      importOptions(sequenceStorage),
    );
    await expect(
      importRfqHistory(
        destination.storage,
        authenticatedSnapshot(historyPayload([record("0xa1")]), 10),
        importOptions(sequenceStorage),
      ),
    ).rejects.toThrow(/conflicting authenticated snapshots/i);

    const malformedHighWater = new MemoryPreferences();
    malformedHighWater.setItem(
      [...sequenceStorage.values.keys()][0]!,
      "not-json",
    );
    await expect(
      importRfqHistory(
        memoryLifecycleStorage("backup-malformed-high-water").storage,
        authenticatedSnapshot(historyPayload([]), 11),
        importOptions(malformedHighWater),
      ),
    ).rejects.toThrow(/high-water is malformed/i);
  });

  it("keeps auto-backup opt-in off by default and posts records plus deletion markers only when enabled", async () => {
    const preferences = new MemoryPreferences();
    const storage = {
      list: async () => [record("0xb0")],
      listTombstones: async () => [],
      save: async () => undefined,
      saveTombstone: async () => undefined,
    };
    const post = vi.fn(async () => undefined);
    expect(isRfqHistoryAutoBackupEnabled(preferences, CHAIN, ACCOUNT)).toBe(
      false,
    );
    await expect(
      exportAndPostRfqHistoryIfEnabled({
        preferenceStorage: preferences,
        storage,
        chainId: CHAIN,
        account: ACCOUNT,
        post,
      }),
    ).resolves.toEqual({ posted: false, count: 0 });
    expect(post).not.toHaveBeenCalled();

    setRfqHistoryAutoBackupEnabled(preferences, CHAIN, ACCOUNT, true);
    await expect(
      exportAndPostRfqHistoryIfEnabled({
        preferenceStorage: preferences,
        storage,
        chainId: CHAIN,
        account: ACCOUNT,
        post,
      }),
    ).resolves.toEqual({ posted: true, count: 1 });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: RFQ_HISTORY_BACKUP_SCHEMA,
        count: 1,
        tombstoneCount: 0,
        records: expect.any(Array),
        tombstones: expect.any(Array),
      }),
    );

    setRfqHistoryAutoBackupEnabled(preferences, CHAIN, ACCOUNT, false);
    expect(isRfqHistoryAutoBackupEnabled(preferences, CHAIN, ACCOUNT)).toBe(
      false,
    );
  });
});
