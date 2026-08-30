import { describe, expect, it } from "vitest";
import {
  RFQ_APP20_FEE_BPS,
  RFQ_FULL_FILL_ONLY,
  RFQ_MAX_MAKER_SPREAD_BPS,
  RFQ_MAX_QUOTE_TTL_SECONDS,
  RFQ_MAX_TOTAL_DEVIATION_BPS,
  RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS,
  RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS,
  RFQ_PER_TRADE_CAP_USDC_BASE_UNITS,
  RFQ_PUBLIC_NETWORKS_ENABLED,
  RFQ_REFERENCE_REJECT_AGE_SECONDS,
  RFQ_REFERENCE_SUSPEND_AGE_SECONDS,
  RFQ_REVIEWED_BUY_TOKEN_DECIMALS,
  RFQ_REVIEWED_BUY_TOKEN_ID,
  RFQ_REVIEWED_MARKET_ID,
  RFQ_REVIEWED_SELL_TOKEN_DECIMALS,
  RFQ_REVIEWED_SELL_TOKEN_ID,
  RFQ_SINGLE_MAKER_CONCENTRATION_BPS,
  evaluateRfqEconomicPolicy,
  type RfqEconomicPolicyInput,
} from "./economic-policy.js";

const now = 2_000_000_000;
const dayStart = now - 3_600;
const sellAmount = 100n * 10n ** 18n;
const referenceBuyAmount = RFQ_PER_TRADE_CAP_USDC_BASE_UNITS;

function input(
  overrides: Partial<RfqEconomicPolicyInput> = {},
): RfqEconomicPolicyInput {
  return {
    action: "quote",
    network: "localnet",
    decisionAt: now,
    market: { marketId: RFQ_REVIEWED_MARKET_ID, state: "active" },
    reference: {
      available: true,
      marketId: RFQ_REVIEWED_MARKET_ID,
      observedAt: now - RFQ_REFERENCE_REJECT_AGE_SECONDS,
      sellTokenId: RFQ_REVIEWED_SELL_TOKEN_ID,
      sellTokenDecimals: RFQ_REVIEWED_SELL_TOKEN_DECIMALS,
      buyTokenId: RFQ_REVIEWED_BUY_TOKEN_ID,
      buyTokenDecimals: RFQ_REVIEWED_BUY_TOKEN_DECIMALS,
      grossSellAmountBaseUnits: sellAmount,
      grossBuyAmountBaseUnits: referenceBuyAmount,
    },
    proposal: {
      marketId: RFQ_REVIEWED_MARKET_ID,
      makerId: "maker-a",
      sellTokenId: RFQ_REVIEWED_SELL_TOKEN_ID,
      sellTokenDecimals: RFQ_REVIEWED_SELL_TOKEN_DECIMALS,
      buyTokenId: RFQ_REVIEWED_BUY_TOKEN_ID,
      buyTokenDecimals: RFQ_REVIEWED_BUY_TOKEN_DECIMALS,
      requestedSellAmountBaseUnits: sellAmount,
      offeredSellAmountBaseUnits: sellAmount,
      offeredBuyAmountBaseUnits:
        (referenceBuyAmount * BigInt(10_000 - RFQ_MAX_MAKER_SPREAD_BPS)) /
        10_000n,
      usdcEquivalentBaseUnits: referenceBuyAmount,
      makerSpreadBps: RFQ_MAX_MAKER_SPREAD_BPS,
      app20FeeBps: RFQ_APP20_FEE_BPS,
      quoteTtlSeconds: RFQ_MAX_QUOTE_TTL_SECONDS,
    },
    accounting: {
      windowId: "risk-day-2026-01-01",
      marketId: RFQ_REVIEWED_MARKET_ID,
      makerId: "maker-a",
      startsAt: dayStart,
      endsAt: dayStart + 86_400,
      observedAt: now,
      makerCommittedUsdcBaseUnits: 5_000_000_000n,
      marketCommittedUsdcBaseUnits: 15_000_000_000n,
    },
    ...overrides,
  };
}

