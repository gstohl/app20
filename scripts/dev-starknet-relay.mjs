/**
 * Local-only same-origin Starknet RPC relay.
 *
 * Production uses the Cloudflare Worker. Vite has no Worker routes, so Ready
 * balance/preflight against /api/starknet/{mainnet,sepolia} would 404 here.
 * This plugin forwards the same method allowlist to public unauthenticated
 * RPCs. It must never carry credentials or private prover/discovery origins.
 */

const ALLOWED_METHODS = new Set([
  "starknet_blockNumber",
  "starknet_call",
  "starknet_chainId",
  "starknet_getBlockWithReceipts",
  "starknet_getBlockWithTxHashes",
  "starknet_getBlockWithTxs",
  "starknet_getBlockTransactionCount",
  "starknet_getClass",
  "starknet_getClassAt",
  "starknet_getClassHashAt",
  "starknet_getEvents",
  "starknet_getNonce",
  "starknet_getStorageAt",
  "starknet_getTransactionByBlockIdAndIndex",
  "starknet_getTransactionByHash",
  "starknet_getTransactionReceipt",
  "starknet_getTransactionStatus",
  "starknet_specVersion",
  "starknet_syncing",
  "starknet_estimateFee",
  "starknet_simulateTransactions",
  "starknet_addDeployAccountTransaction",
  "starknet_addInvokeTransaction",
]);

const UPSTREAM = {
  mainnet: "https://rpc.starknet.lava.build",
  sepolia: "https://starknet-sepolia-rpc.publicnode.com",
};

const MAX_BYTES = 2 * 1024 * 1024;

function methodOf(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  return typeof item.method === "string" ? item.method : null;
}

function payloadAllowed(payload) {
  const items = Array.isArray(payload) ? payload : [payload];
  if (items.length === 0 || items.length > 20) return false;
  return items.every((item) => {
    const method = methodOf(item);
    return method !== null && ALLOWED_METHODS.has(method);
  });
}

async function handleRelay(req, res, network) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      res.statusCode = 413;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "RPC request is too large." }));
      return;
    }
    chunks.push(chunk);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Invalid JSON-RPC request." }));
    return;
  }

  if (!payloadAllowed(payload)) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Unsupported Starknet JSON-RPC method." }));
    return;
  }

  const upstream = await fetch(UPSTREAM[network], {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await upstream.text();
  res.statusCode = upstream.ok ? 200 : 502;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(upstream.ok ? body : JSON.stringify({ error: "RPC upstream unavailable." }));
}

export function devStarknetRelay() {
  return {
    name: "app20-dev-starknet-relay",
    configureServer(server) {
      server.middlewares.use("/api/starknet/mainnet", (req, res, next) => {
        handleRelay(req, res, "mainnet").catch(next);
      });
      server.middlewares.use("/api/starknet/sepolia", (req, res, next) => {
        handleRelay(req, res, "sepolia").catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/starknet/mainnet", (req, res, next) => {
        handleRelay(req, res, "mainnet").catch(next);
      });
      server.middlewares.use("/api/starknet/sepolia", (req, res, next) => {
        handleRelay(req, res, "sepolia").catch(next);
      });
    },
  };
}
