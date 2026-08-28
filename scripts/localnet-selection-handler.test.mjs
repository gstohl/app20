import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createLocalnetReservationCoordinator } from "./localnet-reservation-coordinator.mjs";
import { selectQuoteThroughCoordinator } from "./localnet-selection-handler.mjs";

const NOW = 1_900_000_000;
const INTENT = `0x${"11".repeat(32)}`;
const A = `0x${"22".repeat(32)}`;
const B = `0x${"33".repeat(32)}`;
const QUOTE_A = `0x${"44".repeat(32)}`;
const QUOTE_B = `0x${"55".repeat(32)}`;
const REQUEST = Object.freeze({
  intentDigest: INTENT,
  rfqId: "0x77",
  account: "0xabc",
  chainId: "0x1",
  createdAt: NOW,
  expiresAt: NOW + 600,
});
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "app20-selection-route-"));
  roots.push(root);
  const path = join(root, "coordinator.json");
  const coordinator = createLocalnetReservationCoordinator(path);
  await coordinator.beginRequest({
    ...REQUEST,
    makerIds: ["maker-a", "maker-b"],
  });
  for (const [reservationId, makerId] of [
    [A, "maker-a"],
    [B, "maker-b"],
  ]) {
    await coordinator.register(
      { intentDigest: INTENT, reservationId, makerId, expiresAt: NOW + 600 },
      async () => true,
      NOW,
    );
  }
  await coordinator.completeRequestFanout(INTENT);
  return { coordinator, path };
}

function route(
  coordinator,
  reservationId,
  makerId,
  makerSelect,
  release = async () => true,
  publishConfirmed = () => undefined,
) {
  return selectQuoteThroughCoordinator({
    coordinator,
    intentDigest: INTENT,
    reservationId,
    makerId,
    makerSelect,
    publishConfirmed,
    release,
    now: NOW,
  });
}

test("barrier A/B selects persist one pending identity before maker and reject caller substitution", async () => {
  const { coordinator } = await fixture();
  let enterA;
  const enteredA = new Promise((resolve) => {
    enterA = resolve;
  });
  let finishA;
  const barrierA = new Promise((resolve) => {
    finishA = resolve;
  });
  let makerA = 0;
  let makerB = 0;
  const released = [];
  const selectingA = route(
    coordinator,
    A,
    "maker-a",
    async () => {
      makerA += 1;
      enterA();
      await barrierA;
      return { selected: true, fence: "7", quoteDigest: QUOTE_A };
    },
    async (record) => {
      released.push(record.reservationId);
      return true;
    },
  );
  await enteredA;
  assert.equal(coordinator.listRequests()[0].state, "selection-pending");
  assert.equal(coordinator.listRequests()[0].pendingSelection.reservationId, A);
  await assert.rejects(
    route(coordinator, B, "maker-b", async () => {
      makerB += 1;
      return { selected: true, fence: "9", quoteDigest: QUOTE_B };
    }),
    /selection lease|another exact|already bound/i,
  );
  assert.equal(makerB, 0);
  finishA();
  await selectingA;
  assert.equal(makerA, 1);
  assert.deepEqual(released, [B]);
  await assert.rejects(
    coordinator.releaseLosers(INTENT, B, async () => true, NOW),
    /no caller-supplied winner|release callback/i,
  );
  assert.equal(
    coordinator.list().find((record) => record.reservationId === A).state,
    "selected",
  );
  assert.notEqual(
    coordinator.list().find((record) => record.reservationId === A).state,
    "released",
  );
});

test("volatile winner publication occurs once and only after durable confirmation", async () => {
  const { coordinator } = await fixture();
  let publications = 0;
  await route(
    coordinator,
    A,
    "maker-a",
    async () => ({ selected: true, fence: "7", quoteDigest: QUOTE_A }),
    async () => true,
    (confirmed) => {
      publications += 1;
      assert.equal(coordinator.listRequests()[0].state, "selected");
      assert.equal(confirmed.reservationId, A);
      assert.equal(
        coordinator.list().find((record) => record.reservationId === A).state,
        "selected",
      );
    },
  );
  assert.equal(publications, 1);
});

