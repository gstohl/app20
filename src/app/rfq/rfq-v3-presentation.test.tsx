import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RfqActiveCard from "./RfqActiveCard";
import RfqFinalReview, {
  type RfqFinalReviewV3DisplayTerms,
} from "./RfqFinalReview";
import { takeAuthorizationForV3Review } from "./rfq-final-review";
import { createRfqLifecycleRecord } from "./rfq-lifecycle";

const NOW = 2_000_000_000;
const DIGEST = `0x${"44".repeat(32)}`;

const coreTerms = {
  mode: "v3",
  rfqId: "0x77",
  sellAddress: "0x1",
  exactSellAmount: 1_000_000_000_000_000_000n,
  buyAddress: "0x2",
  totalBuyAmount: 2_010_000n,
  floorBuyAmount: 1_980_000n,
  fills: [
    {
      makerId: "maker-a",
      lockId: "0x41",
      amountA: 400_000_000_000_000_000n,
      amountB: 800_000n,
      lockExpiresAt: NOW + 60,
    },
    {
      makerId: "maker-b",
      lockId: "0x42",
      amountA: 600_000_000_000_000_000n,
      amountB: 1_210_000n,
      lockExpiresAt: NOW + 60,
    },
  ],
  feeBps: 0,
  app20FeeAmount: 0n,
  sellSymbol: "STRK",
  sellDecimals: 18,
  buySymbol: "USDC",
  buyDecimals: 6,
  requestDigest: DIGEST,
} as const;
const terms: RfqFinalReviewV3DisplayTerms = {
  ...coreTerms,
  takeAuthorization: takeAuthorizationForV3Review(
    coreTerms,
    "0x5",
    "0x55",
  ),
};

describe("RFQ v3 presentation", () => {
  it("binds every atomic fill, the fresh balance, fees, authority, and privacy in final review", () => {
    const markup = renderToStaticMarkup(
      <RfqFinalReview
        terms={terms}
        snapshot={{
          account: "0xabc",
          chainId: "0x1",
          walletRail: "ready",
          observedAt: NOW,
          shieldedBalance: 2_000_000_000_000_000_000n,
        }}
        blockers={[]}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );

    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("Final atomic Take review");
    expect(markup).toContain("2-maker atomic split");
    expect(markup).toContain("maker-a");
    expect(markup).toContain("maker-b");
    expect(markup).toContain("Copy Lock ID 0x41");
    expect(markup).toContain("Copy Lock ID 0x42");
    expect(markup).toContain("2.01 USDC");
    expect(markup).toContain("0 bps · 0 base units");
    expect(markup).toContain("Fresh private sell balance");
    expect(markup).toContain("exact on-chain Take record");
    expect(markup).toContain("Losing makers saw only the fixed size bucket");
    expect(markup).toContain("Take atomically on LOCALNET");
    expect(markup).toContain("Decline locked quotes");
  });

  it("disables Take and announces exact blockers", () => {
    const markup = renderToStaticMarkup(
      <RfqFinalReview
        terms={terms}
        blockers={["A reviewed lock expired."]}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("A reviewed lock expired.");
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*>Take atomically on/,
    );
  });

  it("renders v3 active rows as Take records while preserving exact fill evidence", () => {
    const record = createRfqLifecycleRecord({
      mode: "v3",
      chainId: "0x1",
      account: "0xabc",
      rfqId: "0x77",
      state: "reviewing",
      now: NOW,
      requestDigest: DIGEST,
      terms: {
        pairId: "STRK_USDC",
        sellSymbol: "STRK",
        sellAddress: "0x1",
        sellDecimals: 18,
        sellAmount: terms.exactSellAmount.toString(),
        buySymbol: "USDC",
        buyAddress: "0x2",
        buyDecimals: 6,
        minBuyAmount: terms.floorBuyAmount.toString(),
        buyAmount: terms.totalBuyAmount.toString(),
        rfqExpiresAt: NOW + 60,
      },
      settlement: {
        version: "Localnet V3",
        escrowAddress: "0x5",
        dealId: "0x77",
        deadline: NOW + 60,
      },
      bucket: {
        min: "500000000000000000",
        max: "1000000000000000000",
      },
      takerCommitment:
        "0x746db56abc4d9fab4832ee42e92e96bbbf8cf4c9fd063b8515bda90d1e8aa5d",
      takerSigningKey: "0x66",
      fills: terms.fills.map((fill) => ({
        makerId: fill.makerId,
        lockId: fill.lockId,
        amountA: fill.amountA.toString(),
        amountB: fill.amountB.toString(),
        lockExpiresAt: fill.lockExpiresAt,
      })),
    });
    const markup = renderToStaticMarkup(
      <RfqActiveCard
        record={record}
        now={NOW}
        onAction={() => undefined}
      />,
    );

    expect(markup).toContain("Ready for final Take review");
    expect(markup).toContain("RFQ v3 · atomic Take");
    expect(markup).toContain("Size bucket: 0.5–1 STRK");
    expect(markup).toContain("maker-a · lock");
    expect(markup).toContain("Take transaction:");
    expect(markup).toContain("Review atomic Take");
    expect(markup).toContain(
      "Open a fresh balance-bound final review before any wallet submission.",
    );
    expect(markup).not.toContain("Maker fill");
    expect(markup).not.toContain("Reservation release");

    const terminalMarkup = renderToStaticMarkup(
      <RfqActiveCard
        record={{
          ...record,
          state: "expired",
          reason: "take-reverted",
          takerSigningKey: undefined,
        }}
        now={NOW}
      />,
    );
    expect(terminalMarkup).toContain(
      "This RFQ is terminal and cannot be resubmitted",
    );
  });
});
