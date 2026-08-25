import { describe, expect, it } from "vitest";
import {
  DEFAULT_SWAP_ROUTE,
  normalizeSwapToken,
  poolCreationPath,
  resolveSwapRoutePair,
  swapRoutePath,
} from "./swap-route";

describe("swap routes", () => {
  it("normalizes bounded token route segments", () => {
    expect(normalizeSwapToken(" STRK ")).toBe("strk");
    expect(normalizeSwapToken("0x53C")).toBe("0x53c");
    expect(normalizeSwapToken("strk/eth")).toBeNull();
  });

  it("fails closed for unreviewed and canonical duplicate assets", () => {
    expect(resolveSwapRoutePair("sepolia", "eth", "usdc")).toMatchObject({
      kind: "unverified",
    });
    expect(
      resolveSwapRoutePair(
        "mainnet",
        "strk",
        "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      ),
    ).toMatchObject({
      kind: "duplicate",
    });
    expect(resolveSwapRoutePair("sepolia", "strk/eth", "usdc")).toMatchObject({
      kind: "invalid",
    });
  });

  it("builds canonical routed paths without consuming relationship data", () => {
    expect(swapRoutePath("USDC", "STRK")).toBe("/swap/usdc/strk");
    expect(poolCreationPath("ETH", "USDC")).toBe("/pools/create/eth/usdc");
    expect(swapRoutePath("bad/path", "usdc")).toBe(DEFAULT_SWAP_ROUTE);
  });
});
