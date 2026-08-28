import { describe, expect, it, vi } from "vitest";
import {
  prepareFundedSettlementExpiry,
  preparePreFundingReservationRelease,
  reconcilePersistedReservationRelease,
  reservationReleaseReconciliationRoute,
} from "./localnet-release-recovery";
import { localnetResumeDecision } from "./localnet-resume-controller";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  fundingTicketAttemptTargetFromLifecycle,
  restoreRfqLifecycle,
  type RfqLifecycleRecord,
  type RfqReleaseAttemptTarget,
} from "./rfq-lifecycle";

const NOW = 1_900_000_000;
const REQUEST_DIGEST = `0x${"ab".repeat(32)}`;

function requestingRecord(): RfqLifecycleRecord {
  return createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "requesting",
    now: NOW,
    requestDigest: REQUEST_DIGEST,
  });
}

function fundedRecord(): RfqLifecycleRecord {
  return createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x88",
    state: "funded",
    now: NOW,
    requestDigest: REQUEST_DIGEST,
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
      rfqExpiresAt: NOW + 100,
    },
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-a",
      solverKey: "key-a",
      nonce: "nonce-a",
      reservationId: "reservation-a",
      spreadBps: 20,
      pricingProvenance: "fixture",
      quotedAt: NOW,
      quoteExpiresAt: NOW + 50,
      reservationExpiresAt: NOW + 60,
      buyAmount: "199",
      intentDigest: REQUEST_DIGEST,
      signature: "signature-a",
      reservationFence: "7",
      quoteDigest: `0x${"cd".repeat(32)}`,
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x3",
      dealId: "0x88",
      ticketAddress: "0x4",
      deadline: NOW + 100,
    },
  });
}

function dependencies(
  overrides: Partial<{
    releaseRequestReservations: (
      target: Extract<
        RfqReleaseAttemptTarget,
        { operation: "request-reservations" }
      >,
    ) => Promise<void>;
    expireFundedSettlement: () => Promise<number>;
    persist: (record: RfqLifecycleRecord) => Promise<unknown>;
    authorize: (record: RfqLifecycleRecord) => Promise<RfqLifecycleRecord>;
  }> = {},
) {
  return {
    releaseRequestReservations:
      overrides.releaseRequestReservations ?? vi.fn(async () => undefined),
    expireFundedSettlement:
      overrides.expireFundedSettlement ?? vi.fn(async () => NOW + 100),
    persist: overrides.persist ?? vi.fn(async () => undefined),
    authorize:
      overrides.authorize ?? vi.fn(async (candidate) => candidate),
    beforeSubmit: vi.fn(),
    now: () => NOW + 2,
  };
}

