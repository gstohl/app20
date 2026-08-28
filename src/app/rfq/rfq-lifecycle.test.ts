import { describe, expect, it } from "vitest";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  lifecycleMaySubmit,
  reconcileRfqLifecycleWithLocalDeal,
  restoreRfqLifecycle,
  transitionRfqLifecycle,
  updateRfqPhaseAttempt,
} from "./rfq-lifecycle";

const NOW = 1_800_000_000;
const context = { chainId: "0x1", account: "0xabc", now: NOW };

function quoted() {
  const draft = createRfqLifecycleRecord({
    ...context,
    rfqId: "0x99",
    now: NOW - 20,
    requestDigest: "0x1234",
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
      buyAmount: "199",
      rfqExpiresAt: NOW + 120,
    },
  });
  const requesting = transitionRfqLifecycle(draft, "requesting", NOW - 19);
  return transitionRfqLifecycle(requesting, "quoted", NOW - 18, {
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-b",
      solverKey: "local-key-b",
      nonce: "nonce-1",
      reservationId: "reservation-1",
      spreadBps: 20,
      pricingProvenance: "local-fixture",
      quotedAt: NOW - 18,
      quoteExpiresAt: NOW + 60,
      reservationExpiresAt: NOW + 90,
      buyAmount: "199",
      intentDigest: "0x1234",
      signature: "0xsigned",
      quoteDigest: "0x5678",
      reservationFence: "1",
    },
    quoteExpiresAt: NOW + 60,
    reservationExpiresAt: NOW + 90,
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x3",
      dealId: "0x99",
      ticketAddress: "0x4",
      deadline: NOW + 120,
    },
  });
}

function fundingTarget(record: ReturnType<typeof quoted>) {
  return {
    operation: "funding-ticket" as const,
    chainId: record.chainId,
    account: record.account,
    rfqId: record.rfqId,
    requestDigest: record.requestDigest!,
    dealId: record.settlement!.dealId,
    solverId: record.selectedQuote!.solverId,
    reservationId: record.selectedQuote!.reservationId,
    reservationFence: record.selectedQuote!.reservationFence!,
    quoteDigest: record.selectedQuote!.quoteDigest!,
    sellToken: record.terms!.sellAddress,
    sellAmount: record.terms!.sellAmount,
    buyToken: record.terms!.buyAddress,
    buyAmount: record.selectedQuote!.buyAmount,
    deadline: record.settlement!.deadline,
  };
}

function submitted() {
  const reviewing = transitionRfqLifecycle(quoted(), "reviewing", NOW);
  const preparing = beginRfqPhaseAttempt(
    reviewing,
    "funding",
    "fund-1",
    NOW + 1,
    fundingTarget(reviewing),
  );
  const unknown = updateRfqPhaseAttempt(
    preparing,
    "funding",
    "submitted-unknown",
    NOW + 2,
    { transactionHash: "0xfeed" },
  );
  return transitionRfqLifecycle(unknown, "submission-unknown", NOW + 2);
}

function observation(status: 0 | 1 | 2 | 3 | 4) {
  return {
    dealId: "0x99",
    escrowAddress: "0x3",
    status,
    legAToken: status ? "0x1" : "0x0",
    legAAmount: status ? "100" : "0",
    legBToken: status ? "0x2" : "0x0",
    legBTerms: status ? "199" : "0",
    legBAmount: status === 2 || status === 3 ? "199" : "0",
    deadline: status ? NOW + 120 : 0,
    ticket: status ? "0x4" : "0x0",
  };
}

