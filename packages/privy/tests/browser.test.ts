import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ec } from "starknet";
import { describe, expect, it, vi } from "vitest";
import {
  BrowserPrivySigner,
  BrowserStrk20Client,
  computeBrowserAccountAddress,
} from "../src/browser.js";
import { PrivyError } from "../src/errors.js";

const PRIVATE_KEY = "0x123456789";
const fullPublicKey = ec.starkCurve.getPublicKey(PRIVATE_KEY);
const PUBLIC_KEY = `0x${Buffer.from(fullPublicKey)
  .subarray(1, 33)
  .toString("hex")}`;
const PRIVY_ADDRESS = "0x5678";

function signatureFor(hash: string): string {
  return `0x${ec.starkCurve.sign(hash, PRIVATE_KEY).toCompactHex()}`;
}

describe("BrowserPrivySigner", () => {
  it("normalizes, verifies, and splits Privy's r||s signature", async () => {
    const rawSign = vi.fn(async (hash: `0x${string}`) => ({
      signature: signatureFor(hash),
    }));
    const signer = new BrowserPrivySigner(PUBLIC_KEY, rawSign);
    const signature = signatureFor("0xabc").slice(2);

    await expect(signer.signRaw("abc")).resolves.toEqual([
      `0x${signature.slice(0, 64)}`,
      `0x${signature.slice(64)}`,
    ]);
    expect(rawSign).toHaveBeenCalledWith("0xabc");
  });

  it("rejects a well-formed signature for a different hash", async () => {
    const signer = new BrowserPrivySigner(PUBLIC_KEY, async () =>
      signatureFor("0x456"),
    );
    await expect(signer.signRaw("0x123")).rejects.toThrow(PrivyError);
  });

  it("rejects malformed browser signatures", async () => {
    const signer = new BrowserPrivySigner(PUBLIC_KEY, async () => "0x12");
    await expect(signer.signRaw("0x1")).rejects.toThrow(PrivyError);
  });
});

describe("BrowserStrk20Client", () => {
  it("derives and validates the Ready account address locally", () => {
    const client = new BrowserStrk20Client({
      rpcUrl: "https://rpc.example.invalid",
    });
    const address = computeBrowserAccountAddress(PUBLIC_KEY);
    expect(
      client.resolveWallet({
        publicKey: PUBLIC_KEY,
        privyAddress: PRIVY_ADDRESS,
        address,
      }).address,
    ).toBe(address);
  });

  it("rejects an account address derived with different parameters", () => {
    const client = new BrowserStrk20Client({
      rpcUrl: "https://rpc.example.invalid",
    });
    expect(() =>
      client.resolveWallet({
        publicKey: PUBLIC_KEY,
        privyAddress: PRIVY_ADDRESS,
        address: "0x1",
      }),
    ).toThrow("does not match");
  });
});

const FORBIDDEN_RUNTIME = [
  "@privy-io/node",
  "node:http",
  "node:crypto",
  "node:fs",
  "node:net",
  "node:child_process",
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function valueSpecifiers(source: string): string[] {
  const text = stripComments(source);
  const specifiers: string[] = [];
  const fromImport =
    /\b(?:import|export)(\s+type)?\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(fromImport)) {
    if (!match[1]) specifiers.push(match[2]!);
  }
  for (const match of text.matchAll(/\bimport\s+["']([^"']+)["']/g)) {
    specifiers.push(match[1]!);
  }
  for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

describe("browser bundle boundary", () => {
  it("does not import Node Privy or server-only modules at runtime", () => {
    const entry = fileURLToPath(new URL("../src/browser.ts", import.meta.url));
    const seen = new Set<string>();
    const queue = [entry];
    const specifiers: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const specifier of valueSpecifiers(source)) {
        specifiers.push(specifier);
        if (!specifier.startsWith(".")) continue;
        const resolved = isAbsolute(specifier)
          ? specifier
          : join(dirname(file), specifier);
        const candidate = resolved.endsWith(".ts")
          ? resolved
          : resolved.replace(/\.js$/, ".ts");
        queue.push(candidate);
      }
    }

    expect(specifiers).not.toEqual(expect.arrayContaining(FORBIDDEN_RUNTIME));
    expect([...seen].some((file) => file.endsWith("/proxy/server.ts"))).toBe(
      false,
    );
    expect([...seen].some((file) => file.endsWith("/privy.ts"))).toBe(false);
  });
});
