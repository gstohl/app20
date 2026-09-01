import {
  LOCALNET_ESCROW_EVENT_SELECTORS,
  assertLocalnetEscrowArtifactIdentity,
} from "./localnet-chain-decoder.mjs";

function canonicalFelt(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))
    throw new Error(`${label} is not a hexadecimal felt.`);
  const parsed = BigInt(value);
  if (parsed === 0n || parsed >= 1n << 252n)
    throw new Error(`${label} is outside the accepted felt range.`);
  return `0x${parsed.toString(16)}`;
}
function canonicalEventKey(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))
    throw new Error(`${label} is not a hexadecimal felt.`);
  const parsed = BigInt(value);
  if (parsed >= 1n << 252n)
    throw new Error(`${label} is outside the accepted felt range.`);
  return `0x${parsed.toString(16)}`;
}
function blockNumber(value, label) {
  const parsed = typeof value === "string" ? Number(BigInt(value)) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`${label} is invalid.`);
  return parsed;
}
function eventFromRpc(value) {
  return Object.freeze({
    fromAddress: canonicalFelt(value?.from_address, "event source"),
    keys: Object.freeze(
      (value?.keys ?? []).map((item, index) =>
        canonicalEventKey(item, `event key ${index}`),
      ),
    ),
    data: Object.freeze(
      (value?.data ?? []).map((item, index) => {
        if (typeof item !== "string" || !/^0x[0-9a-f]+$/i.test(item))
          throw new Error(`event data ${index} is not a hexadecimal felt.`);
        return `0x${BigInt(item).toString(16)}`;
      }),
    ),
  });
}

export function createLocalnetJsonRpc(url, options = {}) {
  let sequence = 0;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  return async function rpc(method, params) {
    const id = ++sequence;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    const payload = await response.json();
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      payload.id !== id ||
      payload.error ||
      payload.result === undefined
    )
      throw new Error(
        "Localnet JSON-RPC response is unavailable or mismatched.",
      );
    return payload.result;
  };
}

/** Two instances may model separate reads, but both remain one-devnet fixture evidence. */
export function createLocalnetRpcReader(options) {
  const id = String(options.id ?? "").trim();
  if (!id) throw new Error("Localnet RPC reader id is required.");
  const artifact = assertLocalnetEscrowArtifactIdentity(options.artifact);
  const rpc = options.rpc;
  if (typeof rpc !== "function")
    throw new Error("Localnet RPC reader requires an injected RPC adapter.");
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  return Object.freeze({
    id,
    independence: "same-devnet-fixture",
    async observe(query) {
      if (
        query.runtimeEpoch !== artifact.runtimeEpoch ||
        query.chainId !== artifact.chainId
      )
        throw new Error("Localnet RPC reader rejected a cross-runtime query.");
      const headBlock = await rpc("starknet_getBlockWithTxHashes", {
        block_id: "latest",
      });
      const head = {
        number: blockNumber(headBlock.block_number, "latest block number"),
        hash: canonicalFelt(headBlock.block_hash, "latest block hash"),
      };
      const classHash = canonicalFelt(
        await rpc("starknet_getClassHashAt", {
          block_id: { block_number: head.number },
          contract_address: artifact.escrowAddress,
        }),
        "escrow class hash",
      );
      if (classHash !== artifact.escrowClassHash)
        throw new Error(
          "Localnet RPC reader observed another escrow class hash.",
        );
      const stages =
        query.outcome === "settled"
          ? ["fund", "fill", "claim"]
          : ["fund", "timeout"];
      const blocks = new Map();
      const canonicalBlock = async (number) => {
        if (blocks.has(number)) return blocks.get(number);
        const raw = await rpc("starknet_getBlockWithTxHashes", {
          block_id: { block_number: number },
        });
        const block = Object.freeze({
          number: blockNumber(raw.block_number, "canonical block number"),
          hash: canonicalFelt(raw.block_hash, "canonical block hash"),
          transactions: Object.freeze(
            (raw.transactions ?? []).map((item, index) =>
              canonicalFelt(
                typeof item === "string" ? item : item?.transaction_hash,
                `block transaction ${index}`,
              ),
            ),
          ),
        });
        if (block.number !== number)
          throw new Error(
            "Canonical block response changed its requested number.",
          );
        blocks.set(number, block);
        return block;
      };
      const lifecycle = [];
      for (const stage of stages) {
        const transactionHash = query.transactions[stage];
        const receipt = await rpc("starknet_getTransactionReceipt", {
          transaction_hash: transactionHash,
        });
        if (
          receipt?.execution_status &&
          receipt.execution_status !== "SUCCEEDED"
        )
          throw new Error(
            "Localnet authority refuses a reverted lifecycle transaction.",
          );
        const receiptHash = canonicalFelt(
          receipt.transaction_hash,
          "receipt transaction hash",
        );
        if (receiptHash !== transactionHash)
          throw new Error("Localnet authority receipt hash was substituted.");
        const number = blockNumber(
          receipt.block_number,
          "receipt block number",
        );
        const hash = canonicalFelt(receipt.block_hash, "receipt block hash");
        const block = await canonicalBlock(number);
        if (block.hash !== hash)
          throw new Error(
            "Receipt block hash is not canonical at its block number.",
          );
        const transactionIndex = block.transactions.indexOf(transactionHash);
        if (transactionIndex < 0)
          throw new Error(
            "Receipt transaction is absent from its block number.",
          );
        const events = (receipt.events ?? []).map(eventFromRpc);
        const selector = LOCALNET_ESCROW_EVENT_SELECTORS[stage];
        const matches = events
          .map((event, eventIndex) => ({ event, eventIndex }))
          .filter(
            ({ event }) =>
              event.fromAddress === artifact.escrowAddress &&
              event.keys[0] === selector &&
              event.keys[1] === query.dealId,
          );
        if (matches.length !== 1)
          throw new Error(
            "Lifecycle transaction does not contain one exact pinned escrow event.",
          );
        lifecycle.push(
          Object.freeze({
            stage,
            transactionHash,
            blockNumber: number,
            blockHash: hash,
            transactionIndex,
            eventIndex: matches[0].eventIndex,
            event: matches[0].event,
            block,
          }),
        );
      }
      return Object.freeze({
        runtimeEpoch: artifact.runtimeEpoch,
        chainId: artifact.chainId,
        artifact,
        observedAt: now(),
        head,
        // Devnet exposes no independent finalized tag. This is labelled fixture finality.
        finalizedHead: head.number,
        lifecycle: Object.freeze(lifecycle),
      });
    },
  });
}
