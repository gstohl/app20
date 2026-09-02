import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import {
  LOCALNET_COORDINATOR_MAX_ATTEMPT_ID_BYTES,
  LOCALNET_COORDINATOR_MAX_CLOSED_TAKE_ATTEMPTS,
  createLocalnetReservationCoordinator,
  digestLocalnetV3Refusal,
} from "./localnet-reservation-coordinator.mjs";
import {
  decodeSolverQuoteV3,
  digestSolverQuoteV3,
} from "../packages/private-intents/src/index.ts";
import {
  acquireReleaseHttpTargetThroughCoordinator,
  bindExpiryHttpTargetThroughCoordinator,
  releaseFundedHttpTargetThroughCoordinator,
  releaseHttpTargetThroughCoordinator,
} from "./localnet-release-boundary.mjs";

const NOW = 1_900_000_000;
const INTENT = `0x${"11".repeat(32)}`;
const WINNER = `0x${"22".repeat(32)}`;
const LOSER = `0x${"33".repeat(32)}`;
const QUOTE = `0x${"44".repeat(32)}`;
const SETTLEMENT_TERMS = Object.freeze({
  sellToken: "0x1",
  sellAmount: "100",
  buyToken: "0x2",
  buyAmount: "200",
  deadline: NOW + 600,
  ticketAddress: "0xabc",
});
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

function journalPath() {
  const root = mkdtempSync(join(tmpdir(), "app20-reservation-coordinator-"));
  roots.push(root);
  return join(root, "makers", "coordinator-releases.json");
}

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

async function releaseRequest(coordinator, request, release, now) {
  const releaseLeaseId = `release:${request.intentDigest}`;
  await coordinator.acquireReleaseLease({
    ...request,
    releaseLeaseId,
    now,
  });
  return coordinator.releaseIntent(
    { ...request, releaseLeaseId },
    release,
    now,
  );
}

async function authorizeExactTicket(
  coordinator,
  target,
  attemptId,
  settlementTerms = SETTLEMENT_TERMS,
) {
  await coordinator.authorizeFundingTicket({
    ...target,
    ...settlementTerms,
    attemptId,
  });
  await coordinator.persistFundingTicket({
    ...target,
    ...settlementTerms,
    attemptId,
  });
}

async function fundExact(coordinator, target, attemptId = "funding-1") {
  await authorizeExactTicket(coordinator, target, attemptId);
  await coordinator.prepareFunding({
    ...target,
    ...SETTLEMENT_TERMS,
    attemptId,
  });
  await coordinator.markFundingUnknown({ ...target, attemptId });
  await coordinator.observeFunded({ ...target, attemptId });
}

async function selectWinner(coordinator) {
  return coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
}

async function fixture(path = journalPath()) {
  const coordinator = createLocalnetReservationCoordinator(path);
  await coordinator.beginRequest({ ...REQUEST, market: "0x1/0x2" });
  await coordinator.register(
    {
      intentDigest: INTENT,
      reservationId: WINNER,
      makerId: "maker-a",
      expiresAt: NOW + 600,
    },
    async () => true,
    NOW,
  );
  await coordinator.register(
    {
      intentDigest: INTENT,
      reservationId: LOSER,
      makerId: "maker-b",
      expiresAt: NOW + 600,
    },
    async () => true,
    NOW,
  );
  await coordinator.completeRequestFanout(INTENT);
  return { coordinator, path };
}

test("beginRequest fail-stops serialization and mkdir faults before maker fanout", async () => {
  for (const stage of ["serialize", "mkdir"]) {
    const path = journalPath();
    let injected = false;
    const faulted = createLocalnetReservationCoordinator(path, {
      faultInjector(candidate) {
        if (!injected && candidate === stage) {
          injected = true;
          throw new Error(`injected beginRequest ${stage}`);
        }
      },
    });
    let makerEffects = 0;
    const beginThenFanout = async (coordinator) => {
      const begun = await coordinator.beginRequest({
        ...REQUEST,
        market: "0x1/0x2",
      });
      assert.equal(
        createLocalnetReservationCoordinator(path).listRequests()[0].state,
        "open",
        stage,
      );
      makerEffects += 1;
      return begun;
    };

    await assert.rejects(beginThenFanout(faulted), /fail-stopped/i, stage);
    assert.equal(injected, true, stage);
    assert.equal(makerEffects, 0, stage);
    assert.deepEqual(faulted.listRequests(), [], stage);
    assert.equal(existsSync(path), false, stage);
    await assert.rejects(beginThenFanout(faulted), /fail-stopped/i, stage);
    assert.equal(makerEffects, 0, stage);

    await beginThenFanout(createLocalnetReservationCoordinator(path));
    assert.equal(makerEffects, 1, stage);
  }
});

test("a real parent-path failure rolls beginRequest back and fail-stops before maker fanout", async () => {
  const path = journalPath();
  writeFileSync(dirname(path), "not a directory", { mode: 0o600 });
  const faulted = createLocalnetReservationCoordinator(path);
  let makerEffects = 0;
  const beginThenFanout = async (coordinator) => {
    const begun = await coordinator.beginRequest({
      ...REQUEST,
      market: "0x1/0x2",
    });
    assert.equal(
      createLocalnetReservationCoordinator(path).listRequests()[0].state,
      "open",
    );
    makerEffects += 1;
    return begun;
  };

  await assert.rejects(beginThenFanout(faulted), /fail-stopped/i);
  assert.deepEqual(faulted.listRequests(), []);
  assert.equal(makerEffects, 0);
  assert.equal(existsSync(path), false);
  rmSync(dirname(path), { force: true });
  await assert.rejects(beginThenFanout(faulted), /fail-stopped/i);
  assert.equal(makerEffects, 0);

  await beginThenFanout(createLocalnetReservationCoordinator(path));
  assert.equal(makerEffects, 1);
});