describe("RFQ lifecycle", () => {
  it("restores a live quote only for the bound account and chain", () => {
    expect(restoreRfqLifecycle(quoted(), context).state).toBe("quoted");
    expect(
      restoreRfqLifecycle(quoted(), { ...context, account: "0xdef" }),
    ).toMatchObject({ state: "quarantined" });
  });

  it("expires quote and reservation independently at each exact boundary", () => {
    const reviewing = transitionRfqLifecycle(quoted(), "reviewing", NOW - 1);
    expect(
      restoreRfqLifecycle(reviewing, { ...context, now: NOW + 59 }).state,
    ).toBe("reviewing");
    expect(
      restoreRfqLifecycle(reviewing, { ...context, now: NOW + 60 }).state,
    ).toBe("expired");

    const laterQuote = {
      ...reviewing,
      quoteExpiresAt: NOW + 120,
      selectedQuote: { ...reviewing.selectedQuote!, quoteExpiresAt: NOW + 120 },
    };
    expect(
      restoreRfqLifecycle(laterQuote, { ...context, now: NOW + 89 }).state,
    ).toBe("reviewing");
    const reservationExpired = restoreRfqLifecycle(laterQuote, {
      ...context,
      now: NOW + 90,
    });
    expect(reservationExpired.state).toBe("expired");
    expect(lifecycleMaySubmit(reservationExpired, NOW + 90)).toBe(false);
  });

  it("persists an attempt before submission and never permits duplicate unknown funding", () => {
    const reviewing = transitionRfqLifecycle(quoted(), "reviewing", NOW);
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "fund-1",
      NOW + 1,
      fundingTarget(reviewing),
    );
    expect(preparing.attempts.funding).toMatchObject({
      state: "preparing",
      attemptId: "fund-1",
    });
    expect(lifecycleMaySubmit(preparing, NOW + 1)).toBe(false);
    expect(() =>
      beginRfqPhaseAttempt(preparing, "funding", "fund-2", NOW + 2),
    ).toThrow(/unknown attempt/i);
    const pending = submitted();
    expect(pending).toMatchObject({
      state: "submission-unknown",
      transactionHash: "0xfeed",
    });
    expect(lifecycleMaySubmit(pending, NOW + 2)).toBe(false);
  });

  it("never reuses a consumed quote after a funding attempt", () => {
    const pending = submitted();
    const reverted = updateRfqPhaseAttempt(
      pending,
      "funding",
      "reverted",
      NOW + 3,
      { transactionHash: "0xfeed", observation: "Receipt proved revert." },
    );
    const reviewing = transitionRfqLifecycle(reverted, "reviewing", NOW + 3);
    expect(reviewing.state).toBe("reviewing");
    expect(lifecycleMaySubmit(reviewing, NOW + 3)).toBe(false);
    expect(() => transitionRfqLifecycle(pending, "reviewing", NOW + 3)).toThrow(
      /proven reverted/i,
    );
  });

  it("durably restores a hashless wallet boundary as verification-only", () => {
    const reviewing = transitionRfqLifecycle(quoted(), "reviewing", NOW);
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "fund-hashless",
      NOW + 1,
      fundingTarget(reviewing),
    );
    const boundaryUnknown = updateRfqPhaseAttempt(
      preparing,
      "funding",
      "wallet-boundary-unknown",
      NOW + 2,
      {
        walletBoundary: "entered",
        observation: "wallet boundary entered without a hash",
      },
    );
    const unknown = transitionRfqLifecycle(
      boundaryUnknown,
      "submission-unknown",
      NOW + 2,
    );
    const restored = restoreRfqLifecycle(unknown, {
      ...context,
      now: NOW + 3,
    });
    expect(restored).toMatchObject({
      state: "submission-unknown",
      attempts: {
        funding: {
          state: "wallet-boundary-unknown",
          walletBoundary: "entered",
        },
      },
    });
    expect(restored.attempts.funding?.transactionHash).toBeUndefined();
    expect(lifecycleMaySubmit(restored, NOW + 3)).toBe(false);
  });

  it("rejects attempts outside their independent lifecycle phases", () => {
    expect(() =>
      beginRfqPhaseAttempt(quoted(), "refund", "bad-refund", NOW),
    ).toThrow(/cannot begin/i);
    expect(() =>
      beginRfqPhaseAttempt(
        { ...quoted(), state: "draft" },
        "fill",
        "bad-fill",
        NOW,
      ),
    ).toThrow(/cannot begin/i);
  });

  it("restores a clock-expired preparing record to funded on exact status 1", () => {
    const preparing = beginRfqPhaseAttempt(
      transitionRfqLifecycle(quoted(), "reviewing", NOW),
      "funding",
      "fund-before-crash",
      NOW + 1,
      fundingTarget(quoted()),
    );
    const expired = restoreRfqLifecycle(preparing, {
      ...context,
      now: NOW + 90,
    });
    expect(expired.state).toBe("expired");
    const funded = reconcileRfqLifecycleWithLocalDeal(
      expired,
      observation(1),
      NOW + 91,
    );
    expect(funded).toMatchObject({
      state: "funded",
      attempts: { funding: { state: "confirmed" } },
      latestObservation: { status: 1, stage: "funded" },
    });
  });

  it("reconciles exact bound local deal observations without retrying", () => {
    expect(
      reconcileRfqLifecycleWithLocalDeal(submitted(), observation(0), NOW + 3),
    ).toMatchObject({
      state: "submission-unknown",
      attempts: { funding: { state: "submitted-unknown" } },
      latestObservation: { stage: "empty" },
    });
    expect(
      reconcileRfqLifecycleWithLocalDeal(submitted(), observation(1), NOW + 3),
    ).toMatchObject({
      state: "funded",
      attempts: { funding: { state: "confirmed" } },
    });
    expect(
      reconcileRfqLifecycleWithLocalDeal(submitted(), observation(3), NOW + 3)
        .state,
    ).toBe("settled");
    expect(
      reconcileRfqLifecycleWithLocalDeal(submitted(), observation(4), NOW + 3)
        .state,
    ).toBe("refunded");
  });

  it("quarantines a non-authoritative observation that contradicts a terminal outcome", () => {
    const settled = reconcileRfqLifecycleWithLocalDeal(
      submitted(),
      observation(3),
      NOW + 3,
    );
    const refunded = reconcileRfqLifecycleWithLocalDeal(
      submitted(),
      observation(4),
      NOW + 3,
    );
    expect(
      reconcileRfqLifecycleWithLocalDeal(settled, observation(4), NOW + 4)
        .state,
    ).toBe("quarantined");
    expect(
      reconcileRfqLifecycleWithLocalDeal(refunded, observation(3), NOW + 4)
        .state,
    ).toBe("quarantined");
  });

  it("quarantines syntactically valid terminal records without terminal evidence", () => {
    const impossible = {
      ...quoted(),
      state: "settled",
      latestObservation: undefined,
    };
    expect(restoreRfqLifecycle(impossible, context)).toMatchObject({
      state: "quarantined",
    });
  });

  it("quarantines malformed, identity-mismatched, and term-mismatched observations", () => {
    expect(restoreRfqLifecycle({ viewingKey: "never" }, context)).toMatchObject(
      { state: "quarantined", rfqId: "malformed-local-record" },
    );
    expect(
      reconcileRfqLifecycleWithLocalDeal(
        submitted(),
        { ...observation(1), dealId: "0x98" },
        NOW + 3,
      ).state,
    ).toBe("quarantined");
    expect(
      reconcileRfqLifecycleWithLocalDeal(
        submitted(),
        { ...observation(1), legAAmount: "101" },
        NOW + 3,
      ).state,
    ).toBe("quarantined");
  });
});
