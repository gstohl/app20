import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalnetReservationCoordinator } from "../../../scripts/localnet-reservation-coordinator.mjs";
import {
  localnetIntentTermsFromLifecycle,
  recoverLocalnetPreparingFundingAfterEmptyObservation,
} from "./localnet-prewallet-recovery";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  fundingTicketAttemptTargetFromLifecycle,
  restoreRfqLifecycle,
} from "./rfq-lifecycle";
import { localnetResumeDecision } from "./localnet-resume-controller";
import { sameMarketRequestFence } from "./rfq-request-fence";

const NOW = 1_900_000_000;
const REQUEST = `0x${"11".repeat(32)}`;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function reviewing() {
  return createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "reviewing",
    now: NOW,
    requestDigest: REQUEST,
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
      intentDigest: REQUEST,
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
}

function preparing(attemptId: string) {
  const record = reviewing();
  return beginRfqPhaseAttempt(
    record,
    "funding",
    attemptId,
    NOW + 1,
    fundingTicketAttemptTargetFromLifecycle(record),
  );
}

const emptyObservation = Object.freeze({
  dealId: "0x77",
  escrowAddress: "0x3",
  status: 0,
});

function deps(overrides: Record<string, unknown> = {}) {
  return {
    abandonFunding: vi.fn(async () => undefined),
    releaseRequestReservations: vi.fn(async () => undefined),
    persist: vi.fn(async () => undefined),
    authorize: vi.fn(async (candidate) => candidate),
    createAttemptId: () => "release-exact",
    now: () => NOW + 2,
    beforeAbandon: vi.fn(),
    ...overrides,
  } as never;
}