test("a killed loser remains pending and completes after coordinator restart", async () => {
  const { coordinator, path } = await fixture();
  await selectWinner(coordinator);
  const unresolved = await coordinator.releaseLosers(
    INTENT,
    async () => {
      throw new Error("maker process stopped");
    },
    NOW,
  );
  assert.deepEqual(
    unresolved.map((entry) => entry.reservationId),
    [LOSER],
  );
  assert.equal(
    coordinator.list().find((entry) => entry.reservationId === LOSER).state,
    "release-pending",
  );

  const restarted = createLocalnetReservationCoordinator(path);
  const recovered = await restarted.recover(
    async (entry) => entry.makerId === "maker-b",
    NOW + 1,
  );
  assert.deepEqual(recovered, []);
  assert.equal(
    restarted.list().find((entry) => entry.reservationId === LOSER).state,
    "released",
  );
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("a lost release response retries idempotently after the maker committed", async () => {
  const { coordinator } = await fixture();
  await selectWinner(coordinator);
  let makerReleased = false;
  const first = await coordinator.releaseLosers(
    INTENT,
    async () => {
      makerReleased = true;
      throw new Error("response lost after commit");
    },
    NOW,
  );
  assert.equal(first.length, 1);
  const second = await coordinator.releaseLosers(
    INTENT,
    async () => makerReleased,
    NOW + 1,
  );
  assert.deepEqual(second, []);
  assert.equal(
    coordinator.list().find((entry) => entry.reservationId === LOSER).state,
    "released",
  );
});

test("recovery reaches terminal state after a crash between acknowledgement and journal write", async () => {
  const { coordinator, path } = await fixture();
  await selectWinner(coordinator);
  await coordinator.releaseLosers(INTENT, async () => false, NOW);
  const journal = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(
    journal.records.find((entry) => entry.reservationId === LOSER).state,
    "release-pending",
  );

  // The maker acknowledgement is authoritative for its local WAL, while the
  // copied journal models the coordinator dying before its terminal rewrite.
  const makerReleased = true;
  writeFileSync(path, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  const restarted = createLocalnetReservationCoordinator(path);
  assert.deepEqual(
    await restarted.recover(async () => makerReleased, NOW + 1),
    [],
  );
  assert.equal(
    restarted.list().find((entry) => entry.reservationId === LOSER).state,
    "released",
  );
});

test("an ambiguous request can idempotently release every known reservation", async () => {
  const { coordinator } = await fixture();
  const first = await releaseRequest(
    coordinator,
    REQUEST,
    async (entry) => entry.reservationId === WINNER,
    NOW,
  );
  assert.equal(first.released, false);
  assert.deepEqual(
    first.unresolved.map((entry) => entry.reservationId),
    [LOSER],
  );
  const second = await releaseRequest(
    coordinator,
    REQUEST,
    async () => true,
    NOW + 1,
  );
  assert.equal(second.released, true);
  assert.deepEqual(
    coordinator.list().map((entry) => entry.state),
    ["released", "released"],
  );
});

test("selection cannot report success while any loser release is unresolved", async () => {
  const { coordinator } = await fixture();
  await selectWinner(coordinator);
  const unresolved = await coordinator.releaseLosers(
    INTENT,
    async () => false,
    NOW,
  );
  const response = unresolved.length
    ? {
        ok: false,
        state: "quarantined",
        unresolved: unresolved.map((entry) => ({
          makerId: entry.makerId,
          reservationId: entry.reservationId,
        })),
      }
    : { ok: true };
  assert.deepEqual(response, {
    ok: false,
    state: "quarantined",
    unresolved: [{ makerId: "maker-b", reservationId: LOSER }],
  });
});

test("release racing in-flight fanout waits for late registration and terminal fanout", async () => {
  const coordinator = createLocalnetReservationCoordinator(journalPath());
  const racing = {
    ...REQUEST,
    intentDigest: `0x${"99".repeat(32)}`,
    rfqId: "0xbb",
  };
  await coordinator.beginRequest(racing);
  const early = await releaseRequest(
    coordinator,
    racing,
    async () => true,
    NOW,
  );
  assert.equal(early.released, false);
  assert.equal(coordinator.listRequests()[0].state, "release-pending");

  let releasedLate = 0;
  const registered = await coordinator.register(
    {
      intentDigest: racing.intentDigest,
      reservationId: `0x${"aa".repeat(32)}`,
      makerId: "maker-race",
      expiresAt: NOW + 600,
    },
    async () => {
      releasedLate += 1;
      return true;
    },
    NOW + 1,
  );
  assert.equal(registered.state, "released");
  assert.equal(releasedLate, 1);
  assert.equal(
    (await coordinator.completeRequestFanout(racing.intentDigest)).state,
    "released",
  );
  assert.equal(
    (await releaseRequest(coordinator, racing, async () => true, NOW + 2))
      .released,
    true,
  );
});

test("a completed zero-reservation fanout terminates release safely", async () => {
  const coordinator = createLocalnetReservationCoordinator(journalPath());
  const zero = {
    ...REQUEST,
    intentDigest: `0x${"ab".repeat(32)}`,
    rfqId: "0xcc",
  };
  await coordinator.beginRequest(zero);
  await coordinator.completeRequestFanout(zero.intentDigest);
  assert.equal(
    (await releaseRequest(coordinator, zero, async () => true, NOW + 1))
      .released,
    true,
  );
});

test("an unknown request is durably tombstoned and a late registration cannot resurrect it", async () => {
  const path = journalPath();
  const coordinator = createLocalnetReservationCoordinator(path);
  const unknown = {
    ...REQUEST,
    intentDigest: `0x${"55".repeat(32)}`,
    rfqId: "0x99",
  };
  const releaseLeaseId = "release:unknown";
  await acquireReleaseHttpTargetThroughCoordinator({
    coordinator,
    target: { ...unknown, requestDigest: unknown.intentDigest },
    releaseLeaseId,
    now: NOW,
  });
  const released = await releaseHttpTargetThroughCoordinator({
    coordinator,
    target: { ...unknown, requestDigest: unknown.intentDigest },
    releaseLeaseId,
    release: async () => true,
    now: NOW,
  });
  assert.equal(released.released, true);
  assert.equal(coordinator.listRequests()[0].state, "released");

  let lateReleaseCalls = 0;
  const late = await coordinator.register(
    {
      intentDigest: unknown.intentDigest,
      reservationId: `0x${"66".repeat(32)}`,
      makerId: "maker-late",
      expiresAt: NOW + 600,
    },
    async () => {
      lateReleaseCalls += 1;
      return true;
    },
    NOW + 1,
  );
  assert.equal(late.state, "released");
  assert.equal(lateReleaseCalls, 1);

  const restarted = createLocalnetReservationCoordinator(path);
  assert.equal(restarted.listRequests()[0].state, "released");
  await assert.rejects(
    restarted.beginRequest(unknown),
    /tombstone|resurrection/i,
  );
});

test("late registration response loss stays pending and recovers after restart", async () => {
  const path = journalPath();
  const coordinator = createLocalnetReservationCoordinator(path);
  const unknown = {
    ...REQUEST,
    intentDigest: `0x${"77".repeat(32)}`,
    rfqId: "0xaa",
  };
  await releaseRequest(coordinator, unknown, async () => true, NOW);
  const reservationId = `0x${"88".repeat(32)}`;
  const late = await coordinator.register(
    {
      intentDigest: unknown.intentDigest,
      reservationId,
      makerId: "maker-late",
      expiresAt: NOW + 600,
    },
    async () => {
      throw new Error("response lost after maker release");
    },
    NOW + 1,
  );
  assert.equal(late.state, "release-pending");

  const restarted = createLocalnetReservationCoordinator(path);
  assert.deepEqual(await restarted.recover(async () => true, NOW + 2), []);
  assert.equal(restarted.list()[0].state, "released");
  assert.equal(restarted.listRequests()[0].state, "released");
});

test("failed late tombstone release is retried before success is reported", async () => {
  const coordinator = createLocalnetReservationCoordinator(journalPath());
  const request = {
    ...REQUEST,
    intentDigest: `0x${"c1".repeat(32)}`,
    rfqId: "0xc1",
  };
  await releaseRequest(coordinator, request, async () => true, NOW);
  let calls = 0;
  const late = await coordinator.register(
    {
      intentDigest: request.intentDigest,
      reservationId: `0x${"c2".repeat(32)}`,
      makerId: "maker-late",
      expiresAt: NOW + 600,
    },
    async () => {
      calls += 1;
      return false;
    },
    NOW + 1,
  );
  assert.equal(late.state, "release-pending");
  assert.equal(coordinator.listRequests()[0].state, "release-pending");
  const retry = await releaseRequest(
    coordinator,
    request,
    async () => {
      calls += 1;
      return true;
    },
    NOW + 2,
  );
  assert.equal(retry.released, true);
  assert.equal(calls, 2);
  assert.equal(coordinator.list()[0].state, "released");
});

test(
  "release callbacks run outside the coordinator tail and may reenter safely",
  { timeout: 5_000 },
  async () => {
    const direct = createLocalnetReservationCoordinator(journalPath());
    await direct.beginRequest({ ...REQUEST, market: "0x1/0x2" });
    await direct.register(
      {
        intentDigest: INTENT,
        reservationId: WINNER,
        makerId: "maker-a",
        expiresAt: NOW + 600,
      },
      async () => true,
    );
    await direct.completeRequestFanout(INTENT);
    const releaseLeaseId = "release-reentrant";
    await direct.acquireReleaseLease({
      ...REQUEST,
      releaseLeaseId,
      now: NOW,
    });
    let reentered = false;
    const released = await direct.releaseIntent(
      { ...REQUEST, releaseLeaseId },
      async () => {
        if (!reentered) {
          reentered = true;
          const nested = await direct.releaseIntent(
            { ...REQUEST, releaseLeaseId },
            async () => {
              throw new Error(
                "an active exact release must not dispatch twice",
              );
            },
            NOW,
          );
          assert.equal(nested.released, false);
          assert.equal(nested.unresolved.length, 1);
        }
        return true;
      },
      NOW,
    );
    assert.equal(released.released, true);
    assert.equal(reentered, true);

    const recovery = createLocalnetReservationCoordinator(journalPath());
    await recovery.beginRequest({ ...REQUEST, market: "0x1/0x2" });
    const recoveryLeaseId = "release-register-reentrant";
    await recovery.acquireReleaseLease({
      ...REQUEST,
      releaseLeaseId: recoveryLeaseId,
      now: NOW,
    });
    assert.equal(
      (
        await recovery.releaseIntent(
          { ...REQUEST, releaseLeaseId: recoveryLeaseId },
          async () => true,
          NOW,
        )
      ).released,
      false,
    );
    const pending = await recovery.register(
      {
        intentDigest: INTENT,
        reservationId: LOSER,
        makerId: "maker-b",
        expiresAt: NOW + 600,
      },
      async () => {
        await recovery.completeRequestFanout(INTENT);
        return false;
      },
    );
    assert.equal(pending.state, "release-pending");
    const unresolved = await recovery.recover(async () => {
      await recovery.completeRequestFanout(INTENT);
      return true;
    }, NOW);
    assert.deepEqual(unresolved, []);
    assert.equal(recovery.getRequest(INTENT).state, "released");
  },
);

test("restart preserves ambiguous planned fanout until authoritative expiry", async () => {
  const path = journalPath();
  const request = {
    ...REQUEST,
    intentDigest: `0x${"d1".repeat(32)}`,
    rfqId: "0xd1",
    makerIds: ["maker-a", "maker-b"],
    market: "0x1/0x2",
  };
  const coordinator = createLocalnetReservationCoordinator(path);
  await coordinator.beginRequest(request);
  await coordinator.register(
    {
      intentDigest: request.intentDigest,
      reservationId: `0x${"d2".repeat(32)}`,
      makerId: "maker-a",
      expiresAt: NOW + 300,
    },
    async () => true,
    NOW,
  );
  await assert.rejects(
    coordinator.completeRequestFanout(request.intentDigest),
    /ambiguous/i,
  );

  const restarted = createLocalnetReservationCoordinator(path);
  let releaseCalls = 0;
  const beforeExpiry = await releaseRequest(
    restarted,
    request,
    async () => {
      releaseCalls += 1;
      return true;
    },
    NOW + 1,
  );
  assert.equal(beforeExpiry.released, false);
  assert.equal(releaseCalls, 1);
  assert.equal(restarted.listRequests()[0].fanoutComplete, false);

  const afterExpiry = await releaseRequest(
    restarted,
    request,
    async () => true,
    request.expiresAt,
  );
  assert.equal(afterExpiry.released, true);
  assert.equal(restarted.listRequests()[0].fanoutComplete, true);
  assert.equal(
    restarted
      .listRequests()[0]
      .makerPlans.find(({ makerId }) => makerId === "maker-b").state,
    "expired",
  );
});

test("durable RFQ identity and account-chain-market leases reject sibling requests", async () => {
  const coordinator = createLocalnetReservationCoordinator(journalPath());
  await coordinator.beginRequest({ ...REQUEST, market: "0x1/0x2" });
  await assert.rejects(
    coordinator.beginRequest({
      ...REQUEST,
      intentDigest: `0x${"e1".repeat(32)}`,
      market: "0x3/0x4",
    }),
    /RFQ identity.*reserved/i,
  );
  await assert.rejects(
    coordinator.beginRequest({
      ...REQUEST,
      intentDigest: `0x${"e2".repeat(32)}`,
      rfqId: "0xe2",
      market: "0x1/0x2",
    }),
    /market lease/i,
  );
});

test("released authorization cannot create a new deal association", async () => {
  const { coordinator } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  await releaseRequest(coordinator, REQUEST, async () => true, NOW + 1);
  await assert.rejects(
    coordinator.bindDeal({
      ...REQUEST,
      dealId: REQUEST.rfqId,
      reservationId: WINNER,
      makerId: "maker-a",
      fence: "7",
      quoteDigest: QUOTE,
    }),
    /funded|expired observation|request state/i,
  );
});

test("exact funded release rejects every sibling target field", async () => {
  const { coordinator } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  };
  await fundExact(coordinator, target);
  await coordinator.bindDeal(target);
  const httpTarget = {
    ...target,
    solverId: target.makerId,
    reservationFence: target.fence,
  };
  const mutations = [
    ["intentDigest", `0x${"f1".repeat(32)}`],
    ["rfqId", "0x78"],
    ["account", "0xabd"],
    ["chainId", "0x2"],
    ["dealId", "0x78"],
    ["reservationId", LOSER],
    ["solverId", "maker-b"],
    ["reservationFence", "8"],
    ["quoteDigest", `0x${"f2".repeat(32)}`],
  ];
  let rejectedCalls = 0;
  for (const [field, value] of mutations) {
    await assert.rejects(
      releaseFundedHttpTargetThroughCoordinator({
        coordinator,
        target: { ...httpTarget, [field]: value },
        release: async () => {
          rejectedCalls += 1;
          return true;
        },
        now: NOW + 1,
      }),
      /durable|target|identity|selection|principal|RFQ/i,
    );
  }
  assert.equal(rejectedCalls, 0);
  let calls = 0;
  const released = await releaseFundedHttpTargetThroughCoordinator({
    coordinator,
    target: {
      ...target,
      solverId: target.makerId,
      reservationFence: target.fence,
    },
    release: async () => {
      calls += 1;
      return true;
    },
    now: NOW + 1,
  });
  assert.equal(released.released, true);
  assert.equal(calls, 1);
});

test("deal association rejects same-term cross-target substitution", async () => {
  const { coordinator } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const binding = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  };
  const throughHttpBoundary = (target) =>
    bindExpiryHttpTargetThroughCoordinator({
      coordinator,
      target: {
        ...target,
        solverId: target.makerId,
        reservationFence: target.fence,
      },
    });
  await fundExact(coordinator, binding);
  await throughHttpBoundary(binding);
  assert.equal(coordinator.listDeals()[0].reservationId, WINNER);
  await assert.rejects(
    throughHttpBoundary({ ...binding, dealId: "0x78" }),
    /deal identity.*RFQ identity/i,
  );
  await assert.rejects(
    throughHttpBoundary({ ...binding, reservationId: LOSER }),
    /exact durable selection/i,
  );
});

test("v2 migration preserves release-pending over a legacy selected record", () => {
  const path = journalPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        version: 2,
        domain: "app20/localnet-reservation-coordinator/v2",
        requests: [
          {
            ...REQUEST,
            fanoutComplete: true,
            makerPlans: [],
            market: "0x1/0x2",
            state: "release-pending",
          },
        ],
        records: [
          {
            intentDigest: INTENT,
            reservationId: WINNER,
            makerId: "maker-a",
            expiresAt: NOW + 600,
            state: "selected",
            fence: "7",
            quoteDigest: QUOTE,
          },
        ],
        deals: [],
      },
      null,
      2,
    )}\n`,
  );
  const migrated = createLocalnetReservationCoordinator(path);
  assert.equal(migrated.listRequests()[0].state, "release-pending");
  assert.equal(
    migrated.listRequests()[0].releaseLeaseId,
    `legacy-release:${INTENT}`,
  );
});

test("funding ticket authorization persists one exact browser attempt and rejects siblings", async () => {
  const { coordinator, path } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  };
  await assert.rejects(
    coordinator.prepareFunding({
      ...target,
      ...SETTLEMENT_TERMS,
      attemptId: "ticket-browser-lease",
    }),
    /requires a durable exact funding-ticket authorization/i,
  );
  await coordinator.authorizeFundingTicket({
    ...target,
    ...SETTLEMENT_TERMS,
    attemptId: "ticket-browser-lease",
  });
  await coordinator.persistFundingTicket({
    ...target,
    ...SETTLEMENT_TERMS,
    attemptId: "ticket-browser-lease",
  });
  const restarted = createLocalnetReservationCoordinator(path);
  assert.equal(
    restarted.listRequests()[0].ticketAttemptId,
    "ticket-browser-lease",
  );
  assert.deepEqual(restarted.listRequests()[0].ticketAuthorization, {
    ticketAttemptId: "ticket-browser-lease",
    dealId: target.dealId,
    ticketAddress: SETTLEMENT_TERMS.ticketAddress,
    settlementTerms: SETTLEMENT_TERMS,
  });
  await restarted.authorizeFundingTicket({
    ...target,
    ...SETTLEMENT_TERMS,
    attemptId: "ticket-browser-lease",
  });
  await assert.rejects(
    restarted.authorizeFundingTicket({
      ...target,
      ...SETTLEMENT_TERMS,
      attemptId: "stale-sibling",
    }),
    /another exact browser funding attempt/i,
  );
  await assert.rejects(
    restarted.prepareFunding({
      ...target,
      ...SETTLEMENT_TERMS,
      attemptId: "stale-sibling",
    }),
    /ticket-authorized attempt/i,
  );
  await assert.rejects(
    restarted.prepareFunding({
      ...target,
      ...SETTLEMENT_TERMS,
      ticketAddress: undefined,
      attemptId: "ticket-browser-lease",
    }),
    /ticketAddress/i,
  );
  await assert.rejects(
    restarted.prepareFunding({
      ...target,
      ...SETTLEMENT_TERMS,
      ticketAddress: "0xdef",
      attemptId: "ticket-browser-lease",
    }),
    /ticket-authorized address|settlement terms/i,
  );
  for (const [field, value] of [
    ["sellToken", "0x3"],
    ["sellAmount", "101"],
    ["buyToken", "0x4"],
    ["buyAmount", "201"],
    ["deadline", SETTLEMENT_TERMS.deadline + 1],
    ["dealId", "0x78"],
    ["attemptId", "stale-sibling"],
    ["ticketAddress", "0xdef"],
  ]) {
    await assert.rejects(
      restarted.prepareFunding({
        ...target,
        ...SETTLEMENT_TERMS,
        attemptId: "ticket-browser-lease",
        [field]: value,
      }),
      /ticket-authorized|settlement terms|address|deal identity|attempt/i,
    );
  }
  const firstPreparation = await restarted.prepareFunding({
    ...target,
    ...SETTLEMENT_TERMS,
    attemptId: "ticket-browser-lease",
  });
  assert.equal(firstPreparation.state, "funding-pending");
});

test("ticket-ready abandonment is exact, durable, idempotent, and admits a sibling market after release", async () => {
  const { coordinator, path } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
    ...SETTLEMENT_TERMS,
    attemptId: "ticket-ready-abandonment",
  };
  await authorizeExactTicket(coordinator, target, target.attemptId);

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
    ["sellToken", "0x3"],
    ["sellAmount", "101"],
    ["buyToken", "0x4"],
    ["buyAmount", "201"],
    ["deadline", SETTLEMENT_TERMS.deadline + 1],
    ["ticketAddress", "0xdef"],
  ]) {
    await assert.rejects(
      coordinator.abandonFunding({ ...target, [field]: value }),
      /exact|principal|selection|deal identity|settlement|ticket|address/i,
      field,
    );
  }
  assert.equal(coordinator.listRequests()[0].state, "ticket-ready");

  const abandoned = await coordinator.abandonFunding(target);
  assert.equal(abandoned.state, "selected");
  assert.equal(abandoned.abandonedFundingAttemptId, target.attemptId);
  assert.equal((await coordinator.abandonFunding(target)).state, "selected");
  const restarted = createLocalnetReservationCoordinator(path);
  assert.equal((await restarted.abandonFunding(target)).state, "selected");
  await assert.rejects(
    restarted.prepareFunding(target),
    /funding-closed|forbidden/i,
  );

  const released = await releaseRequest(
    restarted,
    REQUEST,
    async () => true,
    NOW + 1,
  );
  assert.equal(released.released, true);
  const reopened = createLocalnetReservationCoordinator(path);
  await reopened.beginRequest({
    ...REQUEST,
    intentDigest: `0x${"88".repeat(32)}`,
    rfqId: "0x78",
    market: "0x1/0x2",
  });
  assert.equal(reopened.listRequests().at(-1).state, "open");
});

test("funding lease and unknown outcome persist across journal restart", async () => {
  const { coordinator, path } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  };
  await authorizeExactTicket(coordinator, target, "funding-persisted");
  await coordinator.prepareFunding({
    ...target,
    ...SETTLEMENT_TERMS,
    attemptId: "funding-persisted",
  });
  let restarted = createLocalnetReservationCoordinator(path);
  assert.equal(restarted.listRequests()[0].state, "funding-pending");
  await assert.rejects(
    restarted.acquireReleaseLease({
      ...REQUEST,
      releaseLeaseId: "release-blocked",
      now: NOW + 1,
    }),
    /funding-pending/i,
  );
  await restarted.markFundingUnknown({
    ...target,
    attemptId: "funding-persisted",
  });
  restarted = createLocalnetReservationCoordinator(path);
  assert.equal(restarted.listRequests()[0].state, "funding-unknown");
  await assert.rejects(
    restarted.prepareFunding({
      ...target,
      ...SETTLEMENT_TERMS,
      attemptId: "funding-resubmit",
    }),
    /unknown|reconcile/i,
  );
});

test("exact funding abandonment tombstone survives response loss and restart", async () => {
  const { coordinator, path } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
    ...SETTLEMENT_TERMS,
    attemptId: "funding-abandoned-exact",
  };
  await authorizeExactTicket(
    coordinator,
    target,
    target.attemptId,
    SETTLEMENT_TERMS,
  );
  await coordinator.prepareFunding(target);
  assert.equal((await coordinator.abandonFunding(target)).state, "selected");

  const restarted = createLocalnetReservationCoordinator(path);
  const replay = await restarted.abandonFunding(target);
  assert.equal(replay.state, "selected");
  assert.equal(replay.abandonedFundingAttemptId, "funding-abandoned-exact");
  await assert.rejects(
    restarted.prepareFunding(target),
    /funding-closed|forbidden/i,
  );
  await assert.rejects(
    restarted.abandonFunding({ ...target, attemptId: "other-attempt" }),
    /funding-closed|different exact/i,
  );
});

test("persisted browser attempt can tombstone selected before any server lease", async () => {
  const { coordinator, path } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
    ...SETTLEMENT_TERMS,
    attemptId: "browser-persisted-request-not-started",
  };
  const abandoned = await coordinator.abandonFunding(target);
  assert.equal(abandoned.state, "selected");
  assert.equal(
    abandoned.abandonedFundingAttemptId,
    "browser-persisted-request-not-started",
  );
  assert.deepEqual(abandoned.settlementTerms, SETTLEMENT_TERMS);

  const restarted = createLocalnetReservationCoordinator(path);
  assert.equal((await restarted.abandonFunding(target)).state, "selected");
  for (const attemptId of [
    "browser-persisted-request-not-started",
    "sibling-after-abandonment",
    "browser-persisted-request-not-started",
  ]) {
    await assert.rejects(
      restarted.prepareFunding({ ...target, attemptId }),
      /funding-closed|forbidden/i,
    );
  }
  await assert.rejects(
    restarted.abandonFunding({
      ...target,
      attemptId: "sibling-after-abandonment",
    }),
    /funding-closed|different exact/i,
  );
});

test("real parent-path failures restore durable funding and release authority before any new sink", async () => {
  const fundingFixture = await fixture();
  await fundingFixture.coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const fundingTarget = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
    ...SETTLEMENT_TERMS,
    attemptId: "funding-real-path-fault",
  };
  await authorizeExactTicket(
    fundingFixture.coordinator,
    fundingTarget,
    fundingTarget.attemptId,
  );
  const fundingFault = createLocalnetReservationCoordinator(
    fundingFixture.path,
  );
  const blockedFunding = obstructJournalParent(fundingFixture.path);
  let walletEffects = 0;
  const prepareThenWallet = async (coordinator) => {
    const prepared = await coordinator.prepareFunding(fundingTarget);
    assert.equal(
      createLocalnetReservationCoordinator(
        fundingFixture.path,
      ).listRequests()[0].state,
      "funding-pending",
    );
    walletEffects += 1;
    return prepared;
  };
  await assert.rejects(prepareThenWallet(fundingFault), /fail-stopped/i);
  assert.equal(fundingFault.listRequests()[0].state, "ticket-ready");
  assert.equal(
    createLocalnetReservationCoordinator(
      blockedFunding.durablePath,
    ).listRequests()[0].state,
    "ticket-ready",
  );
  assert.equal(walletEffects, 0);
  blockedFunding.restore();
  await assert.rejects(prepareThenWallet(fundingFault), /fail-stopped/i);
  assert.equal(walletEffects, 0);
  await prepareThenWallet(
    createLocalnetReservationCoordinator(fundingFixture.path),
  );
  assert.equal(walletEffects, 1);

  const releaseFixture = await fixture();
  const releaseLeaseId = "release-real-path-fault";
  await releaseFixture.coordinator.acquireReleaseLease({
    ...REQUEST,
    releaseLeaseId,
    now: NOW,
  });
  const releaseFault = createLocalnetReservationCoordinator(
    releaseFixture.path,
  );
  const blockedRelease = obstructJournalParent(releaseFixture.path);
  let makerEffects = 0;
  const releaseMaker = async () => {
    assert.equal(
      createLocalnetReservationCoordinator(
        releaseFixture.path,
      ).listRequests()[0].state,
      "release-pending",
    );
    makerEffects += 1;
    return true;
  };
  const releaseTarget = { ...REQUEST, releaseLeaseId };
  await assert.rejects(
    releaseFault.releaseIntent(releaseTarget, releaseMaker, NOW + 1),
    /fail-stopped/i,
  );
  assert.equal(releaseFault.listRequests()[0].state, "release-check");
  assert.equal(
    createLocalnetReservationCoordinator(
      blockedRelease.durablePath,
    ).listRequests()[0].state,
    "release-check",
  );
  assert.equal(makerEffects, 0);
  blockedRelease.restore();
  await assert.rejects(
    releaseFault.releaseIntent(releaseTarget, releaseMaker, NOW + 1),
    /fail-stopped/i,
  );
  assert.equal(makerEffects, 0);
  const releaseRetry = createLocalnetReservationCoordinator(
    releaseFixture.path,
  );
  assert.equal(
    (await releaseRetry.releaseIntent(releaseTarget, releaseMaker, NOW + 1))
      .released,
    true,
  );
  assert.equal(makerEffects, 2);
  assert.equal(
    createLocalnetReservationCoordinator(releaseFixture.path).listRequests()[0]
      .state,
    "released",
  );
});

test("funding and release mutations fail-stop and roll back at every durable commit stage", async () => {
  for (const stage of [
    "serialize",
    "mkdir",
    "write",
    "file-fsync",
    "rename",
    "chmod",
    "dir-fsync",
  ]) {
    const fundingFixture = await fixture();
    await fundingFixture.coordinator.markSelected({
      intentDigest: INTENT,
      reservationId: WINNER,
      makerId: "maker-a",
      fence: "7",
      quoteDigest: QUOTE,
    });
    const fundingTarget = {
      ...REQUEST,
      dealId: REQUEST.rfqId,
      reservationId: WINNER,
      makerId: "maker-a",
      fence: "7",
      quoteDigest: QUOTE,
      ...SETTLEMENT_TERMS,
      attemptId: `funding-fault-${stage}`,
    };
    await authorizeExactTicket(
      fundingFixture.coordinator,
      fundingTarget,
      fundingTarget.attemptId,
    );
    let fundingInjected = false;
    const fundingFault = createLocalnetReservationCoordinator(
      fundingFixture.path,
      {
        faultInjector(candidate) {
          if (!fundingInjected && candidate === stage) {
            fundingInjected = true;
            throw new Error(`injected funding ${stage}`);
          }
        },
      },
    );
    await assert.rejects(
      fundingFault.prepareFunding(fundingTarget),
      /fail-stopped/i,
      stage,
    );
    assert.equal(fundingInjected, true, stage);
    assert.equal(fundingFault.listRequests()[0].state, "ticket-ready", stage);
    assert.equal(
      createLocalnetReservationCoordinator(
        fundingFixture.path,
      ).listRequests()[0].state,
      "ticket-ready",
      stage,
    );
    await assert.rejects(
      fundingFault.prepareFunding(fundingTarget),
      /fail-stopped/i,
      stage,
    );
    const fundingRetry = createLocalnetReservationCoordinator(
      fundingFixture.path,
    );
    await fundingRetry.prepareFunding(fundingTarget);
    assert.equal(
      createLocalnetReservationCoordinator(
        fundingFixture.path,
      ).listRequests()[0].state,
      "funding-pending",
      stage,
    );

    const releaseFixture = await fixture();
    const releaseLeaseId = `release-fault-${stage}`;
    await releaseFixture.coordinator.acquireReleaseLease({
      ...REQUEST,
      releaseLeaseId,
      now: NOW,
    });
    let stageCount = 0;
    let releaseInjected = false;
    const releaseFault = createLocalnetReservationCoordinator(
      releaseFixture.path,
      {
        faultInjector(candidate) {
          if (candidate === stage && ++stageCount === 3) {
            releaseInjected = true;
            throw new Error(`injected release final ${stage}`);
          }
        },
      },
    );
    let makerReleased = false;
    let makerEffects = 0;
    const releaseMaker = async () => {
      if (!makerReleased) {
        makerReleased = true;
        makerEffects += 1;
      }
      return true;
    };
    await assert.rejects(
      releaseFault.releaseIntent(
        { ...REQUEST, releaseLeaseId },
        releaseMaker,
        NOW + 1,
      ),
      /fail-stopped/i,
      stage,
    );
    assert.equal(releaseInjected, true, stage);
    assert.equal(makerEffects, 1, stage);
    assert.equal(
      releaseFault.listRequests()[0].state,
      "release-pending",
      stage,
    );
    assert.equal(
      createLocalnetReservationCoordinator(
        releaseFixture.path,
      ).listRequests()[0].state,
      "release-pending",
      stage,
    );
    await assert.rejects(
      releaseFault.releaseIntent(
        { ...REQUEST, releaseLeaseId },
        releaseMaker,
        NOW + 1,
      ),
      /fail-stopped/i,
      stage,
    );
    assert.equal(makerEffects, 1, stage);
    const releaseRetry = createLocalnetReservationCoordinator(
      releaseFixture.path,
    );
    const recovered = await releaseRetry.releaseIntent(
      { ...REQUEST, releaseLeaseId },
      releaseMaker,
      NOW + 1,
    );
    assert.equal(recovered.released, true, stage);
    assert.equal(makerEffects, 1, stage);
    assert.equal(
      createLocalnetReservationCoordinator(
        releaseFixture.path,
      ).listRequests()[0].state,
      "released",
      stage,
    );
  }
});

test("funding-closed tombstone wins concurrent sibling prepare and request release", async () => {
  const { coordinator } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
    ...SETTLEMENT_TERMS,
    attemptId: "attempt-a",
  };
  await coordinator.abandonFunding(target);
  const [prepared, released] = await Promise.allSettled([
    coordinator.prepareFunding({ ...target, attemptId: "attempt-b" }),
    coordinator.acquireReleaseLease({
      ...REQUEST,
      releaseLeaseId: "release-after-abandonment",
      now: NOW + 1,
    }),
  ]);
  assert.equal(prepared.status, "rejected");
  assert.match(prepared.reason.message, /funding-closed|forbidden/i);
  assert.equal(released.status, "fulfilled");
  assert.equal(released.value.state, "release-check");
});

test("abandonment rejects unknown, funded, terminal, and sibling targets", async () => {
  const build = async (attemptId) => {
    const exact = await fixture();
    await exact.coordinator.markSelected({
      intentDigest: INTENT,
      reservationId: WINNER,
      makerId: "maker-a",
      fence: "7",
      quoteDigest: QUOTE,
    });
    const target = {
      ...REQUEST,
      dealId: REQUEST.rfqId,
      reservationId: WINNER,
      makerId: "maker-a",
      fence: "7",
      quoteDigest: QUOTE,
      ...SETTLEMENT_TERMS,
      attemptId,
    };
    await authorizeExactTicket(
      exact.coordinator,
      target,
      attemptId,
      SETTLEMENT_TERMS,
    );
    await exact.coordinator.prepareFunding(target);
    return { ...exact, target };
  };

  const unknown = await build("unknown-attempt");
  await unknown.coordinator.markFundingUnknown(unknown.target);
  await assert.rejects(
    unknown.coordinator.abandonFunding(unknown.target),
    /selected pre-wallet|matching pre-submission/i,
  );

  const funded = await build("funded-attempt");
  await funded.coordinator.observeFunded(funded.target);
  await assert.rejects(
    funded.coordinator.abandonFunding(funded.target),
    /selected pre-wallet|matching pre-submission/i,
  );
  await funded.coordinator.terminalize(funded.target, "filled");
  await assert.rejects(
    funded.coordinator.abandonFunding(funded.target),
    /selected pre-wallet|matching pre-submission/i,
  );

  const sibling = await build("owner-attempt");
  await assert.rejects(
    sibling.coordinator.abandonFunding({
      ...sibling.target,
      attemptId: "sibling-attempt",
    }),
    /matching pre-submission|exact/i,
  );
});

test("funding prepare replay binds complete canonical settlement terms", async () => {
  const { coordinator } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  };
  await authorizeExactTicket(coordinator, target, "funding-terms");
  await coordinator.prepareFunding({
    ...target,
    ...SETTLEMENT_TERMS,
    attemptId: "funding-terms",
  });
  for (const [field, value] of [
    ["sellToken", "0x3"],
    ["sellAmount", "101"],
    ["buyToken", "0x4"],
    ["buyAmount", "201"],
    ["deadline", SETTLEMENT_TERMS.deadline + 1],
    ["ticketAddress", "0xabd"],
  ]) {
    await assert.rejects(
      coordinator.prepareFunding({
        ...target,
        ...SETTLEMENT_TERMS,
        [field]: value,
        attemptId: "funding-terms",
      }),
      /changed.*canonical settlement terms/i,
    );
  }
});

test("exact funded expiry is idempotent after terminalization and response loss", async () => {
  const { coordinator, path } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  };
  await fundExact(coordinator, target, "funding-expiry-retry");
  let releases = 0;
  assert.equal(
    (
      await coordinator.releaseSelected(
        target,
        async () => {
          releases += 1;
          return true;
        },
        NOW + 1,
      )
    ).released,
    true,
  );
  await coordinator.terminalize(target, "expired");
  assert.equal((await coordinator.bindDeal(target)).dealId, REQUEST.rfqId);
  assert.equal(
    (
      await coordinator.releaseSelected(
        target,
        async () => {
          releases += 1;
          return true;
        },
        NOW + 2,
      )
    ).released,
    true,
  );
  assert.equal(releases, 1);
  assert.equal(
    (await coordinator.terminalize(target, "expired")).state,
    "expired",
  );
  const terminal = createLocalnetReservationCoordinator(path).listRequests()[0];
  assert.equal(terminal.state, "expired");
  assert.deepEqual(terminal.settlementTerms, SETTLEMENT_TERMS);
});

test("refunded advances exact funded expiry to its final durable terminal", async () => {
  const { coordinator, path } = await fixture();
  await coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  };
  await fundExact(coordinator, target, "funding-refund");
  await assert.rejects(
    coordinator.terminalize(target, "refunded"),
    /cannot terminalize/i,
  );
  await coordinator.terminalize(target, "expired");
  await coordinator.terminalize(target, "refunded");
  const restarted = createLocalnetReservationCoordinator(path);
  assert.equal(restarted.listRequests()[0].state, "refunded");
});

test("released and refunded terminals admit sibling market requests", async () => {
  const releasedFixture = await fixture();
  await releaseRequest(
    releasedFixture.coordinator,
    REQUEST,
    async () => true,
    NOW + 1,
  );
  assert.equal(
    (
      await releasedFixture.coordinator.beginRequest({
        ...REQUEST,
        intentDigest: `0x${"c3".repeat(32)}`,
        rfqId: "0xc3",
        market: "0x1/0x2",
      })
    ).state,
    "open",
  );

  const refundedFixture = await fixture();
  await refundedFixture.coordinator.markSelected({
    intentDigest: INTENT,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  });
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  };
  await fundExact(
    refundedFixture.coordinator,
    target,
    "funding-terminal-refund",
  );
  await refundedFixture.coordinator.terminalize(target, "expired");
  await refundedFixture.coordinator.terminalize(target, "refunded");
  assert.equal(
    (
      await refundedFixture.coordinator.beginRequest({
        ...REQUEST,
        intentDigest: `0x${"c4".repeat(32)}`,
        rfqId: "0xc4",
        market: "0x1/0x2",
      })
    ).state,
    "open",
  );
});

test("authority reorg quarantine durably reclaims the terminal market lease", async () => {
  const { coordinator, path } = await fixture();
  await selectWinner(coordinator);
  const target = {
    ...REQUEST,
    dealId: REQUEST.rfqId,
    reservationId: WINNER,
    makerId: "maker-a",
    fence: "7",
    quoteDigest: QUOTE,
  };
  await fundExact(coordinator, target, "funding-authority-quarantine");
  await coordinator.terminalize(target, "filled");
  await coordinator.terminalize(target, "settled");
  const quarantined = await coordinator.quarantineAuthority({
    ...target,
    authorityRevision: 1,
    authorityReason: "canonical-membership-lost",
  });
  assert.equal(quarantined.state, "authority-quarantined");
  assert.equal(
    (
      await coordinator.quarantineAuthority({
        ...target,
        authorityRevision: 1,
        authorityReason: "canonical-membership-lost",
      })
    ).state,
    "authority-quarantined",
  );
  const restarted = createLocalnetReservationCoordinator(path);
  assert.equal(restarted.listRequests()[0].state, "authority-quarantined");
  await assert.rejects(
    restarted.beginRequest({
      ...REQUEST,
      intentDigest: `0x${"c1".repeat(32)}`,
      rfqId: "0xc1",
      market: "0x1/0x2",
    }),
    /market lease/i,
  );
});

test("v4 journals v3 quote/refusal fanout by RFQ digest without selection or loser release", async () => {
  const path = journalPath();
  const coordinator = createLocalnetReservationCoordinator(path);
  const rfqDigest = `0x${"a1".repeat(32)}`;
  const signature = `0x${"0".repeat(63)}1${"0".repeat(63)}1`;
  const quote = {
    domain: "app20/private-intent-quote/v3",
    version: 3,
    solverId: "maker-a",
    quoteKeyId: "maker-a/key",
    nonce: `0x${"12".repeat(32)}`,
    pool: "starknet:APP20_LOCALNET",
    helper: "0xe5c",
    escrowAddress: "0xe5c",
    rfqDigest,
    rfqFelt: "0x901",
    sellToken: "0x1",
    buyToken: "0x2",
    schedule: [
      { a: "40", b: "80" },
      { a: "100", b: "200" },
    ],
    lockId: "0xa01",
    lockTicket: "0xb01",
    lockTransactionHash: "0xc01",
    lockExpiresAt: NOW + 90,
    spreadBps: 30,
    pricingProvenance: "fixture:v3",
    quotedAt: NOW,
    quoteExpiresAt: NOW + 60,
    signature,
  };
  await coordinator.beginV3Request({
    rfqDigest,
    intentDigest: `0x${"a2".repeat(32)}`,
    rfqId: "0x901",
    account: "0xabc",
    chainId: "0x1",
    createdAt: NOW,
    expiresAt: NOW + 90,
    market: "0x1/0x2",
    makerIds: ["maker-a", "maker-b"],
  });
  const quoteDigest = await digestSolverQuoteV3(decodeSolverQuoteV3(quote));
  await coordinator.recordV3Quote(rfqDigest, "maker-a", { quote, quoteDigest });
  await coordinator.recordV3Refusal(rfqDigest, "maker-b", {
    code: "insufficient-inventory",
    reason: "No bucket inventory is available.",
  });
  const completed = await coordinator.completeV3Fanout(rfqDigest);
  assert.equal(completed.fanoutComplete, true);
  assert.equal(completed.selection, undefined);
  assert.deepEqual(
    completed.makerPlans.map(({ makerId, state }) => ({ makerId, state })),
    [
      { makerId: "maker-a", state: "quoted" },
      { makerId: "maker-b", state: "refused" },
    ],
  );
  assert.equal(
    completed.makerPlans[1].quoteDigest,
    digestLocalnetV3Refusal({
      makerId: "maker-b",
      code: "insufficient-inventory",
      reason: "No bucket inventory is available.",
    }),
  );
  const journal = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(journal.domain, "app20/localnet-reservation-coordinator/v4");
  assert.equal(journal.version, 4);
  assert.equal(journal.v3Requests.length, 1);
  assert.equal(
    createLocalnetReservationCoordinator(path).getV3Request(rfqDigest)
      .fanoutComplete,
    true,
  );
});

test("v3 take lease is exact, restart-safe, idempotent, and supports proven absence retry", async () => {
  const path = journalPath();
  const coordinator = createLocalnetReservationCoordinator(path);
  const rfqDigest = `0x${"b1".repeat(32)}`;
  const quote = {
    domain: "app20/private-intent-quote/v3",
    version: 3,
    solverId: "maker-a",
    quoteKeyId: "maker-a/key",
    nonce: `0x${"13".repeat(32)}`,
    pool: "starknet:APP20_LOCALNET",
    helper: "0xe5c",
    escrowAddress: "0xe5c",
    rfqDigest,
    rfqFelt: "0x902",
    sellToken: "0x1",
    buyToken: "0x2",
    schedule: [{ a: "100", b: "200" }],
    lockId: "0xa02",
    lockTicket: "0xb02",
    lockTransactionHash: "0xc02",
    lockExpiresAt: NOW + 90,
    spreadBps: 30,
    pricingProvenance: "fixture:v3",
    quotedAt: NOW,
    quoteExpiresAt: NOW + 60,
    signature: `0x${"0".repeat(63)}1${"0".repeat(63)}1`,
  };
  await coordinator.beginV3Request({
    rfqDigest,
    intentDigest: `0x${"b2".repeat(32)}`,
    rfqId: "0x902",
    account: "0xabc",
    chainId: "0x1",
    createdAt: NOW,
    expiresAt: NOW + 90,
    market: "0x1/0x2",
    makerIds: ["maker-a"],
  });
  await coordinator.recordV3Quote(rfqDigest, "maker-a", {
    quote,
    quoteDigest: await digestSolverQuoteV3(decodeSolverQuoteV3(quote)),
  });
  await coordinator.completeV3Fanout(rfqDigest);
  await coordinator.journalV3Transcript(rfqDigest, `0x${"d1".repeat(32)}`);
  const target = {
    rfqId: "0x902",
    dealId: "0x902",
    account: "0xabc",
    chainId: "0x1",
    expected: {
      tokenA: "0x1",
      totalA: "100",
      tokenB: "0x2",
      totalB: "200",
      fills: [{ lockId: "0xa02", amountA: "100", amountB: "200" }],
    },
  };
  assert.equal(
    (await coordinator.prepareTake(target, "take-1")).state,
    "take-pending",
  );
  await assert.rejects(
    coordinator.prepareTake(target, "take-2"),
    /another exact/i,
  );
  await coordinator.markTakeUnknown(
    { ...target, transactionHash: "0xd02" },
    "take-1",
  );
  const restarted = createLocalnetReservationCoordinator(path);
  assert.equal(restarted.getV3Request(rfqDigest).state, "take-unknown");
  await restarted.observeTaken(
    { ...target, transactionHash: "0xd02" },
    "take-1",
  );
  assert.equal(restarted.getV3RequestForRfq("0x902").state, "taken");

  const secondPath = journalPath();
  const second = createLocalnetReservationCoordinator(secondPath);
  const secondDigest = `0x${"c1".repeat(32)}`;
  const secondQuote = {
    ...quote,
    rfqDigest: secondDigest,
    rfqFelt: "0x903",
    lockId: "0xa03",
  };
  await second.beginV3Request({
    rfqDigest: secondDigest,
    intentDigest: `0x${"c2".repeat(32)}`,
    rfqId: "0x903",
    account: "0xabc",
    chainId: "0x1",
    createdAt: NOW,
    expiresAt: NOW + 90,
    market: "0x1/0x2",
    makerIds: ["maker-a"],
  });
  await second.recordV3Quote(secondDigest, "maker-a", {
    quote: secondQuote,
    quoteDigest: await digestSolverQuoteV3(decodeSolverQuoteV3(secondQuote)),
  });
  await second.completeV3Fanout(secondDigest);
  await second.journalV3Transcript(secondDigest, `0x${"d2".repeat(32)}`);
  const secondTarget = {
    ...target,
    rfqId: "0x903",
    dealId: "0x903",
    expected: {
      ...target.expected,
      fills: [{ lockId: "0xa03", amountA: "100", amountB: "200" }],
    },
  };
  await second.prepareTake(secondTarget, "reverted-1");
  await second.markTakeAbsent(secondTarget, "reverted-1");
  assert.equal(
    (await second.prepareTake(secondTarget, "retry-2")).state,
    "take-pending",
  );
  await assert.rejects(
    second.prepareTake(secondTarget, "reverted-1"),
    /durably closed/i,
  );
});

for (const outcome of ["filled", "expired"]) {
  test(`${outcome} terminalizes the market lease and restart admits a sibling request`, async () => {
    const { coordinator, path } = await fixture();
    await coordinator.markSelected({
      intentDigest: INTENT,
      reservationId: WINNER,
      makerId: "maker-a",
      fence: "7",
      quoteDigest: QUOTE,
    });
    const target = {
      ...REQUEST,
      dealId: REQUEST.rfqId,
      reservationId: WINNER,
      makerId: "maker-a",
      fence: "7",
      quoteDigest: QUOTE,
    };
    await fundExact(coordinator, target, `funding-${outcome}`);
    await assert.rejects(
      coordinator.beginRequest({
        ...REQUEST,
        intentDigest: `0x${(outcome === "filled" ? "a1" : "a2").repeat(32)}`,
        rfqId: outcome === "filled" ? "0xa1" : "0xa2",
        market: "0x1/0x2",
      }),
      /market lease/i,
    );
    await coordinator.terminalize(target, outcome);
    const restarted = createLocalnetReservationCoordinator(path);
    const sibling = await restarted.beginRequest({
      ...REQUEST,
      intentDigest: `0x${(outcome === "filled" ? "b1" : "b2").repeat(32)}`,
      rfqId: outcome === "filled" ? "0xb1" : "0xb2",
      market: "0x1/0x2",
    });
    assert.equal(sibling.state, "open");
    assert.equal(
      restarted.listRequests().find((entry) => entry.intentDigest === INTENT)
        .state,
      outcome,
    );
  });
}

function hex32Byte(value) {
  return `0x${value.toString(16).padStart(2, "0").repeat(32)}`;
}

async function beginBareV3(
  coordinator,
  index,
  { account = "0xabc", createdAt = NOW, expiresAt = createdAt + 90 } = {},
) {
  return coordinator.beginV3Request({
    rfqDigest: hex32Byte(index),
    intentDigest: hex32Byte(255 - index),
    rfqId: `0x${(0x1000 + index).toString(16)}`,
    account,
    chainId: "0x1",
    createdAt,
    expiresAt,
    market: "0x1/0x2",
    makerIds: ["maker-a"],
  });
}

async function v3TakeFixture(coordinator, sequence = 1, timestamp = NOW) {
  const rfqDigest = hex32Byte(0x80 + sequence);
  const rfqId = `0x${(0x900 + sequence).toString(16)}`;
  const lockId = `0x${(0xa00 + sequence).toString(16)}`;
  const quote = {
    domain: "app20/private-intent-quote/v3",
    version: 3,
    solverId: "maker-a",
    quoteKeyId: "maker-a/key",
    nonce: hex32Byte(0x20 + sequence),
    pool: "starknet:APP20_LOCALNET",
    helper: "0xe5c",
    escrowAddress: "0xe5c",
    rfqDigest,
    rfqFelt: rfqId,
    sellToken: "0x1",
    buyToken: "0x2",
    schedule: [{ a: "100", b: "200" }],
    lockId,
    lockTicket: `0x${(0xb00 + sequence).toString(16)}`,
    lockTransactionHash: `0x${(0xc00 + sequence).toString(16)}`,
    lockExpiresAt: timestamp + 90,
    spreadBps: 30,
    pricingProvenance: "fixture:v3",
    quotedAt: timestamp,
    quoteExpiresAt: timestamp + 60,
    signature: `0x${"0".repeat(63)}1${"0".repeat(63)}1`,
  };
  await coordinator.beginV3Request({
    rfqDigest,
    intentDigest: hex32Byte(0x40 + sequence),
    rfqId,
    account: "0xabc",
    chainId: "0x1",
    createdAt: timestamp,
    expiresAt: timestamp + 90,
    market: "0x1/0x2",
    makerIds: ["maker-a"],
  });
  await coordinator.recordV3Quote(rfqDigest, "maker-a", {
    quote,
    quoteDigest: await digestSolverQuoteV3(decodeSolverQuoteV3(quote)),
  });
  await coordinator.completeV3Fanout(rfqDigest);
  await coordinator.journalV3Transcript(rfqDigest, hex32Byte(0x60 + sequence));
  return {
    rfqDigest,
    target: {
      rfqId,
      dealId: rfqId,
      account: "0xabc",
      chainId: "0x1",
      expected: {
        tokenA: "0x1",
        totalA: "100",
        tokenB: "0x2",
        totalB: "200",
        fills: [{ lockId, amountA: "100", amountB: "200" }],
      },
    },
  };
}

test("v3 bounds attempt ids and closed-attempt history across restart", async () => {
  const path = journalPath();
  const coordinator = createLocalnetReservationCoordinator(path, {
    now: () => NOW,
  });
  const { rfqDigest, target } = await v3TakeFixture(coordinator);
  await assert.rejects(
    coordinator.prepareTake(
      target,
      "x".repeat(LOCALNET_COORDINATOR_MAX_ATTEMPT_ID_BYTES + 1),
    ),
    /attempt-id byte limit|bounded/i,
  );
  await assert.rejects(
    coordinator.prepareTake(target, "é".repeat(65)),
    /attempt-id byte limit|bounded/i,
  );
  for (
    let index = 0;
    index < LOCALNET_COORDINATOR_MAX_CLOSED_TAKE_ATTEMPTS;
    index += 1
  ) {
    const attemptId = `closed-${index}`;
    await coordinator.prepareTake(target, attemptId);
    await coordinator.markTakeAbsent(target, attemptId);
  }
  assert.equal(
    coordinator.getV3Request(rfqDigest).closedTakeAttempts.length,
    LOCALNET_COORDINATOR_MAX_CLOSED_TAKE_ATTEMPTS,
  );
  await assert.rejects(
    coordinator.prepareTake(target, "closed-overflow"),
    /attempt quota/i,
  );
  const restarted = createLocalnetReservationCoordinator(path, {
    now: () => NOW,
  });
  assert.equal(
    restarted.getV3Request(rfqDigest).closedTakeAttempts.length,
    LOCALNET_COORDINATOR_MAX_CLOSED_TAKE_ATTEMPTS,
  );
});

test("v3 expiry closes submission but preserves exact late reconciliation", async () => {
  let clock = NOW;
  const path = journalPath();
  const coordinator = createLocalnetReservationCoordinator(path, {
    now: () => clock,
  });
  const { rfqDigest, target } = await v3TakeFixture(coordinator);
  await coordinator.prepareTake(target, "take-expiring");
  clock = NOW + 91;
  await assert.rejects(
    coordinator.prepareTake(target, "take-expiring"),
    /expiry permanently closes/i,
  );
  const expired = coordinator.getV3Request(rfqDigest);
  assert.equal(expired.state, "expired");
  assert.equal(expired.expiredAt, NOW + 91);
  assert.equal(expired.expiredFromState, "take-pending");
  assert.equal(expired.takeAttemptId, "take-expiring");
  assert.deepEqual(expired.expected, target.expected);
  const restarted = createLocalnetReservationCoordinator(path, {
    now: () => clock,
  });
  const closed = await restarted.markTakeAbsent(target, "take-expiring");
  assert.equal(closed.state, "expired");
  assert.equal(closed.takeAttemptId, undefined);
  assert.equal(closed.closedTakeAttempts.at(-1).attemptId, "take-expiring");

  clock = NOW;
  const latePath = journalPath();
  const late = createLocalnetReservationCoordinator(latePath, {
    now: () => clock,
  });
  const lateFixture = await v3TakeFixture(late, 2);
  await late.prepareTake(lateFixture.target, "take-late-chain");
  await late.markTakeUnknown(
    { ...lateFixture.target, transactionHash: "0xd02" },
    "take-late-chain",
  );
  clock = NOW + 91;
  await late.completeV3Fanout(lateFixture.rfqDigest);
  assert.equal(
    late.getV3Request(lateFixture.rfqDigest).expiredFromState,
    "take-unknown",
  );
  const lateRestarted = createLocalnetReservationCoordinator(latePath, {
    now: () => clock,
  });
  await assert.rejects(
    lateRestarted.abandonTake(lateFixture.target, "take-late-chain"),
    /pre-submission/i,
  );
  const taken = await lateRestarted.observeTaken(
    { ...lateFixture.target, transactionHash: "0xd02" },
    "take-late-chain",
  );
  assert.equal(taken.state, "taken");
  assert.equal(taken.expiredAt, undefined);
  assert.equal(taken.expiredFromState, undefined);
});

test("legacy and v3 requests cannot share one RFQ identity in either order or after restart", async () => {
  const sharedRfqId = "0x1777";
  const v3FirstPath = journalPath();
  const v3First = createLocalnetReservationCoordinator(v3FirstPath, {
    now: () => NOW,
  });
  await v3First.beginV3Request({
    rfqDigest: INTENT,
    intentDigest: hex32Byte(0x71),
    rfqId: sharedRfqId,
    account: "0xabc",
    chainId: "0x1",
    createdAt: NOW,
    expiresAt: NOW + 90,
    market: "0x1/0x2",
    makerIds: ["maker-a"],
  });
  await assert.rejects(
    v3First.beginRequest({
      ...REQUEST,
      intentDigest: hex32Byte(0x72),
      rfqId: sharedRfqId,
      market: "0x1/0x2",
    }),
    /v3 request lifecycle/i,
  );
  await assert.rejects(
    v3First.acquireReleaseLease({
      intentDigest: hex32Byte(0x73),
      rfqId: sharedRfqId,
      account: "0xabc",
      chainId: "0x1",
      releaseLeaseId: "cross-lifecycle-release",
      now: NOW,
    }),
    /v3 request lifecycle/i,
  );

  const legacyFirstPath = journalPath();
  const legacyFirst = createLocalnetReservationCoordinator(legacyFirstPath, {
    now: () => NOW,
  });
  await legacyFirst.beginRequest({
    ...REQUEST,
    intentDigest: INTENT,
    rfqId: sharedRfqId,
    market: "0x1/0x2",
  });
  await assert.rejects(
    legacyFirst.beginV3Request({
      rfqDigest: INTENT,
      intentDigest: hex32Byte(0x74),
      rfqId: sharedRfqId,
      account: "0xabc",
      chainId: "0x1",
      createdAt: NOW,
      expiresAt: NOW + 90,
      market: "0x1/0x2",
      makerIds: ["maker-a"],
    }),
    /legacy request lifecycle/i,
  );

  const legacyJournal = JSON.parse(readFileSync(legacyFirstPath, "utf8"));
  const v3Journal = JSON.parse(readFileSync(v3FirstPath, "utf8"));
  legacyJournal.v3Requests = v3Journal.v3Requests;
  writeFileSync(
    legacyFirstPath,
    `${JSON.stringify(legacyJournal, null, 2)}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      createLocalnetReservationCoordinator(legacyFirstPath, { now: () => NOW }),
    /cross-lifecycle RFQ identity collision/i,
  );
});

