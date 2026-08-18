import { describe, expect, it, vi } from "vitest";
import {
  ProverProxyClientError,
  createPrivyProxyProofProvider,
} from "../src/proxy/provider.js";
import { PROVER_PROXY_TENANT_HEADER } from "../src/proxy/server.js";

const POOL = "0x123";

function base() {
  return {
    getDefaultDetails: vi.fn(async () => ({ nonce: 1n })),
    invalidateNonceCache: vi.fn(),
  };
}

function successResponse() {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        proof: "base64-proof",
        proof_facts: ["0xfact"],
        l2_to_l1_messages: [
          {
            from_address: POOL,
            to_address: "0x0",
            payload: ["0xclass", "0xaction"],
          },
        ],
        additional_data: {
          signature: { issued_at: 1, sig_r: "0x1", sig_s: "0x2" },
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("PrivyProxyProofProvider", () => {
  it("adds refreshed Privy authentication and maps the proof response", async () => {
    const accessToken = vi.fn(async () => "token-1");
    const fetchMock = vi.fn(async () =>
      successResponse(),
    ) as unknown as typeof fetch;
    const delegated = base();
    const provider = createPrivyProxyProofProvider(delegated, POOL, {
      url: "https://proxy.example/rpc",
      tenantId: "tenant-demo",
      accessToken,
      fetch: fetchMock,
    });

    await expect(provider.getDefaultDetails()).resolves.toEqual({ nonce: 1n });
    const proof = await provider.prove({ sender_address: POOL }, 123);

    expect(proof).toEqual({
      data: "base64-proof",
      output: ["0xclass", "0xaction"],
      proofFacts: ["0xfact"],
      additionalData: {
        signature: { issued_at: 1, sig_r: "0x1", sig_s: "0x2" },
      },
    });
    const [, init] = vi.mocked(fetchMock).mock.calls[0]!;
    const requestHeaders = new Headers(init?.headers);
    expect(requestHeaders.get("authorization")).toBe("Bearer token-1");
    expect(requestHeaders.get(PROVER_PROXY_TENANT_HEADER)).toBe("tenant-demo");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      method: "starknet_proveTransaction",
      params: { block_id: { block_number: 123 } },
    });
    provider.invalidateNonceCache();
    expect(delegated.invalidateNonceCache).toHaveBeenCalledOnce();
  });

  it("asks the callback for a fresh token once after a 401", async () => {
    const accessToken = vi
      .fn<(request: { forceRefresh: boolean }) => Promise<string>>()
      .mockResolvedValueOnce("expired")
      .mockResolvedValueOnce("fresh");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32001, message: "invalid token" },
          }),
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(successResponse());
    const provider = createPrivyProxyProofProvider(base(), POOL, {
      url: "https://proxy.example/rpc",
      tenantId: "tenant-demo",
      accessToken,
      fetch: fetchMock,
    });

    await expect(provider.prove({}, 123)).resolves.toMatchObject({
      data: "base64-proof",
    });
    expect(accessToken).toHaveBeenNthCalledWith(1, { forceRefresh: false });
    expect(accessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries proxy-compatible service-busy responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32005, message: "busy" },
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(successResponse());
    const provider = createPrivyProxyProofProvider(base(), POOL, {
      url: "https://proxy.example/rpc",
      tenantId: "tenant-demo",
      accessToken: "token",
      fetch: fetchMock,
      retry: { maxRetries: 1, baseDelayMs: 1 },
    });

    await expect(provider.prove({}, 123)).resolves.toMatchObject({
      data: "base64-proof",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient upstream failures", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32603, message: "upstream failed" },
          }),
          { status: 502 },
        ),
    ) as unknown as typeof fetch;
    const provider = createPrivyProxyProofProvider(base(), POOL, {
      url: "https://proxy.example/rpc",
      tenantId: "tenant-demo",
      accessToken: "token",
      fetch: fetchMock,
    });

    await expect(provider.prove({}, 123)).rejects.toBeInstanceOf(
      ProverProxyClientError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("composes caller cancellation with its timeout", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    ) as unknown as typeof fetch;
    const provider = createPrivyProxyProofProvider(base(), POOL, {
      url: "https://proxy.example/rpc",
      tenantId: "tenant-demo",
      accessToken: "token",
      abortSignal: controller.signal,
      fetch: fetchMock,
    });

    const proving = provider.prove({}, 123);
    controller.abort(new Error("cancelled"));
    await expect(proving).rejects.toThrow("cancelled");
  });

  it("requires an explicit proving block before making a request", async () => {
    const fetchMock = vi.fn(async () =>
      successResponse(),
    ) as unknown as typeof fetch;
    const provider = createPrivyProxyProofProvider(base(), POOL, {
      url: "https://proxy.example/rpc",
      tenantId: "tenant-demo",
      accessToken: "token",
      fetch: fetchMock,
    });

    await expect(provider.prove({})).rejects.toBeInstanceOf(
      ProverProxyClientError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects responses that omit the configured pool output", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              proof: "proof",
              proof_facts: ["0xfact"],
              l2_to_l1_messages: [],
            },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const provider = createPrivyProxyProofProvider(base(), POOL, {
      url: "https://proxy.example/rpc",
      tenantId: "tenant-demo",
      accessToken: "token",
      fetch: fetchMock,
    });

    await expect(provider.prove({}, 123)).rejects.toBeInstanceOf(
      ProverProxyClientError,
    );
  });
});