describe("production Desk/Workspace pre-wallet recovery seam", () => {
  it("crosses browser-persist -> request-not-started with tombstone before release", async () => {
    const persisted = preparing("browser-persisted-request-not-started");
    const abandonFunding = vi
      .fn()
      .mockRejectedValueOnce(new Error("tombstone response lost"))
      .mockResolvedValueOnce(undefined);
    const releaseRequestReservations = vi.fn(async () => undefined);
    const persist = vi.fn<
      (record: ReturnType<typeof reviewing>) => Promise<void>
    >(async () => undefined);

    const cancelled =
      await recoverLocalnetPreparingFundingAfterEmptyObservation(
        persisted,
        emptyObservation,
        deps({ abandonFunding, releaseRequestReservations, persist }),
      );

    expect(abandonFunding).toHaveBeenCalledTimes(2);
    expect(abandonFunding.mock.calls[0]).toEqual([
      expect.objectContaining({
        intentDigest: REQUEST,
        dealId: "0x77",
        reservationId: `0x${"22".repeat(32)}`,
        buyAmount: 200n,
      }),
      "browser-persisted-request-not-started",
    ]);
    expect(releaseRequestReservations).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        operation: "request-reservations",
        requestDigest: REQUEST,
        releaseLeaseId: "release-exact",
      }),
    );
    expect(persist.mock.calls[0]?.[0]).toMatchObject({
      state: "reviewing",
      attempts: {
        funding: { state: "reverted", walletBoundary: "not-entered" },
      },
    });
    expect(cancelled).toMatchObject({
      state: "cancelled",
      attempts: {
        funding: { state: "reverted", walletBoundary: "not-entered" },
        "reservation-release": { state: "confirmed" },
      },
      latestObservation: { status: 0 },
    });
  });

  it("composes status-0 browser recovery with the durable ticket-ready coordinator and admits a sibling market", async () => {
    const root = mkdtempSync(join(tmpdir(), "app20-browser-ticket-recovery-"));
    roots.push(root);
    const path = join(root, "coordinator.json");
    const coordinator = createLocalnetReservationCoordinator(path);
    const browser = preparing("browser-ticket-ready");
    const lifecycleTerms = localnetIntentTermsFromLifecycle(browser);
    const lifecycleObservation = {
      dealId: browser.settlement!.dealId,
      escrowAddress: browser.settlement!.escrowAddress,
      status: 0,
    };
    const request = {
      intentDigest: lifecycleTerms.intentDigest,
      rfqId: lifecycleTerms.rfqId,
      account: lifecycleTerms.account,
      chainId: lifecycleTerms.chainId,
      createdAt: NOW,
      expiresAt: browser.terms!.rfqExpiresAt,
    };
    const target = {
      ...request,
      dealId: lifecycleTerms.dealId,
      reservationId: lifecycleTerms.reservationId,
      makerId: lifecycleTerms.solverId,
      fence: lifecycleTerms.reservationFence,
      quoteDigest: lifecycleTerms.quoteDigest,
      sellToken: lifecycleTerms.sellToken,
      sellAmount: lifecycleTerms.sellAmount.toString(),
      buyToken: lifecycleTerms.buyToken,
      buyAmount: lifecycleTerms.buyAmount.toString(),
      deadline: lifecycleTerms.deadline,
      ticketAddress: lifecycleTerms.ticketAddress,
      attemptId: browser.attempts.funding!.attemptId,
    };
    const reservationId = target.reservationId;
    await coordinator.beginRequest({ ...request, market: "strk_usdc" });
    await coordinator.register(
      {
        intentDigest: target.intentDigest,
        reservationId,
        makerId: target.makerId,
        expiresAt: browser.selectedQuote!.reservationExpiresAt,
      },
      async () => true,
    );
    await coordinator.completeRequestFanout(target.intentDigest);
    await coordinator.markSelected(target);
    await coordinator.authorizeFundingTicket(target);
    await coordinator.persistFundingTicket(target);
    expect(coordinator.listRequests()[0].state).toBe("ticket-ready");

    const cancelled =
      await recoverLocalnetPreparingFundingAfterEmptyObservation(
        browser,
        lifecycleObservation,
        deps({
          abandonFunding: (
            terms: ReturnType<typeof localnetIntentTermsFromLifecycle>,
            attemptId: string,
          ) =>
            coordinator.abandonFunding({
              intentDigest: terms.intentDigest,
              rfqId: terms.rfqId,
              account: terms.account,
              chainId: terms.chainId,
              dealId: terms.dealId,
              reservationId: terms.reservationId,
              makerId: terms.solverId,
              fence: terms.reservationFence,
              quoteDigest: terms.quoteDigest,
              sellToken: terms.sellToken,
              sellAmount: terms.sellAmount.toString(),
              buyToken: terms.buyToken,
              buyAmount: terms.buyAmount.toString(),
              deadline: terms.deadline,
              ticketAddress: terms.ticketAddress,
              attemptId,
            }),
          releaseRequestReservations: async (releaseTarget: {
            requestDigest: string;
            rfqId: string;
            account: string;
            chainId: string;
            releaseLeaseId: string;
          }) => {
            const binding = {
              intentDigest: releaseTarget.requestDigest,
              rfqId: releaseTarget.rfqId,
              account: releaseTarget.account,
              chainId: releaseTarget.chainId,
              releaseLeaseId: releaseTarget.releaseLeaseId,
            };
            await coordinator.acquireReleaseLease({ ...binding, now: NOW + 2 });
            await coordinator.releaseIntent(binding, async () => true, NOW + 2);
          },
        }),
      );
    expect(cancelled.state).toBe("cancelled");
    expect(
      createLocalnetReservationCoordinator(path).listRequests()[0].state,
    ).toBe("released");

    const reopened = createLocalnetReservationCoordinator(path);
    await reopened.beginRequest({
      ...request,
      intentDigest: `0x${"44".repeat(32)}`,
      rfqId: "0x78",
      market: "strk_usdc",
    });
    expect(reopened.listRequests().at(-1).state).toBe("open");
  });

  it("converges browser recovery to cancelled when request release won first", async () => {
    const persisted = preparing("browser-stale-after-release");
    const abandonFunding = vi.fn(async () => ({ state: "released" }));
    const releaseRequestReservations = vi.fn(async () => undefined);
    const cancelled =
      await recoverLocalnetPreparingFundingAfterEmptyObservation(
        persisted,
        emptyObservation,
        deps({ abandonFunding, releaseRequestReservations }),
      );
    expect(abandonFunding).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      "browser-stale-after-release",
    );
    expect(releaseRequestReservations).toHaveBeenCalledOnce();
    expect(cancelled).toMatchObject({
      state: "cancelled",
      attempts: {
        funding: { state: "reverted", walletBoundary: "not-entered" },
        "reservation-release": { state: "confirmed" },
      },
    });
  });

  it("survives repeated lost tombstone responses and restart replay", async () => {
    const persisted = preparing("persisted-across-restart");
    let tombstoned = false;
    let responsesLost = 2;
    const abandonFunding = vi.fn(async () => {
      tombstoned = true;
      if (responsesLost-- > 0) throw new Error("response lost after tombstone");
    });
    const persist = vi.fn<
      (record: ReturnType<typeof reviewing>) => Promise<void>
    >(async () => undefined);
    const dependencies = deps({ abandonFunding, persist });

    await expect(
      recoverLocalnetPreparingFundingAfterEmptyObservation(
        persisted,
        emptyObservation,
        dependencies,
      ),
    ).rejects.toThrow(/response lost/i);
    expect(tombstoned).toBe(true);
    expect(persist).not.toHaveBeenCalled();

    const restored = restoreRfqLifecycle(persisted, {
      chainId: "0x1",
      account: "0xabc",
      now: NOW + 2,
    });
    const cancelled =
      await recoverLocalnetPreparingFundingAfterEmptyObservation(
        restored,
        emptyObservation,
        dependencies,
      );
    expect(cancelled.state).toBe("cancelled");
    expect(abandonFunding).toHaveBeenCalledTimes(3);
  });

  it("rejects value-bearing and wrong-target observations before abandonment", async () => {
    const persisted = preparing("prewallet-exact");
    const abandonFunding = vi.fn();
    await expect(
      recoverLocalnetPreparingFundingAfterEmptyObservation(
        persisted,
        { ...emptyObservation, status: 1 },
        deps({ abandonFunding }),
      ),
    ).rejects.toThrow(/status-0|empty-chain/i);
    await expect(
      recoverLocalnetPreparingFundingAfterEmptyObservation(
        persisted,
        { ...emptyObservation, dealId: "0x78" },
        deps({ abandonFunding }),
      ),
    ).rejects.toThrow(/status-0|empty-chain/i);
    expect(abandonFunding).not.toHaveBeenCalled();
  });

  it.each(["account", "chain", "provider", "runtime", "tombstone"])(
    "fences %s changes after authorization before abandonment and release",
    async (field) => {
      const persisted = preparing(`prewallet-context-${field}`);
      const abandonFunding = vi.fn();
      const releaseRequestReservations = vi.fn();
      const wallet = vi.fn();
      const context = {
        account: persisted.account,
        chain: persisted.chainId,
        provider: 3,
        runtime: "epoch-a",
        tombstoned: false,
      };
      const expected = { ...context };
      const authorize = vi.fn(async (candidate) => {
        if (field === "account") context.account = "0xdef";
        if (field === "chain") context.chain = "0x2";
        if (field === "provider") context.provider = 2;
        if (field === "runtime") context.runtime = "epoch-b";
        if (field === "tombstone") context.tombstoned = true;
        return candidate;
      });
      const beforeAbandon = vi.fn(() => {
        if (JSON.stringify(context) !== JSON.stringify(expected))
          throw new Error("pre-wallet recovery context changed");
      });

      await expect(
        recoverLocalnetPreparingFundingAfterEmptyObservation(
          persisted,
          emptyObservation,
          deps({
            abandonFunding,
            releaseRequestReservations,
            authorize,
            beforeAbandon,
          }),
        ),
      ).rejects.toThrow(/context changed/i);
      expect(abandonFunding).not.toHaveBeenCalled();
      expect(releaseRequestReservations).not.toHaveBeenCalled();
      expect(wallet).not.toHaveBeenCalled();
    },
  );

  it("rechecks context after abandonment and blocks the release sink", async () => {
    const persisted = preparing("prewallet-post-abandon-context");
    const context = { runtime: "epoch-a" };
    const abandonFunding = vi.fn(async () => {
      context.runtime = "epoch-b";
    });
    const releaseRequestReservations = vi.fn(async () => undefined);
    const beforeAbandon = vi.fn(() => {
      expect(context.runtime).toBe("epoch-a");
    });
    const beforeRelease = vi.fn(() => {
      if (context.runtime !== "epoch-a")
        throw new Error("pre-wallet release context changed");
    });

    await expect(
      recoverLocalnetPreparingFundingAfterEmptyObservation(
        persisted,
        emptyObservation,
        deps({
          abandonFunding,
          releaseRequestReservations,
          beforeAbandon,
          beforeRelease,
        }),
      ),
    ).rejects.toThrow(/release context changed/i);
    expect(abandonFunding).toHaveBeenCalledOnce();
    expect(beforeRelease).toHaveBeenCalledOnce();
    expect(releaseRequestReservations).not.toHaveBeenCalled();
  });

  it("routes crash-before-local-prep expiry to release and keeps its market fenced", () => {
    const beforeLocalPrep = {
      ...reviewing(),
      settlement: undefined,
      quoteExpiresAt: NOW + 1,
      reservationExpiresAt: NOW + 1,
      selectedQuote: {
        ...reviewing().selectedQuote!,
        quoteExpiresAt: NOW + 1,
        reservationExpiresAt: NOW + 1,
      },
    };
    const expired = restoreRfqLifecycle(beforeLocalPrep, {
      chainId: "0x1",
      account: "0xabc",
      now: NOW + 2,
    });
    expect(expired.state).toBe("expired");
    expect(localnetResumeDecision(expired, NOW + 2).action).toBe(
      "release-request-reservations",
    );
    expect(sameMarketRequestFence([expired], "STRK_USDC")).toMatch(
      /unresolved/i,
    );

    const legacySettlementOnly = {
      ...expired,
      settlement: reviewing().settlement,
    };
    expect(localnetResumeDecision(legacySettlementOnly, NOW + 2).action).toBe(
      "release-request-reservations",
    );
    expect(sameMarketRequestFence([legacySettlementOnly], "STRK_USDC")).toMatch(
      /unresolved/i,
    );
  });
});
