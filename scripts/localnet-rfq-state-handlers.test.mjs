import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createLocalnetReservationCoordinator } from "./localnet-reservation-coordinator.mjs";
import { createLocalnetRfqStateHandlers } from "./localnet-rfq-state-handlers.mjs";
import { validateLocalnetDealObservation } from "./localnet-deal-validator.mjs";
import { dispatchLocalnetMakerFill } from "./localnet-maker-http.mjs";
import { runLocalnetSolve } from "./localnet-solve-handler.mjs";
import {
  bindExpiryHttpTargetThroughCoordinator,
  terminalizeHttpTargetThroughCoordinator,
} from "./localnet-release-boundary.mjs";

const NOW = 1_900_000_000;
const INTENT = `0x${"11".repeat(32)}`;
const RESERVATION = `0x${"22".repeat(32)}`;
const QUOTE = `0x${"33".repeat(32)}`;
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "app20-rfq-handler-"));
  roots.push(root);
  const coordinator = createLocalnetReservationCoordinator(
    join(root, "coordinator.json"),
  );
  const request = {
    intentDigest: INTENT,
    rfqId: "0x77",
    account: "0xabc",
    chainId: "0x1",
    createdAt: NOW,
    expiresAt: NOW + 600,
    market: "0x1/0x2",
  };
  await coordinator.beginRequest(request);
  await coordinator.register(
    {
      intentDigest: INTENT,
      reservationId: RESERVATION,
      makerId: "maker-a",
      expiresAt: NOW + 600,
    },
    async () => true,
  );
  await coordinator.completeRequestFanout(INTENT);
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: RESERVATION,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    requestDigest: INTENT,
    intentDigest: INTENT,
    rfqId: "0x77",
    dealId: "0x77",
    account: "0xabc",
    chainId: "0x1",
    reservationId: RESERVATION,
    solverId: "maker-a",
    reservationFence: "7",
    quoteDigest: QUOTE,
    sellToken: "0x1",
    sellAmount: 100n,
    buyToken: "0x2",
    buyAmount: 200n,
    deadline: NOW + 600,
    ticketAddress: "0xabc",
  };
  let releaseCalls = 0;
  const handlers = createLocalnetRfqStateHandlers({
    coordinator,
    observeEscrow: options.observeEscrow ?? (async () => ({ status: 0 })),
    release: async () => {
      releaseCalls += 1;
      return options.releaseResult ?? true;
    },
    now: () => NOW + 1,
    afterReleaseObservation: options.afterReleaseObservation,
    validateFundedObservation: options.validateFundedObservation,
  });
  return { coordinator, handlers, target, releaseCalls: () => releaseCalls };
}

async function authorizeTicket(exact, attemptId) {
  const target = {
    intentDigest: exact.target.intentDigest,
    rfqId: exact.target.rfqId,
    account: exact.target.account,
    chainId: exact.target.chainId,
    dealId: exact.target.dealId,
    reservationId: exact.target.reservationId,
    makerId: exact.target.solverId,
    fence: exact.target.reservationFence,
    quoteDigest: exact.target.quoteDigest,
    sellToken: exact.target.sellToken,
    sellAmount: exact.target.sellAmount,
    buyToken: exact.target.buyToken,
    buyAmount: exact.target.buyAmount,
    deadline: exact.target.deadline,
    ticketAddress: exact.target.ticketAddress,
    attemptId,
  };
  await exact.coordinator.authorizeFundingTicket(target);
  await exact.coordinator.persistFundingTicket(target);
}

function exactDeal(status) {
  return {
    status,
    legAToken: "0x1",
    legAAmount: 100n,
    legBToken: "0x2",
    legBTerms: 200n,
    legBAmount: status === 2 || status === 3 ? 200n : 0n,
    deadline: NOW + 600,
    ticket: "0xabc",
  };
}

function productionValidator(target, observed, expectedStatus) {
  return validateLocalnetDealObservation(
    observed,
    target,
    expectedStatus,
  );
}