test("v3 admission enforces account, global, burst, and retained quotas", async () => {
  let clock = NOW;
  const accountPath = journalPath();
  const accountLimited = createLocalnetReservationCoordinator(accountPath, {
    now: () => clock,
    maxV3ActivePerAccount: 2,
    maxV3ActiveGlobal: 10,
    maxV3AdmissionsPerWindow: 10,
  });
  await beginBareV3(accountLimited, 1);
  await beginBareV3(accountLimited, 2);
  await assert.rejects(beginBareV3(accountLimited, 3), /account.*concurrency/i);
  assert.equal(
    (await beginBareV3(accountLimited, 4, { account: "0xdef" })).state,
    "open",
  );

  const globalLimited = createLocalnetReservationCoordinator(journalPath(), {
    now: () => clock,
    maxV3ActivePerAccount: 2,
    maxV3ActiveGlobal: 2,
    maxV3AdmissionsPerWindow: 10,
  });
  await beginBareV3(globalLimited, 11, { account: "0xa" });
  await beginBareV3(globalLimited, 12, { account: "0xb" });
  await assert.rejects(
    beginBareV3(globalLimited, 13, { account: "0xc" }),
    /global.*concurrency/i,
  );

  const burstLimited = createLocalnetReservationCoordinator(journalPath(), {
    now: () => clock,
    maxV3ActivePerAccount: 10,
    maxV3ActiveGlobal: 10,
    maxV3AdmissionsPerWindow: 2,
    v3AdmissionWindowSeconds: 60,
  });
  await beginBareV3(burstLimited, 21, { expiresAt: NOW + 2 });
  await beginBareV3(burstLimited, 22, { expiresAt: NOW + 2 });
  clock = NOW + 3;
  await assert.rejects(
    beginBareV3(burstLimited, 23, {
      createdAt: clock,
      expiresAt: clock + 90,
    }),
    /admission rate/i,
  );
  clock = NOW + 61;
  assert.equal(
    (
      await beginBareV3(burstLimited, 23, {
        createdAt: clock,
        expiresAt: clock + 90,
      })
    ).state,
    "open",
  );

  const retained = createLocalnetReservationCoordinator(journalPath(), {
    now: () => clock,
    maxV3Requests: 2,
    maxV3ActiveGlobal: 2,
    maxV3AdmissionsPerWindow: 10,
  });
  await beginBareV3(retained, 31, {
    createdAt: clock,
    expiresAt: clock + 2,
  });
  await beginBareV3(retained, 32, {
    createdAt: clock,
    expiresAt: clock + 2,
  });
  clock += 3;
  await assert.rejects(
    beginBareV3(retained, 33, {
      createdAt: clock,
      expiresAt: clock + 90,
    }),
    /retained.*quota/i,
  );
  assert.equal(
    retained.listV3Requests().filter(({ state }) => state === "expired").length,
    2,
  );
});

