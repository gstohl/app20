import { describe, expect, it, vi } from "vitest";
import {
  createRfqLifecycleRecord,
  reviseRfqLifecycle,
  type RfqLifecycleRecord,
} from "@/app/rfq/rfq-lifecycle";
import {
  exportAndPostRfqHistoryIfEnabled,
  exportRfqHistory,
  importRfqHistory,
  isRfqHistoryAutoBackupEnabled,
  setRfqHistoryAutoBackupEnabled,
} from "./rfq-history-backup";

const CHAIN = "0x534e5f5345504f4c4941";
const ACCOUNT = "0xa11ce";
const NOW = 1_900_000_000;

function record(
  rfqId: string,
  updatedAt = NOW,
  revision = 0,
): RfqLifecycleRecord {
  const created = createRfqLifecycleRecord({
    chainId: CHAIN,
    account: ACCOUNT,
    rfqId,
    now: updatedAt,
  });
  return Object.freeze({ ...created, storageRevision: revision });
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

describe("RFQ history backup adapter", () => {
  it("exports lifecycle rows and recursively strips takerSecret", async () => {
    const unsafe = {
      ...record("rfq-1"),
      takerSecret: "0xsecret",
      extension: { takerSecret: "nested", safe: true },
    } as unknown as RfqLifecycleRecord;
    const list = vi.fn(async () => [unsafe]);
    const exported = await exportRfqHistory({ list }, CHAIN, ACCOUNT);

    expect(exported.count).toBe(1);
    expect(JSON.stringify(exported)).not.toContain("takerSecret");
    expect(exported.records[0]).toMatchObject({
      rfqId: "rfq-1",
      state: "draft",
    });
  });

  it("imports new rows as verify-only and resets an initial storage revision", async () => {
    const source = record("rfq-2", NOW, 9);
    const incoming = {
      records: [
        {
          ...source,
          evidenceAuthority: {
            ...source.evidenceAuthority,
            status: "authoritative" as const,
          },
        },
      ],
      count: 1,
    };
    const save = vi.fn(async (_record: RfqLifecycleRecord) => undefined);
    const result = await importRfqHistory(
      { list: async () => [], save },
      incoming,
      { onConflict: "keep-newer" },
    );

    expect(result).toEqual({ imported: 1, skipped: 0, count: 1 });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      rfqId: "rfq-2",
      storageRevision: 0,
      evidenceAuthority: { status: "local-non-authoritative" },
    });
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty(
      "storagePredecessorRevision",
    );
  });

  it("keeps newer local rows and CAS-binds a newer backup replacement", async () => {
    const local = record("rfq-3", NOW, 4);
    const olderSave = vi.fn(async (_record: RfqLifecycleRecord) => undefined);
    await expect(
      importRfqHistory(
        { list: async () => [local], save: olderSave },
        { records: [record("rfq-3", NOW - 1)], count: 1 },
        { onConflict: "keep-newer" },
      ),
    ).resolves.toEqual({ imported: 0, skipped: 1, count: 1 });
    expect(olderSave).not.toHaveBeenCalled();

    const newer = reviseRfqLifecycle(local, { updatedAt: NOW + 1 });
    const save = vi.fn(async (_record: RfqLifecycleRecord) => undefined);
    await importRfqHistory(
      { list: async () => [local], save },
      { records: [newer], count: 1 },
      { onConflict: "keep-newer" },
    );
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      storageRevision: 5,
      storagePredecessorRevision: 4,
      updatedAt: NOW + 1,
    });
  });

  it("rejects malformed, mixed-scope, duplicate, and count-conflicting exports", async () => {
    const storage = {
      list: async () => [],
      save: vi.fn(async () => undefined),
    };
    await expect(
      importRfqHistory(
        storage,
        { records: [], count: 1 },
        { onConflict: "keep-newer" },
      ),
    ).rejects.toThrow(/count/i);
    await expect(
      importRfqHistory(
        storage,
        { records: [{ nope: true }], count: 1 },
        { onConflict: "keep-newer" },
      ),
    ).rejects.toThrow(/identity/i);
    await expect(
      importRfqHistory(
        storage,
        { records: [record("same"), record("same")], count: 2 },
        { onConflict: "keep-newer" },
      ),
    ).rejects.toThrow(/duplicate/i);
    await expect(
      importRfqHistory(
        storage,
        {
          records: [
            record("one"),
            createRfqLifecycleRecord({
              chainId: "0x1",
              account: ACCOUNT,
              rfqId: "two",
              now: NOW,
            }),
          ],
          count: 2,
        },
        { onConflict: "keep-newer" },
      ),
    ).rejects.toThrow(/one wallet and chain/i);
  });

  it("keeps auto-backup opt-in off by default and posts only when enabled", async () => {
    const preferences = new MemoryPreferences();
    const storage = {
      list: async () => [record("rfq-4")],
      save: async () => undefined,
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
    expect(isRfqHistoryAutoBackupEnabled(preferences, CHAIN, ACCOUNT)).toBe(
      true,
    );
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
      expect.objectContaining({ count: 1, records: expect.any(Array) }),
    );

    setRfqHistoryAutoBackupEnabled(preferences, CHAIN, ACCOUNT, false);
    expect(isRfqHistoryAutoBackupEnabled(preferences, CHAIN, ACCOUNT)).toBe(
      false,
    );
  });
});
