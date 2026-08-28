import { describe, expect, it } from "vitest";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  fundingTicketAttemptTargetFromLifecycle,
} from "./rfq-lifecycle";
import { localnetResumeDecision } from "./localnet-resume-controller";
import {
  prepareFundedSettlementExpiry,
  preparePreFundingReservationRelease,
} from "./localnet-release-recovery";

const NOW = 1_900_000_000;
function record(
  state: Parameters<typeof createRfqLifecycleRecord>[0]["state"],
) {
  return createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x1",
    state,
    now: NOW,
    requestDigest: `0x${"ab".repeat(32)}`,
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
      rfqExpiresAt: NOW + 20,
    },
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-a",
      solverKey: "key-a",
      nonce: "nonce-a",
      reservationId: `0x${"bc".repeat(32)}`,
      spreadBps: 20,
      pricingProvenance: "fixture",
      quotedAt: NOW,
      quoteExpiresAt: NOW + 10,
      reservationExpiresAt: NOW + 15,
      buyAmount: "199",
      intentDigest: `0x${"ab".repeat(32)}`,
      signature: "signature-a",
      reservationFence: "7",
      quoteDigest: `0x${"cd".repeat(32)}`,
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x2",
      dealId: "0x1",
      ticketAddress: "0x4",
      deadline: NOW + 20,
    },
  });
}

describe("localnet resume controller", () => {
  it("never offers a duplicate fund while an attempt is unknown", () => {
    const reviewing = record("reviewing");
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "attempt-1",
      NOW + 1,
      fundingTicketAttemptTargetFromLifecycle(reviewing),
    );
    expect(localnetResumeDecision(preparing, NOW + 2)).toMatchObject({
      action: "verify-funding",
      label: "Check pre-submission funding lease",
    });
  });

  it("offers fill rather than fund for a confirmed funded record", () => {
    expect(localnetResumeDecision(record("funded"), NOW + 1).action).toBe(
      "request-maker-fill",
    );
  });

  it("exposes only a user-triggered exact retry for persisted preparing fill", () => {
    const pending = beginRfqPhaseAttempt(
      record("funded"),
      "fill",
      "fill-exact",
      NOW + 1,
      {
        operation: "maker-fill",
        chainId: "0x1",
        account: "0xabc",
        rfqId: "0x1",
        requestDigest: `0x${"ab".repeat(32)}`,
        dealId: "0x1",
        solverId: "maker-a",
        reservationId: `0x${"bc".repeat(32)}`,
        reservationFence: "7",
        quoteDigest: `0x${"cd".repeat(32)}`,
        sellToken: "0x1",
        sellAmount: "100",
        buyToken: "0x2",
        buyAmount: "199",
        deadline: NOW + 20,
        ticketAddress: "0x4",
      },
    );
    expect(localnetResumeDecision(pending, NOW + 2)).toMatchObject({
      action: "retry-maker-fill",
      label: "Retry exact maker-fill request",
      disabled: false,
    });
  });

  it("offers refund only after explicit observed-expiry state", () => {
    expect(
      localnetResumeDecision(
        {
          ...record("funded"),
          settlement: { ...record("funded").settlement!, deadline: NOW },
        },
        NOW + 1,
      ).action,
    ).toBe("observe-expiry");
    expect(localnetResumeDecision(record("refundable"), NOW + 1).action).toBe(
      "refund",
    );
    expect(
      localnetResumeDecision(record("refundable"), NOW + 1).action,
    ).not.toBe("claim");
  });

  it("distinguishes funded expiry from request-backed release without allocating a retry", () => {
    const funded = prepareFundedSettlementExpiry(
      record("funded"),
      "expiry-1",
      NOW + 1,
    );
    const requestBacked = preparePreFundingReservationRelease(
      createRfqLifecycleRecord({
        chainId: "0x1",
        account: "0xabc",
        rfqId: "0x2",
        state: "cancel-pending",
        now: NOW,
        requestDigest: `0x${"ab".repeat(32)}`,
      }),
      "release-1",
      NOW + 1,
    );
    expect(localnetResumeDecision(funded, NOW + 2)).toMatchObject({
      action: "verify-reservation-release",
      label: "Verify funded settlement expiry",
      disabled: false,
    });
    expect(localnetResumeDecision(requestBacked, NOW + 2)).toMatchObject({
      action: "verify-reservation-release",
      label: "Verify request reservation release",
      disabled: false,
    });
  });

  it("offers explicit coordinator release for ambiguous and restored requests", () => {
    expect(localnetResumeDecision(record("requesting"), NOW)).toMatchObject({
      action: "release-request-reservations",
      disabled: false,
    });
    expect(localnetResumeDecision(record("quoted"), NOW)).toMatchObject({
      action: "decline-and-release",
      disabled: false,
    });
    expect(localnetResumeDecision(record("reviewing"), NOW)).toMatchObject({
      action: "decline-and-release",
      disabled: false,
    });
  });

  it("requires coordinator release after pre-funding expiry and permits fresh quotes only after refusal", () => {
    expect(
      localnetResumeDecision(
        { ...record("expired"), settlement: undefined },
        NOW,
      ).action,
    ).toBe("release-request-reservations");
    expect(localnetResumeDecision(record("refused"), NOW).action).toBe(
      "request-fresh-quotes",
    );
  });

  it("makes an exact pre-funding quarantine actionable without dropping its fence", () => {
    expect(
      localnetResumeDecision(
        { ...record("quarantined"), settlement: undefined },
        NOW,
      ),
    ).toMatchObject({
      action: "release-request-reservations",
      disabled: false,
    });
    expect(
      localnetResumeDecision(
        {
          ...record("quarantined"),
          requestDigest: undefined,
          settlement: undefined,
        },
        NOW,
      ),
    ).toMatchObject({ action: "none", disabled: true });
  });
});
