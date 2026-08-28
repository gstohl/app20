const DIGEST_256_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const U128_LIMIT = 1n << 128n;

/** A full 256-bit digest split in Cairo u256 serialization order. */
export type Digest256 = Readonly<{
  low: bigint;
  high: bigint;
}>;

/**
 * Parses exactly one `0x`-prefixed 32-byte digest. Digests are not Starknet
 * felts and must never be passed through felt canonicalization.
 */
export function parseDigest256(value: string): Digest256 {
  if (!DIGEST_256_PATTERN.test(value)) {
    throw new Error(
      "Digest256 must be exactly one 0x-prefixed 32-byte hexadecimal digest.",
    );
  }
  const digest = BigInt(value);
  return Object.freeze({
    low: digest & (U128_LIMIT - 1n),
    high: digest >> 128n,
  });
}

/** Encodes Digest256 as Cairo's `[low, high]` u256 limb order. */
export function encodeDigest256Limbs({
  low,
  high,
}: Digest256): readonly [string, string] {
  if (low < 0n || low >= U128_LIMIT || high < 0n || high >= U128_LIMIT) {
    throw new Error("Digest256 low and high limbs must each fit u128.");
  }
  return Object.freeze([
    `0x${low.toString(16)}`,
    `0x${high.toString(16)}`,
  ]) as readonly [string, string];
}