function barrier() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("release observation lease wins before funding and maker callback is reached only by that lease", async () => {
  const observed = barrier();
  const continueRelease = barrier();
  const { handlers, target, releaseCalls } = await fixture({
    observeEscrow: async () => {
      observed.release();
      return { status: 0 };
    },
    afterReleaseObservation: async () => continueRelease.promise,
  });
  const releasing = handlers.releaseIntent(target, "release-1");
  await observed.promise;
  await assert.rejects(
    handlers.prepareFunding(target, "funding-1"),
    /release-check|release/i,
  );
  assert.equal(releaseCalls(), 0);
  continueRelease.release();
  assert.equal((await releasing).released, true);
  assert.equal(releaseCalls(), 1);
});

test("funding lease wins before release observation and no maker callback is reached", async () => {
  const exact = await fixture();
  const { handlers, target, releaseCalls } = exact;
  await authorizeTicket(exact, "funding-1");
  await handlers.prepareFunding(target, "funding-1");
  await assert.rejects(
    handlers.releaseIntent(target, "release-1"),
    /funding-pending/i,
  );
  assert.equal(releaseCalls(), 0);
  await handlers.markFundingUnknown(target, "funding-1");
  await assert.rejects(
    handlers.releaseIntent(target, "release-2"),
    /funding-unknown/i,
  );
  assert.equal(releaseCalls(), 0);
});

test("release lease records a nonzero escrow observation as funded without a maker callback", async () => {
  const { coordinator, handlers, target, releaseCalls } = await fixture({
    observeEscrow: async () => ({ status: 1 }),
  });
  await assert.rejects(
    handlers.releaseIntent(target, "release-observed-funded"),
    /blocked after funding/i,
  );
  assert.equal(releaseCalls(), 0);
  assert.equal(coordinator.listRequests()[0].state, "funded");
  assert.equal(coordinator.listDeals()[0].reservationId, RESERVATION);
});

test("release and funding observation reject a mutated settlement deadline before coordinator authorization", async () => {
  const validateFundedObservation = (_target, observed) => {
    if (observed.deadline !== NOW + 600)
      throw new Error("durable settlement deadline mismatch");
  };
  const released = await fixture({
    observeEscrow: async () => ({ status: 1, deadline: NOW + 1 }),
    validateFundedObservation,
  });
  await assert.rejects(
    released.handlers.releaseIntent(
      released.target,
      "release-deadline-mismatch",
    ),
    /deadline mismatch/i,
  );
  assert.equal(released.coordinator.listRequests()[0].state, "release-check");
  assert.equal(released.releaseCalls(), 0);

  const funded = await fixture({
    observeEscrow: async () => ({ status: 1, deadline: NOW + 1 }),
    validateFundedObservation,
  });
  await authorizeTicket(funded, "funding-deadline");
  await funded.handlers.prepareFunding(funded.target, "funding-deadline");
  await assert.rejects(
    funded.handlers.observeFunding(funded.target, "funding-deadline"),
    /deadline mismatch/i,
  );
  assert.equal(funded.coordinator.listRequests()[0].state, "funding-pending");
});

test("terminal escrow collisions never become funded or reach a maker callback", async () => {
  const { coordinator, handlers, target, releaseCalls } = await fixture({
    observeEscrow: async () => ({ status: 4 }),
  });
  await assert.rejects(
    handlers.releaseIntent(target, "release-terminal-collision"),
    /terminal|malformed|collision/i,
  );
  assert.equal(releaseCalls(), 0);
  assert.equal(coordinator.listRequests()[0].state, "release-check");
  assert.equal(coordinator.listDeals().length, 0);
});

test("stale-tab release then funding is rejected and ambiguous funding cannot resubmit", async () => {
  const { handlers, target } = await fixture();
  assert.equal(
    (await handlers.releaseIntent(target, "release-stale")).released,
    true,
  );
  await assert.rejects(
    handlers.prepareFunding(target, "funding-after-release"),
    /released/i,
  );

  const second = await fixture();
  await authorizeTicket(second, "funding-unknown");
  await second.handlers.prepareFunding(second.target, "funding-unknown");
  await second.handlers.markFundingUnknown(second.target, "funding-unknown");
  await assert.rejects(
    second.handlers.prepareFunding(second.target, "different-attempt"),
    /unknown|reconcile/i,
  );
  await assert.rejects(
    second.handlers.prepareFunding(second.target, "funding-unknown"),
    /unknown|reconcile/i,
  );
  await assert.rejects(
    second.handlers.abandonFunding(second.target, "funding-unknown"),
    /pre-submission/i,
  );
});

