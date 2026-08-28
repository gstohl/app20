import { describe, expect, it } from "vitest";
import { Strk20WalletSubmissionUnknownError } from "@/lib/strk20";
import { applyLocalnetFundingFailureEvidence } from "./localnet-funding-failure-recovery";
import {
  LocalnetFundingKnownNotSubmittedError,
  LocalnetFundingPrewalletRecoveryPendingError,
} from "./localnet-funding-orchestration";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  fundingTicketAttemptTargetFromLifecycle,
} from "./rfq-lifecycle";

const NOW = 1_900_000_000;

function reviewing(withAttempt = true) {
  const record = createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "reviewing",
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
      nonce: "consumed-nonce",
      reservationId: `0x${"22".repeat(32)}`,
      spreadBps: 20,
      pricingProvenance: "fixture",
      quotedAt: NOW,
      quoteExpiresAt: NOW + 60,
      reservationExpiresAt: NOW + 90,
      buyAmount: "200",
      intentDigest: `0x${"11".repeat(32)}`,
      signature: "signature-a",
      quoteDigest: `0x${"33".repeat(32)}`,
      reservationFence: "7",
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x3",
      dealId: "0x77",
      deadline: NOW + 600,
    },
  });
  return withAttempt
    ? beginRfqPhaseAttempt(
        record,
        "funding",
        "fund-exact",
        NOW + 1,
        fundingTicketAttemptTargetFromLifecycle(record),
      )
    : record;
}

describe("Desk funding catch state seam", () => {
  it("marks confirmed pre-wallet abandonment safe and requires request-wide release", () => {
    const result = applyLocalnetFundingFailureEvidence(
      reviewing(),
      new LocalnetFundingKnownNotSubmittedError(
        new Error("prepare responses lost then abandonment confirmed"),
        "lease-abandoned",
      ),
      NOW + 2,
    );
    expect(result).toMatchObject({
      releaseRequired: true,
      verificationOnly: false,
      record: {
        state: "reviewing",
        attempts: {
          funding: {
            state: "reverted",
            walletBoundary: "not-entered",
          },
        },
      },
    });
  });

  it("keeps repeated lost abandonment responses preparing and verification-only", () => {
    const original = reviewing();
    const result = applyLocalnetFundingFailureEvidence(
      original,
      new LocalnetFundingPrewalletRecoveryPendingError(
        new Error("second abandonment response lost"),
      ),
      NOW + 2,
    );
    expect(result).toEqual({
      record: original,
      releaseRequired: false,
      verificationOnly: true,
    });
    expect(result.record.attempts.funding).toMatchObject({
      state: "preparing",
    });
    expect(result.record.attempts.funding?.walletBoundary).toBeUndefined();
  });

  it("persists hashless wallet-boundary evidence without throwing", () => {
    expect(() =>
      applyLocalnetFundingFailureEvidence(
        reviewing(),
        new Strk20WalletSubmissionUnknownError(
          new Error("wallet rejected without hash"),
        ),
        NOW + 2,
      ),
    ).not.toThrow();
    const result = applyLocalnetFundingFailureEvidence(
      reviewing(),
      new Strk20WalletSubmissionUnknownError(
        new Error("wallet rejected without hash"),
      ),
      NOW + 2,
    );
    expect(result).toMatchObject({
      releaseRequired: false,
      verificationOnly: true,
      record: {
        state: "submission-unknown",
        attempts: {
          funding: {
            state: "wallet-boundary-unknown",
            walletBoundary: "entered",
          },
        },
      },
    });
    expect(result.record.attempts.funding?.transactionHash).toBeUndefined();
  });

  it("keeps local-preparation failure attempt-free while requiring release/requote", () => {
    const record = reviewing(false);
    const result = applyLocalnetFundingFailureEvidence(
      record,
      new LocalnetFundingKnownNotSubmittedError(
        new Error("nonce storage failed"),
        "no-attempt",
      ),
      NOW + 2,
    );
    expect(result.releaseRequired).toBe(true);
    expect(result.record).toBe(record);
    expect(result.record.attempts.funding).toBeUndefined();
  });
});
