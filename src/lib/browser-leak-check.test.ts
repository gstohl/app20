import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const created: string[] = [];
const script = resolve(process.cwd(), "scripts/check-browser-leaks.mjs");

function outputDirectory(content: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), "app20-browser-leak-"));
  created.push(directory);
  writeFileSync(resolve(directory, "app.js"), content);
  return directory;
}

function run(directory: string, environment: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, directory], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("browser leak release check", () => {
  it("accepts a bundle containing only same-origin and public metadata", () => {
    const result = run(outputDirectory('fetch("/api/starknet/mainnet")'));
    expect(result.status).toBe(0);
  });

  it("rejects any configured RPC origin or authorization without printing it", () => {
    const rpc = "https://rpc.vendor.invalid/PRIVATE_RPC_CANARY";
    const authorization = "Bearer PRIVATE_AUTHORIZATION_CANARY";
    const result = run(outputDirectory(`const a=${JSON.stringify(rpc)};const b=${JSON.stringify(authorization)}`), {
      STARKNET_MAINNET_RPC_URL: rpc,
      STARKNET_MAINNET_AUTHORIZATION: authorization,
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("value of STARKNET_MAINNET_RPC_URL");
    expect(output).toContain("value of STARKNET_MAINNET_AUTHORIZATION");
    expect(output).not.toContain("PRIVATE_RPC_CANARY");
    expect(output).not.toContain("PRIVATE_AUTHORIZATION_CANARY");
  });

  it("rejects an APP20 release canary without printing it", () => {
    const canary = "APP20_PRIVATE_RELEASE_CANARY";
    const result = run(outputDirectory(`const leaked=${JSON.stringify(canary)}`), {
      APP20_PRIVATE_CANARIES: canary,
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain("APP20_PRIVATE_CANARIES[0]");
    expect(output).not.toContain(canary);
  });

  it("rejects server-only configuration markers even without their values", () => {
    const result = run(outputDirectory("const leaked = 'PROVER_UPSTREAM_URL'"));
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("PROVER_UPSTREAM_URL");
  });
});
