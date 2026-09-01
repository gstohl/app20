#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const LOCALNET_SCRIPT = resolve(ROOT, "scripts/localnet-app.mjs");
const PLAYWRIGHT_CLI = resolve(ROOT, "node_modules/playwright/cli.js");
const LOCALNET_WALLET_NAME = "Localnet (dev)";
const LOCALNET_READY_TIMEOUT_MS = 6 * 60_000;

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`APP20_TEST_BASE_URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP20_TEST_BASE_URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "APP20_TEST_BASE_URL must not contain credentials, a query, or a fragment.",
    );
  }
  if (url.pathname !== "/") {
    throw new Error("APP20_TEST_BASE_URL must point to the server root.");
  }
  return url.origin;
}

/**
 * An explicit base URL means the caller owns the server lifecycle. Without it,
 * this runner creates and removes one fresh localnet for the complete serial
 * suite so chain state cannot leak in from a previous run.
 */
export function resolveUiTestPlan(env = process.env) {
  const configuredBaseUrl = env.APP20_TEST_BASE_URL?.trim();
  if (configuredBaseUrl) {
    const baseUrl = normalizeBaseUrl(configuredBaseUrl);
    return {
      baseUrl,
      configUrl: `${baseUrl}/__app20_localnet_wallet/config`,
      managesLocalnet: false,
    };
  }

  const vitePort = Number(env.APP20_LOCALNET_VITE_PORT ?? 5173);
  if (!Number.isInteger(vitePort) || vitePort <= 0 || vitePort > 65_535) {
    throw new Error("APP20_LOCALNET_VITE_PORT must be a valid TCP port.");
  }
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  return {
    baseUrl,
    configUrl: `${baseUrl}/__app20_localnet_wallet/config`,
    managesLocalnet: true,
  };
}

function delay(durationMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

export async function waitForLocalnet({
  configUrl,
  processHandle,
  fetchImpl = fetch,
  timeoutMs = LOCALNET_READY_TIMEOUT_MS,
  pollIntervalMs = 500,
  isInterrupted = () => false,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "localnet did not answer";
  let spawnError;
  const onSpawnError = (error) => {
    spawnError = error;
  };
  processHandle?.once("error", onSpawnError);

  try {
    while (Date.now() < deadline) {
      if (isInterrupted())
        throw new Error("APP20 UI test run was interrupted.");
      if (spawnError) {
        throw new Error("APP20 localnet could not be started.", {
          cause: spawnError,
        });
      }
      if (
        processHandle &&
        (processHandle.exitCode !== null || processHandle.signalCode !== null)
      ) {
        throw new Error(
          `APP20 localnet exited before the UI suite (code ${processHandle.exitCode ?? "signal"}).`,
        );
      }
      try {
        const remainingMs = Math.max(1, deadline - Date.now());
        const response = await fetchImpl(configUrl, {
          signal: AbortSignal.timeout(Math.min(5_000, remainingMs)),
        });
        const payload = await response.json();
        if (
          response.ok &&
          payload?.result?.walletName === LOCALNET_WALLET_NAME
        ) {
          return payload.result;
        }
        lastError = response.ok
          ? "config response was not the APP20 localnet fixture"
          : `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
  } finally {
    processHandle?.off("error", onSpawnError);
  }

  throw new Error(
    `APP20 localnet was not ready in ${Math.ceil(timeoutMs / 1_000)} seconds: ${lastError}`,
  );
}

function stopLocalnet(spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(process.execPath, [LOCALNET_SCRIPT, "--stop"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (status !== 0)
    throw new Error(`APP20 localnet stop failed with exit code ${status}.`);
}

async function stopSpawnedLocalnet(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null)
    return false;

  const exited = new Promise((resolveExit) =>
    processHandle.once("exit", resolveExit),
  );
  processHandle.kill("SIGTERM");
  let timeout;
  let forced = false;
  try {
    await Promise.race([
      exited,
      new Promise((resolveTimeout) => {
        timeout = setTimeout(() => {
          if (
            processHandle.exitCode === null &&
            processHandle.signalCode === null
          ) {
            forced = true;
            processHandle.kill("SIGKILL");
          }
          resolveTimeout(undefined);
        }, 25_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return forced;
}

function waitForChild(processHandle) {
  return new Promise((resolveExit, reject) => {
    processHandle.once("error", reject);
    processHandle.once("exit", (code, signal) => {
      resolveExit(signal ? 1 : (code ?? 1));
    });
  });
}

export async function runUiTests({
  args = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
} = {}) {
  let localnet;
  let playwright;
  let interrupted = false;
  let exitCode = 1;

  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    playwright?.kill("SIGTERM");
    localnet?.kill("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    const plan = resolveUiTestPlan(env);
    if (plan.managesLocalnet) {
      // A managed run deliberately starts clean; caller-managed runs below are
      // never stopped or restarted by this process.
      stopLocalnet(spawnSyncImpl);
      localnet = spawnImpl(process.execPath, [LOCALNET_SCRIPT], {
        cwd: ROOT,
        env,
        stdio: "inherit",
      });
    } else {
      console.log(`Using caller-managed APP20 localnet at ${plan.baseUrl}.`);
    }

    await waitForLocalnet({
      configUrl: plan.configUrl,
      processHandle: localnet,
      fetchImpl,
      isInterrupted: () => interrupted,
    });
    playwright = spawnImpl(
      process.execPath,
      [PLAYWRIGHT_CLI, "test", ...args],
      {
        cwd: ROOT,
        env: { ...env, APP20_TEST_BASE_URL: plan.baseUrl },
        stdio: "inherit",
      },
    );
    exitCode = await waitForChild(playwright);
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (localnet) {
      const forced = await stopSpawnedLocalnet(localnet);
      if (forced) {
        console.error(
          "APP20 localnet did not stop gracefully; forcing runtime cleanup.",
        );
        try {
          stopLocalnet(spawnSyncImpl);
        } catch (error) {
          console.error(error instanceof Error ? error.stack : String(error));
          exitCode = 1;
        }
      }
    }
  }

  return exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runUiTests();
}