describe("localnet reservation-release recovery handler", () => {
  it("rejects a stale release authorization before either production server sink", async () => {
    const pending = preparePreFundingReservationRelease(
      requestingRecord(),
      "stale-release",
      NOW + 1,
    );
    const releaseRequestReservations = vi.fn();
    const expireFundedSettlement = vi.fn();
    await expect(
      reconcilePersistedReservationRelease(
        pending,
        dependencies({
          releaseRequestReservations,
          expireFundedSettlement,
          authorize: async () => {
            throw new Error("forgotten RFQ ID");
          },
        }),
      ),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    expect(releaseRequestReservations).not.toHaveBeenCalled();
    expect(expireFundedSettlement).not.toHaveBeenCalled();
  });

  it("keeps the persisted pre-funding attempt recoverable when the coordinator response is lost", async () => {
    const pending = preparePreFundingReservationRelease(
      requestingRecord(),
      "release-attempt-1",
      NOW + 1,
    );
    const release = vi.fn(async () => {
      throw new Error("response lost after coordinator commit");
    });
    const persist = vi.fn(async () => undefined);

    await expect(
      reconcilePersistedReservationRelease(
        pending,
        dependencies({ releaseRequestReservations: release, persist }),
      ),
    ).rejects.toThrow(/response lost/i);

    expect(release).toHaveBeenCalledExactlyOnceWith({
      operation: "request-reservations",
      account: "0xabc",
      chainId: "0x1",
      rfqId: "0x77",
      requestDigest: REQUEST_DIGEST,
      releaseLeaseId: "release-attempt-1",
    });
    expect(persist).not.toHaveBeenCalled();
    expect(pending).toMatchObject({
      state: "cancel-pending",
      attempts: {
        "reservation-release": {
          attemptId: "release-attempt-1",
          state: "preparing",
        },
      },
    });
    expect(localnetResumeDecision(pending, NOW + 2)).toMatchObject({
      action: "verify-reservation-release",
      disabled: false,
    });
  });

  it("restores and completes the same request-backed attempt after refresh", async () => {
    const pending = preparePreFundingReservationRelease(
      requestingRecord(),
      "release-attempt-refresh",
      NOW + 1,
    );
    const restored = restoreRfqLifecycle(pending, {
      chainId: "0x1",
      account: "0xabc",
      now: NOW + 2,
    });
    const release = vi.fn(async () => undefined);
    const persist = vi.fn(async () => undefined);

    const cancelled = await reconcilePersistedReservationRelease(
      restored,
      dependencies({ releaseRequestReservations: release, persist }),
    );

    expect(release).toHaveBeenCalledExactlyOnceWith({
      operation: "request-reservations",
      account: "0xabc",
      chainId: "0x1",
      rfqId: "0x77",
      requestDigest: REQUEST_DIGEST,
      releaseLeaseId: "release-attempt-refresh",
    });
    expect(cancelled).toMatchObject({
      state: "cancelled",
      attempts: {
        "reservation-release": {
          attemptId: "release-attempt-refresh",
          state: "confirmed",
        },
      },
    });
    expect(persist).toHaveBeenCalledExactlyOnceWith(cancelled);
  });

  it("restores pre-funding expiry and reaches final cancelled only with an exact request target", async () => {
    const quoted = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "0x79",
      state: "quoted",
      now: NOW,
      requestDigest: REQUEST_DIGEST,
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
        rfqExpiresAt: NOW + 1,
      },
      selectedQuote: {
        ...fundedRecord().selectedQuote!,
        quoteExpiresAt: NOW + 1,
        reservationExpiresAt: NOW + 1,
      },
    });
    const expired = restoreRfqLifecycle(quoted, {
      chainId: "0x1",
      account: "0xabc",
      now: NOW + 2,
    });
    expect(expired.state).toBe("expired");
    const pending = preparePreFundingReservationRelease(
      expired,
      "expired-release",
      NOW + 2,
    );
    const release = vi.fn(async () => undefined);
    const cancelled = await reconcilePersistedReservationRelease(
      pending,
      dependencies({ releaseRequestReservations: release }),
    );
    expect(release).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        requestDigest: REQUEST_DIGEST,
        rfqId: "0x79",
        releaseLeaseId: "expired-release",
      }),
    );
    expect(cancelled.state).toBe("cancelled");
  });

  it("permits request-wide release only for a proven no-wallet funding revert", () => {
    const reviewing = {
      ...fundedRecord(),
      state: "reviewing" as const,
    };
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "known-not-submitted",
      NOW + 1,
      fundingTicketAttemptTargetFromLifecycle(reviewing),
    );
    const proven = {
      ...preparing,
      attempts: {
        ...preparing.attempts,
        funding: {
          ...preparing.attempts.funding!,
          state: "reverted" as const,
          walletBoundary: "not-entered" as const,
        },
      },
    };
    expect(
      preparePreFundingReservationRelease(
        proven,
        "release-consumed-quote",
        NOW + 2,
      ),
    ).toMatchObject({
      state: "cancel-pending",
      attempts: {
        funding: { state: "reverted", walletBoundary: "not-entered" },
        "reservation-release": { attemptId: "release-consumed-quote" },
      },
    });
    expect(() =>
      preparePreFundingReservationRelease(
        {
          ...proven,
          attempts: {
            ...proven.attempts,
            funding: {
              ...proven.attempts.funding!,
              walletBoundary: "entered" as const,
            },
          },
        },
        "unsafe-release",
        NOW + 2,
      ),
    ).toThrow(/proven no-wallet/i);
  });

  it("classifies expired settlement records by funding evidence, not object presence", () => {
    const preFundingExpired = {
      ...fundedRecord(),
      state: "expired" as const,
    };
    expect(
      preparePreFundingReservationRelease(
        preFundingExpired,
        "pre-funding-expired-release",
        NOW + 2,
      ),
    ).toMatchObject({
      state: "cancel-pending",
      attempts: {
        "reservation-release": {
          attemptId: "pre-funding-expired-release",
        },
      },
    });

    const reviewing = { ...fundedRecord(), state: "reviewing" as const };
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "wallet-boundary-entered",
      NOW + 1,
      fundingTicketAttemptTargetFromLifecycle(reviewing),
    );
    const fundedExpired = {
      ...preparing,
      state: "expired" as const,
      attempts: {
        ...preparing.attempts,
        funding: {
          ...preparing.attempts.funding!,
          state: "wallet-boundary-unknown" as const,
          walletBoundary: "entered" as const,
        },
      },
    };
    expect(() =>
      preparePreFundingReservationRelease(
        fundedExpired,
        "wrong-expired-route",
        NOW + 2,
      ),
    ).toThrow(/pre-funding|unknown funding/i);
  });

  it("retries the same idempotent request after a post-response storage-save failure", async () => {
    const pending = preparePreFundingReservationRelease(
      requestingRecord(),
      "release-attempt-storage",
      NOW + 1,
    );
    const release = vi.fn(async () => undefined);
    const persist = vi
      .fn<(record: RfqLifecycleRecord) => Promise<void>>()
      .mockRejectedValueOnce(new Error("storage save failed"))
      .mockResolvedValueOnce(undefined);
    const deps = dependencies({
      releaseRequestReservations: release,
      persist,
    });

    await expect(
      reconcilePersistedReservationRelease(pending, deps),
    ).rejects.toThrow(/storage save failed/i);
    const cancelled = await reconcilePersistedReservationRelease(pending, deps);

    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.calls).toEqual([
      [
        expect.objectContaining({
          requestDigest: REQUEST_DIGEST,
          rfqId: "0x77",
        }),
      ],
      [
        expect.objectContaining({
          requestDigest: REQUEST_DIGEST,
          rfqId: "0x77",
        }),
      ],
    ]);
    expect(cancelled.attempts["reservation-release"]).toMatchObject({
      attemptId: "release-attempt-storage",
      state: "confirmed",
    });
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("never cross-routes request release and funded settlement expiry", async () => {
    const requestPending = preparePreFundingReservationRelease(
      requestingRecord(),
      "release-request",
      NOW + 1,
    );
    const fundedPending = prepareFundedSettlementExpiry(
      fundedRecord(),
      "expire-funded",
      NOW + 1,
    );
    const release = vi.fn(async () => undefined);
    const expire = vi.fn(async () => NOW + 100);
    const persist = vi.fn(async () => undefined);
    const deps = dependencies({
      releaseRequestReservations: release,
      expireFundedSettlement: expire,
      persist,
    });

    expect(reservationReleaseReconciliationRoute(requestPending)).toBe(
      "request-reservations",
    );
    await reconcilePersistedReservationRelease(requestPending, deps);
    expect(release).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ requestDigest: REQUEST_DIGEST, rfqId: "0x77" }),
    );
    expect(expire).not.toHaveBeenCalled();

    release.mockClear();
    persist.mockClear();
    expect(reservationReleaseReconciliationRoute(fundedPending)).toBe(
      "funded-settlement-expiry",
    );
    const refundable = await reconcilePersistedReservationRelease(
      fundedPending,
      deps,
    );
    expect(release).not.toHaveBeenCalled();
    expect(expire).toHaveBeenCalledExactlyOnceWith({
      account: "0xabc",
      chainId: "0x1",
      rfqId: "0x88",
      dealId: "0x88",
      intentDigest: REQUEST_DIGEST,
      solverId: "maker-a",
      reservationId: "reservation-a",
      reservationFence: "7",
      quoteDigest: `0x${"cd".repeat(32)}`,
      sellToken: "0x1",
      sellAmount: 100n,
      buyToken: "0x2",
      buyAmount: 199n,
      deadline: NOW + 100,
      ticketAddress: "0x4",
    });
    expect(refundable.state).toBe("refundable");
  });

  it("quarantines copied, missing, cross-route, and mutated immutable targets on restore", () => {
    const requestPending = preparePreFundingReservationRelease(
      requestingRecord(),
      "bound-request",
      NOW + 1,
    );
    const fundedPending = prepareFundedSettlementExpiry(
      fundedRecord(),
      "bound-expiry",
      NOW + 1,
    );
    const cases: unknown[] = [
      {
        ...requestPending,
        requestDigest: `0x${"ef".repeat(32)}`,
      },
      {
        ...requestPending,
        attempts: {
          ...requestPending.attempts,
          "reservation-release": {
            ...requestPending.attempts["reservation-release"],
            target: undefined,
          },
        },
      },
      {
        ...fundedPending,
        settlement: { ...fundedPending.settlement!, dealId: "0x89" },
      },
      {
        ...fundedPending,
        selectedQuote: {
          ...fundedPending.selectedQuote!,
          reservationId: "same-terms-other-reservation",
        },
      },
      {
        ...fundedPending,
        selectedQuote: {
          ...fundedPending.selectedQuote!,
          quoteDigest: `0x${"ee".repeat(32)}`,
        },
      },
      {
        ...fundedPending,
        selectedQuote: {
          ...fundedPending.selectedQuote!,
          reservationFence: "8",
        },
      },
      {
        ...fundedPending,
        attempts: {
          ...fundedPending.attempts,
          "reservation-release": requestPending.attempts["reservation-release"],
        },
      },
    ];
    for (const value of cases) {
      expect(
        restoreRfqLifecycle(value, {
          chainId: "0x1",
          account: "0xabc",
          now: NOW + 2,
        }).state,
      ).toBe("quarantined");
    }
  });

  it("revalidates the immutable target immediately before either sink", async () => {
    const pending = prepareFundedSettlementExpiry(
      fundedRecord(),
      "pre-sink",
      NOW + 1,
    );
    const changed = {
      ...pending,
      selectedQuote: {
        ...pending.selectedQuote!,
        reservationId: "same-terms-deal-b-reservation",
      },
    };
    const release = vi.fn(async () => undefined);
    const expire = vi.fn(async () => NOW + 100);
    await expect(
      reconcilePersistedReservationRelease(
        changed,
        dependencies({
          releaseRequestReservations: release,
          expireFundedSettlement: expire,
        }),
      ),
    ).rejects.toThrow(/target does not match/i);
    expect(release).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
  });

  it("checks the current recovery context immediately before submission", async () => {
    const pending = preparePreFundingReservationRelease(
      requestingRecord(),
      "context-bound",
      NOW + 1,
    );
    const release = vi.fn(async () => undefined);
    const beforeSubmit = vi.fn(() => {
      throw new Error("provider changed before submission");
    });
    await expect(
      reconcilePersistedReservationRelease(pending, {
        ...dependencies({ releaseRequestReservations: release }),
        beforeSubmit,
      }),
    ).rejects.toThrow(/provider changed/i);
    expect(beforeSubmit).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it("refuses release reconciliation while a value-moving wallet attempt is unknown", async () => {
    const reviewing = {
      ...fundedRecord(),
      state: "reviewing" as const,
    };
    const fundingUnknown = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "wallet-funding",
      NOW + 1,
      fundingTicketAttemptTargetFromLifecycle(reviewing),
    );
    const conflicting = {
      ...fundingUnknown,
      state: "cancel-pending" as const,
      attempts: {
        ...fundingUnknown.attempts,
        "reservation-release": prepareFundedSettlementExpiry(
          fundedRecord(),
          "release-conflict",
          NOW + 1,
        ).attempts["reservation-release"]!,
      },
    };
    const release = vi.fn(async () => undefined);
    const expire = vi.fn(async () => NOW + 100);

    await expect(
      reconcilePersistedReservationRelease(
        conflicting,
        dependencies({
          releaseRequestReservations: release,
          expireFundedSettlement: expire,
        }),
      ),
    ).rejects.toThrow(/unknown funding wallet attempt/i);
    expect(release).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
    expect(localnetResumeDecision(conflicting, NOW + 2).action).toBe(
      "verify-funding",
    );
  });
});
