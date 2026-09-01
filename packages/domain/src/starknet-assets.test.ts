import { describe, expect, it } from "vitest";
import {
  canonicalizeStarknetFelt,
  formatTokenAmount,
  parseTokenAmount,
  starknetFeltEquals,
} from "./index";

describe("Starknet asset primitives", () => {
  it("canonicalizes equivalent bounded felt forms", () => {
    expect(canonicalizeStarknetFelt("0x00053C")).toBe("0x53c");
    expect(canonicalizeStarknetFelt("1340")).toBe("0x53c");
    expect(starknetFeltEquals("0x00053c", "1340")).toBe(true);
    expect(() => canonicalizeStarknetFelt(`0x${"f".repeat(64)}`)).toThrow(
      /bounded Starknet felt/,
    );
  });

  it("converts reviewed decimals exactly without Number arithmetic", () => {
    expect(parseTokenAmount("1.25", { decimals: 18 })).toBe(
      1_250_000_000_000_000_000n,
    );
    expect(parseTokenAmount(".000001", { decimals: 6 })).toBe(1n);
    expect(formatTokenAmount(1_250_000n, { decimals: 6 })).toBe("1.25");
    expect(() => parseTokenAmount("1e3", { decimals: 6 })).toThrow(
      /plain-decimal/,
    );
    expect(() => parseTokenAmount("0.0000001", { decimals: 6 })).toThrow(
      /at most 6/,
    );
  });

  it("rejects zero and u128 overflow", () => {
    expect(() => parseTokenAmount("0", { decimals: 18 })).toThrow(
      /greater than zero/,
    );
    expect(() =>
      parseTokenAmount((2n ** 128n).toString(), { decimals: 0 }),
    ).toThrow(/u128/);
  });

  it("rejects unbounded felt and decimal strings before BigInt conversion", () => {
    expect(() => canonicalizeStarknetFelt(`1${"0".repeat(256)}`)).toThrow(
      /bounded Starknet felt/,
    );
    expect(() => canonicalizeStarknetFelt(`${" ".repeat(256)}1`)).toThrow(
      /bounded Starknet felt/,
    );
    expect(() =>
      parseTokenAmount(`1${"0".repeat(512)}`, { decimals: 0 }),
    ).toThrow(/plain-decimal/);
    expect(starknetFeltEquals(`1${"0".repeat(256)}`, "1")).toBe(false);
  });
});
