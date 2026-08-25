import { describe, expect, it } from "vitest";
import {
  DEFAULT_SWAP_ROUTE,
  normalizeSwapToken,
  poolCreationPath,
  resolveSwapRoutePair,
  swapRoutePath,
} from "./swap-route";

describe("swap route pairs", () => {
  it("defaults to the STRK/USDC pool route", () => {
    expect(DEFAULT_SWAP_ROUTE).toBe("/swap/strk/usdc");
  });

  it("resolves both supported pool directions", () => {
    expect(resolveSwapRoutePair("STRK", "usdc")).toEqual({
      tokenA: "strk",
      tokenB: "usdc",
      pairId: "STRK_USDC",
    });
    expect(resolveSwapRoutePair("usdc", "STRK")?.pairId).toBe("USDC_STRK");
  });

  it("keeps valid unknown pairs so the UI can show a no-pool state", () => {
    expect(resolveSwapRoutePair("eth", "usdc")).toEqual({
      tokenA: "eth",
      tokenB: "usdc",
      pairId: null,
    });
    expect(poolCreationPath("eth", "usdc")).toBe("/pools/create/eth/usdc");
  });

  it("rejects unsafe path segments and falls back safely", () => {
    expect(normalizeSwapToken("../strk")).toBeNull();
    expect(resolveSwapRoutePair("strk/eth", "usdc")).toBeNull();
    expect(swapRoutePath("strk/eth", "usdc")).toBe(DEFAULT_SWAP_ROUTE);
  });
});