test("release-check and release-pending winners accept exact abandonment", async () => {
  const observed = barrier();
  const continueRelease = barrier();
  const checking = await fixture({
    observeEscrow: async () => {
      observed.release();
      return { status: 0 };
    },
    afterReleaseObservation: async () => continueRelease.promise,
  });
  const releasing = checking.handlers.releaseIntent(
    checking.target,
    "release-check-first",
  );
  await observed.promise;
  assert.equal(
    (
      await checking.handlers.abandonFunding(
        checking.target,
        "abandon-during-check",
      )
    ).state,
    "release-check",
  );
  continueRelease.release();
  assert.equal((await releasing).released, true);

  const pending = await fixture({ releaseResult: false });
  assert.equal(
    (await pending.handlers.releaseIntent(pending.target, "release-pending-first"))
      .released,
    false,
  );
  assert.equal(
    (
      await pending.handlers.abandonFunding(
        pending.target,
        "abandon-during-pending",
      )
    ).state,
    "release-pending",
  );
});

test("release-first selected/no-lease abandonment is exact, idempotent, and funding-closed", async () => {
  const { coordinator, handlers, target, releaseCalls } = await fixture();
  assert.equal(
    (await handlers.releaseIntent(target, "release-won-first")).released,
    true,
  );
  const abandoned = await handlers.abandonFunding(
    target,
    "browser-preparing-after-release",
  );
  assert.equal(abandoned.state, "released");
  assert.equal(
    abandoned.abandonedFundingAttemptId,
    "browser-preparing-after-release",
  );
  assert.equal(
    (await handlers.abandonFunding(target, "browser-preparing-after-release"))
      .state,
    "released",
  );
  await assert.rejects(
    handlers.prepareFunding(target, "browser-preparing-after-release"),
    /released|funding-closed/i,
  );
  assert.equal(coordinator.listRequests()[0].state, "released");
  assert.equal(releaseCalls(), 1);
});

test("funding unknown cannot be reopened by any reverted hash or caller binding", async () => {
  const exact = await fixture();
  const { coordinator, handlers, target } = exact;
  await authorizeTicket(exact, "funding-reverted");
  await handlers.prepareFunding(target, "funding-reverted");
  await handlers.markFundingUnknown(target, "funding-reverted");
  assert.equal(handlers.resolveFundingReverted, undefined);
  await assert.rejects(
    coordinator.resolveFundingReverted({
      ...target,
      makerId: target.solverId,
      fence: target.reservationFence,
      attemptId: "funding-reverted",
      transactionHash: "0xdead",
    }),
    /disabled|fail-closed/i,
  );
  assert.equal(coordinator.listRequests()[0].state, "funding-unknown");
});

for (const [status, terminalState] of [
  [1, "funded"],
  [2, "filled"],
  [3, "settled"],
  [4, "refunded"],
]) {
  test(`status ${status} convergence establishes ${terminalState} before browser acknowledgement`, async () => {
    const exact = await fixture({
      observeEscrow: async () => exactDeal(status),
      validateFundedObservation: productionValidator,
    });
    await authorizeTicket(exact, `funding-${status}`);
    await exact.handlers.prepareFunding(exact.target, `funding-${status}`);
    await exact.handlers.markFundingUnknown(exact.target, `funding-${status}`);
    await exact.handlers.convergeObservation(
      exact.target,
      `funding-${status}`,
      status,
    );
    assert.equal(exact.coordinator.listRequests()[0].state, terminalState);
    const releaseEffects = exact.releaseCalls();

    // Reload/retry of the same production handler is exact and idempotent.
    await exact.handlers.convergeObservation(
      exact.target,
      `funding-${status}`,
      status,
    );
    assert.equal(exact.coordinator.listRequests()[0].state, terminalState);
    assert.equal(exact.releaseCalls(), releaseEffects);
    assert.equal(releaseEffects, 0);
  });
}

