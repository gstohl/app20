import { createHmac, createPublicKey, type webcrypto } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  verifyAccessToken,
  type VerifyAccessTokenResponse,
} from "@privy-io/node";
import type { ProverProxyLimiter } from "./limiter.js";
import { InMemoryProverProxyLimiter } from "./limiter.js";
import type { ProverTenant, ProverTenantRegistry } from "./registry.js";

export const PROVER_PROXY_TENANT_HEADER = "x-strk20-tenant";

export interface ProverProxyAuditEvent {
  tenantId?: string;
  userHash?: string;
  method?: string;
  outcome: "allowed" | "rejected" | "upstream_error";
  status: number;
  durationMs: number;
}

export interface PrivyProverProxyOptions {
  registry: ProverTenantRegistry;
  upstreamUrl: string;
  /** Private headers sent only from proxy to prover. */
  upstreamHeaders?: Record<string, string>;
  /** At least 32 random characters; used to pseudonymize user DIDs for quotas. */
  identityHashSecret: string;
  limiter?: ProverProxyLimiter;
  requestTimeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** Per-source-IP admission limit applied before JWT verification. */
  preAuthRequestsPerMinute?: number;
  /** Hard memory bound for distinct pre-auth source addresses. */
  preAuthMaxEntries?: number;
  /** Override only behind a trusted proxy; inbound forwarding headers are ignored. */
  clientIp?: (request: IncomingMessage) => string;
  maxConnections?: number;
  fetch?: typeof fetch;
  verifyToken?: (
    token: string,
    tenant: ProverTenant,
  ) => Promise<VerifyAccessTokenResponse>;
  audit?: (event: ProverProxyAuditEvent) => Promise<void> | void;
}

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

type AdmissionWindow = { startedAt: number; count: number };

class PreAuthAdmissionLimiter {
  private readonly windows = new Map<string, AdmissionWindow>();
  private lastCleanup = 0;

  constructor(
    private readonly requestsPerMinute: number,
    private readonly maxEntries: number,
  ) {
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute <= 0) {
      throw new Error("preAuthRequestsPerMinute must be a positive integer.");
    }
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("preAuthMaxEntries must be a positive integer.");
    }
  }

  private cleanup(now: number): void {
    if (now - this.lastCleanup < 60_000) return;
    this.lastCleanup = now;
    for (const [source, window] of this.windows) {
      if (now - window.startedAt >= 60_000) this.windows.delete(source);
    }
  }

  consume(source: string): boolean {
    const now = Date.now();
    this.cleanup(now);
    if (!this.windows.has(source) && this.windows.size >= this.maxEntries) {
      return false;
    }
    const existing = this.windows.get(source);
    const window =
      !existing || now - existing.startedAt >= 60_000
        ? { startedAt: now, count: 0 }
        : existing;
    this.windows.set(source, window);
    if (window.count >= this.requestsPerMinute) return false;
    window.count += 1;
    return true;
  }
}

class ProxyHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly rpcCode = -32600,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function oneHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(request: IncomingMessage): string {
  const authorization = oneHeader(request, "authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) {
    throw new ProxyHttpError(401, "Missing or invalid bearer token.", -32001);
  }
  return match[1];
}