test("journal byte limits reject capacity normally and oversized startup files fail closed", async () => {
  const path = journalPath();
  const seed = createLocalnetReservationCoordinator(path, { now: () => NOW });
  await beginBareV3(seed, 41);
  const constrained = createLocalnetReservationCoordinator(path, {
    now: () => NOW,
    maxJournalBytes: statSync(path).size,
  });
  await assert.rejects(
    beginBareV3(constrained, 42),
    /journal exceeds its byte limit/i,
  );
  assert.equal(constrained.listV3Requests().length, 1);
  assert.equal((await beginBareV3(constrained, 41)).state, "open");
  await assert.rejects(
    beginBareV3(constrained, 43),
    /journal exceeds its byte limit/i,
  );

  const oversized = journalPath();
  mkdirSync(dirname(oversized), { recursive: true });
  writeFileSync(oversized, "x".repeat(257));
  assert.throws(
    () =>
      createLocalnetReservationCoordinator(oversized, {
        maxJournalBytes: 256,
      }),
    /journal is too large/i,
  );

  const malformed = journalPath();
  mkdirSync(dirname(malformed), { recursive: true });
  writeFileSync(malformed, "{not-json", { mode: 0o600 });
  assert.throws(
    () => createLocalnetReservationCoordinator(malformed),
    /journal is invalid/i,
  );
});
