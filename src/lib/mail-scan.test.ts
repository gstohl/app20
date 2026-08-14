import { describe, expect, it } from "vitest";
import { MAX_CT_FELTS } from "./mail";
import {
  MAIL_SCAN_BLOCK_WINDOW,
  MAIL_SCAN_CHUNK_SIZE,
  MAIL_SCAN_MAX_MESSAGES,
  MAIL_SCAN_MAX_PAGES,
  completeMailScan,
  emptyMailScanCursor,
  loadMailScanCursor,
  mailScanCursorKey,
  parseMailEvent,
  pauseMailScan,
  planMailScan,
  saveMailScanCursor,
} from "./mail-scan";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const fingerprint = "11".repeat(32);

function event(ciphertextLength = 2) {
  return {
    keys: ["0x1", "0x0002"],
    data: [
      "0x11",
      "0x22",
      "0x7a",
      "0x33",
      "0x44",
      `0x${ciphertextLength.toString(16)}`,
      ...Array.from(
        { length: ciphertextLength },
        (_, index) => `0x${(index + 1).toString(16)}`,
      ),
    ],
    transaction_hash: "0x000999",
    block_number: 10,
    event_index: 3,
  };
}

describe("bounded mail scanning", () => {
  it("caps RPC ciphertext before retaining a parsed record", () => {
    expect(parseMailEvent(event())).toMatchObject({
      index: "2",
      transactionHash: "0x999",
      record: {
        ciphertextFelts: ["0x1", "0x2"],
      },
    });
    expect(parseMailEvent(event(MAX_CT_FELTS + 1))).toBeNull();
    expect(
      parseMailEvent({
        ...event(),
        transaction_hash: `0x${"0".repeat(1_000)}999`,
      }),
    ).toBeNull();
  });

  it("persists a scoped cursor and resumes its continuation token", () => {
    const storage = new MemoryStorage();
    const key = mailScanCursorKey(
      "SN_MAIN",
      "0x000abc",
      "0x000def",
      fingerprint,
    );
    const range = {
      direction: "recent" as const,
      fromBlock: 3_000,
      toBlock: 5_000,
    };
    const paused = pauseMailScan(emptyMailScanCursor(), range, "next-page");
    saveMailScanCursor(storage, key, paused);

    expect(key).toContain("/0xabc/0xdef/");
    expect(loadMailScanCursor(storage, key)).toEqual(paused);
    expect(planMailScan(paused, 5_001, "newer", false)).toEqual({
      ...range,
      continuationToken: "next-page",
    });
  });

  it("starts with a recent window and advances older only on request", () => {
    expect(MAIL_SCAN_CHUNK_SIZE).toBeLessThanOrEqual(1_024);
    expect(MAIL_SCAN_MAX_MESSAGES).toBeLessThanOrEqual(2_048);
    expect(MAIL_SCAN_CHUNK_SIZE * MAIL_SCAN_MAX_PAGES).toBeLessThanOrEqual(512);
    const latest = 10_000;
    const recent = planMailScan(emptyMailScanCursor(), latest, "newer", false);
    expect(recent).toEqual({
      direction: "recent",
      fromBlock: latest - MAIL_SCAN_BLOCK_WINDOW + 1,
      toBlock: latest,
    });

    const cursor = completeMailScan(emptyMailScanCursor(), recent!);
    expect(planMailScan(cursor, latest, "newer", true)).toBeNull();
    expect(planMailScan(cursor, latest, "older", true)).toEqual({
      direction: "older",
      fromBlock: latest - 2 * MAIL_SCAN_BLOCK_WINDOW + 1,
      toBlock: latest - MAIL_SCAN_BLOCK_WINDOW,
    });
  });
});
