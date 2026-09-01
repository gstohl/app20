import { describe, expect, it } from "vitest";
import {
  Strk20RevertedError,
  Strk20WalletSubmissionUnknownError,
} from "@/lib/strk20";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
} from "../rfq-lifecycle";
import { applyLocalnetPayoutFailureEvidence } from "./payout-failure-recovery";

const NOW = 1_900_000_000;

function claimable() {
  const record = createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "claimable",
    now: NOW,
    requestDigest: `0x${"11".repeat(32)}`,
    terms: {
      pairId: "STRK_USDC",
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
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-a",
      solverKey: "key-a",
      nonce: "nonce-a",
      reservationId: `0x${"22".repeat(32)}`,
      spreadBps: 20,
      pricingProvenance: "fixture",
      quotedAt: NOW,
      quoteExpiresAt: NOW + 60,
      reservationExpiresAt: NOW + 90,
      buyAmount: "200",
      intentDigest: `0x${"11".repeat(32)}`,
      signature: "signature-a",
      reservationFence: "7",
      quoteDigest: `0x${"33".repeat(32)}`,
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x3",
      dealId: "0x77",
      ticketAddress: "0x4",
      deadline: NOW + 600,
    },
  });
  return beginRfqPhaseAttempt(record, "claim", "claim-exact", NOW + 1);
}

describe("Desk claim/refund catch state seam", () => {
  it("persists hashless wallet-boundary evidence without opening a retry", () => {
    const result = applyLocalnetPayoutFailureEvidence(
      claimable(),
      "claim",
      new Strk20WalletSubmissionUnknownError(
        new Error("wallet rejected without hash"),
      ),
      NOW + 2,
    );
    expect(result).toMatchObject({
      state: "claimable",
      attempts: {
        claim: {
          state: "wallet-boundary-unknown",
          walletBoundary: "entered",
        },
      },
    });
    expect(result.attempts.claim?.transactionHash).toBeUndefined();
  });

  it("keeps a hashed unknown claim submitted-unknown", () => {
    const result = applyLocalnetPayoutFailureEvidence(
      claimable(),
      "claim",
      new Strk20RevertedError("0xfeed"),
      NOW + 2,
    );
    expect(result.attempts.claim).toMatchObject({
      state: "reverted",
      transactionHash: "0xfeed",
    });
  });
});
