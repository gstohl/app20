import { describe, expect, it } from "vitest";
import { normalizeStarknetAddress } from "./address-book";
import {
  createBackupSnapshot,
  decodeBackupSnapshot,
  nextBackupSequence,
  verifyBackupSnapshot,
  type BackupSnapshotV1,
} from "./backup-snapshot";

const NOW = 2_000_000_000_000;
const SEED = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const CONTEXT = {
  owner: "0xa11ce",
  chainId: "SN_SEPOLIA",
  helperAddress: "0x1234",
  mailboxFingerprint: "ab".repeat(32),
};

function clone(snapshot: BackupSnapshotV1): BackupSnapshotV1 {
  return JSON.parse(JSON.stringify(snapshot)) as BackupSnapshotV1;
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("authenticated backup snapshots", () => {
  it("creates and verifies a context, kind, and sequence-bound snapshot", () => {
    const snapshot = createBackupSnapshot({
      ...CONTEXT,
      mailboxSeed: SEED,
      kind: "contacts",
      seq: 42,
      now: NOW,
      payload: {
        entries: [{ address: "0x1", label: "Desk", updatedAt: NOW - 1 }],
      },
    });

    expect(snapshot).toMatchObject({
      version: 1,
      kind: "contacts",
      seq: 42,
      owner: normalizeStarknetAddress("0xa11ce"),
      chainId: "0x534e5f5345504f4c4941",
      helperAddress: normalizeStarknetAddress("0x1234"),
    });
    expect(snapshot.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.mac).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verifyBackupSnapshot(snapshot, {
        ...CONTEXT,
        mailboxSeed: SEED,
        kind: "contacts",
        seq: 42,
        now: NOW,
      }),
    ).toEqual(snapshot);
  });

  it("rejects payload, MAC, context, kind, sequence, and schema tampering", () => {
    const snapshot = createBackupSnapshot({
      ...CONTEXT,
      mailboxSeed: SEED,
      kind: "rfq-resume",
      seq: 7,
      now: NOW,
      payload: { count: 0, records: [] },
    });
    const payloadTamper = clone(snapshot);
    (payloadTamper.payload as { count: number }).count = 1;
    expect(() =>
      verifyBackupSnapshot(payloadTamper, {
        ...CONTEXT,
        mailboxSeed: SEED,
        now: NOW,
      }),
    ).toThrow(/authentication/i);

    const macTamper = clone(snapshot);
    macTamper.mac = "00".repeat(32);
    expect(() =>
      verifyBackupSnapshot(macTamper, {
        ...CONTEXT,
        mailboxSeed: SEED,
        now: NOW,
      }),
    ).toThrow(/authentication/i);
    expect(() =>
      verifyBackupSnapshot(snapshot, {
        ...CONTEXT,
        owner: "0xb0b",
        mailboxSeed: SEED,
        now: NOW,
      }),
    ).toThrow(/different wallet/i);
    expect(() =>
      verifyBackupSnapshot(snapshot, {
        ...CONTEXT,
        mailboxSeed: SEED,
        kind: "contacts",
        now: NOW,
      }),
    ).toThrow(/different wallet/i);
    expect(() =>
      verifyBackupSnapshot(snapshot, {
        ...CONTEXT,
        mailboxSeed: SEED,
        seq: 8,
        now: NOW,
      }),
    ).toThrow(/different wallet/i);
    expect(() =>
      decodeBackupSnapshot({ ...snapshot, extra: true }, { now: NOW }),
    ).toThrow(/schema/i);
  });

  it("strictly rejects non-JSON payloads and future timestamps", () => {
    expect(() =>
      createBackupSnapshot({
        ...CONTEXT,
        mailboxSeed: SEED,
        kind: "contacts",
        seq: 1,
        now: NOW,
        payload: { amount: 1n } as never,
      }),
    ).toThrow(/JSON/i);
    const snapshot = createBackupSnapshot({
      ...CONTEXT,
      mailboxSeed: SEED,
      kind: "contacts",
      seq: 1,
      now: NOW,
      payload: { entries: [] },
    });
    expect(() =>
      decodeBackupSnapshot(
        { ...snapshot, createdAt: NOW + 6 * 60 * 1_000 },
        { now: NOW },
      ),
    ).toThrow(/creation time/i);
  });

  it("allocates monotonic per-kind sequences with a unix-time floor", () => {
    const storage = new MemoryStorage();
    const first = nextBackupSequence(
      storage,
      { ...CONTEXT, kind: "contacts" },
      NOW,
    );
    const second = nextBackupSequence(
      storage,
      { ...CONTEXT, kind: "contacts" },
      NOW,
    );
    const rfq = nextBackupSequence(
      storage,
      { ...CONTEXT, kind: "rfq-resume" },
      NOW,
    );
    expect(first).toBe(Math.floor(NOW / 1_000));
    expect(second).toBe(first + 1);
    expect(rfq).toBe(first);
  });
});
