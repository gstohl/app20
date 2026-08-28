import { describe, expect, it, vi } from "vitest";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  fundingTicketAttemptTargetFromLifecycle,
  restoreRfqLifecycle,
  transitionRfqLifecycle,
  updateRfqPhaseAttempt,
} from "./rfq-lifecycle";
import { reconcileFundingBeforeBrowserPersistence } from "./localnet-funded-persistence";

const NOW = 1_800_000_000;

function submitted() {
  const draft = createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x99",
    state: "reviewing",
    now: NOW,
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
      rfqExpiresAt: NOW + 120,
    },
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-b",
      solverKey: "key-b",
      nonce: "nonce-1",
      reservationId: "reservation-1",
      spreadBps: 20,
      pricingProvenance: "fixture",
      quotedAt: NOW - 10,
      quoteExpiresAt: NOW + 60,
      reservationExpiresAt: NOW + 90,
      buyAmount: "199",
      intentDigest: "0x1234",
      signature: "0xsigned",
      quoteDigest: "0x5678",
      reservationFence: "1",
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x3",
      dealId: "0x99",
      ticketAddress: "0x4",
      deadline: NOW + 120,
    },
  });
  const preparing = beginRfqPhaseAttempt(
    draft,
    "funding",
    "fund-1",
    NOW + 1,
    fundingTicketAttemptTargetFromLifecycle(draft),
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

const fundedObservation = Object.freeze({
  dealId: "0x99",
  escrowAddress: "0x3",
  status: 1,
  legAToken: "0x1",
  legAAmount: "100",
  legBToken: "0x2",
  legBTerms: "199",
  legBAmount: "0",
  deadline: NOW + 120,
  ticket: "0x4",
});

describe("funded server/browser crash barrier", () => {
  it("rejects stale convergence authorization before any server or browser dependency", async () => {
    const convergeServer = vi.fn();
    const persistBrowser = vi.fn();
    await expect(
      reconcileFundingBeforeBrowserPersistence(
        submitted(),
        fundedObservation,
        NOW + 3,
        {
          authorize: async () => {
            throw new Error("forgotten RFQ ID");
          },
          convergeServer,
          persistBrowser,
        },
      ),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    expect(convergeServer).not.toHaveBeenCalled();
    expect(persistBrowser).not.toHaveBeenCalled();
  });

  it.each([
    [1, "funded"],
    [2, "claimable"],
    [3, "settled"],
    [4, "refunded"],
  ] as const)(
    "leaves the prior browser record when status %i server convergence fails",
    async (status, expectedState) => {
      const persistBrowser = vi.fn();
      const observed = {
        ...fundedObservation,
        status,
        ...(status === 2 || status === 3
          ? { legBAmount: "199" }
          : { legBAmount: "0" }),
      };
      await expect(
        reconcileFundingBeforeBrowserPersistence(
          submitted(),
          observed,
          NOW + status + 10,
          {
            authorize: async (candidate) => candidate,
            convergeServer: async (next, exactStatus) => {
              expect(next.state).toBe(expectedState);
              expect(exactStatus).toBe(status);
              throw new Error(`status ${status} server barrier failed`);
            },
            persistBrowser,
          },
        ),
      ).rejects.toThrow(/server barrier failed/i);
      expect(persistBrowser).not.toHaveBeenCalled();
    },
  );

  it("recovers preparing -> wallet commit/crash -> TTL reload/status 1 through the production caller", async () => {
    const prior = submitted();
    const committedBeforeCallback = {
      ...prior,
      state: "reviewing" as const,
      transactionHash: undefined,
      attempts: {
        funding: {
          ...prior.attempts.funding!,
          state: "preparing" as const,
          transactionHash: undefined,
        },
      },
    };
    const restored = restoreRfqLifecycle(committedBeforeCallback, {
      chainId: "0x1",
      account: "0xabc",
      now: NOW + 100,
    });
    expect(restored.state).toBe("expired");
    const order: string[] = [];
    const recovered = await reconcileFundingBeforeBrowserPersistence(
      restored,
      fundedObservation,
      NOW + 101,
      {
        authorize: async (candidate) => candidate,
        convergeServer: async (next, status, attemptId) => {
          order.push(`server:${status}:${attemptId}:${next.state}`);
        },
        persistBrowser: async (next) => {
          order.push(`browser:${next.state}`);
        },
      },
    );
    expect(recovered.state).toBe("funded");
    expect(order).toEqual([
      "server:1:fund-1:funded",
      "browser:funded",
    ]);
  });

  it("converges canonical status 4 with zero output server-before-browser to refunded", async () => {
    const order: string[] = [];
    const refunded = await reconcileFundingBeforeBrowserPersistence(
      submitted(),
      { ...fundedObservation, status: 4, legBAmount: "0" },
      NOW + 10,
      {
        authorize: async (candidate) => candidate,
        convergeServer: async (next, status) => {
          order.push(`server:${status}:${next.state}`);
        },
        persistBrowser: async (next) => {
          order.push(`browser:${next.state}`);
        },
      },
    );
    expect(refunded.state).toBe("refunded");
    expect(order).toEqual(["server:4:refunded", "browser:refunded"]);
  });

  it("never persists funded when server observation fails", async () => {
    const persistBrowser = vi.fn();
    await expect(
      reconcileFundingBeforeBrowserPersistence(
        submitted(),
        fundedObservation,
        NOW + 3,
        {
          authorize: async (candidate) => candidate,
          convergeServer: async () => {
            throw new Error("server funding CAS failed");
          },
          persistBrowser,
        },
      ),
    ).rejects.toThrow(/server funding CAS failed/);
    expect(persistBrowser).not.toHaveBeenCalled();
  });

  it("observes a restored browser-funded/server-unknown record before persistence", async () => {
    const restoredFunded = await reconcileFundingBeforeBrowserPersistence(
      submitted(),
      fundedObservation,
      NOW + 3,
      {
        authorize: async (candidate) => candidate,
        convergeServer: async () => undefined,
        persistBrowser: async () => undefined,
      },
    );
    const order: string[] = [];
    await reconcileFundingBeforeBrowserPersistence(
      restoredFunded,
      fundedObservation,
      NOW + 4,
      {
        authorize: async (candidate) => candidate,
        convergeServer: async (_record, _status, attemptId) => {
          order.push(`server:${attemptId}`);
        },
        persistBrowser: async (record) => {
          order.push(`browser:${record.state}`);
        },
      },
    );
    expect(order).toEqual(["server:fund-1", "browser:funded"]);
  });
});
