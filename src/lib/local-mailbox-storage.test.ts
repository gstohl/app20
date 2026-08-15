import { describe, expect, it } from "vitest";
import {
  LOCAL_MAILBOX_STORAGE_PREFIXES,
  clearLocalMailboxStorage,
} from "./local-mailbox-storage";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("local mailbox purge", () => {
  it("removes every sensitive mailbox store but preserves preferences", () => {
    const storage = new MemoryStorage();
    for (const prefix of LOCAL_MAILBOX_STORAGE_PREFIXES) {
      storage.setItem(`${prefix}/SN_SEPOLIA/0xa11ce`, "sensitive");
    }
    storage.setItem("quietline/theme", "dark");
    storage.setItem("quietline/localnet-wallet/identity/v1", "alice");
    storage.setItem("unrelated", "keep");

    const removed = clearLocalMailboxStorage(storage);

    expect(removed).toHaveLength(LOCAL_MAILBOX_STORAGE_PREFIXES.length);
    for (const key of removed) expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem("quietline/theme")).toBe("dark");
    expect(storage.getItem("quietline/localnet-wallet/identity/v1")).toBe(
      "alice",
    );
    expect(storage.getItem("unrelated")).toBe("keep");
  });
});
