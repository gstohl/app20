import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCALNET_ESCROW_EVENT_ABI_DIGEST,
  LOCALNET_ESCROW_EVENT_SELECTORS,
} from "./localnet-chain-decoder.mjs";
import { createLocalnetRpcReader } from "./localnet-chain-reader.mjs";

const artifact = { runtimeEpoch: "0123456789abcdef0123456789abcdef", chainId: "0x123", escrowAddress: "0x456", escrowClassHash: "0x789", abiDigest: LOCALNET_ESCROW_EVENT_ABI_DIGEST };
const query = { runtimeEpoch: artifact.runtimeEpoch, chainId: artifact.chainId, dealId: "0xabc", outcome: "refunded", sellToken: "0x11", sellAmount: "100", buyToken: "0x22", buyAmount: "200", deadline: 1_800_000_000, ticketAddress: "0x33", transactions: { fund: "0x101", timeout: "0x102" } };
function event(stage) {
  return {
    from_address: artifact.escrowAddress,
    keys: [LOCALNET_ESCROW_EVENT_SELECTORS[stage], query.dealId],
    data: stage === "fund"
      ? [query.sellToken, "0x64", query.buyToken, "0xc8", `0x${query.deadline.toString(16)}`, query.ticketAddress]
      : [query.sellToken, "0x64"],
  };
}
function rpcFixture(mutate = () => {}) {
  return async (method, params) => {
    if (method === "starknet_getClassHashAt") return artifact.escrowClassHash;
    if (method === "starknet_getBlockWithTxHashes" && params.block_id === "latest")
      return { block_number: 20, block_hash: "0x999", transactions: [] };
    if (method === "starknet_getTransactionReceipt") {
      const stage = params.transaction_hash === query.transactions.fund ? "fund" : "timeout";
      const value = { transaction_hash: params.transaction_hash, block_number: stage === "fund" ? 10 : 11, block_hash: stage === "fund" ? "0xa" : "0xb", execution_status: "SUCCEEDED", events: [event(stage)] };
      mutate(value, method, stage);
      return value;
    }
    if (method === "starknet_getBlockWithTxHashes") {
      const number = params.block_id.block_number;
      const value = { block_number: number, block_hash: number === 10 ? "0xa" : "0xb", transactions: [number === 10 ? query.transactions.fund : query.transactions.timeout] };
      mutate(value, method, number);
      return value;
    }
    throw new Error("unexpected RPC");
  };
}

test("local RPC reader derives coordinates and event identity from raw same-devnet observations", async () => {
  const reader = createLocalnetRpcReader({ id: "a", artifact, rpc: rpcFixture(), now: () => 1_700_000_000 });
  const result = await reader.observe(query);
  assert.equal(reader.independence, "same-devnet-fixture");
  assert.deepEqual(result.lifecycle.map((item) => item.stage), ["fund", "timeout"]);
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
    async () => createLocalnetRpcReader({ id: "a", artifact, rpc: async (method, params) => method === "starknet_getClassHashAt" ? "0x888" : rpcFixture()(method, params) }).observe(query),
    async () => createLocalnetRpcReader({ id: "a", artifact, rpc: rpcFixture((value, method) => { if (method === "starknet_getTransactionReceipt") value.transaction_hash = "0x999"; }) }).observe(query),
    async () => createLocalnetRpcReader({ id: "a", artifact, rpc: rpcFixture((value, method) => { if (method === "starknet_getTransactionReceipt") value.events = []; }) }).observe(query),
    async () => createLocalnetRpcReader({ id: "a", artifact, rpc: rpcFixture((value, method) => { if (method === "starknet_getBlockWithTxHashes") value.transactions = ["0x999"]; }) }).observe(query),
  ];
  for (const run of cases) await assert.rejects(run);
});
