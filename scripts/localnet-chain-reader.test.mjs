import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCALNET_ESCROW_EVENT_ABI_DIGEST,
  LOCALNET_ESCROW_EVENT_SELECTORS,
} from "./localnet-chain-decoder.mjs";
import {
  createLocalnetJsonRpc,
  createLocalnetRpcReader,
} from "./localnet-chain-reader.mjs";

const artifact = {
  runtimeEpoch: "0123456789abcdef0123456789abcdef",
  chainId: "0x123",
  escrowAddress: "0x456",
  escrowClassHash: "0x789",
  abiDigest: LOCALNET_ESCROW_EVENT_ABI_DIGEST,
};
const query = {
  runtimeEpoch: artifact.runtimeEpoch,
  chainId: artifact.chainId,
  dealId: "0xabc",
  outcome: "refunded",
  sellToken: "0x11",
  sellAmount: "100",
  buyToken: "0x22",
  buyAmount: "200",
  deadline: 1_800_000_000,
  ticketAddress: "0x33",
  transactions: { fund: "0x101", timeout: "0x102" },
};
function event(stage) {
  return {
    from_address: artifact.escrowAddress,
    keys: [LOCALNET_ESCROW_EVENT_SELECTORS[stage], query.dealId],
    data:
      stage === "fund"
        ? [
            query.sellToken,
            "0x64",
            query.buyToken,
            "0xc8",
            `0x${query.deadline.toString(16)}`,
            query.ticketAddress,
          ]
        : [query.sellToken, "0x64"],
  };
}
function rpcFixture(mutate = () => {}) {
  return async (method, params) => {
    if (method === "starknet_getClassHashAt") return artifact.escrowClassHash;
    if (
      method === "starknet_getBlockWithTxHashes" &&
      params.block_id === "latest"
    )
      return { block_number: 20, block_hash: "0x999", transactions: [] };
    if (method === "starknet_getTransactionReceipt") {
      const stage =
        params.transaction_hash === query.transactions.fund
          ? "fund"
          : "timeout";
      const value = {
        transaction_hash: params.transaction_hash,
        block_number: stage === "fund" ? 10 : 11,
        block_hash: stage === "fund" ? "0xa" : "0xb",
        execution_status: "SUCCEEDED",
        events: [event(stage)],
      };
      mutate(value, method, stage);
      return value;
    }
    if (method === "starknet_getBlockWithTxHashes") {
      const number = params.block_id.block_number;
      const value = {
        block_number: number,
        block_hash: number === 10 ? "0xa" : "0xb",
        transactions: [
          number === 10 ? query.transactions.fund : query.transactions.timeout,
        ],
      };
      mutate(value, method, number);
      return value;
    }
    throw new Error("unexpected RPC");
  };
}

