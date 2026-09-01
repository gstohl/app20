import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LOCALNET_ESCROW_EVENT_ABI_DIGEST,
  LOCALNET_ESCROW_EVENT_SELECTORS,
} from "./localnet-chain-decoder.mjs";
import {
  canonicalLocalnetAuthorityQuery,
  createLocalnetChainAuthority,
  digestLocalnetAuthorityQuery,
} from "./localnet-chain-authority.mjs";

const epoch = "0123456789abcdef0123456789abcdef";
const artifact = Object.freeze({
  runtimeEpoch: epoch,
  chainId: "0x123",
  escrowAddress: "0x456",
  escrowClassHash: "0x789",
  abiDigest: LOCALNET_ESCROW_EVENT_ABI_DIGEST,
});
const query = Object.freeze({
  runtimeEpoch: epoch,
  chainId: artifact.chainId,
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
function rawEvent(stage, exact) {
  const keys = [LOCALNET_ESCROW_EVENT_SELECTORS[stage], exact.dealId];
  if (stage === "fund")
    return {
      fromAddress: artifact.escrowAddress,
      keys,
      data: [
        exact.sellToken,
        "0x64",
        exact.buyToken,
        "0xc8",
        `0x${exact.deadline.toString(16)}`,
        exact.ticketAddress,
      ],
    };
  if (stage === "fill")
    return {
      fromAddress: artifact.escrowAddress,
      keys,
      data: [exact.sellToken, "0x64", exact.buyToken, "0xc8"],
    };
  return {
    fromAddress: artifact.escrowAddress,
    keys,
    data: [exact.buyToken, "0xc8"],
  };
}
function observation(exact = query, options = {}) {
  const stages =
    exact.outcome === "settled"
      ? ["fund", "fill", "claim"]
      : ["fund", "timeout"];
  const lifecycle = stages.map((stage, index) => {
    const transactionHash = exact.transactions[stage];
    const blockNumber = 10 + index;
    const blockHash = `0x${(100 + index + (options.blockOffset ?? 0)).toString(16)}`;
    return {
      stage,
      transactionHash,
      blockNumber,
      blockHash,
      transactionIndex: 1,
      eventIndex: index,
      event: rawEvent(stage, exact),
      block: {
        number: blockNumber,
        hash: blockHash,
        transactions: ["0x9", transactionHash],
      },
    };
  });
  return {
    runtimeEpoch: exact.runtimeEpoch,
    chainId: exact.chainId,
    artifact,
    observedAt: options.observedAt ?? 1_700_000_000,
    head: { number: options.head ?? 20, hash: options.headHash ?? "0x999" },
    finalizedHead: options.finalizedHead ?? 20,
    lifecycle,
  };
}
function readers(mode = { value: "ok" }) {
  return [0, 1].map((index) => ({
    id: `reader-${index}`,
    independence: "same-devnet-fixture",
    observe: async (exact) => {
      if (mode.value === "outage" && index === 1) throw new Error("offline");
      if (mode.value === "disagree" && index === 1)
        return observation(exact, { blockOffset: 100 });
      if (mode.value === "reorg")
        return observation(exact, { blockOffset: 200 });
      if (mode.value === "stale")
        return observation(exact, { observedAt: 1_699_999_900 });
      if (mode.value === "unfinalized")
        return observation(exact, { head: 12, finalizedHead: 11 });
      return observation(exact);
    },
  }));
}
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "app20-authority-"));
  return {
    directory,
    path: join(directory, "authority.json"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("agreement promotes exact finalized observation and restart restores monotonic projection", async () => {
  const tmp = temporary();
  try {
    const authority = createLocalnetChainAuthority({
      path: tmp.path,
      artifact,
      readers: readers(),
      now: () => 1_700_000_000,
      finalityDepth: 2,
    });
    const result = await authority.verify({ query, market: "strk-usdc" });
    assert.equal(result.status, "authoritative");
    assert.equal(result.revision, 1);
    assert.equal(
      authority.reconciliationEvidence(query)?.queryDigest,
      digestLocalnetAuthorityQuery(query),
    );
    const operatorJson = JSON.stringify(authority.listOperatorSummaries());
    assert.equal(operatorJson.includes(query.account), false);
    assert.equal(operatorJson.includes(query.rfqId), false);
    assert.equal(operatorJson.includes(query.intentDigest), false);
    const restarted = createLocalnetChainAuthority({
      path: tmp.path,
      artifact,
      readers: readers(),
      now: () => 1_700_000_001,
      finalityDepth: 2,
    });
    assert.deepEqual(restarted.snapshot(query), result);
    const second = await restarted.verify({ query, market: "strk-usdc" });
    assert.equal(second.revision, 2);
  } finally {
    tmp.cleanup();
  }
});

test("v3 authority promotes only one exact DealTaken and one LockTaken per expected fill", async () => {
  const tmp = temporary();
  const v3 = Object.freeze({
    lifecycle: "v3",
    runtimeEpoch: epoch,
    chainId: artifact.chainId,
    account: "0xaaa",
    rfqId: "0xddd",
    dealId: "0xddd",
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
  const v3Observation = () => ({
    runtimeEpoch: epoch,
    chainId: artifact.chainId,
    artifact,
    observedAt: 1_700_000_000,
    head: { number: 20, hash: "0x999" },
    finalizedHead: 20,
    lifecycle: [
      {
        stage: "take",
        transactionHash: "0x201",
        blockNumber: 10,
        blockHash: "0xa",
        transactionIndex: 0,
        eventIndex: 2,
        event: {
          fromAddress: artifact.escrowAddress,
          keys: [LOCALNET_ESCROW_EVENT_SELECTORS.take, "0xddd"],
          data: ["0x11", "0x64", "0x22", "0xc8", "0x2"],
        },
        fillEvents: [
          {
            eventIndex: 0,
            event: {
              fromAddress: artifact.escrowAddress,
              keys: [LOCALNET_ESCROW_EVENT_SELECTORS.lockTaken, "0xa", "0xddd"],
              data: ["0x28", "0x50", "0x0"],
            },
          },
          {
            eventIndex: 1,
            event: {
              fromAddress: artifact.escrowAddress,
              keys: [LOCALNET_ESCROW_EVENT_SELECTORS.lockTaken, "0xb", "0xddd"],
              data: ["0x3c", "0x78", "0x0"],
            },
          },
        ],
        block: { number: 10, hash: "0xa", transactions: ["0x201"] },
      },
    ],
  });
  try {
    const authority = createLocalnetChainAuthority({
      path: tmp.path,
      artifact,
      readers: [0, 1].map((index) => ({
        id: `v3-reader-${index}`,
        independence: "same-devnet-fixture",
        observe: async () => v3Observation(),
      })),
      now: () => 1_700_000_000,
      finalityDepth: 2,
    });
    const projection = await authority.verify({ query: v3, market: "strk-usdc" });
    assert.equal(projection.status, "authoritative");
    assert.deepEqual(
      authority.reconciliationEvidence(v3).canonicalLifecycle[0].fillEvents.map(
        ({ lockId }) => lockId,
      ),
      ["0xa", "0xb"],
    );
    const journal = JSON.parse(readFileSync(tmp.path, "utf8"));
    assert.equal(journal.rows[0].query.lifecycle, "v3");

    const invalid = createLocalnetChainAuthority({
      path: join(tmp.directory, "invalid-v3.json"),
      artifact,
      readers: [0, 1].map((index) => ({
        id: `invalid-v3-reader-${index}`,
        independence: "same-devnet-fixture",
        observe: async () => {
          const value = v3Observation();
          value.lifecycle[0].fillEvents[1].event.data[1] = "0x79";
          return value;
        },
      })),
      now: () => 1_700_000_000,
      finalityDepth: 2,
    });
    assert.equal(
      (await invalid.verify({ query: v3, market: "strk-usdc" })).status,
      "disagreement",
    );
  } finally {
    tmp.cleanup();
  }
});

test("outage, disagreement, stale head, and insufficient finality never promote", async () => {
  for (const value of ["outage", "disagree", "stale", "unfinalized"]) {
    const tmp = temporary();
    try {
      const mode = { value };
      const authority = createLocalnetChainAuthority({
        path: tmp.path,
        artifact,
        readers: readers(mode),
        now: () => 1_700_000_000,
        maxAgeSeconds: 30,
        finalityDepth: 2,
      });
      const result = await authority.verify({ query, market: "strk-usdc" });
      assert.equal(
        result.status,
        value === "stale" || value === "unfinalized" ? "stale" : "disagreement",
      );
      assert.notEqual(
        authority.reconciliationEvidence(query)?.status,
        "authoritative",
      );
    } finally {
      tmp.cleanup();
    }
  }
});

test("transient reader failure stays recoverable and only changed agreed coordinates reorg", async () => {
  const tmp = temporary();
  try {
    const mode = { value: "ok" };
    const authority = createLocalnetChainAuthority({
      path: tmp.path,
      artifact,
      readers: readers(mode),
      now: () => 1_700_000_000,
      finalityDepth: 2,
    });
    const first = await authority.verify({ query, market: "strk-usdc" });
    assert.equal(first.status, "authoritative");
    assert.equal(first.validUntil, 1_700_000_030);

    mode.value = "outage";
    const unavailable = await authority.verify({ query, market: "strk-usdc" });
    assert.equal(unavailable.status, "disagreement");
    assert.equal(
      authority.reconciliationEvidence(query)?.marketQuarantined,
      false,
    );

    mode.value = "ok";
    assert.equal(
      (await authority.verify({ query, market: "strk-usdc" })).status,
      "authoritative",
    );

    mode.value = "reorg";
    assert.equal(
      (await authority.verify({ query, market: "strk-usdc" })).status,
      "reorged",
    );
  } finally {
    tmp.cleanup();
  }
});

test("canonical replacement persists reorg and market quarantine before projection", async () => {
  const tmp = temporary();
  try {
    const mode = { value: "ok" };
    const authority = createLocalnetChainAuthority({
      path: tmp.path,
      artifact,
      readers: readers(mode),
      now: () => 1_700_000_000,
      finalityDepth: 2,
    });
    assert.equal(
      (await authority.verify({ query, market: "strk-usdc" })).status,
      "authoritative",
    );
    mode.value = "reorg";
    const [result] = await authority.reverifyAll();
    assert.equal(result.status, "reorged");
    assert.equal(
      authority.reconciliationEvidence(query)?.marketQuarantined,
      true,
    );
    mode.value = "ok";
    assert.equal(
      (await authority.verify({ query, market: "strk-usdc" })).status,
      "reorged",
    );
    const restarted = createLocalnetChainAuthority({
      path: tmp.path,
      artifact,
      readers: readers(mode),
      now: () => 1_700_000_001,
      finalityDepth: 2,
    });
    assert.equal(restarted.snapshot(query)?.status, "reorged");
  } finally {
    tmp.cleanup();
  }
});

test("query, event, coordinate, transaction, and artifact mutations fail closed", async () => {
  assert.throws(() =>
    canonicalLocalnetAuthorityQuery({ ...query, rfqId: "0xabc" }),
  );
  assert.throws(() =>
    canonicalLocalnetAuthorityQuery({ ...query, reservationFence: "07" }),
  );
  assert.throws(() =>
    canonicalLocalnetAuthorityQuery({ ...query, commitmentDigest: "0x1" }),
  );
  const mutations = [
    (value) => {
      value.lifecycle[0].event.keys[1] = "0xabc";
    },
    (value) => {
      value.lifecycle[0].event.data[1] = "0x65";
    },
    (value) => {
      value.lifecycle[0].transactionHash = "0x999";
    },
    (value) => {
      value.lifecycle[0].block.transactions[1] = "0x999";
    },
    (value) => {
      value.lifecycle[0].block.hash = "0x998";
    },
    (value) => {
      value.lifecycle[1].eventIndex = value.lifecycle[0].eventIndex;
      value.lifecycle[1].blockNumber = value.lifecycle[0].blockNumber;
      value.lifecycle[1].transactionIndex = value.lifecycle[0].transactionIndex;
    },
    (value) => {
      value.lifecycle[1].blockNumber = 9;
      value.lifecycle[1].block.number = 9;
    },
    (value) => {
      value.artifact = { ...artifact, escrowClassHash: "0x888" };
    },
  ];
  for (const mutate of mutations) {
    const tmp = temporary();
    try {
      const invalidReaders = [0, 1].map((index) => ({
        id: `mutation-${index}`,
        independence: "same-devnet-fixture",
        observe: async () => {
          const value = structuredClone(observation());
          mutate(value);
          return value;
        },
      }));
      const authority = createLocalnetChainAuthority({
        path: tmp.path,
        artifact,
        readers: invalidReaders,
        now: () => 1_700_000_000,
        finalityDepth: 2,
      });
      assert.notEqual(
        (await authority.verify({ query, market: "strk-usdc" })).status,
        "authoritative",
      );
    } finally {
      tmp.cleanup();
    }
  }
});

test("duplicate reader identity and old runtime queries are rejected", async () => {
  const tmp = temporary();
  try {
    const same = readers();
    same[1].id = same[0].id;
    assert.throws(() =>
      createLocalnetChainAuthority({ path: tmp.path, artifact, readers: same }),
    );
    const authority = createLocalnetChainAuthority({
      path: tmp.path,
      artifact,
      readers: readers(),
      now: () => 1_700_000_000,
    });
    await assert.rejects(() =>
      authority.verify({
        query: { ...query, runtimeEpoch: "f".repeat(32) },
        market: "strk-usdc",
      }),
    );
  } finally {
    tmp.cleanup();
  }
});

test("one authority key cannot be rebound to another query or market", async () => {
  const tmp = temporary();
  try {
    const authority = createLocalnetChainAuthority({
      path: tmp.path,
      artifact,
      readers: readers(),
      now: () => 1_700_000_000,
      finalityDepth: 2,
    });
    await authority.verify({ query, market: "strk-usdc" });
    await assert.rejects(
      authority.verify({
        query: { ...query, makerId: "maker-b" },
        market: "strk-usdc",
      }),
      /reused with another exact query/i,
    );
    await assert.rejects(
      authority.verify({ query, market: "usdc-strk" }),
      /market binding/i,
    );
    assert.equal(authority.reconciliationEvidence(query)?.revision, 1);
  } finally {
    tmp.cleanup();
  }
});

test("restart rejects persisted key and lifecycle substitutions", async () => {
  for (const mutate of [
    (row) => {
      row.key = "substituted-key";
    },
    (row) => {
      row.canonicalLifecycle[1].transactionHash = "0x999";
    },
    (row) => {
      row.canonicalLifecycle.reverse();
    },
  ]) {
    const tmp = temporary();
    try {
      const authority = createLocalnetChainAuthority({
        path: tmp.path,
        artifact,
        readers: readers(),
        now: () => 1_700_000_000,
        finalityDepth: 2,
      });
      await authority.verify({ query, market: "strk-usdc" });
      const journal = JSON.parse(readFileSync(tmp.path, "utf8"));
      mutate(journal.rows[0]);
      writeFileSync(tmp.path, `${JSON.stringify(journal)}\n`);
      assert.throws(
        () =>
          createLocalnetChainAuthority({
            path: tmp.path,
            artifact,
            readers: readers(),
          }),
        /authority journal/i,
      );
    } finally {
      tmp.cleanup();
    }
  }
});

test("every atomic journal stage fail-stops publication", async () => {
  for (const stage of [
    "before-write",
    "after-write",
    "after-file-fsync",
    "after-rename",
    "after-directory-fsync",
  ]) {
    const tmp = temporary();
    try {
      const authority = createLocalnetChainAuthority({
        path: tmp.path,
        artifact,
        readers: readers(),
        now: () => 1_700_000_000,
        faultInjector: (point) => {
          if (point === stage) throw new Error(stage);
        },
      });
      await assert.rejects(
        () => authority.verify({ query, market: "strk-usdc" }),
        /fail-stopped|uncertain/i,
      );
      await assert.rejects(
        () => authority.verify({ query, market: "strk-usdc" }),
        /fail-stopped/i,
      );
    } finally {
      tmp.cleanup();
    }
  }
});
