const STARKNET_ADDRESS_LIMIT = 2n ** 251n;
const MAX_ADDRESS_INPUT_LENGTH = 78;
const ADDRESS_PATTERN = /^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/;

/** Parse an address once and return a bounded lowercase 0x representation. */
export function canonicalizeStarknetAddress(address: string): string {
  const trimmed = address.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_ADDRESS_INPUT_LENGTH ||
    !ADDRESS_PATTERN.test(trimmed)
  ) {
    throw new Error("Address must be a bounded Starknet felt.");
  }

  try {
    const value = BigInt(trimmed);
    if (value < 0n || value >= STARKNET_ADDRESS_LIMIT) throw new Error();
    return `0x${value.toString(16)}`;
  } catch {
    throw new Error("Address must be a bounded Starknet felt.");
  }
}

/** Compare only canonical, bounded Starknet address representations. */
export function feltEquals(a: string, b: string): boolean {
  try {
    return canonicalizeStarknetAddress(a) === canonicalizeStarknetAddress(b);
  } catch {
    return false;
  }
}
