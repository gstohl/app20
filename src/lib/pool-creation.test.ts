import { describe, expect, it } from "vitest";
import { validatePoolCreationDraft } from "./pool-creation";

describe("pool creation draft", () => {
  it("builds a review without implying deployment", () => {
    const result = validatePoolCreationDraft({
      tokenA: "eth",
      tokenB: "usdc",
      feeBps: 30,
      initialPrice: "2500",
      tokenAInventory: "2",
      tokenBInventory: "5000",
    });

    expect(result).toEqual({
      ok: true,
      errors: {},
      review: {
        feeBps: 30,
        initialPrice: 2500,
        tokenAInventory: 2,
        tokenBInventory: 5000,
        totalReferenceValueInTokenB: 10_000,
      },
    });
  });

  it("rejects same-token pairs, non-positive amounts, and exponent notation", () => {
    const result = validatePoolCreationDraft({
      tokenA: "strk",
      tokenB: "STRK",
      feeBps: 30,
      initialPrice: "1e3",
      tokenAInventory: "0",
      tokenBInventory: "-1",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toMatchObject({
      pair: "Choose two different tokens.",
      initialPrice: "Enter a positive initial price.",
      tokenAInventory: "Enter positive starting inventory.",
      tokenBInventory: "Enter positive starting inventory.",
    });
  });
});
