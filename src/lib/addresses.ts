/** Compare Starknet felts numerically so padding and casing do not matter. */
export function feltEquals(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}
