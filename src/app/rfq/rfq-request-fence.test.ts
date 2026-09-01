import { describe, expect, it } from "vitest";
import {
  createRfqLifecycleRecord,
  type RfqLifecycleRecord,
  type RfqLifecycleState,
} from "./rfq-lifecycle";
import { sameMarketRequestFence } from "./rfq-request-fence";

const NOW = 1_900_000_000;
const PAIR = "STRK_USDC";

function record(
  state: RfqLifecycleState,
  patch: Partial<RfqLifecycleRecord> = {},
): RfqLifecycleRecord {
  return {
    ...createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "0x77",
      state,
      now: NOW,
      requestDigest: "0x1234",
      terms: {
        pairId: PAIR,
        sellSymbol: "STRK",
        sellAddress: "0x1",
        sellDecimals: 18,
        sellAmount: "100",
        buySymbol: "USDC",
        buyAddress: "0x2",
        buyDecimals: 6,
        minBuyAmount: "190",
        rfqExpiresAt: NOW + 600,
      },
    }),
    ...patch,
  };
}

describe("same-market RFQ request fence", () => {
  it.each([
    "requesting",
    "quoted",
    "reviewing",
    "submission-unknown",
    "funded",
    "cancel-pending",
    "expired",
    "quarantined",
  ] as const)("fences an unresolved %s record on the same market", (state) => {
    expect(sameMarketRequestFence([record(state)], PAIR)).toMatch(
      /unresolved/i,
    );
    expect(
      sameMarketRequestFence([record(state)], "USDC_STRK"),
    ).toBeUndefined();
  });

  it.each([
    "filled",
    "claimable",
    "settled",
    "refundable",
    "refunded",
    "refused",
    "cancelled",
  ] as const)("does not fence a completed %s record", (state) => {
    expect(sameMarketRequestFence([record(state)], PAIR)).toBeUndefined();
  });

  it("fails closed on a malformed quarantined row that lost its market identity", () => {
    const malformed = record("quarantined", {
      terms: undefined,
      requestDigest: undefined,
    });
    expect(sameMarketRequestFence([malformed], "USDC_STRK")).toMatch(
      /unresolved/i,
    );
  });

  it("keeps a server-derived incomplete record fenced until settlement or refund", () => {
    const derived = record("funded", {
      recoverySource: "server-derived",
      terms: {
        ...record("funded").terms!,
        minBuyAmount: undefined,
      },
    });
    expect(sameMarketRequestFence([derived], PAIR)).toMatch(/unresolved/i);
    expect(
      sameMarketRequestFence(
        [record("settled", { recoverySource: "server-derived" })],
        PAIR,
      ),
    ).toBeUndefined();
  });

  it("fences an expired record whose reservation release is still unknown", () => {
    const expired = record("expired", {
      attempts: {
        "reservation-release": {
          attemptId: "release-1",
          state: "submitted-unknown",
          createdAt: NOW + 1,
          updatedAt: NOW + 1,
          transactionHash: "0xrel",
        },
      },
    });
    expect(sameMarketRequestFence([expired], PAIR)).toMatch(/unresolved/i);
  });
});
