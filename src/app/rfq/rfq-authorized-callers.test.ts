import { describe, expect, it, vi } from "vitest";
import {
  beginRfqPhaseAttempt,
  createRfqLifecycleRecord,
  finalizeRfqLifecycleForStorage,
  restoreRfqLifecycle,
  reviseRfqLifecycle,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";
import {
  assertRfqStorageReplacement,
  assertRfqStorageTombstoneReplacement,
  createRfqLifecycleStorage,
  planRfqAliasMigration,
  replaceRfqWithTombstone,
  type RfqStorageBackend,
} from "./rfq-storage";
import {
  runAuthorizedInitialMakerFill,
  runAuthorizedPayout,
  runAuthorizedTicketAcceptance,
} from "./rfq-authorized-callers";
import {
  makerFillAttemptTarget,
  retryPersistedMakerFill,
} from "./localnet-maker-fill-recovery";
import {
  preparePreFundingReservationRelease,
  reconcilePersistedReservationRelease,
} from "./localnet-release-recovery";
import { reconcileFundingBeforeBrowserPersistence } from "./localnet-funded-persistence";
import { runLocalnetFundingOrchestration } from "./localnet-funding-orchestration";

const NOW = 2_000_000_000;

function memoryStorage() {
  const rows = new Map<string, unknown>();
  const backend: RfqStorageBackend = {
    async migrateAliases(scope) {
      const plan = planRfqAliasMigration([...rows], scope);
      for (const key of plan.deleteKeys) rows.delete(key);
      for (const [key, value] of plan.putEntries) rows.set(key, value);
    },
    async compareAndPut(key, value) {
      assertRfqStorageReplacement(rows.get(key), value);
      rows.set(key, structuredClone(finalizeRfqLifecycleForStorage(value)));
    },
    async compareAndPutTombstone(key, value) {
      rows.set(
        key,
        assertRfqStorageTombstoneReplacement(rows.get(key), key, value),
      );
    },
    async compareAndDelete(key, legacyKey, expected) {
      rows.set(key, replaceRfqWithTombstone(rows.get(key), key, expected));
      rows.delete(legacyKey);
    },
    async get(key) {
      return rows.get(key);
    },
    async list(prefix) {
      return [...rows]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => value);
    },
    async delete(key) {
      rows.delete(key);
    },
  };
  return {
    tabA: createRfqLifecycleStorage(backend, "two-tab-callers"),
    tabB: createRfqLifecycleStorage(backend, "two-tab-callers"),
  };
}

function exactRecord(
  state: RfqLifecycleRecord["state"],
  rfqId: string,
  ticketAddress: string | undefined = "0x40",
) {
  return createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId,
    state,
    now: NOW,
    requestDigest: `digest-${rfqId}`,
    terms: {
      pairId: "SELL_BUY",
      sellSymbol: "SELL",
      sellAddress: "0x10",
      sellDecimals: 18,
      sellAmount: "100",
      buySymbol: "BUY",
      buyAddress: "0x20",
      buyDecimals: 6,
      minBuyAmount: "190",
      buyAmount: "200",
      rfqExpiresAt: NOW + 1_000,
    },
    selectedQuote: {
      version: "Quote V1",
      solverId: "maker-a",
      solverKey: "maker-key",
      nonce: `nonce-${rfqId}`,
      reservationId: `reservation-${rfqId}`,
      spreadBps: 1,
      pricingProvenance: "fixture",
      quotedAt: NOW,
      quoteExpiresAt: NOW + 500,
      reservationExpiresAt: NOW + 600,
      buyAmount: "200",
      intentDigest: `digest-${rfqId}`,
      signature: "signature",
      quoteDigest: `quote-${rfqId}`,
      reservationFence: "1",
    },
    settlement: {
      version: "Localnet V2",
      escrowAddress: "0x30",
      dealId: rfqId,
      ...(ticketAddress === undefined ? {} : { ticketAddress }),
      deadline: NOW + 1_000,
    },
  });
}