test("JSON-RPC adapter binds each response to its request id", async () => {
  let requestId;
  const rpc = createLocalnetJsonRpc("http://local.invalid", {
    fetchImpl: async (_url, init) => {
      requestId = JSON.parse(init.body).id;
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: requestId + 1, result: "0x1" }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  await assert.rejects(rpc("starknet_chainId", []), /mismatched/i);
  assert.equal(requestId, 1);
});

test("local RPC reader derives coordinates and event identity from raw same-devnet observations", async () => {
  const reader = createLocalnetRpcReader({
    id: "a",
    artifact,
    rpc: rpcFixture(),
    now: () => 1_700_000_000,
  });
  const result = await reader.observe(query);
  assert.equal(reader.independence, "same-devnet-fixture");
  assert.deepEqual(
    result.lifecycle.map((item) => item.stage),
    ["fund", "timeout"],
  );
  assert.equal(result.lifecycle[1].transactionIndex, 0);
  assert.equal(result.lifecycle[1].eventIndex, 0);
  assert.equal(result.finalizedHead, 20);
});

test("unrelated receipt events may contain zero-valued keys", async () => {
  const reader = createLocalnetRpcReader({
    id: "a",
    artifact,
    rpc: rpcFixture((value, method) => {
      if (method === "starknet_getTransactionReceipt") {
        value.events.unshift({
          from_address: "0x777",
          keys: ["0x1", "0x0"],
          data: ["0x0"],
        });
      }
    }),
    now: () => 1_700_000_000,
  });
  const result = await reader.observe(query);
  assert.deepEqual(
    result.lifecycle.map((item) => item.eventIndex),
    [1, 1],
  );
});

test("raw receipt, class, event, and canonical block mutations fail closed", async () => {
  const cases = [
    async () =>
      createLocalnetRpcReader({
        id: "a",
        artifact,
        rpc: async (method, params) =>
          method === "starknet_getClassHashAt"
            ? "0x888"
            : rpcFixture()(method, params),
      }).observe(query),
    async () =>
      createLocalnetRpcReader({
        id: "a",
        artifact,
        rpc: rpcFixture((value, method) => {
          if (method === "starknet_getTransactionReceipt")
            value.transaction_hash = "0x999";
        }),
      }).observe(query),
    async () =>
      createLocalnetRpcReader({
        id: "a",
        artifact,
        rpc: rpcFixture((value, method) => {
          if (method === "starknet_getTransactionReceipt") value.events = [];
        }),
      }).observe(query),
    async () =>
      createLocalnetRpcReader({
        id: "a",
        artifact,
        rpc: rpcFixture((value, method) => {
          if (method === "starknet_getBlockWithTxHashes")
            value.transactions = ["0x999"];
        }),
      }).observe(query),
    async () =>
      createLocalnetRpcReader({
        id: "a",
        artifact,
        rpc: rpcFixture((value, method, stage) => {
          if (
            method === "starknet_getBlockWithTxHashes" &&
            typeof stage === "number"
          )
            value.block_hash = "0xff";
        }),
      }).observe(query),
  ];
  for (const run of cases) await assert.rejects(run);
});

test("v3 reader requires one DealTaken plus one distinct LockTaken for every expected fill", async () => {
  const v3 = {
    runtimeEpoch: artifact.runtimeEpoch,
    chainId: artifact.chainId,
    lifecycle: "v3",
    dealId: "0xdef",
    transactions: { take: "0x201" },
    expected: {
      fills: [
        { lockId: "0xa", amountA: "40", amountB: "80" },
        { lockId: "0xb", amountA: "60", amountB: "120" },
      ],
    },
  };
  const rpc = async (method, params) => {
    if (method === "starknet_getClassHashAt") return artifact.escrowClassHash;
    if (method === "starknet_getBlockWithTxHashes" && params.block_id === "latest")
      return { block_number: 20, block_hash: "0x999", transactions: [] };
    if (method === "starknet_getTransactionReceipt")
      return {
        transaction_hash: v3.transactions.take,
        block_number: 10,
        block_hash: "0xa",
        execution_status: "SUCCEEDED",
        events: [
          {
            from_address: artifact.escrowAddress,
            keys: [LOCALNET_ESCROW_EVENT_SELECTORS.lockTaken, "0xa", v3.dealId],
            data: ["0x28", "0x50", "0x0"],
          },
          {
            from_address: artifact.escrowAddress,
            keys: [LOCALNET_ESCROW_EVENT_SELECTORS.lockTaken, "0xb", v3.dealId],
            data: ["0x3c", "0x78", "0x0"],
          },
          {
            from_address: artifact.escrowAddress,
            keys: [LOCALNET_ESCROW_EVENT_SELECTORS.take, v3.dealId],
            data: ["0x11", "0x64", "0x22", "0xc8", "0x2"],
          },
        ],
      };
    if (method === "starknet_getBlockWithTxHashes")
      return {
        block_number: 10,
        block_hash: "0xa",
        transactions: [v3.transactions.take],
      };
    throw new Error("unexpected RPC");
  };
  const reader = createLocalnetRpcReader({ id: "v3", artifact, rpc });
  const observation = await reader.observe(v3);
  assert.equal(observation.lifecycle[0].stage, "take");
  assert.deepEqual(
    observation.lifecycle[0].fillEvents.map(({ event }) => event.keys[1]),
    ["0xa", "0xb"],
  );

  await assert.rejects(
    createLocalnetRpcReader({
      id: "v3-mutation",
      artifact,
      rpc: async (method, params) => {
        const value = await rpc(method, params);
        if (method === "starknet_getTransactionReceipt") value.events.splice(0, 1);
        return value;
      },
    }).observe(v3),
    /one LockTaken per expected fill/i,
  );
});

test("lifecycle transactions sharing a block reuse one canonical block read", async () => {
  let canonicalBlockReads = 0;
  const rpc = rpcFixture((value, method, stage) => {
    if (method === "starknet_getTransactionReceipt" && stage === "timeout") {
      value.block_number = 10;
      value.block_hash = "0xa";
    }
    if (
      method === "starknet_getBlockWithTxHashes" &&
      typeof stage === "number"
    ) {
      canonicalBlockReads += 1;
      value.block_hash = "0xa";
      value.transactions = [
        query.transactions.fund,
        query.transactions.timeout,
      ];
    }
  });
  const reader = createLocalnetRpcReader({
    id: "a",
    artifact,
    rpc,
    now: () => 1_700_000_000,
  });
  const result = await reader.observe(query);
  assert.equal(canonicalBlockReads, 1);
  assert.deepEqual(
    result.lifecycle.map((item) => item.transactionIndex),
    [0, 1],
  );
});
