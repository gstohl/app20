import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRK_AMOUNT,
  formatStrkAmount,
  loadStrkAmount,
  parseStrkAmount,
  saveStrkAmount,
  strkAmountStorageKey,
} from "./strk-amount";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("STRK amount input", () => {
  it("parses decimal STRK exactly without floating-point rounding", () => {
    expect(parseStrkAmount("0.1")).toBe(100_000_000_000_000_000n);
    expect(parseStrkAmount("1.000000000000000001")).toBe(
      1_000_000_000_000_000_001n,
    );
    expect(parseStrkAmount("999999999999999999.999999999999999999")).toBe(
      999_999_999_999_999_999_999_999_999_999_999_999n,
    );
  });

  it.each(["", "0", "0.0", "-1", "+1", "NaN", "1e3", ".1"])(
    "rejects invalid or non-positive input %j",
    (value) => {
      expect(() => parseStrkAmount(value)).toThrow();
    },
  );

  it("rejects more than 18 decimal places", () => {
    expect(() => parseStrkAmount("0.0000000000000000001")).toThrow(
      /at most 18 decimal places/i,
    );
  });

  it("formats exact human and base-unit values", () => {
    expect(formatStrkAmount(100_000_000_000_000_000n)).toBe("0.1");
    expect(formatStrkAmount(1_000_000_000_000_000_001n)).toBe(
      "1.000000000000000001",
    );
    expect(formatStrkAmount(0n)).toBe("0");
  });

  it("remembers the last valid amount independently per network", () => {
    const storage = memoryStorage();
    expect(loadStrkAmount(storage, "MAINNET")).toBe(DEFAULT_STRK_AMOUNT);

    expect(saveStrkAmount(storage, "MAINNET", "0.2500")).toBe("0.25");
    expect(saveStrkAmount(storage, "SEPOLIA", "2")).toBe("2");
    expect(loadStrkAmount(storage, "MAINNET")).toBe("0.25");
    expect(loadStrkAmount(storage, "SEPOLIA")).toBe("2");
    expect(storage.getItem(strkAmountStorageKey("MAINNET"))).toBe("0.25");
  });

  it("falls back to 0.1 STRK when stored data is malformed", () => {
    const storage = memoryStorage();
    storage.setItem(strkAmountStorageKey("MAINNET"), "10oops");
    expect(loadStrkAmount(storage, "MAINNET")).toBe("0.1");
  });
});
