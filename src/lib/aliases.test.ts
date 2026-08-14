import { describe, expect, it } from "vitest";
import {
  aliasStorageKey,
  findAliasByAddress,
  loadAliases,
  removeAlias,
  resolveAliasInput,
  saveAlias,
} from "./aliases";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("local contact aliases", () => {
  it("roundtrips under the self-address-only storage key", () => {
    const storage = new MemoryStorage();
    saveAlias(storage, "0xself", "0x000AbC", "  Alice  ", 123);

    expect(aliasStorageKey("0xself")).toBe("quietline/aliases/v1/0xself");
    expect(loadAliases(storage, "0xself")).toEqual([
      { address: "0xabc", label: "Alice", addedAt: 123 },
    ]);
    expect(loadAliases(storage, "0xother")).toEqual([]);
  });

  it("looks up numerically equivalent felt addresses and labels", () => {
    const storage = new MemoryStorage();
    const aliases = saveAlias(storage, "0x1", "0x00aBc", "Alice", 1);

    expect(findAliasByAddress(aliases, "0xABC")?.label).toBe("Alice");
    expect(resolveAliasInput(aliases, " alice ")).toBe("0xabc");
    expect(resolveAliasInput(aliases, "0xdef")).toBe("0xdef");
  });

  it("updates and removes locally without leaking into another scope", () => {
    const storage = new MemoryStorage();
    saveAlias(storage, "0x1", "0xabc", "Alice", 1);
    saveAlias(storage, "0x1", "0x0abc", "Trading desk", 2);
    saveAlias(storage, "0x2", "0xabc", "Other profile", 3);

    expect(loadAliases(storage, "0x1")).toEqual([
      { address: "0xabc", label: "Trading desk", addedAt: 2 },
    ]);
    expect(removeAlias(storage, "0x1", "0xABC")).toEqual([]);
    expect(loadAliases(storage, "0x2")).toHaveLength(1);
  });

  it("rejects ambiguous labels and ignores malformed saved JSON", () => {
    const storage = new MemoryStorage();
    saveAlias(storage, "0x1", "0xabc", "Alice", 1);
    expect(() => saveAlias(storage, "0x1", "0xdef", "alice", 2)).toThrow(
      /another address/i,
    );

    storage.setItem(aliasStorageKey("0x1"), "not-json");
    expect(loadAliases(storage, "0x1")).toEqual([]);
  });

  it("strips Unicode controls and bounds canonical alias addresses", () => {
    const storage = new MemoryStorage();
    const aliases = saveAlias(
      storage,
      "0x1",
      `0x${"0".repeat(20)}abc`,
      "Tre\u202eas\u2066ury\u0000 Desk",
      1,
    );

    expect(aliases).toEqual([
      { address: "0xabc", label: "Treasury Desk", addedAt: 1 },
    ]);
    expect(resolveAliasInput(aliases, "Tre\u202easury Desk")).toBe("0xabc");
    expect(() =>
      saveAlias(storage, "0x1", `0x${"0".repeat(1000)}abc`, "Long", 2),
    ).toThrow(/bounded Starknet felt/i);
  });
});
