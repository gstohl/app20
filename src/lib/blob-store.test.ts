import { describe, expect, it, vi } from "vitest";
import {
  BLOB_STORE_MAX_RESPONSE_BYTES,
  computeCidV1Raw,
  createIpfsBlobStore,
  createUnavailableBlobStore,
  resolveBlobStoreConfig,
} from "./blob-store";

const encoder = new TextEncoder();

describe("CIDv1 raw blobs", () => {
  it("matches fixed raw/sha2-256 CID vectors", () => {
    expect(computeCidV1Raw(new Uint8Array())).toBe(
      "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
    );
    expect(computeCidV1Raw(encoder.encode("hello"))).toBe(
      "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq",
    );
  });

  it("uploads multipart bytes with the exact reviewed IPFS parameters", async () => {
    const bytes = encoder.encode("hello");
    const cid = computeCidV1Raw(bytes);
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/__app20_localnet_ipfs/api/v0/add");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        "cid-version": "1",
        "raw-leaves": "true",
        hash: "sha2-256",
        pin: "true",
      });
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
      expect(init?.redirect).toBe("error");
      return Response.json({
        Name: "backup.bin",
        Hash: cid,
        Size: bytes.length,
      });
    });
    const store = createIpfsBlobStore({
      rpcOrigin: "http://127.0.0.1:3000/__app20_localnet_ipfs",
      gatewayOrigins: ["http://127.0.0.1:3000/__app20_localnet_ipfs"],
      fetch: fetchMock,
    });

    await expect(store.put(bytes)).resolves.toEqual({ cid });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("tries gateways in order and accepts only bytes whose CID verifies", async () => {
    const good = encoder.encode("hello");
    const cid = computeCidV1Raw(good);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(encoder.encode("tampered")))
      .mockResolvedValueOnce(new Response(good));
    const store = createIpfsBlobStore({
      rpcOrigin: "https://rpc.example",
      gatewayOrigins: ["https://first.example", "https://second.example"],
      fetch: fetchMock,
    });

    await expect(store.get(cid)).resolves.toEqual(good);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const second = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(first.origin).toBe("https://first.example");
    expect(second.origin).toBe("https://second.example");
    expect(first.pathname).toBe(`/ipfs/${cid}`);
    expect(first.searchParams.get("format")).toBe("raw");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      headers: { Accept: "application/vnd.ipld.raw" },
    });
  });

  it("aborts gateway fetches at the configured timeout", async () => {
    const cid = computeCidV1Raw(encoder.encode("expected"));
    const store = createIpfsBlobStore({
      rpcOrigin: "https://rpc.example",
      gatewayOrigins: ["https://gateway.example"],
      timeoutMs: 5,
      fetch: async (_request, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    await expect(store.get(cid)).rejects.toThrow(/gateway/i);
  });

  it("rejects hash mismatches and over-limit responses", async () => {
    const cid = computeCidV1Raw(encoder.encode("expected"));
    const mismatch = createIpfsBlobStore({
      rpcOrigin: "https://rpc.example",
      gatewayOrigins: ["https://gateway.example"],
      fetch: async () => new Response(encoder.encode("wrong")),
    });
    await expect(mismatch.get(cid)).rejects.toThrow(/hash mismatch/i);

    const oversized = createIpfsBlobStore({
      rpcOrigin: "https://rpc.example",
      gatewayOrigins: ["https://gateway.example"],
      fetch: async () =>
        new Response(null, {
          headers: {
            "content-length": String(BLOB_STORE_MAX_RESPONSE_BYTES + 1),
          },
        }),
    });
    await expect(oversized.get(cid)).rejects.toThrow(/1 MiB/i);
  });
});

describe("blob store configuration", () => {
  it("resolves a localnet same-origin proxy and tolerates an absent field", () => {
    expect(
      resolveBlobStoreConfig({
        localnetConfig: { ipfsProxyPath: "/__app20_localnet_ipfs" },
        origin: "http://127.0.0.1:3000",
      }),
    ).toEqual({
      available: true,
      rpcOrigin: "http://127.0.0.1:3000/__app20_localnet_ipfs",
      gatewayOrigins: ["http://127.0.0.1:3000/__app20_localnet_ipfs"],
    });
    expect(
      resolveBlobStoreConfig({
        localnetConfig: {},
        origin: "http://localhost",
      }),
    ).toMatchObject({
      available: false,
      reason: expect.stringMatching(/does not advertise/i),
    });
  });

  it("requires complete HTTPS production origins and defaults unavailable", () => {
    expect(resolveBlobStoreConfig({ env: {} })).toMatchObject({
      available: false,
    });
    expect(
      resolveBlobStoreConfig({
        env: {
          VITE_IPFS_RPC_ORIGIN: "https://rpc.example",
          VITE_IPFS_GATEWAY_ORIGINS: "https://one.example, https://two.example",
        },
      }),
    ).toEqual({
      available: true,
      rpcOrigin: "https://rpc.example",
      gatewayOrigins: ["https://one.example", "https://two.example"],
    });
    expect(
      resolveBlobStoreConfig({
        env: {
          VITE_IPFS_RPC_ORIGIN: "http://public.example",
          VITE_IPFS_GATEWAY_ORIGINS: "https://gateway.example",
        },
      }),
    ).toMatchObject({ available: false });
  });

  it("provides a clear fail-closed unavailable store", async () => {
    const store = createUnavailableBlobStore("No reviewed origins.");
    expect(store.available).toBe(false);
    await expect(store.put(new Uint8Array())).rejects.toThrow(
      /No reviewed origins/i,
    );
    await expect(store.get(`b${"a".repeat(58)}`)).rejects.toThrow(
      /No reviewed origins/i,
    );
  });
});