test("negative and malformed maker acknowledgements cannot confirm selection", async () => {
  for (const acknowledgement of [
    { selected: false, fence: "7", quoteDigest: QUOTE_A },
    { selected: true, quoteDigest: QUOTE_A },
    { selected: true, fence: "7", quoteDigest: "not-a-digest" },
  ]) {
    const { coordinator } = await fixture();
    let publications = 0;
    await assert.rejects(
      route(
        coordinator,
        A,
        "maker-a",
        async () => acknowledgement,
        async () => true,
        () => {
          publications += 1;
        },
      ),
      /acknowledge|fence|hex|selection/i,
    );
    assert.equal(publications, 0);
    assert.equal(coordinator.listRequests()[0].state, "selection-pending");
    assert.equal(
      coordinator.list().find((record) => record.reservationId === A).state,
      "reserved",
    );
  }
});

test("lost maker acknowledgement response restarts from exact pending selection", async () => {
  const { coordinator, path } = await fixture();
  let makerSelected = false;
  await assert.rejects(
    route(coordinator, A, "maker-a", async () => {
      makerSelected = true;
      throw new Error("response lost after maker commit");
    }),
    /response lost/i,
  );
  assert.equal(coordinator.listRequests()[0].state, "selection-pending");
  const restarted = createLocalnetReservationCoordinator(path);
  const result = await route(restarted, A, "maker-a", async () => {
    assert.equal(makerSelected, true);
    return { selected: true, fence: "7", quoteDigest: QUOTE_A };
  });
  assert.equal(result.confirmed.state, "selected");
  assert.equal(restarted.listRequests()[0].state, "selected");
  assert.equal(
    restarted.list().find((record) => record.reservationId === A).state,
    "selected",
  );
});

test("confirmed A cleanup races sibling retry and exact ticket funding without releasing A", async () => {
  const { coordinator } = await fixture();
  let cleanupEntered;
  const entered = new Promise((resolve) => {
    cleanupEntered = resolve;
  });
  let finishCleanup;
  const cleanupBarrier = new Promise((resolve) => {
    finishCleanup = resolve;
  });
  const released = [];
  let publications = 0;
  let makerB = 0;
  const first = route(
    coordinator,
    A,
    "maker-a",
    async () => ({ selected: true, fence: "7", quoteDigest: QUOTE_A }),
    async (record) => {
      released.push(record.reservationId);
      cleanupEntered();
      await cleanupBarrier;
      return true;
    },
    () => {
      publications += 1;
      assert.equal(coordinator.listRequests()[0].state, "selected");
    },
  );
  await entered;
  assert.equal(publications, 1);
  assert.equal(coordinator.listRequests()[0].state, "selected");
  assert.equal(
    coordinator.list().find((record) => record.reservationId === A).state,
    "selected",
  );

  await assert.rejects(
    route(coordinator, B, "maker-b", async () => {
      makerB += 1;
      return { selected: true, fence: "9", quoteDigest: QUOTE_B };
    }),
    /another exact|already bound|known durable reservation/i,
  );
  assert.equal(makerB, 0);

  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: A,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE_A,
    sellToken: "0x1",
    sellAmount: "100",
    buyToken: "0x2",
    buyAmount: "200",
    deadline: NOW + 600,
    attemptId: "cleanup-race",
  };
  await coordinator.authorizeFundingTicket(target);
  assert.equal(coordinator.listRequests()[0].state, "ticket-pending");
  await coordinator.persistFundingTicket({ ...target, ticketAddress: "0xabc" });
  assert.equal(coordinator.listRequests()[0].state, "ticket-ready");
  await coordinator.prepareFunding({ ...target, ticketAddress: "0xabc" });
  assert.equal(coordinator.listRequests()[0].state, "funding-pending");
  assert.equal(
    coordinator.list().find((record) => record.reservationId === A).state,
    "selected",
  );

  finishCleanup();
  await first;
  assert.deepEqual(released, [B]);
  assert.equal(coordinator.listRequests()[0].state, "funding-pending");
  assert.equal(
    coordinator.list().find((record) => record.reservationId === A).state,
    "selected",
  );
});
