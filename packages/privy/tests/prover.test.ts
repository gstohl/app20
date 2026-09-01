import { describe, expect, it, vi } from "vitest";
import { customProver, mockProver, serviceProver } from "../src/prover.js";
import { ConfigError } from "../src/errors.js";

const context = {
  provider: {
    channel: { nodeUrl: "https://rpc.example" },
  } as never,
  network: "sepolia" as const,
  chainId: "0x534e5f5345504f4c4941",
  nodeUrl: "https://rpc.example",
  poolAddress: "0x123",
};

describe("prover sources", () => {
  it("resolves a remote proving-service config from session context", async () => {
    const prover = serviceProver({
      url: "https://prover.example",
      requestTimeoutMs: 90_000,
      retry: { maxRetries: 2 },
    });

    expect(prover.kind).toBe("service");
    expect(prover.submittable).toBe(true);
    await expect(prover.resolve(context)).resolves.toMatchObject({
      url: "https://prover.example",
      chainId: context.chainId,
      nodeUrl: context.nodeUrl,
      requestTimeoutMs: 90_000,
      retry: { maxRetries: 2 },
    });
  });

  it("forwards OHTTP transport options so the SDK can encapsulate witnesses", async () => {
    const ohttp = {
      relayUrl: "/api/ohttp/prover",
      publicKeyConfig: new Uint8Array([1, 2, 3]),
    };
    const prover = serviceProver({
      url: "https://prover.example",
      ohttp,
    });
    await expect(prover.resolve(context)).resolves.toMatchObject({ ohttp });
  });

  it("marks in-process and HTTP mocks as non-submittable", () => {
    expect(mockProver()).toMatchObject({ kind: "mock", submittable: false });
    expect(
      serviceProver({
        url: "http://127.0.0.1:8787",
        submittable: false,
      }),
    ).toMatchObject({ kind: "service", submittable: false });
  });

  it("accepts an application-owned provider only with an explicit policy", async () => {
    const provider = {
      getDefaultDetails: vi.fn(async () => ({})),
      prove: vi.fn(async () => ({
        data: "proof",
        output: ["0x1"],
        proofFacts: [],
      })),
    };
    const prover = customProver(provider, { submittable: true });

    expect(prover.kind).toBe("custom");
    expect(prover.submittable).toBe(true);
    await expect(prover.resolve(context)).resolves.toBe(provider);
  });

  it("rejects empty service URLs and malformed custom providers", () => {
    expect(() => serviceProver({ url: " " })).toThrow(ConfigError);
    expect(() => customProver({} as never, { submittable: false })).toThrow(
      ConfigError,
    );
  });
});
