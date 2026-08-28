import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const scanner = resolve("scripts/check-browser-leaks.mjs");

async function artifact(contents) {
  const root = await mkdtemp(join(tmpdir(), "app20-browser-artifact-"));
  const dist = join(root, "dist", "assets");
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "app.js"), contents);
  return { root, output: join(root, "dist") };
}

test("artifact scanning rejects the stable localnet development-wallet sentinel", async () => {
  const { root, output } = await artifact(
    'globalThis.wallet="APP20_LOCALNET_DEV_WALLET_SENTINEL_7C91E2";',
  );
  try {
    const result = spawnSync(process.execPath, [scanner, output], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /LOCALNET_DEV_WALLET_SENTINEL/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact scanning accepts a minimal clean browser artifact", async () => {
  const { root, output } = await artifact('globalThis.app20="public";');
  try {
    const result = spawnSync(process.execPath, [scanner, output], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
