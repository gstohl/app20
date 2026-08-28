import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { resolveExactLocalnetReservationOwner } from "./localnet-expiry-handler.mjs";
import { createLocalnetReservationCoordinator } from "./localnet-reservation-coordinator.mjs";
import { runLocalnetEnsureTicketRoute } from "./localnet-ticket-handler.mjs";

const NOW = 1_900_000_000;
const INTENT = `0x${"11".repeat(32)}`;
const RESERVATION = `0x${"22".repeat(32)}`;
const QUOTE = `0x${"33".repeat(32)}`;
const REQUEST = Object.freeze({
  intentDigest: INTENT,
  rfqId: "0x77",
  account: "0xabc",
  chainId: "0x1",
  createdAt: NOW,
  expiresAt: NOW + 600,
});
const TARGET = Object.freeze({
  ...REQUEST,
  dealId: REQUEST.rfqId,
  reservationId: RESERVATION,
  makerId: "maker-a",
  fence: "7",
  quoteDigest: QUOTE,
  attemptId: "ticket-attempt",
});
const TERMS = Object.freeze({
  sellToken: "0x1",
  sellAmount: "100",
  buyToken: "0x2",
  buyAmount: "200",
  deadline: NOW + 600,
});
const roots = [];
const servers = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise((resolve) => server.close(() => resolve(undefined))),
      ),
  );
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function obstructJournalParent(path) {
  const parent = dirname(path);
  const durableParent = `${parent}.durable`;
  renameSync(parent, durableParent);
  writeFileSync(parent, "not a directory", { mode: 0o600 });
  return {
    durablePath: path.replace(parent, durableParent),
    restore() {
      rmSync(parent, { force: true });
      renameSync(durableParent, parent);
    },
  };
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "app20-ticket-route-"));
  roots.push(root);
  const path = join(root, "journal", "coordinator.json");
  let coordinator = createLocalnetReservationCoordinator(path);
  await coordinator.beginRequest({ ...REQUEST, market: "0x1/0x2" });
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
  const client = { solverId: "maker-a" };
  const makerById = new Map([[client.solverId, client]]);
  const reservationOwner = {
    client,
    intentDigest: INTENT,
    selected: true,
    fence: "7",
    quoteDigest: QUOTE,
    sellToken: TERMS.sellToken,
    sellAmount: BigInt(TERMS.sellAmount),
    buyToken: TERMS.buyToken,
    buyAmount: BigInt(TERMS.buyAmount),
    deadline: TERMS.deadline,
  };
  let reservationOwners = new Map([[RESERVATION, reservationOwner]]);
  let chainTicket;
  let chainEffects = 0;
  let ensureTicket = async (dealId) => {
    assert.equal(dealId, TARGET.dealId);
    if (!chainTicket) {
      chainTicket = "0xabc";
      chainEffects += 1;
    }
    return chainTicket;
  };
  let loseResponse = false;

  const server = createServer(async (request, response) => {
    try {
      if (
        request.method !== "POST" ||
        request.url !== "/escrow/ensure-ticket"
      ) {
        response.writeHead(404).end();
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = await runLocalnetEnsureTicketRoute({
        coordinator,
        target: body.target,
        settlementTerms: body.settlementTerms,
        resolveOwner: (target) =>
          resolveExactLocalnetReservationOwner({
            coordinator,
            makerById,
            reservationOwners,
            target,
          }),
        validateOwner: (owner, exact) => {
          if (
            !owner?.selected ||
            owner.intentDigest !== exact.intentDigest ||
            owner.client?.solverId !== exact.makerId ||
            String(owner.fence) !== String(exact.fence) ||
            owner.quoteDigest !== exact.quoteDigest ||
            owner.sellToken !== exact.sellToken ||
            owner.sellAmount !== BigInt(exact.sellAmount) ||
            owner.buyToken !== exact.buyToken ||
            owner.buyAmount !== BigInt(exact.buyAmount) ||
            owner.deadline !== exact.deadline
          )
            throw new Error(
              "coordinator selection does not authorize the exact funding ticket target.",
            );
        },
        ensureTicket: (dealId) => ensureTicket(dealId),
      });
      if (loseResponse) {
        loseResponse = false;
        throw new Error("ticket response lost after journal finalization");
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ result }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}/escrow/ensure-ticket`;
  const post = async (target = TARGET, settlementTerms = TERMS) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, settlementTerms }),
    });
    return { status: response.status, payload: await response.json() };
  };
  return {
    post,
    get coordinator() {
      return coordinator;
    },
    restart(options) {
      coordinator = createLocalnetReservationCoordinator(path, options);
      reservationOwners = new Map();
    },
    path,
    restoreReservationOwner() {
      reservationOwners = new Map([[RESERVATION, reservationOwner]]);
    },
    setEnsure(next) {
      ensureTicket = next;
    },
    getChainTicket: () => chainTicket,
    getChainEffects: () => chainEffects,
    setChainTicket(value) {
      if (!chainTicket && value) chainEffects += 1;
      chainTicket = value;
    },
    loseNextResponse() {
      loseResponse = true;
    },
  };
}

test("composed /escrow/ensure-ticket makes ticket-pending an exclusive durable lease", async () => {
  const exact = await fixture();
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let finish;
  const barrier = new Promise((resolve) => {
    finish = resolve;
  });
  exact.setEnsure(async () => {
    entered();
    await barrier;
    exact.setChainTicket("0xabc");
    return "0xabc";
  });
  const pendingResponse = exact.post();
  await started;
  const pending = exact.coordinator.listRequests()[0];
  assert.equal(pending.state, "ticket-pending");
  assert.equal(pending.ticketAttemptId, TARGET.attemptId);
  assert.equal(pending.ticketDealId, TARGET.dealId);
  assert.deepEqual(pending.ticketSettlementTerms, TERMS);
  await assert.rejects(
    exact.coordinator.acquireReleaseLease({
      ...REQUEST,
      releaseLeaseId: "release-during-ticket",
      now: NOW + 1,
    }),
    /ticket-pending/i,
  );
  assert.deepEqual(
    await exact.coordinator.releaseLosers(INTENT, async () => true, NOW + 1),
    [],
  );
  assert.equal(exact.coordinator.list()[0].state, "selected");
  await assert.rejects(
    exact.coordinator.prepareFunding({
      ...TARGET,
      ...TERMS,
      ticketAddress: "0xabc",
    }),
    /ticket-pending/i,
  );
  await assert.rejects(
    exact.coordinator.authorizeFundingTicket({
      ...TARGET,
      ...TERMS,
      attemptId: "sibling-attempt",
    }),
    /another exact browser/i,
  );
  finish();
  assert.deepEqual(await pendingResponse, {
    status: 200,
    payload: { result: { ticketAddress: "0xabc" } },
  });
  assert.equal(exact.coordinator.listRequests()[0].state, "ticket-ready");
});

test("ticket-pending recovers crashes before and after the chain side effect with an empty owner cache", async () => {
  for (const phase of ["before", "after"]) {
    const exact = await fixture();
    let failed = false;
    exact.setEnsure(async () => {
      if (phase === "after") exact.setChainTicket("0xabc");
      failed = true;
      throw new Error(`crash ${phase} chain side effect`);
    });
    const first = await exact.post();
    assert.equal(first.status, 400);
    assert.equal(failed, true);
    assert.equal(exact.coordinator.listRequests()[0].state, "ticket-pending");

    exact.restart();
    exact.setEnsure(async (dealId) => {
      assert.equal(dealId, TARGET.dealId);
      if (!exact.getChainTicket()) exact.setChainTicket("0xabc");
      return exact.getChainTicket();
    });
    const replay = await exact.post();
    assert.equal(replay.status, 200);
    assert.equal(replay.payload.result.ticketAddress, "0xabc");
    const ready = exact.coordinator.listRequests()[0];
    assert.equal(ready.state, "ticket-ready");
    assert.equal(ready.ticketAuthorization.ticketAddress, "0xabc");
    assert.deepEqual(ready.ticketAuthorization.settlementTerms, {
      ...TERMS,
      ticketAddress: "0xabc",
    });
  }
});

test("response loss, exact restart replay, and deliberate ticket-ready release are safe", async () => {
  const exact = await fixture();
  exact.loseNextResponse();
  const lost = await exact.post();
  assert.equal(lost.status, 400);
  assert.equal(exact.coordinator.listRequests()[0].state, "ticket-ready");
  exact.restart();
  const replay = await exact.post();
  assert.deepEqual(replay, {
    status: 200,
    payload: { result: { ticketAddress: "0xabc" } },
  });
  const released = await exact.coordinator.acquireReleaseLease({
    ...REQUEST,
    releaseLeaseId: "deliberate-ready-release",
    now: NOW + 1,
  });
  assert.equal(released.state, "release-check");
});

test("all durable commit stages fail-stop pending ticket publication before the chain sink", async () => {
  for (const stage of [
    "serialize",
    "mkdir",
    "write",
    "file-fsync",
    "rename",
    "chmod",
    "dir-fsync",
  ]) {
    const exact = await fixture();
    let injected = false;
    exact.restart({
      faultInjector(candidate) {
        if (!injected && candidate === stage) {
          injected = true;
          throw new Error(`injected ${stage} failure`);
        }
      },
    });
    // A selected journal has no durable ticket terms yet, so owner recovery
    // must reach validation before the commit fault can be exercised.
    exact.restoreReservationOwner();

    const first = await exact.post();
    assert.equal(first.status, 400, stage);
    assert.equal(injected, true, stage);
    assert.equal(exact.getChainEffects(), 0, stage);
    assert.equal(exact.coordinator.listRequests()[0].state, "selected", stage);
    assert.equal(
      createLocalnetReservationCoordinator(exact.path).listRequests()[0].state,
      "selected",
      stage,
    );

    const sameInstanceRetry = await exact.post();
    assert.equal(sameInstanceRetry.status, 400, stage);
    assert.match(sameInstanceRetry.payload.error, /fail-stopped/i, stage);
    assert.equal(exact.getChainEffects(), 0, stage);

    exact.restart();
    exact.restoreReservationOwner();
    exact.setEnsure(async () => {
      assert.equal(
        createLocalnetReservationCoordinator(exact.path).listRequests()[0]
          .state,
        "ticket-pending",
        stage,
      );
      exact.setChainTicket("0xabc");
      return "0xabc";
    });
    const recovered = await exact.post();
    assert.equal(recovered.status, 200, stage);
    assert.equal(exact.getChainEffects(), 1, stage);
    assert.equal(
      createLocalnetReservationCoordinator(exact.path).listRequests()[0].state,
      "ticket-ready",
      stage,
    );
  }
});

test("all durable commit stages recover final ticket publication from pending without another chain effect", async () => {
  for (const stage of [
    "serialize",
    "mkdir",
    "write",
    "file-fsync",
    "rename",
    "chmod",
    "dir-fsync",
  ]) {
    const exact = await fixture();
    await exact.coordinator.authorizeFundingTicket({ ...TARGET, ...TERMS });
    assert.equal(
      createLocalnetReservationCoordinator(exact.path).listRequests()[0].state,
      "ticket-pending",
      stage,
    );
    let injected = false;
    exact.restart({
      faultInjector(candidate) {
        if (!injected && candidate === stage) {
          injected = true;
          throw new Error(`injected final ${stage} failure`);
        }
      },
    });

    const first = await exact.post();
    assert.equal(first.status, 400, stage);
    assert.equal(injected, true, stage);
    assert.equal(exact.getChainEffects(), 1, stage);
    assert.equal(
      exact.coordinator.listRequests()[0].state,
      "ticket-pending",
      stage,
    );
    assert.equal(
      createLocalnetReservationCoordinator(exact.path).listRequests()[0].state,
      "ticket-pending",
      stage,
    );

    const sameInstanceRetry = await exact.post();
    assert.equal(sameInstanceRetry.status, 400, stage);
    assert.equal(exact.getChainEffects(), 1, stage);
    assert.match(sameInstanceRetry.payload.error, /fail-stopped/i, stage);

    exact.restart();
    const recovered = await exact.post();
    assert.equal(recovered.status, 200, stage);
    assert.equal(exact.getChainEffects(), 1, stage);
    assert.equal(
      createLocalnetReservationCoordinator(exact.path).listRequests()[0].state,
      "ticket-ready",
      stage,
    );
  }
});

test("real parent-path failures fail-stop pending and final ticket publication", async () => {
  const pending = await fixture();
  pending.restart();
  pending.restoreReservationOwner();
  const blockedPending = obstructJournalParent(pending.path);
  const pendingFailure = await pending.post();
  assert.equal(pendingFailure.status, 400);
  assert.match(pendingFailure.payload.error, /fail-stopped/i);
  assert.equal(pending.getChainEffects(), 0);
  assert.equal(pending.coordinator.listRequests()[0].state, "selected");
  assert.equal(
    createLocalnetReservationCoordinator(
      blockedPending.durablePath,
    ).listRequests()[0].state,
    "selected",
  );
  blockedPending.restore();
  const pendingSameInstance = await pending.post();
  assert.equal(pendingSameInstance.status, 400);
  assert.match(pendingSameInstance.payload.error, /fail-stopped/i);
  assert.equal(pending.getChainEffects(), 0);

  pending.restart();
  pending.restoreReservationOwner();
  pending.setEnsure(async () => {
    assert.equal(
      createLocalnetReservationCoordinator(pending.path).listRequests()[0]
        .state,
      "ticket-pending",
    );
    pending.setChainTicket("0xabc");
    return "0xabc";
  });
  assert.equal((await pending.post()).status, 200);
  assert.equal(pending.getChainEffects(), 1);
  assert.equal(
    createLocalnetReservationCoordinator(pending.path).listRequests()[0].state,
    "ticket-ready",
  );

  const final = await fixture();
  await final.coordinator.authorizeFundingTicket({ ...TARGET, ...TERMS });
  final.restart();
  const blockedFinal = obstructJournalParent(final.path);
  const finalFailure = await final.post();
  assert.equal(finalFailure.status, 400);
  assert.match(finalFailure.payload.error, /fail-stopped/i);
  assert.equal(final.getChainEffects(), 1);
  assert.equal(final.coordinator.listRequests()[0].state, "ticket-pending");
  assert.equal(
    createLocalnetReservationCoordinator(
      blockedFinal.durablePath,
    ).listRequests()[0].state,
    "ticket-pending",
  );
  blockedFinal.restore();
  const finalSameInstance = await final.post();
  assert.equal(finalSameInstance.status, 400);
  assert.match(finalSameInstance.payload.error, /fail-stopped/i);
  assert.equal(final.getChainEffects(), 1);

  final.restart();
  assert.equal((await final.post()).status, 200);
  assert.equal(final.getChainEffects(), 1);
  assert.equal(
    createLocalnetReservationCoordinator(final.path).listRequests()[0].state,
    "ticket-ready",
  );
});

test("composed route rejects sibling, term, omission, and ticket-address substitution", async () => {
  const exact = await fixture();
  assert.equal((await exact.post()).status, 200);
  exact.restart();

  for (const [field, value] of [
    ["intentDigest", `0x${"55".repeat(32)}`],
    ["rfqId", "0x78"],
    ["account", "0xabd"],
    ["chainId", "0x2"],
    ["dealId", "0x78"],
    ["reservationId", `0x${"66".repeat(32)}`],
    ["makerId", "maker-b"],
    ["fence", "8"],
    ["quoteDigest", `0x${"77".repeat(32)}`],
    ["attemptId", "sibling-attempt"],
  ]) {
    const rejected = await exact.post({ ...TARGET, [field]: value });
    assert.equal(rejected.status, 400, field);
  }
  for (const [field, value] of [
    ["sellToken", "0x3"],
    ["sellAmount", "101"],
    ["buyToken", "0x4"],
    ["buyAmount", "201"],
    ["deadline", TERMS.deadline + 1],
  ]) {
    const rejected = await exact.post(TARGET, { ...TERMS, [field]: value });
    assert.equal(rejected.status, 400, field);
  }
  const { buyAmount: _omitted, ...missingTerms } = TERMS;
  assert.equal((await exact.post(TARGET, missingTerms)).status, 400);

  exact.setEnsure(async () => "0xdef");
  const substituted = await exact.post();
  assert.equal(substituted.status, 400);
  assert.match(substituted.payload.error, /changed.*address|replay/i);

  const missing = await fixture();
  missing.setEnsure(async () => undefined);
  const missingAddress = await missing.post();
  assert.equal(missingAddress.status, 400);
  assert.match(missingAddress.payload.error, /ticketAddress/i);
  assert.equal(missing.coordinator.listRequests()[0].state, "ticket-pending");
});
