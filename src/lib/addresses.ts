import { canonicalizeStarknetFelt } from "@app20/domain";

/** Parse an address once and return a bounded lowercase 0x representation. */
export function canonicalizeStarknetAddress(address: string): string {
  try {
    return canonicalizeStarknetFelt(address);
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