async function readRequestBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = Number(oneHeader(request, "content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    request.resume();
    throw new ProxyHttpError(413, "Request body is too large.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      request.resume();
      throw new ProxyHttpError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readResponseBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ProxyHttpError(502, "Upstream response is too large.", -32603);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProxyHttpError(400, "Invalid JSON-RPC object.");
  }
  return value as Record<string, unknown>;
}

function asFelt(value: unknown, field: string): bigint {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ProxyHttpError(400, `${field} must be a felt.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new ProxyHttpError(400, `${field} must be a felt.`);
  }
}

function validateProveRequest(
  request: JsonRpcRequest,
  tenant: ProverTenant,
): void {
  const params = asObject(request.params);
  const blockId = asObject(params.block_id);
  const blockNumber = blockId.block_number;
  if (
    typeof blockNumber !== "number" ||
    !Number.isSafeInteger(blockNumber) ||
    blockNumber < 0
  ) {
    throw new ProxyHttpError(
      400,
      "block_id must contain a non-negative block_number.",
    );
  }

  const transaction = asObject(params.transaction);
  if (transaction.type !== "INVOKE") {
    throw new ProxyHttpError(
      400,
      "Only INVOKE proof transactions are allowed.",
    );
  }
  if (asFelt(transaction.version, "transaction.version") !== 3n) {
    throw new ProxyHttpError(400, "Only transaction version 3 is allowed.");
  }
  if (asFelt(transaction.tip, "transaction.tip") !== 0n) {
    throw new ProxyHttpError(400, "Proof transaction tip must be zero.");
  }
  if (
    asFelt(transaction.sender_address, "transaction.sender_address") !==
    BigInt(tenant.poolAddress)
  ) {
    throw new ProxyHttpError(
      403,
      "Proof transaction targets another pool.",
      -32002,
    );
  }

  const bounds = asObject(transaction.resource_bounds);
  for (const resource of ["l1_gas", "l2_gas", "l1_data_gas"]) {
    const bound = asObject(bounds[resource]);
    if (
      asFelt(bound.max_price_per_unit, `${resource}.max_price_per_unit`) !== 0n
    ) {
      throw new ProxyHttpError(
        400,
        "Proof transaction resource prices must be zero.",
      );
    }
  }
}

function parseRpcRequest(body: Buffer, tenant: ProverTenant): JsonRpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ProxyHttpError(400, "Invalid JSON.", -32700);
  }
  if (Array.isArray(parsed)) {
    throw new ProxyHttpError(400, "JSON-RPC batches are not allowed.");
  }
  const object = asObject(parsed);
  if (object.jsonrpc !== "2.0" || typeof object.method !== "string") {
    throw new ProxyHttpError(400, "Invalid JSON-RPC request.");
  }
  if (
    object.method !== "starknet_proveTransaction" &&
    object.method !== "starknet_specVersion"
  ) {
    throw new ProxyHttpError(403, "JSON-RPC method is not allowed.", -32601);
  }
  const request = object as JsonRpcRequest;
  if (request.method === "starknet_proveTransaction") {
    validateProveRequest(request, tenant);
  }
  return request;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  retryAfterSeconds?: number,
): void {
  const body = Buffer.from(JSON.stringify(value));
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.setHeader("content-length", body.length);
  response.setHeader("cache-control", "no-store");
  if (retryAfterSeconds) {
    response.setHeader("retry-after", String(retryAfterSeconds));
  }
  response.end(body);
}

function sendRpcError(
  response: ServerResponse,
  error: ProxyHttpError,
  id: JsonRpcRequest["id"] = null,
): void {
  sendJson(
    response,
    error.status,
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code: error.rpcCode, message: error.message },
    },
    error.retryAfterSeconds,
  );
}

async function verifyForTenant(
  token: string,
  tenant: ProverTenant,
  verificationKeys: webcrypto.CryptoKey[],
): Promise<VerifyAccessTokenResponse> {
  let lastError: unknown;
  for (const key of verificationKeys) {
    try {
      return await verifyAccessToken({
        access_token: token,
        app_id: tenant.privyAppId,
        verification_key: key,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No verification key accepted the token.");
}

/** Build a server-to-server Privy-authenticated prover-proxy request handler. */
export function createPrivyProverProxyHandler(
  options: PrivyProverProxyOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  if (options.identityHashSecret.length < 32) {
    throw new Error("identityHashSecret must contain at least 32 characters.");
  }
  let upstreamUrl: string;
  try {
    const parsed = new URL(options.upstreamUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    upstreamUrl = parsed.toString();
  } catch (error) {
    throw new Error("upstreamUrl must be a valid HTTP(S) URL.", {
      cause: error,
    });
  }
  const limiter = options.limiter ?? new InMemoryProverProxyLimiter();
  const admissionLimiter = new PreAuthAdmissionLimiter(
    options.preAuthRequestsPerMinute ?? 120,
    options.preAuthMaxEntries ?? 10_000,
  );
  const verificationKeyCache = new Map<
    string,
    { sources: string[]; keys: webcrypto.CryptoKey[] }
  >();
  const getVerificationKeys = (tenant: ProverTenant) => {
    const cached = verificationKeyCache.get(tenant.tenantId);
    if (
      cached &&
      cached.sources.length === tenant.verificationKeys.length &&
      cached.sources.every(
        (source, index) => source === tenant.verificationKeys[index],
      )
    ) {
      return cached.keys;
    }
    const keys = tenant.verificationKeys.map((source) =>
      createPublicKey(source).toCryptoKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      ),
    );
    verificationKeyCache.set(tenant.tenantId, {
      sources: [...tenant.verificationKeys],
      keys,
    });
    return keys;
  };
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024 * 1024;
  const fetchImpl = options.fetch ?? fetch;
  const verifyToken =
    options.verifyToken ??
    ((token: string, tenant: ProverTenant) =>
      verifyForTenant(token, tenant, getVerificationKeys(tenant)));

  return async (request, response) => {
    const startedAt = Date.now();
    let tenantId: string | undefined;
    let userHash: string | undefined;
    let method: string | undefined;
    let outcome: ProverProxyAuditEvent["outcome"] = "rejected";
    let status = 500;
    let limitRelease: (() => Promise<void> | void) | undefined;
    let rpcId: JsonRpcRequest["id"] = null;
    response.on("error", () => {
      // Client disconnects and socket teardown must not become process errors.
    });

    try {
      const sourceIp =
        options.clientIp?.(request) ??
        request.socket.remoteAddress ??
        "unknown";
      if (!admissionLimiter.consume(sourceIp)) {
        throw new ProxyHttpError(429, "Too many requests.", -32003, 60);
      }
      if (request.method === "GET" && request.url === "/health") {
        status = 200;
        outcome = "allowed";
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method !== "POST" || request.url !== "/rpc") {
        throw new ProxyHttpError(404, "Not found.", -32601);
      }
      if (oneHeader(request, "origin")) {
        throw new ProxyHttpError(
          403,
          "Browser-origin requests are not allowed.",
        );
      }
      if (
        !oneHeader(request, "content-type")
          ?.toLowerCase()
          .startsWith("application/json")
      ) {
        throw new ProxyHttpError(415, "Content-Type must be application/json.");
      }
      tenantId = oneHeader(request, PROVER_PROXY_TENANT_HEADER)?.trim();
      if (!tenantId || tenantId.length > 200) {
        throw new ProxyHttpError(401, "Unknown prover tenant.", -32001);
      }
      const tenant = await options.registry.getByTenantId(tenantId);
      if (!tenant) {
        throw new ProxyHttpError(401, "Unknown prover tenant.", -32001);
      }
      if (!tenant.enabled) {
        throw new ProxyHttpError(403, "Prover tenant is disabled.", -32002);
      }

      const claims = await verifyToken(bearerToken(request), tenant).catch(
        () => {
          throw new ProxyHttpError(401, "Invalid Privy access token.", -32001);
        },
      );
      if (claims.app_id !== tenant.privyAppId) {
        throw new ProxyHttpError(401, "Invalid Privy access token.", -32001);
      }
      userHash = createHmac("sha256", options.identityHashSecret)
        .update(tenantId)
        .update("\0")
        .update(claims.user_id)
        .digest("hex");

      const limit = await limiter.acquire({
        tenantId,
        userHash,
      });
      if (!limit.allowed) {
        throw new ProxyHttpError(
          503,
          "Proving service is busy; retry later.",
          -32005,
          limit.retryAfterSeconds,
        );
      }
      limitRelease = limit.release;

      const body = await readRequestBody(request, maxRequestBytes);
      const rpc = parseRpcRequest(body, tenant);
      method = rpc.method;
      rpcId = rpc.id;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      const cancelOnClose = () => {
        if (!response.writableEnded) controller.abort();
      };
      response.once("close", cancelOnClose);
      try {
        const upstream = await fetchImpl(upstreamUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...options.upstreamHeaders,
          },
          body,
          redirect: "error",
          signal: controller.signal,
        });
        const upstreamBody = await readResponseBody(upstream, maxResponseBytes);
        status = upstream.status;
        outcome = upstream.ok ? "allowed" : "upstream_error";
        response.statusCode = upstream.status;
        response.setHeader(
          "content-type",
          upstream.headers.get("content-type") ?? "application/json",
        );
        response.setHeader("content-length", upstreamBody.length);
        response.setHeader("cache-control", "no-store");
        const retryAfter = upstream.headers.get("retry-after");
        if (retryAfter) response.setHeader("retry-after", retryAfter);
        response.end(upstreamBody);
      } finally {
        clearTimeout(timeout);
        response.off("close", cancelOnClose);
      }
    } catch (error) {
      const httpError =
        error instanceof ProxyHttpError
          ? error
          : new ProxyHttpError(502, "Proving service unavailable.", -32603);
      status = httpError.status;
      if (status >= 500) outcome = "upstream_error";
      if (response.writableEnded || response.destroyed) {
        status = 499;
      } else if (response.headersSent) {
        response.destroy();
      } else {
        sendRpcError(response, httpError, rpcId);
      }
    } finally {
      try {
        await limitRelease?.();
      } catch {
        // A limiter cleanup failure must not turn a completed HTTP response
        // into an unhandled rejection.
      }
      try {
        await options.audit?.({
          tenantId,
          userHash,
          method,
          outcome,
          status,
          durationMs: Date.now() - startedAt,
        });
      } catch {
        // Audit sinks receive pseudonymous metadata only and are best-effort.
      }
    }
  };
}

export function createPrivyProverProxyServer(
  options: PrivyProverProxyOptions,
): Server {
  const handler = createPrivyProverProxyHandler(options);
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = (options.requestTimeoutMs ?? 120_000) + 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxConnections = options.maxConnections ?? 256;
  return server;
}
