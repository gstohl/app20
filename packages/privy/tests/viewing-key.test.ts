import { describe, expect, it } from "vitest";
import {
  canonicalViewingKey,
  deriveViewingKeyFromPassphrase,
  memoizedViewingKeyProvider,
} from "../src/viewing-key.js";

const ADDRESS = "0x1234";

describe("canonicalViewingKey", () => {
  it("maps zero to 1", () => {
    expect(canonicalViewingKey(0n)).toBe(1n);
  });

  it("keeps a small non-zero scalar", () => {
    expect(canonicalViewingKey(7n)).toBe(7n);
  });
});

describe("memoizedViewingKeyProvider", () => {
  it("deduplicates concurrent derivations and caches the result", async () => {
    let calls = 0;
    let resolveViewingKey: ((value: bigint) => void) | undefined;
    const derivation = new Promise<bigint>((resolve) => {
      resolveViewingKey = resolve;
    });
    const provider = memoizedViewingKeyProvider(async () => {
      calls += 1;
      return derivation;
    });

    const first = provider.getViewingKey();
    const second = provider.getViewingKey();
    expect(calls).toBe(1);
    resolveViewingKey?.(42n);

    await expect(Promise.all([first, second])).resolves.toEqual([42n, 42n]);
    await expect(provider.getViewingKey()).resolves.toBe(42n);
    expect(calls).toBe(1);
  });

  it("allows a retry after a failed derivation", async () => {
    let calls = 0;
    const provider = memoizedViewingKeyProvider(async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary signer failure");
      return 9n;
    });

    await expect(provider.getViewingKey()).rejects.toThrow(
      "temporary signer failure",
    );
    await expect(provider.getViewingKey()).resolves.toBe(9n);
    expect(calls).toBe(2);
  });
});

describe("deriveViewingKeyFromPassphrase", () => {
  it("is deterministic for the same passphrase + address", () => {
    const a = deriveViewingKeyFromPassphrase(
      "correct horse battery staple",
      ADDRESS,
    );
    const b = deriveViewingKeyFromPassphrase(
      "correct horse battery staple",
      ADDRESS,
    );
    expect(a).toBe(b);
    expect(a > 0n).toBe(true);
  });

  it("changes when the address salt changes", () => {
    const a = deriveViewingKeyFromPassphrase("pass", "0x1");
    const b = deriveViewingKeyFromPassphrase("pass", "0x2");
    expect(a).not.toBe(b);
  });

  it("changes when the passphrase changes", () => {
    const a = deriveViewingKeyFromPassphrase("alpha", ADDRESS);
    const b = deriveViewingKeyFromPassphrase("beta", ADDRESS);
    expect(a).not.toBe(b);
  });
});
