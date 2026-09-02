import { describe, expect, it } from "vitest";
import {
  consumePendingRfqHistoryAutoBackup,
  RFQ_AUTO_BACKUP_PENDING_KEY,
} from "./rfq-auto-backup";

function storageWith(value: unknown) {
  const values = new Map<string, string>([
    [RFQ_AUTO_BACKUP_PENDING_KEY, JSON.stringify(value)],
  ]);
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  };
}

describe("settled RFQ auto-backup handoff", () => {
  it("consumes only the exact account and chain scope", () => {
    const pending = {
      version: 1,
      chainId: "0x1",
      account: "0xAbC",
      requestedAt: 2_000_000_000_000,
    } as const;
    const mismatch = storageWith(pending);

    expect(
      consumePendingRfqHistoryAutoBackup(mismatch.storage, {
        chainId: "0x2",
        account: "0xabc",
      }),
    ).toBeNull();
    expect(mismatch.values.has(RFQ_AUTO_BACKUP_PENDING_KEY)).toBe(true);

    const match = storageWith(pending);
    expect(
      consumePendingRfqHistoryAutoBackup(match.storage, {
        chainId: "0x1",
        account: "0xabc",
      }),
    ).toEqual(pending);
    expect(match.values.has(RFQ_AUTO_BACKUP_PENDING_KEY)).toBe(false);
  });

  it("does not consume malformed requests", () => {
    const malformed = storageWith({
      version: 1,
      chainId: "0x1",
      account: "0xabc",
      requestedAt: -1,
    });

    expect(
      consumePendingRfqHistoryAutoBackup(malformed.storage, {
        chainId: "0x1",
        account: "0xabc",
      }),
    ).toBeNull();
    expect(malformed.values.has(RFQ_AUTO_BACKUP_PENDING_KEY)).toBe(true);
  });
});
