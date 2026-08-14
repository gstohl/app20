import { num } from "starknet";

/** Compare Starknet felts numerically so padding and casing do not matter. */
export function feltEquals(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    try {
      return num.toBigInt(a) === num.toBigInt(b);
    } catch {
      return false;
    }
  }
}
