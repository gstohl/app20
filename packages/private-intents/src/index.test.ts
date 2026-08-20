import { describe, expect, it } from "vitest";
import {
  acceptQuote,
  assertInventoryCovers,
  assertPrivateSwapIntent,
  digestPrivateSwapIntent,
  fillLockedIntent,
  planRestock,
  quotePrivateSwapIntent,
  refundExpiredIntent,
  type PricingSource,
  type PrivateSwapIntentV1,
  type SolverQuote,
} from "./index";

const USDC =
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const NOW = 1_800_000_000;

function intent(
  overrides: Partial<PrivateSwapIntentV1> = {},
): PrivateSwapIntentV1 {
  return {
    version: 1,
    intentId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    pool: "starknet:SN_SEPOLIA",
    sellToken: USDC,
    sellAmount: 100_000_000n,
    buyToken: STRK,
    minBuyAmount: 950n * 10n ** 18n,
    createdAt: NOW,
    expiresAt: NOW + 3_600,
    ...overrides,
  };
}

function fixturePricing(buyAmount: bigint): PricingSource {
  return {
    price: async () => ({ buyAmount, provenance: "fixture:1click-dry" }),
  };
}

describe("private swap intent", () => {
  it("accepts a canonical intent and digests deterministically", async () => {
    expect(() => assertPrivateSwapIntent(intent())).not.toThrow();
    const first = await digestPrivateSwapIntent(intent());
    const second = await digestPrivateSwapIntent(intent());
    expect(first).toBe(second);
    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes the digest when any economic field changes", async () => {
    const base = await digestPrivateSwapIntent(intent());
    for (const changed of [
      intent({ sellAmount: 100_000_001n }),
      intent({ minBuyAmount: 950n * 10n ** 18n + 1n }),
      intent({ buyToken: "0x1234" }),
      intent({ expiresAt: NOW + 3_601 }),
    ]) {
      expect(await digestPrivateSwapIntent(changed)).not.toBe(base);
    }
  });

  it.each([
    ["short id", intent({ intentId: "short" })],
    ["zero sell", intent({ sellAmount: 0n })],
    ["same token", intent({ buyToken: USDC })],
    ["expiry before creation", intent({ expiresAt: NOW - 1 })],
    ["zero token", intent({ sellToken: "0x0" })],
  ])("rejects %s", (_label, bad) => {
    expect(() => assertPrivateSwapIntent(bad)).toThrow();
  });
});

describe("solver quoting", () => {
  const options = {
    solverId: "app20-desk",
    spreadBps: 30,
    quoteTtlSeconds: 120,
    now: NOW,
  };

  it("quotes above the floor with the spread applied", async () => {
    const raw = 1_000n * 10n ** 18n;
    const outcome = await quotePrivateSwapIntent(
      intent(),
      fixturePricing(raw),
      options,
    );
    if (outcome.kind !== "quoted") throw new Error("expected a quote");
    expect(outcome.quote.buyAmount).toBe((raw * 9_970n) / 10_000n);
    expect(outcome.quote.buyAmount >= intent().minBuyAmount).toBe(true);
    expect(outcome.quote.pricingProvenance).toBe("fixture:1click-dry");
    expect(outcome.quote.quoteExpiresAt).toBe(NOW + 120);
  });

  it("declines when the spread pushes the fill under the floor", async () => {
    const outcome = await quotePrivateSwapIntent(
      intent({ minBuyAmount: 999n * 10n ** 18n }),
      fixturePricing(1_000n * 10n ** 18n),
      { ...options, spreadBps: 500 },
    );
    expect(outcome.kind).toBe("declined");
  });

  it("declines an expired intent without pricing it", async () => {
    let priced = false;
    const source: PricingSource = {
      price: async () => {
        priced = true;
        return { buyAmount: 1n, provenance: "x" };
      },
    };
    const outcome = await quotePrivateSwapIntent(intent(), source, {
      ...options,
      now: NOW + 3_600,
    });
    expect(outcome.kind).toBe("declined");
    expect(priced).toBe(false);
  });

  it("never lets the quote outlive the intent", async () => {
    const outcome = await quotePrivateSwapIntent(
      intent({ expiresAt: NOW + 60 }),
      fixturePricing(1_000n * 10n ** 18n),
      options,
    );
    if (outcome.kind !== "quoted") throw new Error("expected a quote");
    expect(outcome.quote.quoteExpiresAt).toBe(NOW + 60);
  });
});

