import { describe, expect, it } from "vitest";
import { READY_ACCOUNT_CLASS_HASH_V0_5_0 } from "../src/constants.js";
import { buildReadyConstructor, computeReadyAddress } from "../src/ready.js";

// 248-bit dummy keys — must stay inside felt252 (≤ 251 bits).
const PUBKEY = "0x" + "11".repeat(31);
const OTHER = "0x" + "22".repeat(31);

describe("Ready account derivation", () => {
  it("is deterministic for the same public key + class hash", () => {
    const a = computeReadyAddress(PUBKEY, READY_ACCOUNT_CLASS_HASH_V0_5_0);
    const b = computeReadyAddress(PUBKEY, READY_ACCOUNT_CLASS_HASH_V0_5_0);
    expect(a).toBe(b);
    expect(a.startsWith("0x")).toBe(true);
  });

  it("changes when the public key changes", () => {
    expect(
      computeReadyAddress(PUBKEY, READY_ACCOUNT_CLASS_HASH_V0_5_0),
    ).not.toBe(computeReadyAddress(OTHER, READY_ACCOUNT_CLASS_HASH_V0_5_0));
  });

  it("compiles constructor calldata", () => {
    const calldata = buildReadyConstructor(PUBKEY);
    expect(Array.isArray(calldata)).toBe(true);
    expect(calldata.length).toBeGreaterThan(0);
  });
});
