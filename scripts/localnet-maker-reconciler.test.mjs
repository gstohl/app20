import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digestLocalnetAuthorityQuery } from "./localnet-chain-authority.mjs";
import { createLocalnetMakerReconciler } from "./localnet-maker-reconciler.mjs";

const epoch = "0123456789abcdef0123456789abcdef";
const query = Object.freeze({
  runtimeEpoch: epoch,
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
  outcome: "settled",
  transactions: Object.freeze({ fund: "0x101", fill: "0x102", claim: "0x103" }),
});
function coordinator(exact = query) {
  return {
    state: exact.outcome,
    intentDigest: exact.intentDigest,
    rfqId: exact.rfqId,
    account: exact.account,
    chainId: exact.chainId,
    selection: {
      reservationId: exact.reservationId,
      makerId: exact.makerId,
      fence: exact.reservationFence,
      quoteDigest: exact.quoteDigest,
    },
  };
}
function reservation(exact = query) {
  return {
    makerId: exact.makerId,
    intentDigest: exact.intentDigest,
    reservationId: exact.reservationId,
    fence: exact.reservationFence,
    quoteDigest: exact.quoteDigest,
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
  };
}
function authority(exact = query, patch = {}) {
  return {
    status: "authoritative",
    revision: 9,
    queryDigest: digestLocalnetAuthorityQuery(exact),
    marketQuarantined: false,
    canonicalLifecycle: [
      { stage: "fund", transactionHash: exact.transactions.fund },
      ...(exact.outcome === "settled"
        ? [
            { stage: "fill", transactionHash: exact.transactions.fill },
            { stage: "claim", transactionHash: exact.transactions.claim },
          ]
        : [{ stage: "timeout", transactionHash: exact.transactions.timeout }]),
    ],
    ...patch,
  };
}
function terminalSnapshot(exact, evidence, attemptId) {
  return {
    ...reservation(exact),
    state: exact.outcome === "settled" ? "consumed" : "released",
    terminalReconciliation: {
      attemptId,
      authorityDigest: evidence.queryDigest,
      authorityRevision: evidence.revision,
      outcome: exact.outcome,
      selectionFence: exact.reservationFence,
      reconciledAt: 1_700_000_000,
    },
  };
}
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "app20-maker-reconcile-"));
  return {
    path: join(directory, "journal.json"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
function reconcilerOptions(path, overrides = {}) {
  return {
    path,
    runtimeEpoch: epoch,
    now: overrides.now ?? (() => 1_700_000_000),
    releaseTerminal: overrides.releaseTerminal ?? (async () => undefined),
    quarantineAuthority:
      overrides.quarantineAuthority ?? (async () => undefined),
    ...(overrides.releaseV3Terminal
      ? { releaseV3Terminal: overrides.releaseV3Terminal }
      : {}),
    ...(overrides.quarantineV3Authority
      ? { quarantineV3Authority: overrides.quarantineV3Authority }
      : {}),
    ...(overrides.faultInjector
      ? { faultInjector: overrides.faultInjector }
      : {}),
  };
}

test("exact authoritative terminal releases once and restart revalidates current maker metadata", async () => {
  const tmp = temporary();
  const effects = [];
  const currentAuthority = authority();
  let makerSnapshot = reservation();
  try {
    let reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, {
        releaseTerminal: async (input) => {
          effects.push(input.attemptId);
          makerSnapshot = terminalSnapshot(
            query,
            currentAuthority,
            input.attemptId,
          );
        },
      }),
    );
    const result = await reconciler.reconcile({
      query,
      coordinator: coordinator(),
      reservation: makerSnapshot,
      authorityEvidence: currentAuthority,
    });
    assert.equal(result.status, "released-terminal");
    assert.equal(effects.length, 1);

    reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, {
        now: () => 1_700_000_001,
        releaseTerminal: async (input) => effects.push(input.attemptId),
      }),
    );
    assert.equal(
      (
        await reconciler.reconcile({
          query,
          coordinator: coordinator(),
          reservation: makerSnapshot,
          authorityEvidence: currentAuthority,
        })
      ).status,
      "released-terminal",
    );
    assert.equal(effects.length, 1);
  } finally {
    tmp.cleanup();
  }
});

