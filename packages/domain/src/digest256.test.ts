import { describe, expect, it } from "vitest";
import { encodeDigest256Limbs, parseDigest256 } from "./digest256";

const digest = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const STARK_PRIME = (1n << 251n) + (17n << 192n) + 1n;

const vectors = [
  0n,
  STARK_PRIME - 1n,
  STARK_PRIME,
  1n << 255n,
  (1n << 256n) - 1n,
  (1n << 128n) - 1n,
  1n << 128n,
] as const;

describe("Digest256", () => {
  it.each(vectors)(
    "round-trips the full-width vector %s in low/high order",
    (value) => {
      const parsed = parseDigest256(digest(value));
      expect(encodeDigest256Limbs(parsed)).toEqual([
        `0x${(value & ((1n << 128n) - 1n)).toString(16)}`,
        `0x${(value >> 128n).toString(16)}`,
      ]);
      expect((parsed.high << 128n) | parsed.low).toBe(value);
    },
  );

  it("accepts hexadecimal case without treating the digest as a felt", () => {
    expect(parseDigest256(`0x${"AB".repeat(32)}`)).toEqual({
      low: BigInt(`0x${"ab".repeat(16)}`),
      high: BigInt(`0x${"ab".repeat(16)}`),
    });
  });

  it.each([
    "",
    " ",
    ` 0x${"00".repeat(32)}`,
    `0x${"00".repeat(32)}\n`,
    `0x${"00".repeat(31)}`,
    `0x${"00".repeat(33)}`,
    `${"00".repeat(32)}`,
    `0ｘ${"00".repeat(32)}`,
    `0x${"０".repeat(64)}`,
  ])("rejects malformed, whitespace, and Unicode input %#", (value) => {
    expect(() => parseDigest256(value)).toThrow(/exactly one/);
  });

  it("rejects limbs outside u128", () => {
    expect(() => encodeDigest256Limbs({ low: -1n, high: 0n })).toThrow(/u128/);
    expect(() => encodeDigest256Limbs({ low: 0n, high: 1n << 128n })).toThrow(
      /u128/,
    );
  });
});