function codes(value: unknown): string[] {
  return evaluateRfqEconomicPolicy(value).reasons.map((item) => item.code);
}

function proposalWith(
  base: RfqEconomicPolicyInput,
  overrides: Partial<RfqEconomicPolicyInput["proposal"]>,
): RfqEconomicPolicyInput["proposal"] {
  return { ...base.proposal, ...overrides };
}

describe("reviewed RFQ economic policy constants", () => {
  it("encodes every decided first-release value", () => {
    expect(RFQ_FULL_FILL_ONLY).toBe(true);
    expect(RFQ_APP20_FEE_BPS).toBe(0);
    expect(RFQ_MAX_MAKER_SPREAD_BPS).toBe(50);
    expect(RFQ_MAX_TOTAL_DEVIATION_BPS).toBe(100);
    expect(RFQ_MAX_QUOTE_TTL_SECONDS).toBe(90);
    expect(RFQ_PER_TRADE_CAP_USDC_BASE_UNITS).toBe(5_000_000_000n);
    expect(RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS).toBe(25_000_000_000n);
    expect(RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS).toBe(50_000_000_000n);
    expect(RFQ_SINGLE_MAKER_CONCENTRATION_BPS).toBe(6_000);
    expect(RFQ_REFERENCE_REJECT_AGE_SECONDS).toBe(300);
    expect(RFQ_REFERENCE_SUSPEND_AGE_SECONDS).toBe(900);
    expect(RFQ_PUBLIC_NETWORKS_ENABLED).toBe(false);
  });
});

