import { generateKeyPairSync, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROVER_PROXY_TENANT_HEADER,
  createPrivyProverProxyServer,
} from "../src/proxy/server.js";
import { InMemoryProverTenantRegistry } from "../src/proxy/registry.js";
import type { ProverProxyLimiter } from "../src/proxy/limiter.js";

const POOL =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

function tenant() {
  return {
    tenantId: "tenant-demo",
    privyClientId: "client-demo",
    privyAppId: "app-demo",
    verificationKeys: ["public-key"],
    poolAddress: POOL,
    enabled: true,
  };
}

function proveRequest(poolAddress = POOL) {
  return {
    jsonrpc: "2.0",
    id: 7,
    method: "starknet_proveTransaction",
    params: {
      block_id: { block_number: 123 },
      transaction: {
        type: "INVOKE",
        version: "0x3",
        sender_address: poolAddress,
        calldata: [],
        signature: [],
        nonce: "0x0",
        resource_bounds: {
          l1_gas: { max_amount: "0x1", max_price_per_unit: "0x0" },
          l2_gas: { max_amount: "0x1", max_price_per_unit: "0x0" },
          l1_data_gas: { max_amount: "0x1", max_price_per_unit: "0x0" },
        },
        tip: "0x0",
        paymaster_data: [],
        account_deployment_data: [],
        nonce_data_availability_mode: "L1",
        fee_data_availability_mode: "L1",
      },
    },
  };
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signedPrivyToken(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = base64url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sid: "session-real",
      sub: "did:privy:real-user",
      iss: "privy.io",
      aud: "app-demo",
      iat: now,
      exp: now + 3_600,
    }),
  );
  const input = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${signature.toString("base64url")}`;
}

const claims = {
  app_id: "app-demo",
  issuer: "privy.io",
  issued_at: 1,
  expiration: 9_999_999_999,
  session_id: "session-1",
  user_id: "did:privy:user-secret",
};

const servers: ReturnType<typeof createPrivyProverProxyServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function start(
  options: {
    upstreamFetch?: typeof fetch;
    verifyToken?: () => Promise<typeof claims>;
    limiter?: ProverProxyLimiter;
    audit?: (event: unknown) => void;
    preAuthRequestsPerMinute?: number;
  } = {},
) {
  const upstreamFetch =
    options.upstreamFetch ??
    (vi.fn(
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 7, result: { ok: true } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch);
  const verifyToken = options.verifyToken ?? vi.fn(async () => claims);
  const server = createPrivyProverProxyServer({
    registry: new InMemoryProverTenantRegistry([tenant()]),
    upstreamUrl: "https://prover.internal/rpc",
    identityHashSecret: "x".repeat(32),
    fetch: upstreamFetch,
    verifyToken,
    limiter: options.limiter,
    audit: options.audit,
    preAuthRequestsPerMinute: options.preAuthRequestsPerMinute,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    upstreamFetch,
    verifyToken,
  };
}

function headers(extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    authorization: "Bearer access-token",
    [PROVER_PROXY_TENANT_HEADER]: "tenant-demo",
    ...extra,
  };
}

describe("Privy prover proxy", () => {
  it("verifies a real ES256 Privy-shaped token with an enrolled public key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const token = signedPrivyToken(privateKey);
    const upstreamFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 7, result: { ok: true } }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const server = createPrivyProverProxyServer({
      registry: new InMemoryProverTenantRegistry([
        {
          ...tenant(),
          verificationKeys: [
            publicKey.export({ type: "spki", format: "pem" }).toString(),
          ],
        },
      ]),
      upstreamUrl: "https://prover.internal/rpc",
      identityHashSecret: "x".repeat(32),
      fetch: upstreamFetch,
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/rpc`, {
      method: "POST",
      headers: {
        ...headers(),
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(proveRequest()),
    });

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("serves a local health endpoint without touching the prover", async () => {
    const { url, upstreamFetch } = await start();
    const response = await fetch(`${url}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("verifies the tenant token and forwards only the JSON-RPC body", async () => {
    const audit = vi.fn();
    const { url, upstreamFetch, verifyToken } = await start({ audit });
    const body = proveRequest();
    const response = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: { ok: true },
    });
    expect(verifyToken).toHaveBeenCalledWith(
      "access-token",
      expect.objectContaining({ privyAppId: "app-demo" }),
    );
    const [, init] = vi.mocked(upstreamFetch).mock.calls[0]!;
    const forwardedHeaders = new Headers(init?.headers);
    expect(forwardedHeaders.get("authorization")).toBeNull();
    expect(forwardedHeaders.get(PROVER_PROXY_TENANT_HEADER)).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-demo",
        outcome: "allowed",
        status: 200,
        userHash: expect.not.stringContaining("did:privy"),
      }),
    );
  });

  it("rate-limits unauthenticated work before JWT verification", async () => {
    const { url, upstreamFetch } = await start({
      preAuthRequestsPerMinute: 1,
    });
    const request = () =>
      fetch(`${url}/rpc`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [PROVER_PROXY_TENANT_HEADER]: "tenant-demo",
        },
        body: JSON.stringify(proveRequest()),
      });

    expect((await request()).status).toBe(401);
    expect((await request()).status).toBe(429);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects missing tokens before reading from the prover", async () => {
    const { url, upstreamFetch } = await start();
    const response = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [PROVER_PROXY_TENANT_HEADER]: "tenant-demo",
      },
      body: JSON.stringify(proveRequest()),
    });

    expect(response.status).toBe(401);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects a token whose verified app ID does not match enrollment", async () => {
    const { url, upstreamFetch } = await start({
      verifyToken: async () => ({ ...claims, app_id: "another-app" }),
    });
    const response = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(proveRequest()),
    });

    expect(response.status).toBe(401);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects proof invocations for another pool", async () => {
    const { url, upstreamFetch } = await start();
    const response = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(proveRequest("0x123")),
    });

    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects browser-origin and JSON-RPC batch requests", async () => {
    const { url, upstreamFetch } = await start();
    const browser = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: headers({ origin: "https://app.example" }),
      body: JSON.stringify(proveRequest()),
    });
    const batch = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify([proveRequest()]),
    });

    expect(browser.status).toBe(403);
    expect(batch.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("releases limiter leases when request validation fails", async () => {
    const release = vi.fn();
    const limiter: ProverProxyLimiter = {
      acquire: async () => ({ allowed: true, release }),
    };
    const { url } = await start({ limiter });
    const response = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify([proveRequest()]),
    });

    expect(response.status).toBe(400);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not mark unknown upstream failures as retryable", async () => {
    const upstreamFetch = vi.fn(async () => {
      throw new Error("socket failed");
    }) as unknown as typeof fetch;
    const { url } = await start({ upstreamFetch });
    const response = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(proveRequest()),
    });
    const payload = (await response.json()) as { error: { code: number } };

    expect(response.status).toBe(502);
    expect(payload.error.code).toBe(-32603);
  });

  it("uses retry-compatible overload responses", async () => {
    const limiter: ProverProxyLimiter = {
      acquire: async () => ({ allowed: false, retryAfterSeconds: 3 }),
    };
    const { url, upstreamFetch } = await start({ limiter });
    const response = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(proveRequest()),
    });
    const payload = (await response.json()) as {
      error: { code: number };
    };

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(payload.error.code).toBe(-32005);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