async function lockedFixture(): Promise<{
  order: PrivateSwapIntentV1;
  quote: SolverQuote;
}> {
  const order = intent();
  const outcome = await quotePrivateSwapIntent(
    order,
    fixturePricing(1_000n * 10n ** 18n),
    { solverId: "app20-desk", spreadBps: 30, quoteTtlSeconds: 120, now: NOW },
  );
  if (outcome.kind !== "quoted") throw new Error("fixture quote failed");
  return { order, quote: outcome.quote };
}

describe("fill-or-refund lifecycle", () => {
  it("locks, fills at or above the floor, and records delivery", async () => {
    const { order, quote } = await lockedFixture();
    const locked = acceptQuote(order, quote, NOW + 10);
    const filled = fillLockedIntent(order, locked, quote.buyAmount, NOW + 30);
    expect(filled.kind).toBe("filled");
  });

  it("rejects accepting an expired quote", async () => {
    const { order, quote } = await lockedFixture();
    expect(() => acceptQuote(order, quote, NOW + 121)).toThrow(/expired/i);
  });

  it("rejects a fill below the floor", async () => {
    const { order, quote } = await lockedFixture();
    const locked = acceptQuote(order, quote, NOW + 10);
    expect(() =>
      fillLockedIntent(order, locked, order.minBuyAmount - 1n, NOW + 30),
    ).toThrow(/below the intent floor/i);
  });

  it("rejects a fill after expiry and allows the refund instead", async () => {
    const { order, quote } = await lockedFixture();
    const locked = acceptQuote(order, quote, NOW + 10);
    expect(() =>
      fillLockedIntent(order, locked, quote.buyAmount, NOW + 3_600),
    ).toThrow(/expired/i);
    const refunded = refundExpiredIntent(order, locked, NOW + 3_600);
    expect(refunded.kind).toBe("refunded");
  });

  it("rejects refunding before expiry and double settlement", async () => {
    const { order, quote } = await lockedFixture();
    const locked = acceptQuote(order, quote, NOW + 10);
    expect(() => refundExpiredIntent(order, locked, NOW + 20)).toThrow(
      /not expired/i,
    );
    const filled = fillLockedIntent(order, locked, quote.buyAmount, NOW + 30);
    expect(() =>
      fillLockedIntent(order, filled, quote.buyAmount, NOW + 40),
    ).toThrow(/state filled/i);
    expect(() => refundExpiredIntent(order, filled, NOW + 4_000)).toThrow(
      /state filled/i,
    );
  });
});

describe("inventory-first rule", () => {
  it("passes only when notes cover the fill", () => {
    const inventory = [{ token: STRK, available: 1_000n }];
    expect(() => assertInventoryCovers(inventory, STRK, 1_000n)).not.toThrow();
    expect(() => assertInventoryCovers(inventory, STRK, 1_001n)).toThrow(
      /inventory does not cover/i,
    );
    expect(() => assertInventoryCovers([], STRK, 1n)).toThrow(
      /inventory does not cover/i,
    );
  });
});

describe("restock netting", () => {
  it("nets opposing fills so no public order is needed", () => {
    const plan = planRestock(
      [
        { sellToken: USDC, sellAmount: 100n, buyToken: STRK, buyAmount: 400n },
        { sellToken: STRK, sellAmount: 400n, buyToken: USDC, buyAmount: 100n },
      ],
      { denomination: 50n, minBatch: 50n },
    );
    expect(plan.orders).toEqual([]);
    expect(plan.deferred).toEqual([]);
    expect(plan.netExposure.every((entry) => entry.amount <= 0n)).toBe(true);
  });

  it("rounds residual demand up to the standard denomination", () => {
    const plan = planRestock(
      [
        { sellToken: USDC, sellAmount: 100n, buyToken: STRK, buyAmount: 430n },
        { sellToken: USDC, sellAmount: 50n, buyToken: STRK, buyAmount: 210n },
      ],
      { denomination: 100n, minBatch: 100n },
    );
    expect(plan.orders).toEqual([{ token: STRK.toLowerCase(), amount: 700n }]);
  });

  it("defers residuals below the batch floor instead of leaking them", () => {
    const plan = planRestock(
      [{ sellToken: USDC, sellAmount: 10n, buyToken: STRK, buyAmount: 40n }],
      { denomination: 100n, minBatch: 100n },
    );
    expect(plan.orders).toEqual([]);
    expect(plan.deferred).toEqual([{ token: STRK.toLowerCase(), amount: 40n }]);
  });
});
