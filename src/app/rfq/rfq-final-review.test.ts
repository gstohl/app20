import { describe, expect, it } from "vitest";
import {
  validateFinalReview,
  validateLiveV3FinalReview,
  validateV3FinalReview,
  type RfqFinalReviewTerms,
} from "./rfq-final-review";

const terms: RfqFinalReviewTerms = {
  rfqId: "rfq",
  quoteDigest: "quote-digest",
  intentDigest: "intent-digest",
  quoteNonce: "nonce",
  reservationId: "reservation",
  makerId: "maker-a",
  makerKeyId: "key-a",
  sellSymbol: "STRK",
  sellAddress: "0x1",
  sellDecimals: 18,
  sellAmount: 10n,
  buySymbol: "USDC",
  buyAddress: "0x2",
  buyDecimals: 6,
  buyAmount: 20n,
  minBuyAmount: 19n,
  referenceGrossBuyAmount: 21n,
  perTradeCapBaseUnits: 100n,
  maximumTotalDeviationBps: 100,
  maximumMakerSpreadBps: 50,
  economicPolicyId: "fixture-economics-v1",
  app20FeePolicyId: "app20/localnet-app20-fee/zero-fixture-v1",
  app20FeeAmount: 0n,
  spreadBps: 30,
  quoteExpiresAt: 200,
  reservationExpiresAt: 250,
  settlementExpiresAt: 300,
  registryRevision: "registry-v1",
  requiresMatureNote: true,
};
const initial = {
  account: "0xabc",
  chainId: "0x1",
  walletRail: "ready",
  observedAt: 100,
  publicFeeBalance: 30n,
  poolFee: 30n,
  poolAddress: "0x123",
  shieldedBalance: 20n,
  shieldedMature: true,
};

describe("RFQ final review", () => {
  it("accepts an unchanged fresh snapshot", () => {
    expect(
      validateFinalReview({ initial, current: initial, terms, now: 150 }),
    ).toEqual({ ok: true, blockers: [] });
  });
  it("blocks drift, expiry, fee changes, and missing maturity without an override", () => {
    const result = validateFinalReview({
      initial,
      current: {
        ...initial,
        account: "0xdef",
        poolFee: 31n,
        shieldedMature: undefined,
      },
      terms,
      now: 201,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.join(" ")).toMatch(
      /account changed|quote expired|pool fee changed|maturity/i,
    );
  });
  it.each([29n, 30n, 31n])(
    "requires public fee balance to cover the pool fee (%s)",
    (publicFeeBalance) => {
      const result = validateFinalReview({
        initial: { ...initial, publicFeeBalance },
        current: { ...initial, publicFeeBalance },
        terms,
        now: 150,
      });
      expect(result.ok).toBe(publicFeeBalance >= 30n);
      expect(result.blockers.join(" ")).toMatch(
        publicFeeBalance < 30n ? /does not cover/i : /^$/,
      );
    },
  );

  it("rejects an unsupported or non-zero APP20 fee policy", () => {
    expect(
      validateFinalReview({
        ...{ initial, current: initial, now: 150 },
        terms: { ...terms, app20FeeAmount: 1n },
      }).blockers.join(" "),
    ).toMatch(/fee policy/i);
    expect(
      validateFinalReview({
        ...{ initial, current: initial, now: 150 },
        terms: { ...terms, app20FeePolicyId: "unknown" },
      }).blockers.join(" "),
    ).toMatch(/fee policy/i);
  });

  it("does not request or infer shielded balances for feature detection", () => {
    const result = validateFinalReview({
      initial: { ...initial, shieldedBalance: undefined },
      current: { ...initial, shieldedBalance: undefined },
      terms: { ...terms, requiresMatureNote: false },
      now: 150,
    });
    expect(result.ok).toBe(true);
  });

  it("treats canonical chain aliases as the same wallet network", () => {
    const result = validateFinalReview({
      initial: { ...initial, chainId: "0x01" },
      current: { ...initial, chainId: "0x1" },
      terms,
      now: 150,
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["settlement expiry", { settlementExpiresAt: 150 }, /settlement expired/i],
    ["receive below minimum", { buyAmount: 18n }, /reviewed minimum/i],
    ["maker spread", { spreadBps: 51 }, /spread exceeds/i],
    ["per-trade cap", { sellAmount: 101n }, /per-trade cap/i],
  ] as const)(
    "blocks %s without changing an otherwise fresh snapshot",
    (_label, patch, pattern) => {
      const result = validateFinalReview({
        initial,
        current: initial,
        terms: { ...terms, ...patch },
        now: 150,
      });
      expect(result.ok).toBe(false);
      expect(result.blockers.join(" ")).toMatch(pattern);
    },
  );
});

describe("RFQ v3 final review", () => {
  const v3Terms = {
    mode: "v3" as const,
    rfqId: "0x77",
    sellAddress: "0x1",
    exactSellAmount: 100n,
    buyAddress: "0x2",
    totalBuyAmount: 200n,
    floorBuyAmount: 190n,
    fills: [
      {
        makerId: "maker-a",
        lockId: "0x41",
        amountA: 100n,
        amountB: 200n,
        lockExpiresAt: 300,
      },
    ],
    feeBps: 0,
    app20FeeAmount: 0n,
  };

  it("accepts exact fills, fresh locks, floor, balance, and zero fees", () => {
    expect(
      validateV3FinalReview({
        initial,
        current: { ...initial, shieldedBalance: 100n },
        terms: v3Terms,
        now: 150,
      }),
    ).toEqual({ ok: true, blockers: [] });
  });

  it("rereads the selected lock immediately before Take", async () => {
    await expect(
      validateLiveV3FinalReview({
        initial,
        current: { ...initial, shieldedBalance: 100n },
        terms: v3Terms,
        now: 150,
        readLock: async () => ({
          status: "open",
          tokenA: "0x1",
          tokenB: "0x2",
          rfqId: "0x77",
          takerCommitment: "0x55",
          expiry: 300,
          schedule: [{ a: 100n, b: 200n }],
          remainingB: 200n,
          earnedA: 0n,
          ticket: "0x44",
          proceedsSettled: false,
          collateralReleased: false,
        }),
      }),
    ).resolves.toEqual({ ok: true, blockers: [] });
  });

  it("blocks fill drift, expired locks, floor failure, missing balance, and fees", () => {
    const result = validateV3FinalReview({
      initial,
      current: { ...initial, shieldedBalance: undefined },
      terms: {
        ...v3Terms,
        totalBuyAmount: 180n,
        feeBps: 1,
        fills: [
          {
            ...v3Terms.fills[0]!,
            amountA: 99n,
            amountB: 180n,
            lockExpiresAt: 150,
          },
        ],
      },
      now: 150,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.join(" ")).toMatch(
      /sell amounts|lock expired|local floor|unavailable|0 bps/i,
    );
  });
});