function terms(record: RfqLifecycleRecord) {
  return {
    account: record.account,
    chainId: record.chainId,
    rfqId: record.rfqId,
    dealId: record.settlement!.dealId,
    intentDigest: record.requestDigest!,
    solverId: record.selectedQuote!.solverId,
    reservationId: record.selectedQuote!.reservationId,
    reservationFence: record.selectedQuote!.reservationFence!,
    quoteDigest: record.selectedQuote!.quoteDigest!,
    sellToken: record.terms!.sellAddress,
    sellAmount: BigInt(record.terms!.sellAmount),
    buyToken: record.terms!.buyAddress,
    buyAmount: BigInt(record.selectedQuote!.buyAmount),
    deadline: record.settlement!.deadline,
    ticketAddress: record.settlement!.ticketAddress!,
  };
}

function ticketTarget(record: RfqLifecycleRecord) {
  const exact = terms(record);
  return {
    operation: "funding-ticket" as const,
    chainId: exact.chainId,
    account: exact.account,
    rfqId: exact.rfqId,
    requestDigest: exact.intentDigest,
    dealId: exact.dealId,
    solverId: exact.solverId,
    reservationId: exact.reservationId,
    reservationFence: exact.reservationFence,
    quoteDigest: exact.quoteDigest,
    sellToken: exact.sellToken,
    sellAmount: exact.sellAmount.toString(),
    buyToken: exact.buyToken,
    buyAmount: exact.buyAmount.toString(),
    deadline: exact.deadline,
  };
}

async function forget(
  initial: RfqLifecycleRecord,
  terminal: RfqLifecycleRecord,
) {
  const { tabA, tabB } = memoryStorage();
  await tabA.save(initial);
  const committedTerminal = reviseRfqLifecycle(initial, terminal);
  await tabA.save(committedTerminal);
  await tabA.remove(committedTerminal);
  return { stale: initial, tabB };
}