test("v3 take reconciliation binds each LockTaken to one quoted maker and posts terminal once", async () => {
  const tmp = temporary();
  const v3Query = Object.freeze({
    lifecycle: "v3",
    runtimeEpoch: epoch,
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
  const v3Coordinator = {
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
  const v3Authority = {
    status: "authoritative",
    revision: 3,
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
  const effects = [];
  try {
    let reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, {
        releaseV3Terminal: async (effect) => effects.push(effect),
      }),
    );
    const result = await reconciler.reconcile({
      query: v3Query,
      coordinator: v3Coordinator,
      authorityEvidence: v3Authority,
    });
    assert.equal(result.status, "released-terminal");
    assert.deepEqual(
      effects[0].fills.map(({ makerId, lockId }) => [makerId, lockId]),
      [
        ["maker-a", "0xa"],
        ["maker-b", "0xb"],
      ],
    );

    reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, {
        releaseV3Terminal: async (effect) => effects.push(effect),
      }),
    );
    await reconciler.reconcile({
      query: v3Query,
      coordinator: v3Coordinator,
      authorityEvidence: v3Authority,
    });
    assert.equal(effects.length, 1);

    await assert.rejects(
      createLocalnetMakerReconciler(
        reconcilerOptions(`${tmp.path}.mutated`, {
          releaseV3Terminal: async () => undefined,
        }),
      ).reconcile({
        query: v3Query,
        coordinator: {
          ...v3Coordinator,
          makerPlans: v3Coordinator.makerPlans.map((plan, index) =>
            index === 0
              ? { ...plan, quote: { ...plan.quote, lockId: "0xc" } }
              : plan,
          ),
        },
        authorityEvidence: v3Authority,
      }),
      /one maker owner/i,
    );
  } finally {
    tmp.cleanup();
  }
});

test("released-terminal without current maker metadata reruns exact terminal reconciliation", async () => {
  const tmp = temporary();
  const currentAuthority = authority();
  let makerSnapshot = reservation();
  let effects = 0;
  try {
    const releaseTerminal = async (input) => {
      effects += 1;
      makerSnapshot = terminalSnapshot(
        query,
        currentAuthority,
        input.attemptId,
      );
    };
    let reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, { releaseTerminal }),
    );
    await reconciler.reconcile({
      query,
      coordinator: coordinator(),
      reservation: makerSnapshot,
      authorityEvidence: currentAuthority,
    });
    assert.equal(effects, 1);

    // Simulate a maker that was subsequently quarantined while the journal's
    // last published row still says released-terminal.
    makerSnapshot = { ...reservation(), state: "quarantined" };
    reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, { releaseTerminal }),
    );
    const recovered = await reconciler.reconcile({
      query,
      coordinator: coordinator(),
      reservation: makerSnapshot,
      authorityEvidence: currentAuthority,
    });
    assert.equal(recovered.status, "released-terminal");
    assert.equal(effects, 2);
  } finally {
    tmp.cleanup();
  }
});

test("later reorg evidence persists pending before exact maker quarantine", async () => {
  const tmp = temporary();
  const terminalAuthority = authority();
  const reorg = authority(query, {
    status: "reorged",
    revision: 10,
    marketQuarantined: true,
  });
  let makerSnapshot = reservation();
  const observedStatuses = [];
  try {
    const reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, {
        releaseTerminal: async (input) => {
          makerSnapshot = terminalSnapshot(
            query,
            terminalAuthority,
            input.attemptId,
          );
        },
        quarantineAuthority: async () => {
          observedStatuses.push(reconciler.listOperatorSummaries()[0].status);
        },
      }),
    );
    await reconciler.reconcile({
      query,
      coordinator: coordinator(),
      reservation: makerSnapshot,
      authorityEvidence: terminalAuthority,
    });
    const rolledBack = await reconciler.reconcile({
      query,
      coordinator: coordinator(),
      reservation: undefined,
      authorityEvidence: reorg,
    });
    assert.equal(rolledBack.status, "quarantined");
    assert.deepEqual(observedStatuses, ["quarantine-pending"]);
  } finally {
    tmp.cleanup();
  }
});

test("missing and stale authority stay pending while mismatched exact bindings reject", async () => {
  const pendingCases = [
    { evidence: undefined, expected: "pending", quarantineCalls: 0 },
    {
      evidence: authority(query, { status: "stale" }),
      expected: "pending",
      quarantineCalls: 0,
    },
    {
      evidence: authority(query, { status: "disagreement" }),
      expected: "quarantined",
      quarantineCalls: 1,
    },
    {
      evidence: authority(query, {
        status: "reorged",
        marketQuarantined: true,
      }),
      expected: "quarantined",
      quarantineCalls: 1,
    },
  ];
  for (const [index, entry] of pendingCases.entries()) {
    const tmp = temporary();
    try {
      let quarantineCalls = 0;
      const reconciler = createLocalnetMakerReconciler(
        reconcilerOptions(tmp.path, {
          now: () => 1_700_000_000 + index,
          quarantineAuthority: async () => {
            quarantineCalls += 1;
          },
        }),
      );
      const result = await reconciler.reconcile({
        query,
        coordinator: coordinator(),
        reservation: reservation(),
        authorityEvidence: entry.evidence,
      });
      assert.equal(result.status, entry.expected);
      assert.equal(quarantineCalls, entry.quarantineCalls);
    } finally {
      tmp.cleanup();
    }
  }

  for (const mutation of [
    { reservation: { ...reservation(), settlementTransactionHash: "0x999" } },
    { reservation: { ...reservation(), buyAmount: "201" } },
    {
      coordinator: {
        ...coordinator(),
        selection: { ...coordinator().selection, fence: "8" },
      },
    },
    { coordinator: { ...coordinator(), state: "expired" } },
  ]) {
    const tmp = temporary();
    try {
      const reconciler = createLocalnetMakerReconciler(
        reconcilerOptions(tmp.path),
      );
      await assert.rejects(() =>
        reconciler.reconcile({
          query,
          coordinator: mutation.coordinator ?? coordinator(),
          reservation: mutation.reservation ?? reservation(),
          authorityEvidence: authority(),
        }),
      );
      assert.equal(
        reconciler
          .listOperatorSummaries()
          .some((row) => row.status === "quarantined"),
        false,
      );
    } finally {
      tmp.cleanup();
    }
  }
});