test("production-composed solve -> status 2 -> claim/status 3 is exact and effect-once", async () => {
  let currentDeal = exactDeal(1);
  const exact = await fixture({
    observeEscrow: async () => currentDeal,
    validateFundedObservation: productionValidator,
  });
  await authorizeTicket(exact, "funding-composed");
  await exact.handlers.prepareFunding(exact.target, "funding-composed");
  await exact.handlers.markFundingUnknown(exact.target, "funding-composed");
  await exact.handlers.convergeObservation(
    exact.target,
    "funding-composed",
    1,
  );

  let makerEffects = 0;
  let completed;
  const maker = {
    async fill(request) {
      const canonical = JSON.stringify(request, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      if (completed) {
        assert.equal(completed.canonical, canonical);
        return completed.result;
      }
      makerEffects += 1;
      currentDeal = exactDeal(2);
      const result = { transactionHash: "0xf11" };
      completed = { canonical, result };
      return result;
    },
  };
  const invokeSolve = (observed) =>
    runLocalnetSolve({
      target: exact.target,
      observed,
      validateObservation: productionValidator,
      bind: (target) =>
        bindExpiryHttpTargetThroughCoordinator({
          coordinator: exact.coordinator,
          target,
        }),
      submitExact: (target) =>
        dispatchLocalnetMakerFill(
          maker,
          {
            reservationId: target.reservationId,
            intentDigest: target.intentDigest,
            fence: target.reservationFence,
            quoteDigest: target.quoteDigest,
            dealId: target.dealId,
            sellToken: target.sellToken,
            sellAmount: target.sellAmount.toString(),
            buyToken: target.buyToken,
            buyAmount: target.buyAmount.toString(),
            deadline: target.deadline,
            ticketAddress: target.ticketAddress,
          },
          NOW + 1,
        ),
      reconcileCommitted: (target, observedStatus) =>
        observedStatus === 1
          ? terminalizeHttpTargetThroughCoordinator({
              coordinator: exact.coordinator,
              target,
              outcome: "filled",
            })
          : exact.handlers.convergeObservation(
              target,
              "funding-composed",
              observedStatus,
            ),
    });

  assert.deepEqual(await invokeSolve(exactDeal(1)), {
    transactionHash: "0xf11",
  });
  assert.equal(exact.coordinator.listRequests()[0].state, "filled");
  assert.deepEqual(await invokeSolve(currentDeal), {
    transactionHash: "0xf11",
  });
  currentDeal = exactDeal(3); // exact claim effect is observed on-chain
  assert.deepEqual(await invokeSolve(currentDeal), {
    transactionHash: "0xf11",
  });
  assert.equal(exact.coordinator.listRequests()[0].state, "settled");
  assert.equal(makerEffects, 1);
});

test("status 1 hydration preserves an exact coordinator expiry-recovery barrier", async () => {
  const exact = await fixture({
    observeEscrow: async () => ({ status: 1 }),
  });
  await authorizeTicket(exact, "funding-expiry-barrier");
  await exact.handlers.prepareFunding(exact.target, "funding-expiry-barrier");
  await exact.handlers.markFundingUnknown(
    exact.target,
    "funding-expiry-barrier",
  );
  await exact.handlers.convergeObservation(
    exact.target,
    "funding-expiry-barrier",
    1,
  );
  await exact.coordinator.releaseSelected(
    {
      ...exact.target,
      makerId: exact.target.solverId,
      fence: exact.target.reservationFence,
    },
    async () => true,
    NOW + 2,
  );
  await exact.coordinator.terminalize(
    {
      ...exact.target,
      makerId: exact.target.solverId,
      fence: exact.target.reservationFence,
    },
    "expired",
  );
  await exact.handlers.convergeObservation(
    exact.target,
    "funding-expiry-barrier",
    1,
  );
  assert.equal(exact.coordinator.listRequests()[0].state, "expired");
});

test("funded requests reject same and sibling funding preparations", async () => {
  const exact = await fixture({
    observeEscrow: async () => ({ status: 1 }),
  });
  const { coordinator, handlers, target } = exact;
  await authorizeTicket(exact, "funding-winner");
  await handlers.prepareFunding(target, "funding-winner");
  await handlers.markFundingUnknown(target, "funding-winner");
  await handlers.observeFunding(target, "funding-winner");
  assert.equal(coordinator.listRequests()[0].state, "funded");
  await assert.rejects(
    handlers.prepareFunding(target, "funding-winner"),
    /already.*funded|forbidden/i,
  );
  await assert.rejects(
    handlers.prepareFunding(target, "funding-sibling"),
    /already.*funded|forbidden/i,
  );
});
