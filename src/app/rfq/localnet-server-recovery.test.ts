import { describe, expect, it } from "vitest";
import { restoreRfqLifecycle } from "./rfq-lifecycle";
import { sameMarketRequestFence } from "./rfq-request-fence";
import { localnetResumeDecision } from "./localnet-resume-controller";
import { rebuildServerDerivedRfqRecord } from "./localnet-server-recovery";
import type { LocalnetServerRecoveryDeal } from "./localnet-private-intents";

const NOW = 1_900_000_000;
const ACCOUNT = "0xa11ce";
const CHAIN = "0x123";
const STRK = "0x1";
const USDC = "0x2";
const deal: LocalnetServerRecoveryDeal = {
  source: "localnet-coordinator-and-chain",
  authority: "server-derived-resume-only",
  account: ACCOUNT,
  chainId: CHAIN,
  market: `${STRK}/${USDC}`,
  rfqId: "0x77",
  dealId: "0x77",
  intentDigest: `0x${"11".repeat(32)}`,
  createdAt: NOW - 10,
  expiresAt: NOW + 600,
  fundingAttemptId: "fund-attempt",
  selection: {
    solverId: "maker-a",
    reservationId: `0x${"22".repeat(32)}`,
    reservationFence: "7",
    quoteDigest: `0x${"33".repeat(32)}`,
  },
  terms: {
    sellToken: STRK,
    sellAmount: "100",
    buyToken: USDC,
    buyAmount: "99",
    deadline: NOW + 600,
    ticketAddress: "0x44",
  },
  observation: {
    status: 2,
    legAToken: STRK,
    legAAmount: "100",
    legBToken: USDC,
    legBTerms: "99",
    legBAmount: "99",
    deadline: NOW + 600,
    ticket: "0x44",
  },
  escrowAddress: "0xe5c",
};
const context = {
  account: ACCOUNT,
  chainId: CHAIN,
  now: NOW,
  markets: [
    {
      pairId: "STRK_USDC" as const,
      sell: { symbol: "STRK" as const, address: STRK, decimals: 18 as const },
      buy: { symbol: "USDC" as const, address: USDC, decimals: 6 as const },
    },
  ],
};

describe("localnet server-derived recovery", () => {
  it("restores a floor-less non-authoritative claim recovery row without submitting", () => {
    const rebuilt = rebuildServerDerivedRfqRecord(deal, context);
    expect(rebuilt.terms).not.toHaveProperty("minBuyAmount");
    const record = restoreRfqLifecycle(rebuilt, {
      chainId: CHAIN,
      account: ACCOUNT,
      now: NOW,
    });
    expect(record).toMatchObject({
      state: "claimable",
      recoverySource: "server-derived",
      evidenceAuthority: { status: "local-non-authoritative" },
      attempts: {
        funding: { attemptId: "fund-attempt", state: "confirmed" },
        fill: { state: "confirmed" },
      },
    });
    expect(record.reason).toMatch(
      /original browser quote presentation was not recovered/i,
    );
    expect(record.selectedQuote?.signature).toBe("server-derived-unavailable");
    expect(localnetResumeDecision(record, NOW).action).toBe("claim");
    expect(localnetResumeDecision(record, NOW).action).not.toBe(
      "accept-and-fund",
    );
    expect(sameMarketRequestFence([record], "STRK_USDC")).toMatch(
      /unresolved/i,
    );
  });

  it("restores a floor-less funded row onto the explicit timeout-refund path", () => {
    const fundedDeal = {
      ...deal,
      observation: { ...deal.observation, status: 1, legBAmount: "0" },
    } satisfies LocalnetServerRecoveryDeal;
    const record = restoreRfqLifecycle(
      rebuildServerDerivedRfqRecord(fundedDeal, {
        ...context,
        now: deal.expiresAt + 1,
      }),
      { chainId: CHAIN, account: ACCOUNT, now: deal.expiresAt + 1 },
    );

    expect(record.state).toBe("funded");
    expect(record.terms).not.toHaveProperty("minBuyAmount");
    expect(localnetResumeDecision(record, deal.expiresAt + 1).action).toBe(
      "observe-expiry",
    );
  });

  it("still quarantines a non-server row that overloads a zero minimum", () => {
    const rebuilt = rebuildServerDerivedRfqRecord(deal, context);
    const malformed = {
      ...rebuilt,
      recoverySource: undefined,
      terms: { ...rebuilt.terms!, minBuyAmount: "0" },
    };
    const restored = restoreRfqLifecycle(malformed, {
      chainId: CHAIN,
      account: ACCOUNT,
      now: NOW,
    });

    expect(restored.state).toBe("quarantined");
    expect(restored.reason).toMatch(/malformed local resume record/i);
  });

  it("rejects a projection for a different wallet or unsupported direction", () => {
    expect(() =>
      rebuildServerDerivedRfqRecord(deal, { ...context, account: "0xb0b" }),
    ).toThrow(/wallet context/i);
    expect(() =>
      rebuildServerDerivedRfqRecord(
        { ...deal, terms: { ...deal.terms, sellToken: "0x9" } },
        context,
      ),
    ).toThrow(/unsupported local market/i);
  });
});
