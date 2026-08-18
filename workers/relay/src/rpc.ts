import { abortScope } from "./abort.ts";
import { exactArrayBuffer, readBoundedRequest, readBoundedResponse } from "./body.ts";
import { RelayHttpError } from "./errors.ts";
import { requireSameOrigin, validateUpstreamUrl } from "./origin.ts";
import type { AtomicGate, GateBudget, RelayDependencies, RelayEnv } from "./types.ts";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_BATCH_SIZE = 20;

const READ_METHODS = new Set([
  "starknet_blockNumber",
  "starknet_call",
  "starknet_chainId",
  "starknet_getBlockWithReceipts",
  "starknet_getBlockWithTxHashes",
  "starknet_getClassHashAt",
  "starknet_getNonce",
  "starknet_getTransactionReceipt",
  "starknet_getTransactionStatus",
  "starknet_specVersion",
]);
const COSTLY_METHODS = new Set(["starknet_estimateFee", "starknet_simulateTransactions"]);
const SUBMISSION_METHODS = new Set(["starknet_addDeployAccountTransaction", "starknet_addInvokeTransaction"]);

interface RpcItem { jsonrpc?: unknown; method?: unknown; params?: unknown }

function itemBudget(value: unknown): GateBudget {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RelayHttpError(400, "Invalid JSON-RPC request.");
  const item = value as RpcItem;
  if (item.jsonrpc !== "2.0" || typeof item.method !== "string") throw new RelayHttpError(400, "Invalid JSON-RPC request.");
  if (item.params !== undefined && !Array.isArray(item.params) && (!item.params || typeof item.params !== "object")) {
    throw new RelayHttpError(400, "Invalid JSON-RPC request.");
  }
  if (SUBMISSION_METHODS.has(item.method)) return "rpc-submit";
  if (COSTLY_METHODS.has(item.method)) return "rpc-costly";
  if (READ_METHODS.has(item.method)) return "rpc-read";
  throw new RelayHttpError(400, "Unsupported Starknet JSON-RPC method.");
}

function payloadBudget(value: unknown): GateBudget {
  if (!Array.isArray(value)) return itemBudget(value);
  if (value.length === 0 || value.length > MAX_BATCH_SIZE) throw new RelayHttpError(400, "Invalid JSON-RPC batch.");
  const budgets = value.map(itemBudget);
  if (budgets.includes("rpc-submit")) return "rpc-submit";
  if (budgets.includes("rpc-costly")) return "rpc-costly";
  return "rpc-read";
}

async function rpcSubject(request: Request, env: RelayEnv): Promise<string> {
  if (env.TRUST_CLIENT_IP_HEADERS !== "true") return "rpc-anonymous";
  const source = request.headers.get("cf-connecting-ip");
  if (!source) return "rpc-unknown";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `rpc-${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

export async function relayRpc(
  request: Request,
  network: "sepolia" | "mainnet",
  env: RelayEnv,
  dependencies: RelayDependencies,
  gate: AtomicGate,
): Promise<Response> {
  requireSameOrigin(request, env);
  if (request.method !== "POST") throw new RelayHttpError(405, "Method not allowed.");
  const mediaType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw new RelayHttpError(415, "Expected application/json.");
  const body = await readBoundedRequest(request, MAX_REQUEST_BYTES, "RPC request is too large.");
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new RelayHttpError(400, "Invalid JSON-RPC request."); }
  const budget = payloadBudget(payload);
  const service = network === "sepolia" ? "starknet-sepolia" : "starknet-mainnet";
  const upstreamRaw = network === "sepolia" ? env.STARKNET_SEPOLIA_RPC_URL : env.STARKNET_MAINNET_RPC_URL;
  const authorization = network === "sepolia" ? env.STARKNET_SEPOLIA_AUTHORIZATION : env.STARKNET_MAINNET_AUTHORIZATION;
  const upstreamUrl = validateUpstreamUrl(upstreamRaw, env);
  const lease = await gate.acquire({ subject: await rpcSubject(request, env), service, budget });
  try {
    const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
    if (authorization) headers.set("authorization", authorization);
    const scope = abortScope(request.signal, 90_000);
    try {
      const upstream = await dependencies.fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: exactArrayBuffer(body),
        redirect: "error",
        signal: scope.signal,
      });
      const responseType = (upstream.headers.get("content-type") ?? "").toLowerCase();
      if (!upstream.ok || !responseType.includes("json")) {
        await upstream.body?.cancel();
        throw new RelayHttpError(502, "RPC upstream unavailable.");
      }
      const responseBody = await readBoundedResponse(upstream, MAX_RESPONSE_BYTES, "RPC upstream unavailable.");
      return new Response(exactArrayBuffer(responseBody), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    } finally {
      scope.close();
    }
  } finally {
    try { await lease.release(); } catch { /* Expiring gate lease is the fail-safe. */ }
  }
}