describe("production RFQ callers preserve forget-wins before mutation sinks", () => {
  it("creates, saves, reopens, and recovers the exact funding ticket after response loss", async () => {
    const { tabA } = memoryStorage();
    const reviewing = exactRecord("reviewing", "0x705", undefined);
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "funding-attempt",
      NOW + 1,
      ticketTarget(reviewing),
    );
    await tabA.save(preparing);
    const restored = restoreRfqLifecycle(await tabA.load(preparing), {
      chainId: preparing.chainId,
      account: preparing.account,
      now: NOW + 2,
    });
    expect(restored.attempts.funding).toMatchObject({
      attemptId: "funding-attempt",
      state: "preparing",
      target: ticketTarget(reviewing),
    });

    const requests: unknown[] = [];
    const ensure = vi.fn(async (record: RfqLifecycleRecord) => {
      requests.push({
        attemptId: record.attempts.funding!.attemptId,
        target: record.attempts.funding!.target,
      });
      if (requests.length === 1) throw new Error("ticket response lost");
      return "0x40";
    });
    await expect(
      runAuthorizedTicketAcceptance(restored, {
        authorize: tabA.authorize,
        accept: async () => undefined,
        beforeEnsureTicket: () => undefined,
        ensureTicket: ensure,
      }),
    ).rejects.toThrow(/response lost/i);

    const reopened = restoreRfqLifecycle(await tabA.load(preparing), {
      chainId: preparing.chainId,
      account: preparing.account,
      now: NOW + 3,
    });
    const recovered = await runAuthorizedTicketAcceptance(reopened, {
      authorize: tabA.authorize,
      accept: async () => undefined,
      beforeEnsureTicket: () => undefined,
      ensureTicket: ensure,
    });
    expect(recovered.result).toBe("0x40");
    expect(requests).toEqual([requests[0], requests[0]]);
    const ticketBearing = reviseRfqLifecycle(recovered.authorized, {
      settlement: {
        ...recovered.authorized.settlement!,
        ticketAddress: recovered.result,
      },
      updatedAt: NOW + 4,
    });
    await expect(tabA.save(ticketBearing)).resolves.toBeUndefined();
    const ticketAfterRestart = restoreRfqLifecycle(
      await tabA.load(ticketBearing),
      {
        chainId: ticketBearing.chainId,
        account: ticketBearing.account,
        now: NOW + 5,
      },
    );
    expect(ticketAfterRestart.settlement?.ticketAddress).toBe("0x40");
    const changedCore = reviseRfqLifecycle(recovered.authorized, {
      settlement: {
        ...recovered.authorized.settlement!,
        ticketAddress: "0x41",
        deadline: recovered.authorized.settlement!.deadline + 1,
      },
      updatedAt: NOW + 4,
    });
    expect(() =>
      assertRfqStorageReplacement(recovered.authorized, changedCore),
    ).toThrow(/settlement identity/i);

    const malformed = structuredClone(reopened) as RfqLifecycleRecord;
    (malformed.attempts.funding!.target as { buyAmount: string }).buyAmount =
      "201";
    expect(
      restoreRfqLifecycle(malformed, {
        chainId: preparing.chainId,
        account: preparing.account,
        now: NOW + 3,
      }).state,
    ).toBe("quarantined");
    await expect(tabA.save(malformed)).rejects.toThrow(/immutable terms/i);
  });

  it("reauthorizes storage and current context after accept before the ticket sink", async () => {
    const { tabA, tabB } = memoryStorage();
    const reviewing = exactRecord("reviewing", "0x706", undefined);
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "funding-accept-race",
      NOW + 1,
      ticketTarget(reviewing),
    );
    await tabA.save(preparing);
    const ensureTicket = vi.fn().mockResolvedValue("0x40");
    await expect(
      runAuthorizedTicketAcceptance(preparing, {
        authorize: tabB.authorize,
        accept: async (authorized) => {
          const terminal = reviseRfqLifecycle(authorized, {
            state: "cancelled",
            updatedAt: NOW + 2,
          });
          await tabA.save(terminal);
          await tabA.remove(terminal);
        },
        beforeEnsureTicket: () => undefined,
        ensureTicket,
      }),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    expect(ensureTicket).not.toHaveBeenCalled();

    for (const field of ["account", "chain", "provider", "runtime"] as const) {
      const context = {
        account: "0xabc",
        chain: "0x1",
        provider: 3,
        runtime: "epoch-a",
      };
      const expected = { ...context };
      const sink = vi.fn().mockResolvedValue("0x40");
      const fresh = exactRecord("reviewing", `context-${field}`);
      await expect(
        runAuthorizedTicketAcceptance(fresh, {
          authorize: async (record) => record,
          accept: async () => {
            if (field === "account") context.account = "0xdef";
            if (field === "chain") context.chain = "0x2";
            if (field === "provider") context.provider = 2;
            if (field === "runtime") context.runtime = "epoch-b";
          },
          beforeEnsureTicket: () => {
            if (JSON.stringify(context) !== JSON.stringify(expected))
              throw new Error("ticket execution context changed");
          },
          ensureTicket: sink,
        }),
      ).rejects.toThrow(/context changed/i);
      expect(sink).not.toHaveBeenCalled();
    }
  });

  it("blocks accept and ticket plus initial fill before either server sink", async () => {
    const reviewing = exactRecord("reviewing", "ticket-forget");
    const preparing = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "funding-attempt",
      NOW + 1,
      ticketTarget(reviewing),
    );
    const terminal = reviseRfqLifecycle(preparing, {
      state: "cancelled",
      updatedAt: NOW + 2,
    });
    const { stale, tabB } = await forget(preparing, terminal);
    const accept = vi.fn().mockResolvedValue(undefined);
    const ticket = vi.fn().mockResolvedValue("0x40");
    const fill = vi.fn().mockResolvedValue("0xfill");

    await expect(
      runAuthorizedTicketAcceptance(stale, {
        authorize: tabB.authorize,
        accept,
        beforeEnsureTicket: () => undefined,
        ensureTicket: ticket,
      }),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    await expect(
      runAuthorizedInitialMakerFill(stale, {
        authorize: tabB.authorize,
        beforeSubmit: () => undefined,
        submit: fill,
      }),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    expect(accept).not.toHaveBeenCalled();
    expect(ticket).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
  });

  it("blocks retry fill through its real production recovery caller", async () => {
    const funded = exactRecord("funded", "0x601");
    const preparing = beginRfqPhaseAttempt(
      funded,
      "fill",
      "fill-attempt",
      NOW + 1,
      makerFillAttemptTarget(terms(funded)),
    );
    const terminal = reviseRfqLifecycle(preparing, {
      state: "settled",
      updatedAt: NOW + 2,
    });
    const { stale, tabB } = await forget(preparing, terminal);
    const maker = vi.fn().mockResolvedValue("0xfill");
    await expect(
      retryPersistedMakerFill(stale, {
        authorize: tabB.authorize,
        beforeSubmit: () => undefined,
        submitExact: maker,
        persist: tabB.save,
        now: () => NOW + 3,
      }),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    expect(maker).not.toHaveBeenCalled();
  });

  it("blocks release and convergence through production recovery callers", async () => {
    const quoted = exactRecord("quoted", "0x602");
    const release = preparePreFundingReservationRelease(
      quoted,
      "release-attempt",
      NOW + 1,
    );
    const released = reviseRfqLifecycle(release, {
      state: "cancelled",
      updatedAt: NOW + 2,
    });
    const releaseTabs = await forget(release, released);
    const releaseServer = vi.fn().mockResolvedValue(undefined);
    await expect(
      reconcilePersistedReservationRelease(releaseTabs.stale, {
        authorize: releaseTabs.tabB.authorize,
        beforeSubmit: () => undefined,
        releaseRequestReservations: releaseServer,
        expireFundedSettlement: vi.fn(),
        persist: releaseTabs.tabB.save,
        now: () => NOW + 3,
      }),
    ).rejects.toThrow(/forgotten RFQ ID/i);

    const funded = exactRecord("funded", "0x603");
    const settled = reviseRfqLifecycle(funded, {
      state: "settled",
      updatedAt: NOW + 2,
    });
    const convergenceTabs = await forget(funded, settled);
    const convergeServer = vi.fn().mockResolvedValue(undefined);
    await expect(
      reconcileFundingBeforeBrowserPersistence(
        convergenceTabs.stale,
        {
          dealId: funded.rfqId,
          escrowAddress: funded.settlement!.escrowAddress,
          status: 1,
          legAToken: funded.terms!.sellAddress,
          legAAmount: funded.terms!.sellAmount,
          legBToken: funded.terms!.buyAddress,
          legBTerms: funded.selectedQuote!.buyAmount,
          legBAmount: "0",
          deadline: funded.settlement!.deadline,
          ticket: funded.settlement!.ticketAddress,
        },
        NOW + 3,
        {
          authorize: convergenceTabs.tabB.authorize,
          convergeServer,
          persistBrowser: convergenceTabs.tabB.save,
        },
      ),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    expect(releaseServer).not.toHaveBeenCalled();
    expect(convergeServer).not.toHaveBeenCalled();
  });

  it("blocks the required final funding authorization before server and wallet sinks", async () => {
    const reviewing = exactRecord("reviewing", "funding-wallet-forget");
    const terminal = reviseRfqLifecycle(reviewing, {
      state: "cancelled",
      updatedAt: NOW + 1,
    });
    const { stale, tabB } = await forget(reviewing, terminal);
    const server = vi.fn().mockResolvedValue(undefined);
    const wallet = vi.fn().mockResolvedValue({ transactionHash: "0x1" });
    await expect(
      runLocalnetFundingOrchestration({
        prepareBeforeLease: async () => ({
          account: {} as never,
          provider: {} as never,
          actions: [],
          target: { dealId: stale.rfqId },
          attemptId: "funding-attempt",
          policy: () => undefined,
        }),
        persistPreparedAttempt: () => tabB.authorize(stale),
        authorizeWalletSubmission: () => tabB.authorize(stale),
        prepareLease: server,
        markUnknown: vi.fn(),
        abandonLease: vi.fn(),
        submit: wallet as never,
      }),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    expect(server).not.toHaveBeenCalled();
    expect(wallet).not.toHaveBeenCalled();
  });

  it("rechecks forget-wins after the lease and immediately before the final wallet sink", async () => {
    const { tabA, tabB } = memoryStorage();
    const reviewing = exactRecord("reviewing", "0x701");
    let current = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "funding-attempt",
      NOW + 1,
      ticketTarget(reviewing),
    );
    await tabA.save(current);
    const serverLease = vi.fn(async () => {
      const durable = (await tabA.load(current)) as RfqLifecycleRecord;
      const terminal = reviseRfqLifecycle(durable, {
        state: "cancelled",
        updatedAt: NOW + 2,
      });
      await tabA.save(terminal);
      await tabA.remove(terminal);
    });
    const wallet = vi.fn().mockResolvedValue({ transactionHash: "0x1" });

    await expect(
      runLocalnetFundingOrchestration({
        prepareBeforeLease: async () => ({
          account: {} as never,
          provider: {} as never,
          actions: [],
          target: { dealId: current.rfqId },
          attemptId: current.attempts.funding!.attemptId,
          policy: () => undefined,
        }),
        persistPreparedAttempt: async () => {
          current = await tabB.authorize(current);
        },
        prepareLease: serverLease,
        authorizeWalletSubmission: async () => {
          current = await tabB.authorize(current);
        },
        markUnknown: vi.fn(),
        abandonLease: vi.fn(),
        submit: wallet as never,
      }),
    ).rejects.toThrow(/forgotten RFQ ID/i);
    expect(serverLease).toHaveBeenCalledOnce();
    expect(wallet).not.toHaveBeenCalled();
  });

  it("performs the final tombstone CAS after deferred markUnknown on real submitActions", async () => {
    const { tabA, tabB } = memoryStorage();
    const reviewing = exactRecord("reviewing", "0x707");
    let current = beginRfqPhaseAttempt(
      reviewing,
      "funding",
      "funding-final-cas",
      NOW + 1,
      ticketTarget(reviewing),
    );
    await tabA.save(current);
    let releaseFence!: () => void;
    const fence = new Promise<void>((resolve) => {
      releaseFence = resolve;
    });
    const markUnknown = vi.fn(async () => fence);
    const wallet = vi.fn().mockResolvedValue({ transaction_hash: "0x1" });
    const pending = runLocalnetFundingOrchestration({
      prepareBeforeLease: async () => ({
        account: { strk20InvokeTransaction: wallet } as never,
        provider: {} as never,
        actions: [],
        target: { dealId: current.rfqId },
        attemptId: current.attempts.funding!.attemptId,
        policy: () => undefined,
      }),
      persistPreparedAttempt: async () => {
        current = await tabB.authorize(current);
      },
      prepareLease: vi.fn().mockResolvedValue(undefined),
      authorizeWalletSubmission: async () => {
        current = await tabB.authorize(current);
      },
      markUnknown,
      abandonLease: vi.fn(),
    });
    await vi.waitFor(() => expect(markUnknown).toHaveBeenCalledOnce());
    const durable = (await tabA.load(current)) as RfqLifecycleRecord;
    const terminal = reviseRfqLifecycle(durable, {
      state: "cancelled",
      updatedAt: NOW + 2,
    });
    await tabA.save(terminal);
    await tabA.remove(terminal);
    releaseFence();

    await expect(pending).rejects.toMatchObject({
      name: "Strk20WalletSubmissionUnknownError",
      cause: expect.objectContaining({
        message: expect.stringMatching(/forgotten RFQ ID/i),
      }),
    });
    expect(wallet).not.toHaveBeenCalled();
  });

  it.each(["claim", "refund"] as const)(
    "blocks %s through the production payout caller",
    async (phase) => {
      const state = phase === "claim" ? "claimable" : "refundable";
      const initial = exactRecord(state, `${phase}-forget`);
      const preparing = beginRfqPhaseAttempt(
        initial,
        phase,
        `${phase}-attempt`,
        NOW + 1,
      );
      const terminal = reviseRfqLifecycle(preparing, {
        state: phase === "claim" ? "settled" : "refunded",
        updatedAt: NOW + 2,
      });
      const { stale, tabB } = await forget(preparing, terminal);
      const wallet = vi.fn().mockResolvedValue({ transactionHash: "0xpayout" });
      await expect(
        runAuthorizedPayout(stale, {
          authorize: tabB.authorize,
          submitWallet: wallet,
        }),
      ).rejects.toThrow(/forgotten RFQ ID/i);
      expect(wallet).not.toHaveBeenCalled();
    },
  );
});
