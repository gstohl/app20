import { canonicalizeStarknetFelt } from "@app20/domain";
import { describe, expect, it } from "vitest";
import {
  acceptQuote,
  assertInventoryCovers,
  assertPrivateSwapIntent,
  canonicalSolverQuote,
  createMemoryQuoteReplayStore,
  digestPrivateSwapIntent,
  fillLockedIntent,
  isCanonicalQuoteSignature,
  planRestock,
  quotePrivateSwapIntent,
  refundExpiredIntent,
  selectBestSolverQuote,
  signCanonicalQuote,
  verifyCanonicalQuote,
  type PricingSource,
  type PrivateSwapIntentV1,
  type QuoteAcceptance,
  type QuoteOptions,
  type SolverQuote,
} from "./index";

const USDC =
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const HELPER =
  "0x067c772d127482e87807deaa5b4f5014d48e54d12f190737b47fb37f6438c434";

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

async function testKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
}

function quoteOptions(
  privateKey: CryptoKey,
  overrides: Partial<QuoteOptions> = {},
): QuoteOptions {
  return {
    solverId: "app20-desk",
    solverKey: "test-solver/ecdsa-p256-v1",
    helper: HELPER,
    spreadBps: 30,
    quoteTtlSeconds: 120,
    now: NOW,
    reservationId: `0x${"a1".repeat(32)}`,
    reservationExpiresAt: NOW + 180,
    sign: async (canonical) => signCanonicalQuote(canonical, privateKey),
    ...overrides,
  };
}

