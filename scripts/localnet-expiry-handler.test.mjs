import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createLocalnetExpiryHandler } from "./localnet-expiry-handler.mjs";
import { createLocalnetReservationCoordinator } from "./localnet-reservation-coordinator.mjs";
import { validateLocalnetDealObservation } from "./localnet-deal-validator.mjs";

const NOW = 1_900_000_000;
const DEADLINE = NOW + 600;
const INTENT = `0x${"11".repeat(32)}`;
const RESERVATION = `0x${"22".repeat(32)}`;
const QUOTE = `0x${"33".repeat(32)}`;
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function fixture(failAt) {
  const root = mkdtempSync(join(tmpdir(), "app20-expiry-handler-"));
  roots.push(root);
  const path = join(root, "coordinator.json");
  let coordinator = createLocalnetReservationCoordinator(path);
  await coordinator.beginRequest({
    intentDigest: INTENT,
    rfqId: "0x77",
    account: "0xabc",
    chainId: "0x1",
    createdAt: NOW,
    expiresAt: DEADLINE,
    market: "0x1/0x2",
  });
  await coordinator.register(
    {
      intentDigest: INTENT,
      reservationId: RESERVATION,
      makerId: "maker-a",
      expiresAt: DEADLINE,
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
  const coordinatorTarget = {
    intentDigest: INTENT,
    rfqId: "0x77",
    account: "0xabc",
    chainId: "0x1",
    dealId: "0x77",
    reservationId: RESERVATION,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
    sellToken: "0x1",
    sellAmount: "100",
    buyToken: "0x2",
    buyAmount: "200",
    deadline: DEADLINE,
    ticketAddress: "0xabc",
    attemptId: "funding-expiry",
  };
  await coordinator.authorizeFundingTicket(coordinatorTarget);
  await coordinator.persistFundingTicket(coordinatorTarget);
  await coordinator.prepareFunding(coordinatorTarget);
  await coordinator.markFundingUnknown(coordinatorTarget);
  await coordinator.observeFunded(coordinatorTarget);

  // The production regression: live owner is gone and the coordinator restarts.
  const makerById = new Map([
    ["maker-a", { solverId: "maker-a" }],
  ]);
  let time = DEADLINE;
  let failed = false;
  const target = {
    intentDigest: INTENT,
    rfqId: "0x77",
    account: "0xabc",
    chainId: "0x1",
    dealId: "0x77",
    reservationId: RESERVATION,
    solverId: "maker-a",
    reservationFence: "7",
    quoteDigest: QUOTE,
    sellToken: "0x1",
    sellAmount: 100n,
    buyToken: "0x2",
    buyAmount: 200n,
    deadline: DEADLINE,
    ticketAddress: "0xabc",
  };
  let handler;
  let reservationOwners;
  const restart = () => {
    coordinator = createLocalnetReservationCoordinator(path);
    reservationOwners = new Map();
    handler = createLocalnetExpiryHandler({
      coordinator,
      makerById,
      reservationOwners,
      observeEscrow: async () => ({
        status: 1,
        legAToken: "0x1",
        legAAmount: 100n,
        legBToken: "0x2",
        legBTerms: 200n,
        legBAmount: 0n,
        deadline: DEADLINE,
        ticket: "0xabc",
      }),
      validateFundedObservation: (exact, observed, expectedStatus) =>
        validateLocalnetDealObservation(
          observed,
          exact,
          expectedStatus,
        ),
      readTime: async () => time,
      advanceTime: async (next) => {
        time = next;
      },
      now: () => NOW + 1,
      afterBarrier: async (phase) => {
        if (!failed && phase === failAt) {
          failed = true;
          throw new Error(`${phase} response barrier lost`);
        }
      },
    });
  };
  restart();
  return {
    get coordinator() {
      return coordinator;
    },
    get handler() {
      return handler;
    },
    get reservationOwners() {
      return reservationOwners;
    },
    restart,
    target,
  };
}

for (const barrier of ["bind", "time", "terminal", "response"]) {
  test(`production expiry handler retries after ${barrier} barrier without maker release`, async () => {
    const exact = await fixture(barrier);
    assert.equal(exact.reservationOwners.size, 0);
    assert.equal(exact.handler.resolveOwner(exact.target)?.selected, true);
    await assert.rejects(
      exact.handler.expire(exact.target),
      new RegExp(`${barrier} response barrier lost`),
    );
    // Simulate the crash: both production composition and live owner cache are
    // discarded. Retry is reconstructed solely from the durable journal.
    exact.restart();
    assert.equal(exact.reservationOwners.size, 0);
    const restoredOwner = exact.handler.resolveOwner(exact.target);
    assert.equal(restoredOwner?.client.solverId, "maker-a");
    assert.equal(restoredOwner?.selected, true);
    assert.equal(restoredOwner?.intentDigest, INTENT);
    assert.equal(restoredOwner?.fence, "7");
    assert.equal(restoredOwner?.quoteDigest, QUOTE);
    assert.equal(restoredOwner?.sellAmount, 100n);
    assert.equal(restoredOwner?.buyAmount, 200n);
    assert.equal(restoredOwner?.deadline, DEADLINE);
    assert.deepEqual(await exact.handler.expire(exact.target), {
      expiredAt: DEADLINE + 1,
    });
    assert.equal(exact.coordinator.listRequests()[0].state, "expired");
    assert.equal(exact.coordinator.list()[0].state, "selected");
  });
}
