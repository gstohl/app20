import {
  LOCALNET_ESCROW_EVENT_SELECTORS,
  assertLocalnetEscrowArtifactIdentity,
} from "./localnet-chain-decoder.mjs";

export const LOCALNET_LOCK_CREATED_SCAN_CHUNK_SIZE = 128;
export const LOCALNET_LOCK_CREATED_SCAN_MAX_PAGES = 8;
const MAX_CONTINUATION_TOKEN_LENGTH = 2_048;

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

function continuationToken(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.length > MAX_CONTINUATION_TOKEN_LENGTH
  )
    throw new Error(
      "Localnet LockCreated scan received an invalid continuation token.",
    );
  return value;
}

function lockCreatedTransactionFromEvent(
  value,
  escrowAddress,
  lockId,
) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Localnet LockCreated scan received a malformed event.");
  const source = canonicalFelt(value.from_address, "LockCreated event source");
  if (!Array.isArray(value.keys) || value.keys.length < 2)
    throw new Error("Localnet LockCreated event keys are malformed.");
  const selector = canonicalEventKey(
    value.keys[0],
    "LockCreated event selector",
  );
  const observedLockId = canonicalEventKey(
    value.keys[1],
    "LockCreated event lock id",
  );
  if (
    source !== escrowAddress ||
    selector !== LOCALNET_ESCROW_EVENT_SELECTORS.lockCreated ||
    observedLockId !== lockId
  )
    throw new Error(
      "Localnet LockCreated scan returned an event outside its exact filter.",
    );
  return canonicalFelt(
    value.transaction_hash,
    "LockCreated event transaction hash",
  );
}

/** Locates one exact LockCreated event and proves its transaction succeeded. */
export async function findSucceededLockCreatedTransaction(options) {
  if (typeof options?.rpc !== "function")
    throw new Error("Localnet LockCreated scan requires an RPC adapter.");
  const escrowAddress = canonicalFelt(
    options.escrowAddress,
    "LockCreated escrow address",
  );
  const lockId = canonicalFelt(options.lockId, "LockCreated lock id");
  let token;
  let completed = false;
  let transactionHash;
  const seenTokens = new Set();
  for (let page = 0; page < LOCALNET_LOCK_CREATED_SCAN_MAX_PAGES; page += 1) {
    const result = await options.rpc("starknet_getEvents", {
      filter: {
        from_block: { block_number: 0 },
        to_block: "latest",
        address: escrowAddress,
        keys: [
          [LOCALNET_ESCROW_EVENT_SELECTORS.lockCreated],
          [lockId],
        ],
        chunk_size: LOCALNET_LOCK_CREATED_SCAN_CHUNK_SIZE,
        ...(token ? { continuation_token: token } : {}),
      },
    });
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      !Array.isArray(result.events) ||
      result.events.length > LOCALNET_LOCK_CREATED_SCAN_CHUNK_SIZE
    )
      throw new Error("Localnet LockCreated scan received a malformed page.");
    for (const event of result.events) {
      const observed = lockCreatedTransactionFromEvent(
        event,
        escrowAddress,
        lockId,
      );
      if (transactionHash !== undefined)
        throw new Error(
          "Localnet LockCreated scan found duplicate lock creation events.",
        );
      transactionHash = observed;
    }
    const next = continuationToken(result.continuation_token);
    if (!next) {
      completed = true;
      break;
    }
    if (seenTokens.has(next))
      throw new Error(
        "Localnet LockCreated RPC repeated an event continuation token.",
      );
    seenTokens.add(next);
    token = next;
  }
  if (!completed)
    throw new Error(
      "Localnet LockCreated scan exceeded its bounded page cap.",
    );
  if (transactionHash === undefined) return null;
  const receipt = await options.rpc("starknet_getTransactionReceipt", {
    transaction_hash: transactionHash,
  });
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
    throw new Error("Localnet LockCreated receipt is malformed.");
  const receiptHash = canonicalFelt(
    receipt.transaction_hash,
    "LockCreated receipt transaction hash",
  );
  if (receiptHash !== transactionHash)
    throw new Error("Localnet LockCreated receipt hash was substituted.");
  if (receipt.execution_status !== "SUCCEEDED")
    throw new Error("Localnet LockCreated transaction did not succeed.");
  return receiptHash;
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
        query.lifecycle === "v3"
          ? ["take"]
          : query.outcome === "settled"
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
        let fillEvents;
        if (stage === "take") {
          const expectedFills = query.expected?.fills;
          if (!Array.isArray(expectedFills) || expectedFills.length < 1)
            throw new Error("V3 take query has no exact expected fills.");
          const lockMatches = events
            .map((event, eventIndex) => ({ event, eventIndex }))
            .filter(
              ({ event }) =>
                event.fromAddress === artifact.escrowAddress &&
                event.keys[0] === LOCALNET_ESCROW_EVENT_SELECTORS.lockTaken &&
                event.keys.length === 3 &&
                event.keys[2] === query.dealId,
            );
          if (lockMatches.length !== expectedFills.length)
            throw new Error(
              "Take transaction does not contain one LockTaken per expected fill.",
            );
          fillEvents = expectedFills.map((fill) => {
            const exact = lockMatches.filter(
              ({ event }) => event.keys[1] === fill.lockId,
            );
            if (exact.length !== 1)
              throw new Error(
                "Take transaction changed an expected LockTaken identity.",
              );
            return Object.freeze(exact[0]);
          });
          if (
            fillEvents.some(
              ({ eventIndex }, index) =>
                eventIndex >= matches[0].eventIndex ||
                (index > 0 && eventIndex <= fillEvents[index - 1].eventIndex),
            )
          )
            throw new Error(
              "Take transaction LockTaken events are duplicated or out of order.",
            );
        }
        lifecycle.push(
          Object.freeze({
            stage,
            transactionHash,
            blockNumber: number,
            blockHash: hash,
            transactionIndex,
            eventIndex: matches[0].eventIndex,
            event: matches[0].event,
            ...(fillEvents ? { fillEvents: Object.freeze(fillEvents) } : {}),
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
