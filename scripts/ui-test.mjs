#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const APP_URL = "http://127.0.0.1:5173";
const CONFIG_URL = `${APP_URL}/__quietline_localnet_wallet/config`;
const LOCALNET_SCRIPT = resolve(ROOT, "scripts/localnet-app.mjs");
const PLAYWRIGHT_CLI = resolve(ROOT, "node_modules/playwright/cli.js");

function stopLocalnet() {
  return spawnSync(process.execPath, [LOCALNET_SCRIPT, "--stop"], {
    cwd: ROOT,
    stdio: "inherit",
  }).status ?? 1;
}

async function waitForLocalnet(processHandle) {
  const deadline = Date.now() + 6 * 60_000;
  let lastError = "localnet did not answer";

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Quietline localnet exited before the UI suite (code ${processHandle.exitCode}).`,
      );
    }
    try {
      const response = await fetch(CONFIG_URL);
      const payload = await response.json();
      if (response.ok && payload?.result?.walletName === "Localnet (dev)") {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  throw new Error(`Quietline localnet was not ready in six minutes: ${lastError}`);
}

stopLocalnet();
const localnet = spawn(process.execPath, [LOCALNET_SCRIPT], {
  cwd: ROOT,
  env: process.env,
  stdio: "inherit",
});

async function stopSpawnedLocalnet() {
  if (localnet.exitCode !== null) return;
  const exited = new Promise((resolveExit) => localnet.once("exit", resolveExit));
  localnet.kill("SIGTERM");
  let timeout;
  try {
    await Promise.race([
      exited,
      new Promise((resolveTimeout) => {
        timeout = setTimeout(() => {
          if (localnet.exitCode === null) localnet.kill("SIGKILL");
          resolveTimeout(undefined);
        }, 25_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

let playwright;
let interrupted = false;
const interrupt = () => {
  if (interrupted) return;
  interrupted = true;
  playwright?.kill("SIGTERM");
  localnet.kill("SIGTERM");
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

let exitCode = 1;
try {
  await waitForLocalnet(localnet);
  playwright = spawn(
    process.execPath,
    [PLAYWRIGHT_CLI, "test", ...process.argv.slice(2)],
    {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    },
  );
  exitCode = await new Promise((resolveExit) => {
    playwright.once("exit", (code, signal) => {
      resolveExit(signal ? 1 : (code ?? 1));
    });
  });
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
} finally {
  await stopSpawnedLocalnet();
  stopLocalnet();
}

process.exitCode = exitCode;