function acceptance(
  publicKey: CryptoKey,
  quote: SolverQuote,
  store = createMemoryQuoteReplayStore(),
  overrides: Partial<QuoteAcceptance> = {},
): QuoteAcceptance {
  return {
    helper: quote.helper,
    consumeNonce: (nonce) => store.consume(nonce),
    verify: async (canonical, signature, solverKey) => {
      if (solverKey !== quote.solverKey) return false;
      return verifyCanonicalQuote(canonical, signature, publicKey);
    },
    ...overrides,
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

  it("canonicalizes leading-zero felt variants and rejects equivalent pairs", async () => {
    const leadingZeroUsdc = `0x000${USDC.slice(2)}`;
    expect(
      await digestPrivateSwapIntent(intent({ sellToken: leadingZeroUsdc })),
    ).toBe(await digestPrivateSwapIntent(intent()));
    expect(() =>
      assertPrivateSwapIntent(
        intent({ sellToken: leadingZeroUsdc, buyToken: USDC }),
      ),
    ).toThrow(/must differ/);
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
  it("quotes above the floor with the spread applied", async () => {
    const keys = await testKeys();
    const raw = 1_000n * 10n ** 18n;
    const outcome = await quotePrivateSwapIntent(
      intent(),
      fixturePricing(raw),
      quoteOptions(keys.privateKey),
    );
    if (outcome.kind !== "quoted") throw new Error("expected a quote");
    expect(outcome.quote.buyAmount).toBe((raw * 9_970n) / 10_000n);
    expect(outcome.quote.buyAmount >= intent().minBuyAmount).toBe(true);
    expect(outcome.quote.pricingProvenance).toBe("fixture:1click-dry");
    expect(outcome.quote.quoteExpiresAt).toBe(NOW + 120);
    expect(outcome.quote.reservationId).toBe(`0x${"a1".repeat(32)}`);
    expect(outcome.quote.reservationExpiresAt).toBe(NOW + 180);
    expect(outcome.quote.signature).toMatch(/^0x[0-9a-f]+$/);
    await expect(
      verifyCanonicalQuote(
        canonicalSolverQuote(outcome.quote),
        outcome.quote.signature,
        keys.publicKey,
      ),
    ).resolves.toBe(true);
  });

  it("normalizes signatures to low-S and rejects the malleable high-S twin", async () => {
    const keys = await testKeys();
    const canonical = "canonical quote";
    const signature = await signCanonicalQuote(canonical, keys.privateKey);
    expect(isCanonicalQuoteSignature(signature)).toBe(true);
    const raw = signature.slice(2);
    const order =
      0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    const highS = order - BigInt(`0x${raw.slice(64)}`);
    const twin = `0x${raw.slice(0, 64)}${highS.toString(16).padStart(64, "0")}`;
    expect(isCanonicalQuoteSignature(twin)).toBe(false);
    await expect(
      verifyCanonicalQuote(canonical, twin, keys.publicKey),
    ).resolves.toBe(false);
  });

  it("refuses to emit a quote whose signer returned a high-S signature", async () => {
    const keys = await testKeys();
    const order =
      0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    await expect(
      quotePrivateSwapIntent(
        intent(),
        fixturePricing(1_000n * 10n ** 18n),
        quoteOptions(keys.privateKey, {
          sign: async (canonical) => {
            const signature = await signCanonicalQuote(
              canonical,
              keys.privateKey,
            );
            const raw = signature.slice(2);
            const highS = order - BigInt(`0x${raw.slice(64)}`);
            return `0x${raw.slice(0, 64)}${highS.toString(16).padStart(64, "0")}`;
          },
        }),
      ),
    ).rejects.toThrow(/unusable signature/i);
  });

  it("declines when the spread pushes the fill under the floor", async () => {
    const keys = await testKeys();
    const outcome = await quotePrivateSwapIntent(
      intent({ minBuyAmount: 999n * 10n ** 18n }),
      fixturePricing(1_000n * 10n ** 18n),
      quoteOptions(keys.privateKey, { spreadBps: 500 }),
    );
    expect(outcome.kind).toBe("declined");
  });

  it("declines an expired intent without pricing it", async () => {
    const keys = await testKeys();
    let priced = false;
    const source: PricingSource = {
      price: async () => {
        priced = true;
        return { buyAmount: 1n, provenance: "x" };
      },
    };
    const outcome = await quotePrivateSwapIntent(intent(), source, {
      ...quoteOptions(keys.privateKey),
      now: NOW + 3_600,
    });
    expect(outcome.kind).toBe("declined");
    expect(priced).toBe(false);
  });

  it("never lets the quote outlive the intent or inventory reservation", async () => {
    const keys = await testKeys();
    const intentBound = await quotePrivateSwapIntent(
      intent({ expiresAt: NOW + 60 }),
      fixturePricing(1_000n * 10n ** 18n),
      quoteOptions(keys.privateKey),
    );
    if (intentBound.kind !== "quoted") throw new Error("expected a quote");
    expect(intentBound.quote.quoteExpiresAt).toBe(NOW + 60);

    const reservationBound = await quotePrivateSwapIntent(
      intent(),
      fixturePricing(1_000n * 10n ** 18n),
      quoteOptions(keys.privateKey, { reservationExpiresAt: NOW + 45 }),
    );
    if (reservationBound.kind !== "quoted") {
      throw new Error("expected a reservation-bound quote");
    }
    expect(reservationBound.quote.quoteExpiresAt).toBe(NOW + 45);
  });

  it("declines an expired inventory reservation before pricing", async () => {
    const keys = await testKeys();
    let priced = false;
    const outcome = await quotePrivateSwapIntent(
      intent(),
      {
        price: async () => {
          priced = true;
          return { buyAmount: 1n, provenance: "should-not-run" };
        },
      },
      quoteOptions(keys.privateKey, { reservationExpiresAt: NOW }),
    );
    expect(outcome).toEqual({
      kind: "declined",
      reason: "The inventory reservation expired.",
    });
    expect(priced).toBe(false);
  });
});

async function lockedFixture(): Promise<{
  order: PrivateSwapIntentV1;
  quote: SolverQuote;
  keys: CryptoKeyPair;
}> {
  const keys = await testKeys();
  const order = intent();
  const outcome = await quotePrivateSwapIntent(
    order,
    fixturePricing(1_000n * 10n ** 18n),
    quoteOptions(keys.privateKey),
  );
  if (outcome.kind !== "quoted") throw new Error("fixture quote failed");
  return { order, quote: outcome.quote, keys };
}

describe("fill-or-refund lifecycle", () => {
  it("locks, fills at or above the floor, and records delivery", async () => {
    const { order, quote, keys } = await lockedFixture();
    const locked = await acceptQuote(
      order,
      quote,
      NOW + 10,
      acceptance(keys.publicKey, quote),
    );
    const filled = fillLockedIntent(order, locked, quote.buyAmount, NOW + 30);
    expect(filled.kind).toBe("filled");
  });

  it("rejects accepting an expired quote", async () => {
    const { order, quote, keys } = await lockedFixture();
    await expect(
      acceptQuote(order, quote, NOW + 121, acceptance(keys.publicKey, quote)),
    ).rejects.toThrow(/expired/i);
  });

  it("rejects a fill below the floor", async () => {
    const { order, quote, keys } = await lockedFixture();
    const locked = await acceptQuote(
      order,
      quote,
      NOW + 10,
      acceptance(keys.publicKey, quote),
    );
    expect(() =>
      fillLockedIntent(order, locked, order.minBuyAmount - 1n, NOW + 30),
    ).toThrow(/below the quoted fill/i);
  });

  it("rejects a fill after expiry and allows the refund instead", async () => {
    const { order, quote, keys } = await lockedFixture();
    const locked = await acceptQuote(
      order,
      quote,
      NOW + 10,
      acceptance(keys.publicKey, quote),
    );
    expect(() =>
      fillLockedIntent(order, locked, quote.buyAmount, NOW + 3_600),
    ).toThrow(/expired/i);
    const refunded = refundExpiredIntent(order, locked, NOW + 3_600);
    expect(refunded.kind).toBe("refunded");
  });

  it("rejects refunding before expiry and double settlement", async () => {
    const { order, quote, keys } = await lockedFixture();
    const locked = await acceptQuote(
      order,
      quote,
      NOW + 10,
      acceptance(keys.publicKey, quote),
    );
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

describe("quote acceptance binding", () => {
  it("rejects a quote whose digest or domain does not bind the intent", async () => {
    const { order, quote, keys } = await lockedFixture();
    await expect(
      acceptQuote(
        order,
        { ...quote, domain: "wrong-domain" } as unknown as SolverQuote,
        NOW + 10,
        acceptance(keys.publicKey, quote),
      ),
    ).rejects.toThrow(/quote domain/i);
    await expect(
      acceptQuote(
        order,
        { ...quote, intentDigest: "0xdead" },
        NOW + 10,
        acceptance(keys.publicKey, quote),
      ),
    ).rejects.toThrow(/intent digest/i);
    await expect(
      acceptQuote(
        order,
        { ...quote, solverId: "   " },
        NOW + 10,
        acceptance(keys.publicKey, quote),
      ),
    ).rejects.toThrow(/solver identity/i);
  });

  it("rejects unsigned, forged, tampered, future-dated, and replayed quotes", async () => {
    const { order, quote, keys } = await lockedFixture();
    const store = createMemoryQuoteReplayStore();
    const accept = (candidate: SolverQuote, now = NOW + 10) =>
      acceptQuote(
        order,
        candidate,
        now,
        acceptance(keys.publicKey, quote, store),
      );

    await expect(accept({ ...quote, signature: "" })).rejects.toThrow(
      /not authentic|unusable|signature/i,
    );
    await expect(accept({ ...quote, signature: "0xdead" })).rejects.toThrow(
      /not authentic/i,
    );
    await expect(
      accept({ ...quote, buyAmount: quote.buyAmount + 1n }),
    ).rejects.toThrow(/not authentic/i);
    await expect(
      accept({ ...quote, solverKey: "forged-solver" }),
    ).rejects.toThrow(/not authentic/i);
    await expect(accept(quote, quote.quotedAt - 120)).rejects.toThrow(
      /future/i,
    );

    await expect(accept(quote)).resolves.toMatchObject({ kind: "locked" });
    await expect(accept(quote)).rejects.toThrow(/already consumed/i);
  });
});

describe("sealed maker selection", () => {
  it("verifies every quote and chooses best amount with a deterministic tie-break", async () => {
    const order = intent();
    const firstKeys = await testKeys();
    const secondKeys = await testKeys();
    const first = await quotePrivateSwapIntent(
      order,
      fixturePricing(1_000n * 10n ** 18n),
      quoteOptions(firstKeys.privateKey, {
        solverId: "maker-z",
        solverKey: "maker-z/p256",
        spreadBps: 30,
        nonce: `0x${"11".repeat(32)}`,
        reservationId: `0x${"21".repeat(32)}`,
      }),
    );
    const second = await quotePrivateSwapIntent(
      order,
      fixturePricing(1_000n * 10n ** 18n),
      quoteOptions(secondKeys.privateKey, {
        solverId: "maker-a",
        solverKey: "maker-a/p256",
        spreadBps: 20,
        nonce: `0x${"12".repeat(32)}`,
        reservationId: `0x${"22".repeat(32)}`,
      }),
    );
    if (first.kind !== "quoted" || second.kind !== "quoted") {
      throw new Error("expected two private quotes");
    }
    const keys = new Map([
      ["maker-z/p256", firstKeys.publicKey],
      ["maker-a/p256", secondKeys.publicKey],
    ]);
    const verification = {
      helper: HELPER,
      verify: async (
        canonical: string,
        signature: string,
        solverKey: string,
      ) => {
        const key = keys.get(solverKey);
        return key ? verifyCanonicalQuote(canonical, signature, key) : false;
      },
    };

    await expect(
      selectBestSolverQuote(
        order,
        [first.quote, second.quote],
        NOW + 10,
        verification,
      ),
    ).resolves.toBe(second.quote);

    const equalSecond = {
      ...second.quote,
      buyAmount: first.quote.buyAmount,
      spreadBps: first.quote.spreadBps,
    };
    const equalCanonical = canonicalSolverQuote(equalSecond);
    const signedEqualSecond = {
      ...equalSecond,
      signature: await signCanonicalQuote(
        equalCanonical,
        secondKeys.privateKey,
      ),
    };
    await expect(
      selectBestSolverQuote(
        order,
        [first.quote, signedEqualSecond],
        NOW + 10,
        verification,
      ),
    ).resolves.toBe(signedEqualSecond);
  });

  it("fails closed when any invited maker quote is forged or duplicated", async () => {
    const { order, quote, keys } = await lockedFixture();
    const verification = acceptance(keys.publicKey, quote);
    await expect(
      selectBestSolverQuote(
        order,
        [quote, { ...quote, solverId: "forged", signature: "0xdead" }],
        NOW + 10,
        verification,
      ),
    ).rejects.toThrow(/not authentic/i);
    await expect(
      selectBestSolverQuote(
        order,
        [quote, { ...quote, reservationId: `0x${"ff".repeat(32)}` }],
        NOW + 10,
        verification,
      ),
    ).rejects.toThrow(/more than one quote/i);
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
    expect(plan.orders).toEqual([
      { token: canonicalizeStarknetFelt(STRK), amount: 700n },
    ]);
  });

  it("defers residuals below the batch floor instead of leaking them", () => {
    const plan = planRestock(
      [{ sellToken: USDC, sellAmount: 10n, buyToken: STRK, buyAmount: 40n }],
      { denomination: 100n, minBatch: 100n },
    );
    expect(plan.orders).toEqual([]);
    expect(plan.deferred).toEqual([
      { token: canonicalizeStarknetFelt(STRK), amount: 40n },
    ]);
  });

  it("rejects non-positive, oversized, or same-token fill amounts", () => {
    const options = { denomination: 50n, minBatch: 50n };
    expect(() =>
      planRestock(
        [{ sellToken: USDC, sellAmount: 0n, buyToken: STRK, buyAmount: 40n }],
        options,
      ),
    ).toThrow(/positive u256/i);
    expect(() =>
      planRestock(
        [
          {
            sellToken: USDC,
            sellAmount: -1n,
            buyToken: STRK,
            buyAmount: 40n,
          },
        ],
        options,
      ),
    ).toThrow(/positive u256/i);
    expect(() =>
      planRestock(
        [
          {
            sellToken: USDC,
            sellAmount: 1n << 256n,
            buyToken: STRK,
            buyAmount: 40n,
          },
        ],
        options,
      ),
    ).toThrow(/positive u256/i);
    expect(() =>
      planRestock(
        [{ sellToken: USDC, sellAmount: 10n, buyToken: USDC, buyAmount: 40n }],
        options,
      ),
    ).toThrow(/must differ/i);
  });
});
