import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DurableMakerNode,
  DurableReservationStore,
} from "../packages/maker-node/src/index.ts";
import {
  createMakerReservation,
  transitionMakerReservation,
} from "../packages/private-intents/src/index.ts";
import { digestLocalnetAuthorityQuery } from "./localnet-chain-authority.mjs";
import { createLocalnetAuthorityReconciliationPipeline } from "./localnet-authority-reconciliation.mjs";

const runtimeEpoch = "0123456789abcdef0123456789abcdef";
const query = Object.freeze({
  runtimeEpoch,
  chainId: "0x123",
  account: "0xaaa",
  rfqId: "0xbbb",
  dealId: "0xbbb",
  intentDigest: `0x${"1".repeat(64)}`,
  commitmentDigest: `0x${"2".repeat(64)}`,
  reservationId: `0x${"3".repeat(64)}`,
  reservationFence: "7",
  quoteDigest: `0x${"4".repeat(64)}`,
  makerId: "maker-a",
  sellToken: "0x11",
  sellAmount: "100",
  buyToken: "0x22",
  buyAmount: "200",
  deadline: 1_800_000_000,
  ticketAddress: "0x33",
  outcome: "refunded",
  transactions: Object.freeze({ fund: "0x101", timeout: "0x102" }),
});
function projectionFor(exact = query, status = "authoritative", revision = 9) {
  return Object.freeze({
    runtimeEpoch,
    chainId: exact.chainId,
    account: exact.account,
    rfqId: exact.rfqId,
    dealId: exact.dealId,
    status,
    revision,
  });
}
function requestFor(exact = query) {
  return Object.freeze({
    state: exact.outcome,
    intentDigest: exact.intentDigest,
    rfqId: exact.rfqId,
    account: exact.account,
    chainId: exact.chainId,
    selection: Object.freeze({
      reservationId: exact.reservationId,
      makerId: exact.makerId,
      fence: exact.reservationFence,
      quoteDigest: exact.quoteDigest,
    }),
  });
}
function snapshotFor(exact = query) {
  return Object.freeze({
    makerId: exact.makerId,
    intentDigest: exact.intentDigest,
    reservationId: exact.reservationId,
    fence: exact.reservationFence,
    quoteDigest: exact.quoteDigest,
    dealId: exact.dealId,
    sellToken: exact.sellToken,
    sellAmount: exact.sellAmount,
    buyToken: exact.buyToken,
    buyAmount: exact.buyAmount,
    deadline: exact.deadline,
    ticketAddress: exact.ticketAddress,
    state: exact.outcome === "settled" ? "consumed" : "selected",
    ...(exact.outcome === "settled"
      ? { settlementTransactionHash: exact.transactions.fill }
      : {}),
  });
}
const projection = projectionFor();
const request = requestFor();
const snapshot = snapshotFor();
function evidence(status = "authoritative", exact = query, patch = {}) {
  return Object.freeze({
    status,
    revision: 9,
    queryDigest: digestLocalnetAuthorityQuery(exact),
    marketQuarantined: status === "reorged",
    canonicalLifecycle: Object.freeze([
      { stage: "fund", transactionHash: exact.transactions.fund },
      ...(exact.outcome === "settled"
        ? [
            { stage: "fill", transactionHash: exact.transactions.fill },
            { stage: "claim", transactionHash: exact.transactions.claim },
          ]
        : [{ stage: "timeout", transactionHash: exact.transactions.timeout }]),
    ]),
    ...patch,
  });
}
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "app20-live-reconcile-"));
  return {
    path: join(directory, "journal.json"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
function fixture(path, overrides = {}) {
  const exactQuery = overrides.query ?? query;
  let authorityEvidence =
    overrides.authorityEvidence ?? evidence("authoritative", exactQuery);
  let makerSnapshot = overrides.snapshot ?? snapshotFor(exactQuery);
  let requestRecords = overrides.requests ?? [requestFor(exactQuery)];
  const terminalAttempts = new Set();
  let terminalCalls = 0;
  let snapshotCalls = 0;
  let makerQuarantineCalls = 0;
  let quarantineCalls = 0;
  let loseResponse = overrides.loseResponse === true;
  const projectionForEvidence = () =>
    projectionFor(
      exactQuery,
      authorityEvidence.status,
      authorityEvidence.revision,
    );
  const chainAuthority = {
    exactQueryForProjection: () => exactQuery,
    reconciliationEvidence: () => authorityEvidence,
    hasQueryDigest: () => overrides.hasQueryDigest !== false,
    verify: overrides.verify ?? (async () => projectionForEvidence()),
    reverifyAll: async () => [projectionForEvidence()],
    listOperatorSummaries: () =>
      overrides.chainRows ?? [
        {
          status: authorityEvidence.status,
          marketQuarantined: authorityEvidence.marketQuarantined,
        },
      ],
  };
  const pipeline = createLocalnetAuthorityReconciliationPipeline({
    chainAuthority,
    coordinator: { listRequests: () => requestRecords },
    makerClientForId: (makerId) =>
      makerId === exactQuery.makerId ? { solverId: makerId } : undefined,
    requestMaker: async (_client, pathname, body) => {
      if (pathname === "/v1/reconciliation/snapshot") {
        snapshotCalls += 1;
        return makerSnapshot;
      }
      if (pathname === "/v1/reconciliation/quarantine") {
        makerQuarantineCalls += 1;
        makerSnapshot = {
          ...snapshotFor(exactQuery),
          state: "quarantined",
          authorityQuarantine: {
            attemptId: body.attemptId,
            authorityDigest: body.authorityDigest,
            authorityRevision: body.authorityRevision,
            outcome: body.outcome,
            reason: body.reason,
            selectionFence: exactQuery.reservationFence,
            quarantinedAt: 1_700_000_000,
          },
          ...(overrides.quarantineAcknowledgement ?? {}),
        };
        return makerSnapshot;
      }
      assert.equal(pathname, "/v1/reconciliation/terminal");
      assert.deepEqual(body.target, {
        reservationId: exactQuery.reservationId,
        intentDigest: exactQuery.intentDigest,
        fence: exactQuery.reservationFence,
        quoteDigest: exactQuery.quoteDigest,
        dealId: exactQuery.dealId,
        sellToken: exactQuery.sellToken,
        sellAmount: exactQuery.sellAmount,
        buyToken: exactQuery.buyToken,
        buyAmount: exactQuery.buyAmount,
        deadline: exactQuery.deadline,
        ticketAddress: exactQuery.ticketAddress,
      });
      terminalCalls += 1;
      terminalAttempts.add(body.attemptId);
      makerSnapshot = {
        ...snapshotFor(exactQuery),
        state: exactQuery.outcome === "settled" ? "consumed" : "released",
        ...(exactQuery.outcome === "settled"
          ? { settlementTransactionHash: exactQuery.transactions.fill }
          : { settlementTransactionHash: undefined }),
        terminalReconciliation: {
          attemptId: body.attemptId,
          authorityDigest: body.authorityDigest,
          authorityRevision: body.authorityRevision,
          outcome: body.outcome,
          selectionFence: exactQuery.reservationFence,
          reconciledAt: 1_700_000_000,
        },
        ...(overrides.terminalAcknowledgement ?? {}),
      };
      if (loseResponse) {
        loseResponse = false;
        throw new Error("maker response lost");
      }
      return makerSnapshot;
    },
    quarantineProjection: async () => {
      quarantineCalls += 1;
    },
    journalPath: path,
    runtimeEpoch,
    faultInjector: overrides.faultInjector,
    now: () => 1_700_000_000,
  });
  return {
    pipeline,
    terminalAttempts,
    terminalCalls: () => terminalCalls,
    snapshotCalls: () => snapshotCalls,
    makerQuarantineCalls: () => makerQuarantineCalls,
    quarantineCalls: () => quarantineCalls,
    setEvidence: (next) => {
      authorityEvidence = next;
    },
    snapshot: () => makerSnapshot,
    setSnapshot: (next) => {
      makerSnapshot = next;
    },
    setRequests: (next) => {
      requestRecords = next;
    },
  };
}

test("v3 composition posts exact per-lock terminal reconciliation from DealTaken authority", async () => {
  const tmp = temporary();
  const v3Query = Object.freeze({
    lifecycle: "v3",
    runtimeEpoch,
    chainId: "0x123",
    account: "0xaaa",
    rfqId: "0xbbb",
    dealId: "0xbbb",
    intentDigest: `0x${"5".repeat(64)}`,
    rfqDigest: `0x${"6".repeat(64)}`,
    commitmentDigest: `0x${"7".repeat(64)}`,
    expected: Object.freeze({
      tokenA: "0x11",
      totalA: "100",
      tokenB: "0x22",
      totalB: "200",
      fills: Object.freeze([
        Object.freeze({ lockId: "0xa", amountA: "40", amountB: "80" }),
        Object.freeze({ lockId: "0xb", amountA: "60", amountB: "120" }),
      ]),
    }),
    transactions: Object.freeze({ take: "0x201" }),
  });
  const projectionV3 = projectionFor(v3Query);
  const evidenceV3 = {
    status: "authoritative",
    revision: 9,
    queryDigest: digestLocalnetAuthorityQuery(v3Query),
    marketQuarantined: false,
    canonicalLifecycle: [
      {
        stage: "take",
        transactionHash: "0x201",
        fillEvents: [
          { stage: "lockTaken", lockId: "0xa", transactionHash: "0x201" },
          { stage: "lockTaken", lockId: "0xb", transactionHash: "0x201" },
        ],
      },
    ],
  };
  const requestV3 = {
    lifecycle: "v3",
    state: "taken",
    rfqDigest: v3Query.rfqDigest,
    intentDigest: v3Query.intentDigest,
    rfqId: v3Query.rfqId,
    account: v3Query.account,
    chainId: v3Query.chainId,
    expected: v3Query.expected,
    makerPlans: [
      {
        makerId: "maker-a",
        state: "quoted",
        quoteDigest: `0x${"8".repeat(64)}`,
        quote: { lockId: "0xa", rfqDigest: v3Query.rfqDigest, rfqFelt: v3Query.rfqId },
      },
      {
        makerId: "maker-b",
        state: "quoted",
        quoteDigest: `0x${"9".repeat(64)}`,
        quote: { lockId: "0xb", rfqDigest: v3Query.rfqDigest, rfqFelt: v3Query.rfqId },
      },
    ],
  };
  const calls = [];
  try {
    const pipeline = createLocalnetAuthorityReconciliationPipeline({
      chainAuthority: {
        exactQueryForProjection: () => v3Query,
        reconciliationEvidence: () => evidenceV3,
        hasQueryDigest: () => true,
        verify: async () => projectionV3,
        reverifyAll: async () => [projectionV3],
        listOperatorSummaries: () => [
          { status: "authoritative", marketQuarantined: false },
        ],
      },
      coordinator: { getV3Request: () => requestV3 },
      makerClientForId: (makerId) => ({ solverId: makerId }),
      requestMaker: async (client, pathname, body) => {
        assert.equal(pathname, "/v1/reconciliation/terminal");
        calls.push({ client, body });
        return {
          ...body.target,
          state: "taken",
          takenA: body.target.takenA,
          takenB: body.target.takenB,
          terminalReconciliation: {
            idempotencyKey: body.attemptId,
            authorityDigest: body.authorityDigest,
            authorityRevision: body.authorityRevision,
            transactionHash: body.target.transactionHash,
          },
        };
      },
      journalPath: tmp.path,
      runtimeEpoch,
      now: () => 1_700_000_000,
    });
    const result = await pipeline.verifyAndReconcile({});
    assert.equal(result.reconciliation.status, "released-terminal");
    assert.deepEqual(
      calls.map(({ client, body }) => [client.solverId, body.target.lockId]),
      [
        ["maker-a", "0xa"],
        ["maker-b", "0xb"],
      ],
    );
    assert.equal(new Set(calls.map(({ body }) => body.attemptId)).size, 1);
  } finally {
    tmp.cleanup();
  }
});

test("real composition recovers terminal release once across response loss and restart", async () => {
  const tmp = temporary();
  try {
    const first = fixture(tmp.path, { loseResponse: true });
    await assert.rejects(first.pipeline.recover(), /maker response lost/i);
    assert.equal(first.terminalCalls(), 1);
    assert.equal(first.terminalAttempts.size, 1);
    const [firstAttempt] = first.terminalAttempts;
    assert.equal(
      first.snapshot().terminalReconciliation.attemptId,
      firstAttempt,
    );

    const second = fixture(tmp.path, {
      snapshot: first.snapshot(),
    });
    const [result] = await second.pipeline.recover();
    assert.equal(result.status, "released-terminal");
    assert.equal(second.terminalCalls(), 0);
    assert.equal(result.authorityRevision, 9);

    const orphaned = fixture(tmp.path, { hasQueryDigest: false });
    await assert.rejects(
      orphaned.pipeline.recover(),
      /no matching durable chain authority query/i,
    );
    assert.equal(orphaned.terminalCalls(), 0);
  } finally {
    tmp.cleanup();
  }
});

for (const outcome of ["settled", "refunded"]) {
  test(`${outcome} recovery survives crash after maker quarantine acknowledgement before journal publication`, async () => {
    const tmp = temporary();
    const exactQuery = Object.freeze(
      outcome === "settled"
        ? {
            ...query,
            outcome,
            transactions: Object.freeze({
              fund: "0x201",
              fill: "0x202",
              claim: "0x203",
            }),
          }
        : query,
    );
    const terminalRevision9 = evidence("authoritative", exactQuery, {
      revision: 9,
    });
    const disagreementRevision10 = evidence("disagreement", exactQuery, {
      revision: 10,
      marketQuarantined: false,
    });
    const authoritativeRevision11 = evidence("authoritative", exactQuery, {
      revision: 11,
      marketQuarantined: false,
    });
    let crashOnce = true;
    try {
      const first = fixture(tmp.path, {
        query: exactQuery,
        authorityEvidence: terminalRevision9,
        faultInjector: (stage) => {
          if (stage === "after-quarantine-ack" && crashOnce) {
            crashOnce = false;
            throw new Error(
              "simulated crash after exact maker acknowledgement",
            );
          }
        },
      });
      const [terminal] = await first.pipeline.recover();
      assert.equal(terminal.status, "released-terminal");
      first.setEvidence(disagreementRevision10);
      await assert.rejects(
        first.pipeline.reconcileProjection(
          projectionFor(exactQuery, "disagreement", 10),
        ),
        /simulated crash after exact maker acknowledgement/,
      );
      assert.equal(first.makerQuarantineCalls(), 1);
      assert.equal(first.quarantineCalls(), 0);
      assert.equal(first.snapshot().authorityQuarantine.authorityRevision, 10);
      assert.equal(
        first.pipeline.listOperatorSummaries()[0].status,
        "quarantine-pending",
      );

      const recovered = fixture(tmp.path, {
        query: exactQuery,
        authorityEvidence: authoritativeRevision11,
        snapshot: first.snapshot(),
      });
      assert.equal(
        recovered.pipeline.listOperatorSummaries()[0].status,
        "quarantine-pending",
      );
      const [result] = await recovered.pipeline.recover();
      assert.equal(result.status, "released-terminal");
      assert.equal(result.authorityRevision, 11);
      assert.equal(recovered.terminalCalls(), 1);
      assert.equal(
        recovered.snapshot().terminalReconciliation.authorityRevision,
        11,
      );
      assert.equal(
        recovered.snapshot().state,
        outcome === "settled" ? "consumed" : "released",
      );
    } finally {
      tmp.cleanup();
    }
  });
}

test("verify-through-maker reconciliation serializes delayed revision 10 before terminal revision 11 and restart ignores stale replay", async () => {
  const tmp = temporary();
  const revision10 = evidence("disagreement", query, {
    revision: 10,
    marketQuarantined: false,
  });
  const revision11 = evidence("authoritative", query, {
    revision: 11,
    marketQuarantined: false,
  });
  let releaseRevision10;
  const revision10Gate = new Promise((resolve) => {
    releaseRevision10 = resolve;
  });
  const verifyCalls = [];
  let setEvidence;
  try {
    const exact = fixture(tmp.path, {
      authorityEvidence: revision10,
      verify: async (input) => {
        verifyCalls.push(input.requestedRevision);
        if (input.requestedRevision === 10) await revision10Gate;
        const next = input.requestedRevision === 10 ? revision10 : revision11;
        setEvidence(next);
        return projectionFor(query, next.status, next.revision);
      },
    });
    setEvidence = exact.setEvidence;
    const delayed10 = exact.pipeline.verifyAndReconcile({
      query,
      market: "usdc-strk",
      requestedRevision: 10,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const terminal11 = exact.pipeline.verifyAndReconcile({
      query,
      market: "usdc-strk",
      requestedRevision: 11,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      verifyCalls,
      [10],
      "revision 11 verification must wait for the full revision 10 pipeline",
    );
    releaseRevision10();
    const [result10, result11] = await Promise.all([delayed10, terminal11]);
    assert.equal(result10.reconciliation.status, "quarantined");
    assert.equal(result11.reconciliation.status, "released-terminal");
    assert.equal(
      exact.pipeline.listOperatorSummaries()[0].authorityRevision,
      11,
    );
    const quarantineCalls = exact.makerQuarantineCalls();

    // Even a regressed authority adapter cannot make the durable reconciliation
    // high-water publish revision 10 over the completed revision 11 row.
    exact.setEvidence(revision10);
    const ignored = await exact.pipeline.reconcileProjection(
      projectionFor(query, "disagreement", 10),
    );
    assert.equal(ignored.staleAuthorityIgnored, true);
    assert.equal(ignored.status, "released-terminal");
    assert.equal(exact.makerQuarantineCalls(), quarantineCalls);

    const restarted = fixture(tmp.path, {
      authorityEvidence: revision10,
      snapshot: exact.snapshot(),
    });
    const [ignoredAfterRestart] = await restarted.pipeline.recover();
    assert.equal(ignoredAfterRestart.staleAuthorityIgnored, true);
    assert.equal(
      restarted.pipeline.listOperatorSummaries()[0].authorityRevision,
      11,
    );
    assert.equal(restarted.makerQuarantineCalls(), 0);
  } finally {
    tmp.cleanup();
  }
});

test("real durable maker recovers authoritative disagreement revisions across response loss and restart", async () => {
  const tmp = temporary();
  const walPath = join(tmp.path, "..", "maker-reservations.wal");
  const realQuery = Object.freeze({
    ...query,
    deadline: 1_700_001_000,
  });
  const realRequest = Object.freeze({
    ...request,
    selection: Object.freeze({
      ...request.selection,
      fence: realQuery.reservationFence,
    }),
  });
  const target = {
    reservationId: realQuery.reservationId,
    intentDigest: realQuery.intentDigest,
    fence: BigInt(realQuery.reservationFence),
    quoteDigest: realQuery.quoteDigest,
    dealId: realQuery.dealId,
    sellToken: realQuery.sellToken,
    sellAmount: BigInt(realQuery.sellAmount),
    buyToken: realQuery.buyToken,
    buyAmount: BigInt(realQuery.buyAmount),
    deadline: realQuery.deadline,
    ticketAddress: realQuery.ticketAddress,
  };
  let clock = 1_700_000_100;
  let store;
  let maker;
  let loseTerminalResponse = true;
  let currentEvidence = {
    ...evidence(),
    queryDigest: digestLocalnetAuthorityQuery(realQuery),
    revision: 9,
  };
  let currentProjection = { ...projection, revision: 9 };

  const openMaker = () => {
    store = DurableReservationStore.open(walPath);
    maker = new DurableMakerNode(store, {
      makerId: realQuery.makerId,
      solverKey: "maker-a/quote/p256/v1",
      pool: "starknet:APP20_LOCALNET",
      helper: "0x44",
      spreadBps: 0,
      reservationTtlSeconds: 600,
      price: async () => ({
        grossBuyAmount: BigInt(realQuery.buyAmount),
        provenance: "fixture:real-durable-maker",
      }),
      signer: async () => "0x1",
      wallet: {
        settlementAccount: "0x55",
        privateBalance: async () => 1_000n,
        fill: async () => ({ transactionHash: "0xf11" }),
      },
    });
  };
  const closeMaker = async () => {
    await store.close();
  };
  const makerTarget = (value) => ({
    ...value,
    fence: BigInt(value.fence),
    sellAmount: BigInt(value.sellAmount),
    buyAmount: BigInt(value.buyAmount),
  });
  const chainAuthority = {
    exactQueryForProjection: () => realQuery,
    reconciliationEvidence: () => Object.freeze(currentEvidence),
    hasQueryDigest: (value) =>
      value === digestLocalnetAuthorityQuery(realQuery),
    reverifyAll: async () => [Object.freeze(currentProjection)],
    listOperatorSummaries: () => [
      {
        status: currentEvidence.status,
        marketQuarantined: currentEvidence.marketQuarantined,
      },
    ],
  };
  const pipeline = () =>
    createLocalnetAuthorityReconciliationPipeline({
      chainAuthority,
      coordinator: { listRequests: () => [realRequest] },
      makerClientForId: (makerId) =>
        makerId === realQuery.makerId ? { solverId: makerId } : undefined,
      requestMaker: async (_client, pathname, body) => {
        if (pathname === "/v1/reconciliation/snapshot")
          return maker.readReconciliationSnapshot(
            makerTarget(body.target),
            clock++,
          );
        if (pathname === "/v1/reconciliation/quarantine")
          return maker.quarantineForAuthority(
            { ...body, target: makerTarget(body.target) },
            clock++,
          );
        assert.equal(pathname, "/v1/reconciliation/terminal");
        const acknowledgement = await maker.reconcileAuthoritativeTerminal(
          { ...body, target: makerTarget(body.target) },
          clock++,
        );
        if (loseTerminalResponse) {
          loseTerminalResponse = false;
          throw new Error("maker response lost after durable mutation");
        }
        return acknowledgement;
      },
      quarantineProjection: async (publishedProjection) => {
        if (publishedProjection.status !== "disagreement") return;
        const snapshot = await maker.readReconciliationSnapshot(
          target,
          clock++,
        );
        assert.equal(
          snapshot.state,
          "quarantined",
          "maker capacity must lock before disagreement publication",
        );
      },
      journalPath: tmp.path,
      runtimeEpoch,
      now: () => clock++,
    });

  try {
    openMaker();
    const reserved = createMakerReservation({
      reservationId: realQuery.reservationId,
      makerId: realQuery.makerId,
      intentDigest: realQuery.intentDigest,
      rfqDigest: `0x${"8".repeat(64)}`,
      asset: realQuery.buyToken,
      amountBaseUnits: BigInt(realQuery.buyAmount),
      createdAt: 1_700_000_000,
      expiresAt: realQuery.deadline,
      fence: 6n,
    });
    const selected = transitionMakerReservation(reserved, {
      kind: "select",
      expectedFence: 6n,
      at: 1_700_000_001,
      quoteDigest: realQuery.quoteDigest,
    });
    await store.transaction((draft) => {
      draft.set(realQuery.reservationId, {
        reservation: selected,
        nonce: `0x${"9".repeat(64)}`,
        solverId: realQuery.makerId,
        solverKey: "maker-a/quote/p256/v1",
        spreadBps: 0,
        sellToken: realQuery.sellToken,
        sellAmount: BigInt(realQuery.sellAmount),
        buyToken: realQuery.buyToken,
        grossBuyAmount: BigInt(realQuery.buyAmount),
        buyAmount: BigInt(realQuery.buyAmount),
        minBuyAmount: 1n,
        rfqExpiresAt: realQuery.deadline,
        pricingProvenance: "fixture:real-durable-maker",
        signedCanonical: "fixture-canonical-quote",
        signature: "0x1",
        quoteDigest: realQuery.quoteDigest,
      });
    });
    await maker.bindSettlementForReconciliation(target, clock++);

    let reconciliation = pipeline();
    await assert.rejects(
      reconciliation.recover(),
      /maker response lost after durable mutation/i,
    );
    assert.equal(store.list()[0].reservation.state, "released");
    assert.equal(store.list()[0].terminalReconciliation.authorityRevision, 9);

    await closeMaker();
    openMaker();
    reconciliation = pipeline();
    const [replayed] = await reconciliation.recover();
    assert.equal(replayed.status, "released-terminal");

    currentEvidence = {
      ...currentEvidence,
      status: "disagreement",
      revision: 10,
      marketQuarantined: false,
    };
    currentProjection = {
      ...currentProjection,
      status: "disagreement",
      revision: 10,
    };
    const quarantined =
      await reconciliation.reconcileProjection(currentProjection);
    assert.equal(quarantined.status, "quarantined");
    assert.equal(store.list()[0].reservation.state, "quarantined");
    assert.equal(store.list()[0].authorityQuarantine.authorityRevision, 10);

    await closeMaker();
    openMaker();
    currentEvidence = {
      ...currentEvidence,
      status: "authoritative",
      revision: 11,
    };
    currentProjection = {
      ...currentProjection,
      status: "authoritative",
      revision: 11,
    };
    loseTerminalResponse = true;
    reconciliation = pipeline();
    await assert.rejects(
      reconciliation.recover(),
      /maker response lost after durable mutation/i,
    );
    assert.equal(store.list()[0].reservation.state, "released");
    assert.equal(store.list()[0].terminalReconciliation.authorityRevision, 11);

    await closeMaker();
    openMaker();
    reconciliation = pipeline();
    const [recovered] = await reconciliation.recover();
    assert.equal(recovered.status, "released-terminal");
    assert.equal(store.list()[0].reservation.state, "released");
    assert.equal(store.list()[0].terminalReconciliation.authorityRevision, 11);
  } finally {
    if (store) await store.close().catch(() => undefined);
    tmp.cleanup();
    rmSync(walPath, { force: true });
    rmSync(`${walPath}.lock`, { force: true });
  }
});

test("disagreement, unknown coordinator, reorg, and maker mutations never reach terminal release", async () => {
  for (const mutation of [
    "disagreement",
    "missing-request",
    "reorg",
    "maker-terms",
  ]) {
    const tmp = temporary();
    try {
      const exact = fixture(tmp.path, {
        authorityEvidence:
          mutation === "disagreement"
            ? evidence("disagreement")
            : mutation === "reorg"
              ? evidence("reorged")
              : evidence(),
        requests: mutation === "missing-request" ? [] : [request],
        snapshot:
          mutation === "maker-terms"
            ? { ...snapshot, buyAmount: "201" }
            : snapshot,
      });
      if (mutation === "missing-request" || mutation === "maker-terms")
        await assert.rejects(exact.pipeline.recover());
      else {
        const [result] = await exact.pipeline.recover();
        assert.equal(result.status, "quarantined");
      }
      assert.equal(exact.terminalCalls(), 0);
      if (mutation !== "maker-terms") assert.equal(exact.snapshotCalls(), 0);
      assert.equal(
        exact.makerQuarantineCalls(),
        mutation === "disagreement" || mutation === "reorg" ? 1 : 0,
      );
    } finally {
      tmp.cleanup();
    }
  }
});

test("malformed maker quarantine acknowledgement is never published", async () => {
  for (const mutation of [
    { state: "released" },
    { makerId: "maker-b" },
    { fence: "8" },
    { authorityQuarantine: undefined },
    {
      authorityQuarantine: {
        attemptId: "substituted-attempt",
        authorityDigest: digestLocalnetAuthorityQuery(query),
        authorityRevision: 9,
        outcome: "refunded",
        reason: "authority-disagreement",
        selectionFence: query.reservationFence,
        quarantinedAt: 1_700_000_000,
      },
    },
  ]) {
    const tmp = temporary();
    try {
      const exact = fixture(tmp.path, {
        authorityEvidence: evidence("disagreement"),
        quarantineAcknowledgement: mutation,
      });
      await assert.rejects(exact.pipeline.recover());
      assert.equal(exact.makerQuarantineCalls(), 1);
      assert.equal(exact.quarantineCalls(), 0);
      assert.equal(exact.terminalCalls(), 0);
    } finally {
      tmp.cleanup();
    }
  }
});

test("malformed terminal acknowledgement never publishes released authority", async () => {
  for (const mutation of [
    { state: "selected" },
    { makerId: "maker-b" },
    { fence: "8" },
    { settlementTransactionHash: "0x999" },
    { terminalReconciliation: undefined },
    {
      terminalReconciliation: {
        attemptId: "wrong-attempt",
        authorityDigest: digestLocalnetAuthorityQuery(query),
        authorityRevision: 9,
        outcome: "refunded",
        selectionFence: query.reservationFence,
        reconciledAt: 1_700_000_000,
      },
    },
  ]) {
    const tmp = temporary();
    try {
      const exact = fixture(tmp.path, {
        terminalAcknowledgement: mutation,
      });
      // Snapshot validation may reject before release, or the exact terminal
      // acknowledgement may reject after the maker effect. Neither path may
      // publish a released-terminal journal row.
      await assert.rejects(exact.pipeline.recover());
      assert.equal(
        exact.pipeline
          .listOperatorSummaries()
          .some((row) => row.status === "released-terminal"),
        false,
      );
      assert.equal(exact.pipeline.hasUnresolvedAuthority(), true);
    } finally {
      tmp.cleanup();
    }
  }
});

test("one successful binding cannot clear another authority quarantine", async () => {
  const tmp = temporary();
  try {
    const exact = fixture(tmp.path, {
      chainRows: [
        { status: "disagreement", marketQuarantined: false },
        { status: "authoritative", marketQuarantined: false },
      ],
    });
    await exact.pipeline.recover();
    assert.equal(exact.pipeline.hasUnresolvedAuthority(), true);
  } finally {
    tmp.cleanup();
  }
});

test("journal uncertainty fail-stops before the maker terminal mutation", async () => {
  const tmp = temporary();
  try {
    const exact = fixture(tmp.path, {
      faultInjector: (stage) => {
        if (stage === "before-write") throw new Error("disk fault");
      },
    });
    await assert.rejects(exact.pipeline.recover(), /fail-stopped|uncertain/i);
    assert.equal(exact.terminalCalls(), 0);
    await assert.rejects(exact.pipeline.recover(), /fail-stopped/i);
    assert.equal(exact.terminalCalls(), 0);
  } finally {
    tmp.cleanup();
  }
});
