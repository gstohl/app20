import { describe, expect, it } from "vitest";
import {
  inspectMailVault,
  parseMailVaultRecord,
  persistPlaintextSeed,
  persistWrappedSeed,
  unwrapMailSeed,
  wrapMailSeed,
} from "./mail-vault";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const testParams = { N: 16, r: 8, p: 1 };

describe("optional mailbox vault", () => {
  it("reads a legacy hex seed as plaintext", () => {
    const seed = "ab".repeat(32);
    expect(parseMailVaultRecord(seed)).toEqual({
      version: 1,
      kind: "plaintext",
      seed,
    });
  });

  it("wraps and unwraps with a passphrase and rejects a wrong one", async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index);
    const record = await wrapMailSeed(seed, "correct-horse", testParams);
    expect(record.kind).toBe("passphrase");
    expect(record.ciphertext).not.toContain("00010203");
    await expect(unwrapMailSeed(record, "correct-horse")).resolves.toEqual(
      seed,
    );
    await expect(unwrapMailSeed(record, "wrong-horse1")).rejects.toThrow(
      /does not open/i,
    );
  });

  it("lets the user persist either plaintext or a wrapped vault", async () => {
    const storage = new MemoryStorage();
    const seed = Uint8Array.from({ length: 32 }, () => 7);
    persistPlaintextSeed(storage, "SN_MAIN", "0xa11ce", seed);
    expect(inspectMailVault(storage, "SN_MAIN", "0xa11ce").kind).toBe(
      "plaintext",
    );
    await persistWrappedSeed(
      storage,
      "SN_MAIN",
      "0xa11ce",
      seed,
      "correct-horse",
      testParams,
    );
    const inspected = inspectMailVault(storage, "SN_MAIN", "0xa11ce");
    expect(inspected.kind).toBe("passphrase");
  });
});