describe("new request and quote enforcement", () => {
  it("accepts exact full-fill, fee, spread, TTL, and per-trade boundaries", () => {
    const quote = evaluateRfqEconomicPolicy(input());
    const request = evaluateRfqEconomicPolicy(input({ action: "request" }));
    expect(quote).toMatchObject({
      allowed: true,
      action: "quote",
      reasons: [],
      recoveryOnly: false,
    });
    expect(request.allowed).toBe(true);
    expect(Object.isFrozen(quote)).toBe(true);
    expect(Object.isFrozen(quote.reasons)).toBe(true);
  });

  it("rejects one unit beyond each fill, fee, spread, and TTL limit", () => {
    const base = input();
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, {
          offeredSellAmountBaseUnits:
            base.proposal.requestedSellAmountBaseUnits - 1n,
        }),
      }),
    ).toContain("PARTIAL_FILL_REFUSED");
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, { app20FeeBps: RFQ_APP20_FEE_BPS + 1 }),
      }),
    ).toContain("APP20_FEE_REFUSED");
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, {
          offeredBuyAmountBaseUnits:
            (referenceBuyAmount * BigInt(10_000 - RFQ_MAX_MAKER_SPREAD_BPS)) /
              10_000n -
            1n,
        }),
      }),
    ).toContain("MAKER_SPREAD_EXCEEDED");
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, {
          quoteTtlSeconds: RFQ_MAX_QUOTE_TTL_SECONDS + 1,
        }),
      }),
    ).toContain("QUOTE_TTL_EXCEEDED");
  });

  it("computes total deviation at the exact 100 bps boundary", () => {
    const base = input();
    const exact = (referenceBuyAmount * 10_100n) / 10_000n;
    const boundary = evaluateRfqEconomicPolicy({
      ...base,
      proposal: proposalWith(base, {
        offeredBuyAmountBaseUnits: exact,
        makerSpreadBps: 0,
      }),
    });
    expect(boundary.allowed).toBe(true);
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, {
          offeredBuyAmountBaseUnits: exact + 1n,
          makerSpreadBps: 0,
        }),
      }),
    ).toContain("TOTAL_DEVIATION_EXCEEDED");
  });

  it("rejects a forged self-reported maker spread", () => {
    const base = input();
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, { makerSpreadBps: 0 }),
      }),
    ).toContain("MAKER_SPREAD_MISMATCH");
  });

  it("binds reference and proposal to identical tokens, decimals, and sell quantity", () => {
    const base = input();
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, { buyTokenId: "FAKE_USDC" }),
      }),
    ).toContain("TOKEN_BINDING_MISMATCH");
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, {
          buyTokenDecimals: RFQ_REVIEWED_BUY_TOKEN_DECIMALS - 1,
        }),
      }),
    ).toContain("TOKEN_DECIMALS_MISMATCH");
    expect(
      codes({
        ...base,
        reference: {
          ...base.reference,
          available: true,
          grossSellAmountBaseUnits: sellAmount + 1n,
        },
      }),
    ).toContain("REFERENCE_QUANTITY_MISMATCH");
  });

  it("rejects forged USDC equivalents and derives the cap from reference units", () => {
    const base = input();
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, { usdcEquivalentBaseUnits: 1n }),
      }),
    ).toContain("USDC_EQUIVALENT_MISMATCH");

    const overCap = referenceBuyAmount + 1n;
    const overCapReference = {
      ...base.reference,
      available: true as const,
      grossBuyAmountBaseUnits: overCap,
    };
    const result = codes({
      ...base,
      reference: overCapReference,
      proposal: proposalWith(base, {
        offeredBuyAmountBaseUnits: overCap,
        usdcEquivalentBaseUnits: 1n,
        makerSpreadBps: 0,
      }),
    });
    expect(result).toEqual(
      expect.arrayContaining([
        "USDC_EQUIVALENT_MISMATCH",
        "PER_TRADE_CAP_EXCEEDED",
      ]),
    );
  });

  it("enforces maker and market daily caps at exactly one base unit over", () => {
    const base = input();
    const exact = evaluateRfqEconomicPolicy({
      ...base,
      accounting: {
        ...base.accounting,
        makerCommittedUsdcBaseUnits:
          RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS - referenceBuyAmount,
        marketCommittedUsdcBaseUnits:
          RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS - referenceBuyAmount,
      },
    });
    expect(exact.allowed).toBe(true);

    expect(
      codes({
        ...base,
        accounting: {
          ...base.accounting,
          makerCommittedUsdcBaseUnits:
            RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS - referenceBuyAmount + 1n,
          marketCommittedUsdcBaseUnits:
            RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS - referenceBuyAmount,
        },
      }),
    ).toContain("PER_MAKER_DAILY_CAP_EXCEEDED");
    expect(
      codes({
        ...base,
        accounting: {
          ...base.accounting,
          makerCommittedUsdcBaseUnits:
            RFQ_PER_MAKER_DAILY_CAP_USDC_BASE_UNITS - referenceBuyAmount,
          marketCommittedUsdcBaseUnits:
            RFQ_PER_MARKET_DAILY_CAP_USDC_BASE_UNITS - referenceBuyAmount + 1n,
        },
      }),
    ).toContain("PER_MARKET_DAILY_CAP_EXCEEDED");
  });

  it("allows exactly 60% concentration and rejects one base unit above", () => {
    const base = input();
    const exact = evaluateRfqEconomicPolicy({
      ...base,
      accounting: {
        ...base.accounting,
        makerCommittedUsdcBaseUnits: 1_000_000_000n,
        marketCommittedUsdcBaseUnits: 5_000_000_000n,
      },
    });
    expect(exact.allowed).toBe(true);

    const over = evaluateRfqEconomicPolicy({
      ...base,
      accounting: {
        ...base.accounting,
        makerCommittedUsdcBaseUnits: 1_000_000_001n,
        marketCommittedUsdcBaseUnits: 5_000_000_000n,
      },
    });
    expect(over.allowed).toBe(false);
    expect(
      codes({
        ...base,
        accounting: {
          ...base.accounting,
          makerCommittedUsdcBaseUnits: 1_000_000_001n,
          marketCommittedUsdcBaseUnits: 5_000_000_000n,
        },
      }),
    ).toContain("SINGLE_MAKER_CONCENTRATION_EXCEEDED");
  });

  it("rejects absent, malformed, or stale accounting instead of guessing", () => {
    const base = input();
    expect(codes({ ...base, accounting: undefined })).toContain(
      "ACCOUNTING_UNAVAILABLE",
    );
    expect(
      codes({
        ...base,
        accounting: { ...base.accounting, endsAt: base.accounting.endsAt - 1 },
      }),
    ).toContain("ACCOUNTING_MALFORMED");
    expect(
      codes({
        ...base,
        accounting: { ...base.accounting, observedAt: base.decisionAt - 1 },
      }),
    ).toContain("ACCOUNTING_STALE");
  });
});

