import { describe, expect, it } from "vitest";
import { extractSignature, splitStarkSignature } from "../src/privy.js";
import { PrivyError } from "../src/errors.js";

describe("extractSignature", () => {
  it("accepts a bare hex string", () => {
    expect(extractSignature("abcd")).toBe("0xabcd");
  });

  it("reads nested Privy response shapes", () => {
    expect(extractSignature({ signature: "0x11" })).toBe("0x11");
    expect(extractSignature({ data: { signature: "22" } })).toBe("0x22");
  });

  it("rejects missing signatures", () => {
    expect(() => extractSignature({})).toThrow(PrivyError);
  });
});

describe("splitStarkSignature", () => {
  it("splits a 64-byte r||s signature", () => {
    const r = "11".repeat(32);
    const s = "22".repeat(32);
    expect(splitStarkSignature(`0x${r}${s}`)).toEqual([`0x${r}`, `0x${s}`]);
  });

  it("rejects short signatures", () => {
    expect(() => splitStarkSignature("0x11")).toThrow(PrivyError);
  });
});