test("timeout/refund releases an unfilled selected reservation only on exact authority", async () => {
  const tmp = temporary();
  try {
    const refunded = {
      ...query,
      outcome: "refunded",
      transactions: { fund: "0x201", timeout: "0x202" },
    };
    const effects = [];
    const reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, {
        releaseTerminal: async (input) => effects.push(input),
      }),
    );
    const result = await reconciler.reconcile({
      query: refunded,
      coordinator: coordinator(refunded),
      reservation: reservation(refunded),
      authorityEvidence: authority(refunded),
    });
    assert.equal(result.status, "released-terminal");
    assert.equal(effects[0].query.outcome, "refunded");
  } finally {
    tmp.cleanup();
  }
});

test("response loss leaves release-pending and reuses one stable terminal attempt id", async () => {
  const tmp = temporary();
  const effects = new Set();
  let failOnce = true;
  try {
    const reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, {
        releaseTerminal: async ({ attemptId }) => {
          effects.add(attemptId);
          if (failOnce) {
            failOnce = false;
            throw new Error("response lost");
          }
        },
      }),
    );
    await assert.rejects(
      () =>
        reconciler.reconcile({
          query,
          coordinator: coordinator(),
          reservation: reservation(),
          authorityEvidence: authority(),
        }),
      /response lost/,
    );
    assert.equal(
      reconciler.listOperatorSummaries()[0].status,
      "release-pending",
    );
    assert.equal(
      (
        await reconciler.reconcile({
          query,
          coordinator: coordinator(),
          reservation: reservation(),
          authorityEvidence: authority(),
        })
      ).status,
      "released-terminal",
    );
    assert.equal(effects.size, 1);
  } finally {
    tmp.cleanup();
  }
});

test("durable authority high-water ignores delayed stale revision across restart", async () => {
  const tmp = temporary();
  const revision11 = authority(query, { revision: 11 });
  const delayedRevision10 = authority(query, {
    status: "disagreement",
    revision: 10,
  });
  let makerSnapshot = reservation();
  let quarantines = 0;
  try {
    let reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, {
        releaseTerminal: async (input) => {
          makerSnapshot = terminalSnapshot(query, revision11, input.attemptId);
        },
        quarantineAuthority: async () => {
          quarantines += 1;
        },
      }),
    );
    const terminal = await reconciler.reconcile({
      query,
      coordinator: coordinator(),
      reservation: makerSnapshot,
      authorityEvidence: revision11,
    });
    assert.equal(terminal.authorityRevision, 11);
    const ignored = await reconciler.reconcile({
      query,
      coordinator: coordinator(),
      authorityEvidence: delayedRevision10,
    });
    assert.equal(ignored.staleAuthorityIgnored, true);
    assert.equal(ignored.status, "released-terminal");
    assert.equal(quarantines, 0);

    reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path, {
        quarantineAuthority: async () => {
          quarantines += 1;
        },
      }),
    );
    const ignoredAfterRestart = await reconciler.reconcile({
      query,
      coordinator: coordinator(),
      authorityEvidence: delayedRevision10,
    });
    assert.equal(ignoredAfterRestart.staleAuthorityIgnored, true);
    assert.equal(reconciler.listOperatorSummaries()[0].authorityRevision, 11);
    assert.equal(quarantines, 0);
  } finally {
    tmp.cleanup();
  }
});

test("same authority revision cannot equivocate its outcome status", async () => {
  const tmp = temporary();
  try {
    const reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path),
    );
    await reconciler.reconcile({
      query,
      coordinator: coordinator(),
      reservation: reservation(),
      authorityEvidence: authority(query, { status: "stale" }),
    });
    await assert.rejects(
      () =>
        reconciler.reconcile({
          query,
          coordinator: coordinator(),
          authorityEvidence: authority(query, { status: "disagreement" }),
        }),
      /same-revision authority equivocation/i,
    );
  } finally {
    tmp.cleanup();
  }
});

test("old runtime epoch is verification-only refused", async () => {
  const tmp = temporary();
  try {
    const reconciler = createLocalnetMakerReconciler(
      reconcilerOptions(tmp.path),
    );
    await assert.rejects(
      () =>
        reconciler.reconcile({
          query: { ...query, runtimeEpoch: "f".repeat(32) },
          coordinator: coordinator(),
          reservation: reservation(),
          authorityEvidence: authority(),
        }),
      /old runtime/i,
    );
  } finally {
    tmp.cleanup();
  }
});