describe("fail-closed reference and lifecycle behavior", () => {
  it("uses exact reject and suspension age boundaries", () => {
    const base = input();
    expect(evaluateRfqEconomicPolicy(base).allowed).toBe(true);
    expect(
      codes({
        ...base,
        reference: {
          ...base.reference,
          available: true,
          observedAt: now - RFQ_REFERENCE_REJECT_AGE_SECONDS - 1,
        },
      }),
    ).toContain("REFERENCE_STALE");
    const exactlySuspendAge = codes({
      ...base,
      reference: {
        ...base.reference,
        available: true,
        observedAt: now - RFQ_REFERENCE_SUSPEND_AGE_SECONDS,
      },
    });
    expect(exactlySuspendAge).toContain("REFERENCE_STALE");
    expect(exactlySuspendAge).not.toContain("REFERENCE_SUSPENSION_REQUIRED");
    expect(
      codes({
        ...base,
        reference: {
          ...base.reference,
          available: true,
          observedAt: now - RFQ_REFERENCE_SUSPEND_AGE_SECONDS - 1,
        },
      }),
    ).toContain("REFERENCE_SUSPENSION_REQUIRED");
  });

  it("fails closed without throwing on missing, malformed, or public-network inputs", () => {
    expect(() => evaluateRfqEconomicPolicy(null)).not.toThrow();
    expect(codes(null)).toEqual(["ACTION_UNSUPPORTED"]);
    const missing = evaluateRfqEconomicPolicy({ action: "quote" });
    expect(missing.allowed).toBe(false);
    expect(missing.reasons.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "PUBLIC_NETWORK_DISABLED",
        "DECISION_TIME_MALFORMED",
        "MARKET_STATE_UNAVAILABLE",
        "REFERENCE_UNAVAILABLE",
        "PROPOSAL_UNAVAILABLE",
        "ACCOUNTING_UNAVAILABLE",
      ]),
    );
    const base = input();
    expect(codes({ ...base, network: "starknet:SN_MAIN" })).toContain(
      "PUBLIC_NETWORK_DISABLED",
    );
    expect(
      codes({
        ...base,
        proposal: proposalWith(base, { usdcEquivalentBaseUnits: 1 as never }),
      }),
    ).toContain("PROPOSAL_MALFORMED");
  });

  it("classifies recovery as non-authorizing without a persisted reservation", () => {
    for (const action of ["claim", "timeout", "refund"] as const) {
      const bare = evaluateRfqEconomicPolicy({ action });
      expect(bare).toMatchObject({
        allowed: false,
        action,
        recoveryOnly: true,
      });
      expect(bare.reasons.map((item) => item.code)).toEqual(
        expect.arrayContaining([
          "PUBLIC_NETWORK_DISABLED",
          "DECISION_TIME_MALFORMED",
          "RECOVERY_REQUIRES_PERSISTED_RESERVATION",
        ]),
      );

      const publicNetwork = evaluateRfqEconomicPolicy({
        action,
        network: "starknet:SN_MAIN",
        decisionAt: now,
      });
      expect(publicNetwork.allowed).toBe(false);
      expect(publicNetwork.reasons.map((item) => item.code)).toContain(
        "PUBLIC_NETWORK_DISABLED",
      );

      const local = evaluateRfqEconomicPolicy({
        action,
        network: "localnet",
        decisionAt: now,
      });
      expect(local.allowed).toBe(false);
      expect(local.reasons.map((item) => item.code)).toEqual([
        "RECOVERY_REQUIRES_PERSISTED_RESERVATION",
      ]);
    }
  });
});
