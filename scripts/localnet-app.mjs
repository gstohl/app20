#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Node 24 strips types natively, so the solver shares one canonical-quote
// implementation with the app instead of keeping a drift-prone copy here.
import {
  LOCALNET_SECONDARY_SOLVER_ID,
  PRIVATE_RFQ_DOMAIN,
  LOCALNET_SECONDARY_SOLVER_KEY_ID,
  LOCALNET_SOLVER_ID,
  LOCALNET_SOLVER_KEY_ID,
  digestPrivateRfq,
  digestPrivateSwapIntent,
} from "../packages/private-intents/src/index.ts";
import { localnetEconomicReview } from "../src/app/rfq/rfq-operations.ts";
import { createLocalnetReservationCoordinator } from "./localnet-reservation-coordinator.mjs";
import {
  RFQ_MAX_QUOTE_TTL_SECONDS,
  createLocalnetRfqEconomics,
  deriveLocalnetReferenceBuyAmount,
  formatRfqEconomicRefusal,
  localnetPairTokenIds,
  reservedBuyAmountFromGross,
} from "./localnet-rfq-economics.mjs";
import { createLocalnetChainAuthority } from "./localnet-chain-authority.mjs";
import { createLocalnetAuthorityReconciliationPipeline } from "./localnet-authority-reconciliation.mjs";
import { LOCALNET_ESCROW_EVENT_ABI_DIGEST } from "./localnet-chain-decoder.mjs";
import {
  createLocalnetJsonRpc,
  createLocalnetRpcReader,
} from "./localnet-chain-reader.mjs";
import {
  bindExpiryHttpTargetThroughCoordinator,
  terminalizeHttpTargetThroughCoordinator,
} from "./localnet-release-boundary.mjs";
import { createLocalnetRfqStateHandlers } from "./localnet-rfq-state-handlers.mjs";
import { requestLocalnetMaker } from "./localnet-maker-http.mjs";
import { validateLocalnetDealObservation } from "./localnet-deal-validator.mjs";
import { listBrowserSafeUnresolvedLocalnetDeals } from "./localnet-unresolved-deals.mjs";
import {
  createLocalnetPrivateBalanceFixture,
  formatLocalnetPrivateBalanceSummary,
} from "./localnet-user-fixture.mjs";
import { runLocalnetSolve } from "./localnet-solve-handler.mjs";
import { runLocalnetEnsureTicketRoute } from "./localnet-ticket-handler.mjs";
import { selectQuoteThroughCoordinator } from "./localnet-selection-handler.mjs";
import {
  createLocalnetExpiryHandler,
  resolveExactLocalnetReservationOwner,
} from "./localnet-expiry-handler.mjs";
import {
  acquireLocalnetRuntimeLock,
  initializeLocalnetRuntime,
  releaseLocalnetRuntimeLock,
  rotateLocalnetDeploymentEpoch,
} from "./localnet-runtime-state.mjs";
import {
  assertLocalnetMutationGuards,
  assertLocalnetRuntimeEpoch,
  LocalnetMutationGuardError,
} from "./localnet-control-auth.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = join(ROOT, ".app20-localnet");
const RESET_RUNTIME = process.argv.includes("--reset-runtime");
const STATE_FILE = join(RUNTIME_DIR, "state.json");
const LOCK_FILE = join(RUNTIME_DIR, "start.lock");
const RFQ_ACCOUNTING_JOURNAL = join(RUNTIME_DIR, "rfq-accounting.json");
const GENERATED_ENV_FILE = join(ROOT, ".env.localnet.local");
let RUNTIME_LAYOUT;
let RUNTIME_EPOCH;
let runtimeLockOwner;
const API_HOST = "127.0.0.1";
const API_PORT = Number(process.env.APP20_LOCALNET_API_PORT ?? 5051);
const VITE_PORT = Number(process.env.APP20_LOCALNET_VITE_PORT ?? 5173);
const APP_URL = `http://127.0.0.1:${VITE_PORT}`;
const BACKEND_TARGET = `http://${API_HOST}:${API_PORT}`;
const WALLET_PROXY_PATH = "/__app20_localnet_wallet";
const RPC_PROXY_PATH = "/__app20_localnet_rpc";
const LOCALNET_CHAIN_ID = "0x51554945544c494e455f4c4f43414c";
const MAX_REQUEST_BYTES = 1_000_000;
const LOCALNET_QUOTE_RESERVATION_SECONDS = RFQ_MAX_QUOTE_TTL_SECONDS;
const RFQ_OPERATIONS_STATUS_SCHEMA = "app20/rfq-operations-status/v1";
const RFQ_OPERATIONS_STATUS_MAX_AGE_SECONDS = 30;
const RFQ_OPERATIONS_STARTED_AT = Math.floor(Date.now() / 1_000);
const RFQ_MAKER_KEY_VALID_UNTIL = RFQ_OPERATIONS_STARTED_AT + 24 * 60 * 60;
const RFQ_OPERATIONS_MODE = process.env.APP20_LOCALNET_RFQ_MODE ?? "running";
if (!["running", "paused", "drain-only"].includes(RFQ_OPERATIONS_MODE)) {
  fail("APP20_LOCALNET_RFQ_MODE must be running, paused, or drain-only.");
}
const RFQ_OPERATIONS_CONTROL = Object.freeze({
  mode: RFQ_OPERATIONS_MODE,
  reason:
    RFQ_OPERATIONS_MODE === "running"
      ? "Named localnet fixture operations are running."
      : `Named localnet fixture operations are ${RFQ_OPERATIONS_MODE}; recovery remains enabled.`,
  updatedAt: RFQ_OPERATIONS_STARTED_AT,
  claimsAndRefundsEnabled: true,
});
let MAKER_RUNTIME_DIR;
let RESERVATION_COORDINATOR_JOURNAL;
const MAKER_NODE_SCRIPT = join(ROOT, "scripts", "localnet-maker-node.mjs");
const MAKER_NODE_PORT_A = Number(
  process.env.APP20_LOCALNET_MAKER_A_PORT ?? 5052,
);
const MAKER_NODE_PORT_B = Number(
  process.env.APP20_LOCALNET_MAKER_B_PORT ?? 5053,
);

function fail(message) {
  throw new Error(`APP20 localnet: ${message}`);
}

function isLocalnetMakerDecline(error) {
  return /inventory|no output|below the intent floor|cannot cover/i.test(
    String(error),
  );
}

function isLocalnetEconomicPolicyRefusal(error) {
  return /RFQ economic policy/i.test(String(error));
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isRuntimeLockRecord(value) {
  return Boolean(
    value &&
      value.schema === "app20/localnet-runtime-lock/v1" &&
      Number.isSafeInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.token === "string" &&
      /^[0-9a-f]{64}$/.test(value.token) &&
      typeof value.startedAt === "string" &&
      value.startedAt,
  );
}

function persistReplacementMakerPid(makerId, pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const state = readJsonFile(STATE_FILE);
  if (!state || !Array.isArray(state.makers)) return;
  let updated = false;
  const makers = state.makers.map((maker) => {
    if (maker?.makerId !== makerId) return maker;
    updated = true;
    return { ...maker, pid };
  });
  if (!updated) return;
  writeFileSync(
    STATE_FILE,
    `${JSON.stringify({ ...state, makers }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function removeStaleRuntimeFiles({ statePresent, lockPresent }) {
  if (!statePresent && !lockPresent) return;

  // Keep whichever ownership marker exists until the final unlink so a new
  // startup cannot acquire the runtime while stale cleanup is still deleting
  // files that belong to the previous process.
  rmSync(GENERATED_ENV_FILE, { force: true });
  if (lockPresent) {
    rmSync(STATE_FILE, { force: true });
    rmSync(LOCK_FILE, { force: true });
  } else {
    rmSync(STATE_FILE, { force: true });
  }
}

function releaseOwnedRuntimeFiles() {
  rmSync(STATE_FILE, { force: true });
  rmSync(GENERATED_ENV_FILE, { force: true });
  if (runtimeLockOwner) {
    releaseLocalnetRuntimeLock(LOCK_FILE, runtimeLockOwner);
    runtimeLockOwner = undefined;
  }
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return !isProcessAlive(pid);
}

async function stopExisting() {
  // Snapshot marker existence before reading ownership. If neither marker was
  // present, cleanup must not delete a lock acquired by a concurrent startup.
  const statePresent = existsSync(STATE_FILE);
  const lockPresent = existsSync(LOCK_FILE);
  const state = statePresent ? readJsonFile(STATE_FILE) : null;
  const lock = lockPresent ? readJsonFile(LOCK_FILE) : null;
  if (lockPresent && !isRuntimeLockRecord(lock)) {
    fail(
      "runtime lock is malformed or still being written; refusing to delete unknown ownership.",
    );
  }
  const statePid = Number(state?.pid ?? 0);
  const lockPid = Number(lock?.pid ?? 0);
  const livePids = [...new Set([statePid, lockPid])].filter(isProcessAlive);

  if (livePids.length > 1) {
    fail(
      `runtime ownership is inconsistent across live pids ${livePids.join(", ")}; inspect them before stopping either process.`,
    );
  }
  if (livePids.length === 0) {
    removeStaleRuntimeFiles({ statePresent, lockPresent });
    console.log("APP20 localnet is already stopped.");
    return;
  }

  const [pid] = livePids;
  console.log(`Stopping APP20 localnet (pid ${pid})…`);
  process.kill(pid, "SIGTERM");
  if (!(await waitForExit(pid, 20_000))) {
    fail(
      `process ${pid} did not stop within 20 seconds; inspect it before sending SIGKILL.`,
    );
  }

  // The owner removes its own state and token-bound lock. Do not perform a
  // second blind unlink here: a new startup may legitimately acquire the lock
  // immediately after the old process exits.
  console.log("APP20 localnet stopped.");
}

if (process.argv.includes("--stop")) {
  await stopExisting();
  process.exit(0);
}

if (
  !RESET_RUNTIME &&
  (!Number.isInteger(API_PORT) || API_PORT <= 0 || API_PORT > 65_535)
) {
  fail("APP20_LOCALNET_API_PORT must be a valid TCP port.");
}
if (
  !RESET_RUNTIME &&
  (!Number.isInteger(VITE_PORT) || VITE_PORT <= 0 || VITE_PORT > 65_535)
) {
  fail("APP20_LOCALNET_VITE_PORT must be a valid TCP port.");
}

const priorState = readJsonFile(STATE_FILE);
const priorLock = readJsonFile(LOCK_FILE);
const priorStatePid = Number(priorState?.pid ?? 0);
const priorLockPid = Number(priorLock?.pid ?? 0);
if (
  isProcessAlive(priorStatePid) &&
  isProcessAlive(priorLockPid) &&
  priorStatePid !== priorLockPid
) {
  fail(
    `runtime state pid ${priorStatePid} conflicts with lock owner ${priorLockPid}; inspect both processes before cleanup.`,
  );
}
if (existsSync(STATE_FILE)) {
  if (isProcessAlive(priorStatePid)) {
    if (RESET_RUNTIME) {
      fail("cannot reset localnet runtime while its owner is still running.");
    }
    try {
      const response = await fetch(`${BACKEND_TARGET}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      const healthy = response.ok;
      await response.body?.cancel();
      if (healthy) {
        console.log(
          `APP20 localnet is already running at ${priorState.appUrl ?? APP_URL}.`,
        );
        process.exit(0);
      }
    } catch {
      // Fall through to the explicit error below.
    }
    fail(
      `pid ${priorStatePid} is alive but its health endpoint is unavailable; run npm run localnet:stop before retrying.`,
    );
  }
  fail(
    "stale or malformed localnet runtime state requires npm run localnet:stop before startup.",
  );
}
if (existsSync(LOCK_FILE)) {
  fail(
    isProcessAlive(priorLockPid)
      ? `another localnet process owns the runtime as pid ${priorLockPid}.`
      : "a stale or malformed localnet runtime lock requires npm run localnet:stop before startup.",
  );
}

mkdirSync(RUNTIME_DIR, { recursive: true });
runtimeLockOwner = acquireLocalnetRuntimeLock(LOCK_FILE);
process.once("exit", () => {
  if (!runtimeLockOwner) return;
  try {
    releaseLocalnetRuntimeLock(LOCK_FILE, runtimeLockOwner);
    runtimeLockOwner = undefined;
  } catch {
    // Exit cannot recover from substituted ownership; preserve it fail-closed.
  }
});
rmSync(GENERATED_ENV_FILE, { force: true });

if (RESET_RUNTIME) {
  try {
    RUNTIME_LAYOUT = initializeLocalnetRuntime(RUNTIME_DIR, {
      destructiveReset: true,
      confirmation: process.argv.includes("--confirm-delete-localnet-runtime")
        ? "DELETE-LOCALNET-RUNTIME"
        : undefined,
    });
    RUNTIME_EPOCH = RUNTIME_LAYOUT.epoch;
    rmSync(RFQ_ACCOUNTING_JOURNAL, { force: true });
  } finally {
    releaseLocalnetRuntimeLock(LOCK_FILE, runtimeLockOwner);
    runtimeLockOwner = undefined;
  }
  console.log(`APP20 localnet runtime reset created epoch ${RUNTIME_EPOCH}.`);
  process.exit(0);
}

RUNTIME_LAYOUT = initializeLocalnetRuntime(RUNTIME_DIR);
RUNTIME_EPOCH = RUNTIME_LAYOUT.epoch;
MAKER_RUNTIME_DIR = RUNTIME_LAYOUT.makerRuntimeDir;
RESERVATION_COORDINATOR_JOURNAL = RUNTIME_LAYOUT.coordinatorJournal;
mkdirSync(MAKER_RUNTIME_DIR, { recursive: true, mode: 0o700 });

let currentStage = "prerequisite check";
let devnet;
let apiServer;
let viteProcess;
const makerProcesses = new Map();
const makerRestartTimers = new Map();
let shuttingDown = false;
let operationTail = Promise.resolve();
const operationLog = [];

function recordOperation(entry) {
  operationLog.unshift({ at: new Date().toISOString(), ...entry });
  operationLog.splice(20);
}

function serializeOperation(label, identity, operation) {
  const startedAt = Date.now();
  const run = operationTail.then(async () => {
    console.log(`\n==> wallet ${identity}: ${label}`);
    try {
      const result = await operation();
      recordOperation({
        identity,
        label,
        status: "ok",
        durationMs: Date.now() - startedAt,
        transactionHash: result?.transaction_hash,
      });
      return result;
    } catch (error) {
      recordOperation({
        identity,
        label,
        status: "error",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  operationTail = run.catch(() => {});
  return run;
}

const MAKER_DEFINITIONS = Object.freeze([
  {
    solverId: LOCALNET_SOLVER_ID,
    solverKey: LOCALNET_SOLVER_KEY_ID,
    spreadBps: 30,
    port: MAKER_NODE_PORT_A,
    accountIndex: 2,
    extraAccountIndex: 0,
    quoteKeyPath: join(
      ROOT,
      "scripts",
      "fixtures",
      "localnet-maker-a.private.json",
    ),
  },
  {
    solverId: LOCALNET_SECONDARY_SOLVER_ID,
    solverKey: LOCALNET_SECONDARY_SOLVER_KEY_ID,
    spreadBps: 20,
    port: MAKER_NODE_PORT_B,
    accountIndex: 3,
    extraAccountIndex: 1,
    quoteKeyPath: join(
      ROOT,
      "scripts",
      "fixtures",
      "localnet-maker-b.private.json",
    ),
  },
]);
let makerClients = [];
let makerRestartContext = null;

function assertMakerPorts() {
  const ports = MAKER_DEFINITIONS.map((definition) => definition.port);
  if (
    ports.some(
      (port) => !Number.isSafeInteger(port) || port <= 0 || port > 65_535,
    ) ||
    new Set(ports).size !== ports.length ||
    ports.includes(API_PORT) ||
    ports.includes(VITE_PORT)
  ) {
    fail(
      "maker-node ports must be distinct valid ports outside the API/Vite ports.",
    );
  }
}

function childIsRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function waitForChildExit(child, timeoutMs) {
  if (!childIsRunning(child)) return true;
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolveExit(!childIsRunning(child));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once("exit", onExit);
  });
}

async function terminateChild(child, label, timeoutMs = 5_000) {
  if (!childIsRunning(child)) return;
  child.kill("SIGTERM");
  if (await waitForChildExit(child, timeoutMs)) return;
  child.kill("SIGKILL");
  if (!(await waitForChildExit(child, 2_000))) {
    throw new Error(`${label} did not exit after SIGKILL.`);
  }
}

async function waitForMakerHealth(client, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!childIsRunning(child)) {
      fail(`${client.solverId} stopped before becoming healthy.`);
    }
    try {
      const response = await fetch(`${client.endpoint}/health`, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(1_000, deadline - Date.now())),
        ),
      });
      const healthy = response.ok;
      await response.body?.cancel();
      if (healthy) return;
    } catch {
      // Keep polling until the bounded startup deadline.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  fail(`${client.solverId} did not become healthy within 60 seconds.`);
}

async function launchMakerNode(definition, context, authToken) {
  const makerDir = join(MAKER_RUNTIME_DIR, definition.solverId);
  mkdirSync(makerDir, { recursive: true, mode: 0o700 });
  const configPath = join(makerDir, "startup.private.json");
  const settlementAccount =
    context.extraAccounts[definition.extraAccountIndex]?.address;
  if (!settlementAccount) {
    fail(`${definition.solverId} has no independent devnet custody account.`);
  }
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        makerId: definition.solverId,
        solverKey: definition.solverKey,
        spreadBps: definition.spreadBps,
        reservationTtlSeconds: LOCALNET_QUOTE_RESERVATION_SECONDS,
        port: definition.port,
        authToken,
        accountIndex: definition.accountIndex,
        settlementAccount,
        passphrase: `app20-localnet-${definition.solverId}-v1`,
        rpcUrl: context.rpcUrl,
        poolAddress: context.poolAddress,
        escrowAddress: context.escrowAddress,
        strkToken: context.strkToken,
        usdcToken: context.usdcToken,
        seedStrk: (5n * 10n ** 18n).toString(),
        seedUsdc: (10_000n * 10n ** 6n).toString(),
        walPath: join(makerDir, "reservations.wal"),
        quoteKeyPath: definition.quoteKeyPath,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  const endpoint = `http://127.0.0.1:${definition.port}`;
  const client = {
    ...definition,
    authToken,
    endpoint,
    settlementAccount,
  };
  const child = spawn(process.execPath, [MAKER_NODE_SCRIPT, configPath], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  makerProcesses.set(definition.solverId, child);
  let ready = false;
  child.once("exit", (code, signal) => {
    makerProcesses.delete(definition.solverId);
    if (!ready || shuttingDown || !makerRestartContext) return;
    console.error(
      `${definition.solverId} stopped unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}); restarting from its WAL.`,
    );
    const restartTimer = setTimeout(() => {
      makerRestartTimers.delete(definition.solverId);
      if (shuttingDown || !makerRestartContext) return;
      void launchMakerNode(definition, makerRestartContext, authToken)
        .then((replacement) => {
          makerClients = makerClients.map((candidate) =>
            candidate.solverId === replacement.solverId
              ? replacement
              : candidate,
          );
          persistReplacementMakerPid(
            replacement.solverId,
            makerProcesses.get(replacement.solverId)?.pid,
          );
        })
        .catch((error) => {
          console.error(
            `${definition.solverId} restart failed: ${String(error)}`,
          );
          void shutdown(1);
        });
    }, 250);
    makerRestartTimers.set(definition.solverId, restartTimer);
  });
  await waitForMakerHealth(client, child);
  ready = true;
  return client;
}

async function startMakerNodes(context) {
  assertMakerPorts();
  makerRestartContext = context;
  makerClients = await Promise.all(
    MAKER_DEFINITIONS.map((definition) =>
      launchMakerNode(definition, context, randomBytes(32).toString("hex")),
    ),
  );
  return makerClients;
}

async function stopMakerNodes() {
  makerRestartContext = null;
  for (const timer of makerRestartTimers.values()) clearTimeout(timer);
  makerRestartTimers.clear();
  const children = [...makerProcesses.entries()];
  const outcomes = await Promise.allSettled(
    children.map(([makerId, child]) =>
      terminateChild(child, `maker node ${makerId}`),
    ),
  );
  makerProcesses.clear();
  makerClients = [];
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure) throw failure.reason;
}

async function makerRequest(client, pathname, body) {
  return requestLocalnetMaker(client, pathname, body);
}

async function fundMakerPublicUsdc(env, token, accounts, starknet) {
  const amount = 10_000n * 10n ** 6n;
  for (const account of accounts) {
    const value = starknet.cairo.uint256(amount);
    const submitted = await env.admin.execute({
      contractAddress: token,
      entrypoint: "transfer",
      calldata: [account.address, value.low, value.high],
    });
    await waitForSuccess(
      env.node,
      submitted.transaction_hash,
      `public USDC funding for maker ${account.address}`,
    );
  }
}

async function closeHttpServer(server) {
  let closed = false;
  const close = new Promise((resolveClose) => {
    server.close(() => {
      closed = true;
      resolveClose();
    });
  });
  await Promise.race([
    close,
    new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (closed) return;
  server.closeAllConnections?.();
  await Promise.race([
    close,
    new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
  ]);
  if (!closed) throw new Error("local wallet API did not close cleanly.");
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping APP20 localnet…");

  const cleanup = async (label, operation) => {
    try {
      await operation();
    } catch (error) {
      console.error(`${label} cleanup failed: ${String(error)}`);
      exitCode = exitCode || 1;
    }
  };

  await cleanup("Vite", async () => {
    if (viteProcess?.pid) await terminateChild(viteProcess, "Vite");
  });
  await cleanup("Local wallet API", async () => {
    if (apiServer) await closeHttpServer(apiServer);
  });
  await cleanup("Maker-node", stopMakerNodes);
  await cleanup("Devnet", async () => {
    if (devnet) await devnet.cleanup();
  });
  await cleanup("Runtime ownership", async () => {
    releaseOwnedRuntimeFiles();
  });
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

function localExecutable(name) {
  const local = join(homedir(), ".local", "bin", name);
  return existsSync(local) ? local : name;
}

function runPrerequisites() {
  execFileSync(
    "bash",
    [join(ROOT, "scripts", "pool-harness-setup.sh"), "--check"],
    {
      cwd: ROOT,
      stdio: "inherit",
    },
  );

  const scarb = localExecutable("scarb");
  const version = execFileSync(scarb, ["--version"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (!/^scarb 2\.18\./m.test(version)) {
    fail(
      `App20Mail requires Scarb 2.18.x; ${scarb} reported ${version.split("\n")[0]}.`,
    );
  }
  execFileSync(scarb, ["build"], {
    cwd: join(ROOT, "cairo"),
    stdio: "inherit",
  });
}

async function importRuntime() {
  const client = await import(
    pathToFileURL(
      join(ROOT, "vendor", "starknet-privacy", "client", "dist", "index.js"),
    ).href
  );
  const sdk = await import(
    pathToFileURL(
      join(ROOT, "vendor", "starknet-privacy", "sdk", "dist", "index.js"),
    ).href
  );
  const testing = await import(
    pathToFileURL(
      join(
        ROOT,
        "vendor",
        "starknet-privacy",
        "sdk",
        "dist",
        "testing",
        "index.js",
      ),
    ).href
  );
  const starknet = await import(
    pathToFileURL(
      join(
        ROOT,
        "pool-harness",
        "node_modules",
        "starknet",
        "dist",
        "index.mjs",
      ),
    ).href
  );
  return { client, sdk, testing, starknet };
}

async function waitForSuccess(node, transactionHash, label) {
  if (!transactionHash) fail(`${label} did not return a transaction hash.`);
  const receipt = await node.waitForTransaction(transactionHash);
  if (!receipt.isSuccess()) {
    const reason =
      receipt.revert_reason ??
      receipt.execution_result?.reason ??
      JSON.stringify(receipt);
    fail(`${label} reverted: ${reason}`);
  }
  return receipt;
}

async function deployHelper(env, starknet) {
  const artifactRoot = join(ROOT, "cairo", "target", "dev");
  const sierra = starknet.json.parse(
    readFileSync(
      join(artifactRoot, "app20_mail_App20Mail.contract_class.json"),
      "utf8",
    ),
  );
  const casm = starknet.json.parse(
    readFileSync(
      join(artifactRoot, "app20_mail_App20Mail.compiled_contract_class.json"),
      "utf8",
    ),
  );

  const declaration = await env.admin.declare({ contract: sierra, casm });
  await waitForSuccess(
    env.node,
    declaration.transaction_hash,
    "App20Mail declaration",
  );
  const deployment = await env.admin.deployContract({
    classHash: declaration.class_hash,
    constructorCalldata: [env.privacy.address],
  });
  await waitForSuccess(
    env.node,
    deployment.transaction_hash,
    "App20Mail deployment",
  );
  const helperAddress = deployment.contract_address ?? deployment.address;
  if (!helperAddress) fail("App20Mail deployment returned no address.");
  return {
    address: helperAddress,
    declareTransactionHash: declaration.transaction_hash,
    deployTransactionHash: deployment.transaction_hash,
  };
}

async function deployLocalUsdc(env, starknet, recipient) {
  const artifactRoot = join(ROOT, "cairo", "target", "dev");
  const sierra = starknet.json.parse(
    readFileSync(
      join(artifactRoot, "app20_mail_MockErc20.contract_class.json"),
      "utf8",
    ),
  );
  const casm = starknet.json.parse(
    readFileSync(
      join(artifactRoot, "app20_mail_MockErc20.compiled_contract_class.json"),
      "utf8",
    ),
  );
  const declaration = await env.admin.declare({ contract: sierra, casm });
  await waitForSuccess(
    env.node,
    declaration.transaction_hash,
    "local USDC declaration",
  );
  const supply = starknet.cairo.uint256(100_000n * 10n ** 6n);
  const deployment = await env.admin.deployContract({
    classHash: declaration.class_hash,
    constructorCalldata: [recipient, supply.low, supply.high],
  });
  await waitForSuccess(
    env.node,
    deployment.transaction_hash,
    "local USDC deployment",
  );
  const address = deployment.contract_address ?? deployment.address;
  if (!address) fail("local USDC deployment returned no address.");
  return {
    address,
    declareTransactionHash: declaration.transaction_hash,
    deployTransactionHash: deployment.transaction_hash,
  };
}

async function deployEscrow(env, starknet) {
  const artifactRoot = join(ROOT, "cairo", "target", "dev");
  const ticketSierra = starknet.json.parse(
    readFileSync(
      join(artifactRoot, "app20_mail_ClaimTicket.contract_class.json"),
      "utf8",
    ),
  );
  const ticketCasm = starknet.json.parse(
    readFileSync(
      join(artifactRoot, "app20_mail_ClaimTicket.compiled_contract_class.json"),
      "utf8",
    ),
  );
  const ticketDeclaration = await env.admin.declare({
    contract: ticketSierra,
    casm: ticketCasm,
  });
  await waitForSuccess(
    env.node,
    ticketDeclaration.transaction_hash,
    "ClaimTicket declaration",
  );

  const sierra = starknet.json.parse(
    readFileSync(
      join(artifactRoot, "app20_mail_App20Escrow.contract_class.json"),
      "utf8",
    ),
  );
  const casm = starknet.json.parse(
    readFileSync(
      join(artifactRoot, "app20_mail_App20Escrow.compiled_contract_class.json"),
      "utf8",
    ),
  );
  const declaration = await env.admin.declare({ contract: sierra, casm });
  await waitForSuccess(
    env.node,
    declaration.transaction_hash,
    "App20Escrow declaration",
  );
  const deployment = await env.admin.deployContract({
    classHash: declaration.class_hash,
    constructorCalldata: [env.privacy.address, ticketDeclaration.class_hash],
  });
  await waitForSuccess(
    env.node,
    deployment.transaction_hash,
    "App20Escrow deployment",
  );
  const address = deployment.contract_address ?? deployment.address;
  if (!address) fail("App20Escrow deployment returned no address.");
  return {
    address,
    classHash: declaration.class_hash,
    ticketClassHash: ticketDeclaration.class_hash,
    ticketDeclareTransactionHash: ticketDeclaration.transaction_hash,
    declareTransactionHash: declaration.transaction_hash,
    deployTransactionHash: deployment.transaction_hash,
  };
}

function makePrivacyRuntime(
  account,
  passphrase,
  env,
  { client, sdk, testing, starknet },
) {
  const discovery = new testing.ContractDiscoveryProvider(env.privacy);
  const proving = new testing.ScreeningCallMockProofProvider(
    env.node,
    starknet.constants.StarknetChainId.SN_SEPOLIA,
  );
  const viewingKeyProvider = client.passphraseViewingKeyProvider(
    passphrase,
    account.address,
  );
  const transfers = sdk.createPrivateTransfers({
    account,
    viewingKeyProvider,
    provingProvider: proving,
    discoveryProvider: discovery,
    poolContractAddress: env.privacy.address,
  });
  const prover = new client.CorePrivateTransfersProver({
    signer: account.signer,
    address: account.address,
    passphrase,
    node: env.node,
    discovery,
    prover: proving,
    poolContractAddress: env.privacy.address,
    shadowAccountAnonymizerAddress: "0x1",
    storage: {
      // Direct contract discovery is authoritative on every request. A fresh
      // registry also means a reverted transaction is never persisted locally.
      loadRegistry: async () => sdk.createEmptyRegistry(),
      saveRegistry: async () => {},
    },
  });

  // Wallet API transfers describe the requested outputs; the wallet owns note
  // selection and must return input-note change to the user. The pinned core
  // adapter already translates every dapp action and placeholder, but does not
  // set the SDK builder's surplus recipient. Decorate its pinned build seam so
  // the upstream compiler emits that self-change note (the same surplusTo
  // pattern used by upstream SimplePrivateTransfers.transfer/withdraw).
  const coreTransfers = prover.transfers;
  if (!coreTransfers || typeof coreTransfers.build !== "function") {
    fail("the pinned CorePrivateTransfersProver build seam changed.");
  }
  const coreBuild = coreTransfers.build.bind(coreTransfers);
  coreTransfers.build = (...args) =>
    coreBuild(...args).surplusTo(account.address, false);

  return { account, prover, transfers };
}

function toCoreCallAndProof(prepared) {
  return {
    call: {
      contractAddress: prepared.call.contract_address,
      entrypoint: prepared.call.entry_point,
      calldata: prepared.call.calldata,
    },
    proof: {
      data: prepared.proof.data,
      output: prepared.proof.output,
      proofFacts: prepared.proof.proof_facts,
    },
  };
}

function normalizeIdentity(value, identities) {
  if (value !== "alice" && value !== "bob") {
    fail("wallet request identity must be alice or bob.");
  }
  return identities[value];
}

function assertActions(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("privacy actions must be a non-empty array.");
  }
  for (const action of value) {
    if (
      !action ||
      typeof action !== "object" ||
      typeof action.type !== "string"
    ) {
      fail("each privacy action must have a type.");
    }
    if (!["deposit", "withdraw", "transfer", "invoke"].includes(action.type)) {
      fail(`unsupported localnet privacy action: ${String(action.type)}.`);
    }
    const allowed = {
      deposit: ["type", "token", "amount"],
      withdraw: ["type", "token", "amount", "recipient"],
      transfer: ["type", "token", "amount", "recipient"],
      invoke: ["type", "contract", "calldata"],
    }[action.type];
    const unexpected = Object.keys(action).filter(
      (key) => !allowed.includes(key),
    );
    if (unexpected.length) {
      fail(
        `non-standard ${action.type} action properties: ${unexpected.join(", ")}.`,
      );
    }
  }
  return value;
}

function assertCalls(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("invoke calls must be a non-empty array.");
  }
  return value.map((call) => {
    if (
      !call ||
      typeof call !== "object" ||
      typeof call.contract_address !== "string" ||
      typeof call.entry_point !== "string"
    ) {
      fail("wallet invoke call is malformed.");
    }
    return {
      contractAddress: call.contract_address,
      entrypoint: call.entry_point,
      calldata: Array.isArray(call.calldata) ? call.calldata.map(String) : [],
    };
  });
}

async function readDevnetTimestamp(rpcUrl) {
  const rpc = createLocalnetJsonRpc(rpcUrl);
  const block = await rpc("starknet_getBlockWithTxHashes", ["latest"]);
  if (!Number.isSafeInteger(block?.timestamp)) {
    fail("devnet returned an invalid latest block timestamp.");
  }
  return block.timestamp;
}

async function createDevnetBlocks(rpcUrl, count = 10) {
  const rpc = createLocalnetJsonRpc(rpcUrl);
  for (let index = 0; index < count; index += 1) {
    await rpc("devnet_createBlock", []);
  }
}

async function approveDeposits(identity, actions, env, starknet) {
  const totals = new Map();
  for (const action of actions) {
    if (action.type !== "deposit") continue;
    const token = String(action.token);
    const amount = starknet.num.toBigInt(action.amount);
    totals.set(token, (totals.get(token) ?? 0n) + amount);
  }

  for (const [token, amount] of totals) {
    const value = starknet.cairo.uint256(amount);
    const response = await identity.account.execute({
      contractAddress: token,
      entrypoint: "approve",
      calldata: [env.privacy.address, value.low, value.high],
    });
    await waitForSuccess(
      env.node,
      response.transaction_hash,
      `${identity.label} pool approval`,
    );
  }
}

async function seedEscrowPrivateBalances(fixture, env, starknet) {
  // Alice and Bob remain user/demo identities. Independent maker processes seed
  // their own USDC and STRK notes after receiving public localnet fixtures.
  // Every user fixture entry goes through the reviewed pool deposit/prove path.
  for (const { identity, token, amountBaseUnits } of fixture) {
    const actions = [
      {
        type: "deposit",
        token,
        amount: starknet.num.toHex(amountBaseUnits),
      },
    ];
    await approveDeposits(identity, actions, env, starknet);
    const prepared = await identity.prover.prove(actions);
    const receipt = await devnet.executeOutside(toCoreCallAndProof(prepared));
    if (!receipt.isSuccess()) {
      fail(`${identity.label} escrow demo balance seed reverted.`);
    }
  }
  await createDevnetBlocks(devnet.url);
}

async function privateBalances(identity, tokens, starknet) {
  if (!Array.isArray(tokens)) fail("balance tokens must be an array.");
  const requested = tokens.map((token) => starknet.num.toBigInt(String(token)));
  const discovery = await identity.transfers.discoverNotes({
    tokens: requested,
  });
  const discovered = new Map();
  for (const [token, notes] of discovery.notes.entries()) {
    const total = notes.reduce((sum, note) => sum + note.amount, 0n);
    discovered.set(starknet.num.toBigInt(token), total);
  }

  const outputTokens = requested.length ? requested : [...discovered.keys()];
  return outputTokens.map((token) => ({
    token: starknet.num.toHex(token),
    balance: starknet.num.toHex(discovered.get(token) ?? 0n),
  }));
}

function positiveBaseUnits(value, label, starknet) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    fail(`${label} must be a canonical base-unit integer string.`);
  }
  const parsed = starknet.num.toBigInt(value);
  if (parsed <= 0n || parsed >= 2n ** 128n) {
    fail(`${label} must be greater than zero and fit in u128.`);
  }
  return parsed;
}

function feltInput(value, label, starknet) {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-f]{1,63}|0[0-9a-f]{63})$/i.test(value)
  ) {
    fail(`${label} must be a non-zero Starknet felt.`);
  }
  const parsed = starknet.num.toBigInt(value);
  if (parsed <= 0n) fail(`${label} must be non-zero.`);
  return starknet.num.toHex(parsed);
}

function assertLocalIntentPair(body, env, starknet) {
  const sellToken = starknet.num.toBigInt(String(body.sellToken));
  const buyToken = starknet.num.toBigInt(String(body.buyToken));
  const strk = starknet.num.toBigInt(env.strk);
  const usdc = starknet.num.toBigInt(env.usdc);
  let direction = null;
  if (sellToken === strk && buyToken === usdc) {
    direction = "STRK_USDC";
  } else if (sellToken === usdc && buyToken === strk) {
    direction = "USDC_STRK";
  }
  if (!direction) {
    fail("the local solver supports only the private USDC↔STRK market.");
  }
  return {
    sellToken: starknet.num.toHex(sellToken),
    buyToken: starknet.num.toHex(buyToken),
    direction,
  };
}

async function executePrivacyActions(identity, actions, label, env, starknet) {
  return serializeOperation(label, identity.id, async () => {
    await approveDeposits(identity, actions, env, starknet);
    const prepared = await identity.prover.prove(actions);
    if (prepared.proof.data !== undefined && prepared.proof.data !== "") {
      fail("devnet unexpectedly returned non-mock proof bytes.");
    }
    if (prepared.proof.proof_facts.length !== 9) {
      fail(
        `devnet mock proof returned ${prepared.proof.proof_facts.length} proof facts, expected 9.`,
      );
    }
    if (
      prepared.call.calldata.some(
        (item) => typeof item === "string" && item.includes("${"),
      )
    ) {
      fail("vendored client left an unresolved wallet placeholder.");
    }
    const receipt = await devnet.executeOutside(toCoreCallAndProof(prepared));
    const transactionHash = receipt.transaction_hash;
    if (!transactionHash)
      fail("outside execution returned no transaction hash.");
    return { transaction_hash: transactionHash };
  });
}

async function readLocalEscrowDeal(dealId, env, escrowAddress) {
  const result = await env.node.callContract({
    contractAddress: escrowAddress,
    entrypoint: "get_deal",
    calldata: [dealId],
  });
  if (!Array.isArray(result) || result.length < 8) {
    fail("local escrow returned a malformed deal.");
  }
  return {
    legAToken: result[0],
    legAAmount: BigInt(result[1]),
    legBToken: result[2],
    legBTerms: BigInt(result[3]),
    legBAmount: BigInt(result[4]),
    deadline: Number(BigInt(result[5])),
    ticket: result[6],
    status: Number(BigInt(result[7])),
  };
}

async function ensureLocalEscrowTicket(dealId, env, escrowAddress, starknet) {
  const existing = await env.node.callContract({
    contractAddress: escrowAddress,
    entrypoint: "get_ticket",
    calldata: [dealId],
  });
  if (starknet.num.toBigInt(existing[0] ?? "0x0") !== 0n) return existing[0];
  const submitted = await env.admin.execute({
    contractAddress: escrowAddress,
    entrypoint: "ensure_ticket",
    calldata: [dealId],
  });
  await waitForSuccess(
    env.node,
    submitted.transaction_hash,
    "claim ticket deployment",
  );
  const result = await env.node.callContract({
    contractAddress: escrowAddress,
    entrypoint: "get_ticket",
    calldata: [dealId],
  });
  const ticketAddress = result[0];
  if (!ticketAddress || starknet.num.toBigInt(ticketAddress) === 0n) {
    fail("claim ticket deployment returned no address.");
  }
  return ticketAddress;
}

function jsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) fail("wallet request body exceeded 1 MB.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("wallet request body is not valid JSON.");
  }
}

function canonicalHex32(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) {
    fail(`${label} must be a canonical 32-byte hex value.`);
  }
  return value.toLowerCase();
}

async function startApi({
  config,
  identities,
  env,
  helperAddress: _helperAddress,
  escrowAddress,
  escrowClassHash,
  starknet,
  makerClients,
  controlToken,
}) {
  const reservationOwners = new Map();
  const makerById = new Map(
    makerClients.map((client) => [client.solverId, client]),
  );
  const coordinator = createLocalnetReservationCoordinator(
    RESERVATION_COORDINATOR_JOURNAL,
  );
  const rfqEconomics = createLocalnetRfqEconomics({
    accountingPath: RFQ_ACCOUNTING_JOURNAL,
  });
  const authorityArtifact = Object.freeze({
    runtimeEpoch: RUNTIME_EPOCH,
    chainId: LOCALNET_CHAIN_ID,
    escrowAddress: starknet.num.toHex(escrowAddress),
    escrowClassHash: starknet.num.toHex(escrowClassHash),
    abiDigest: LOCALNET_ESCROW_EVENT_ABI_DIGEST,
  });
  const authorityReaders = ["fixture-view-a", "fixture-view-b"].map((id) =>
    createLocalnetRpcReader({
      id,
      artifact: authorityArtifact,
      rpc: createLocalnetJsonRpc(devnet.url),
    }),
  );
  let authorityPipelineFailed = false;
  const chainAuthority = createLocalnetChainAuthority({
    path: join(RUNTIME_LAYOUT.epochDir, "authority", "chain-authority.json"),
    artifact: authorityArtifact,
    readers: authorityReaders,
    // Devnet has no finalized tag; latest accepted is the explicitly labelled fixture boundary.
    finalityDepth: 0,
    maxAgeSeconds: 30,
  });
  const quarantineAuthorityProjection = async (projection) => {
    if (projection.status !== "reorged") return;
    const requestRecord = coordinator.getRequestForRfq(projection.rfqId);
    if (
      !requestRecord?.selection ||
      requestRecord.account !== projection.account ||
      requestRecord.chainId !== projection.chainId
    )
      return;
    await coordinator.quarantineAuthority({
      intentDigest: requestRecord.intentDigest,
      rfqId: requestRecord.rfqId,
      account: requestRecord.account,
      chainId: requestRecord.chainId,
      dealId: requestRecord.rfqId,
      reservationId: requestRecord.selection.reservationId,
      makerId: requestRecord.selection.makerId,
      fence: requestRecord.selection.fence,
      quoteDigest: requestRecord.selection.quoteDigest,
      authorityRevision: projection.revision,
      authorityReason: "canonical-membership-lost",
    });
  };
  const releaseAttempt = async (attempt, reason) => {
    const requestRecord = coordinator.getRequest(attempt.intentDigest);
    const selected = requestRecord?.selection;
    const hasDurableDeal = coordinator.hasDealForIntent(attempt.intentDigest);
    if (
      hasDurableDeal &&
      selected?.reservationId === attempt.reservationId &&
      selected.makerId === attempt.makerId
    ) {
      return false;
    }
    const client = makerById.get(attempt.makerId);
    if (!client) return false;
    const result = await makerRequest(client, "/v1/release", {
      reservationId: attempt.reservationId,
      reason,
    });
    return result.released === true;
  };
  const authorityReconciliation = createLocalnetAuthorityReconciliationPipeline(
    {
      chainAuthority,
      coordinator,
      makerClientForId: (makerId) => makerById.get(makerId),
      requestMaker: makerRequest,
      quarantineProjection: quarantineAuthorityProjection,
      journalPath: join(
        RUNTIME_LAYOUT.epochDir,
        "authority",
        "maker-reconciliation.json",
      ),
      runtimeEpoch: RUNTIME_EPOCH,
    },
  );
  function exactOwnerForObservation(target) {
    return resolveExactLocalnetReservationOwner({
      coordinator,
      makerById,
      reservationOwners,
      target,
    });
  }

  function validateCanonicalFundedObservation(
    target,
    observed,
    expectedStatus = 1,
  ) {
    const owner = exactOwnerForObservation(target);
    if (
      !owner?.sellToken ||
      !owner.buyToken ||
      owner.sellAmount === undefined ||
      owner.buyAmount === undefined ||
      owner.deadline === undefined
    )
      fail("the durable maker reservation lacks canonical settlement terms.");
    if (
      target.sellToken !== undefined &&
      (starknet.num.toBigInt(target.sellToken) !==
        starknet.num.toBigInt(owner.sellToken) ||
        target.sellAmount !== owner.sellAmount ||
        starknet.num.toBigInt(target.buyToken) !==
          starknet.num.toBigInt(owner.buyToken) ||
        target.buyAmount !== owner.buyAmount ||
        target.deadline !== owner.deadline ||
        (target.ticketAddress !== undefined &&
          owner.ticketAddress !== undefined &&
          starknet.num.toBigInt(target.ticketAddress) !==
            starknet.num.toBigInt(owner.ticketAddress)))
    )
      fail(
        "client settlement terms do not match the durable maker reservation.",
      );
    validateLocalnetDealObservation(
      observed,
      {
        sellToken: owner.sellToken,
        sellAmount: owner.sellAmount,
        buyToken: owner.buyToken,
        buyAmount: owner.buyAmount,
        deadline: owner.deadline,
        ticketAddress:
          owner.ticketAddress ?? target.ticketAddress ?? observed.ticket,
      },
      expectedStatus,
      starknet.num.toBigInt,
    );
  }

  const expiryHandler = createLocalnetExpiryHandler({
    coordinator,
    makerById,
    reservationOwners,
    observeEscrow: (dealId) => readLocalEscrowDeal(dealId, env, escrowAddress),
    validateFundedObservation: validateCanonicalFundedObservation,
    readTime: () => readDevnetTimestamp(devnet.url),
    advanceTime: async (timestamp) => {
      const rpc = createLocalnetJsonRpc(devnet.url);
      await rpc("devnet_setTime", { time: timestamp });
      await createDevnetBlocks(devnet.url, 1);
    },
    now: () => Math.floor(Date.now() / 1_000),
  });

  const rfqStateHandlers = createLocalnetRfqStateHandlers({
    coordinator,
    observeEscrow: (dealId) => readLocalEscrowDeal(dealId, env, escrowAddress),
    release: releaseAttempt,
    now: () => Math.floor(Date.now() / 1_000),
    validateFundedObservation: validateCanonicalFundedObservation,
  });
  const pendingAfterRecovery = await coordinator.recover(
    releaseAttempt,
    Math.floor(Date.now() / 1_000),
  );
  if (pendingAfterRecovery.length) {
    console.warn(
      `Localnet reservation coordinator recovered with ${pendingAfterRecovery.length} unresolved release(s); affected RFQs remain quarantined.`,
    );
  }
  for (const attempt of coordinator.list()) {
    if (attempt.state === "released" || attempt.state === "expired") continue;
    const client = makerById.get(attempt.makerId);
    if (!client) continue;
    const request = coordinator.getRequest(attempt.intentDigest);
    const durableTerms =
      request?.ticketAuthorization?.settlementTerms ??
      request?.settlementTerms ??
      request?.ticketSettlementTerms;
    const durableTicket =
      request?.ticketAuthorization?.ticketAddress ??
      request?.settlementTerms?.ticketAddress;
    reservationOwners.set(attempt.reservationId, {
      client,
      intentDigest: attempt.intentDigest,
      selected: attempt.state === "selected",
      fence: attempt.fence,
      quoteDigest: attempt.quoteDigest,
      expiresAt: attempt.expiresAt,
      ...(durableTerms
        ? {
            sellToken: durableTerms.sellToken,
            sellAmount: BigInt(durableTerms.sellAmount),
            buyToken: durableTerms.buyToken,
            buyAmount: BigInt(durableTerms.buyAmount),
            deadline: durableTerms.deadline,
          }
        : {}),
      ...(durableTicket === undefined ? {} : { ticketAddress: durableTicket }),
    });
  }
  await authorityReconciliation.recover();
  authorityPipelineFailed = authorityReconciliation.hasUnresolvedAuthority();
  const verifyAuthorityOrFailStop = async (input) => {
    try {
      const result = await authorityReconciliation.verifyAndReconcile(input);
      // A successful projection cannot clear another binding's quarantine.
      // The gate reopens only when the complete durable authority set is clean.
      authorityPipelineFailed =
        authorityReconciliation.hasUnresolvedAuthority();
      return result.projection;
    } catch (error) {
      authorityPipelineFailed = true;
      throw error;
    }
  };

  function browserSafeMakerStatus(
    client,
    observedAt = Math.floor(Date.now() / 1_000),
  ) {
    const makerProcess = makerProcesses.get(client.solverId);
    const available = makerProcess ? childIsRunning(makerProcess) : false;
    const keyValid = observedAt < RFQ_MAKER_KEY_VALID_UNTIL;
    return {
      makerId: client.solverId,
      keyId: client.solverKey,
      keyStatus: keyValid ? "valid" : "expired",
      keyValidUntil: RFQ_MAKER_KEY_VALID_UNTIL,
      invitationStatus: available ? "not-invited" : "unavailable",
      capacityBand: available ? "medium" : "unknown",
      eligible:
        available && keyValid && RFQ_OPERATIONS_CONTROL.mode === "running",
      rationale: keyValid
        ? available
          ? RFQ_OPERATIONS_CONTROL.mode === "running"
            ? "Eligible under the named localnet fixture policy; capacity is a coarse band, not inventory proof."
            : `Excluded while local operations are ${RFQ_OPERATIONS_CONTROL.mode}; recovery remains enabled.`
          : "Excluded because this local maker process is unavailable."
        : "Excluded because the published local fixture maker key expired.",
    };
  }

  function assertRfqStartAllowed(action) {
    if (Math.floor(Date.now() / 1_000) >= RFQ_MAKER_KEY_VALID_UNTIL)
      fail(
        `${action} is blocked because the published local fixture maker keys expired; recovery remains enabled.`,
      );
    if (authorityPipelineFailed)
      fail(
        `${action} is blocked because local chain/maker reconciliation is fail-stopped; recovery remains verification-only.`,
      );
    if (RFQ_OPERATIONS_CONTROL.mode !== "running") {
      fail(
        `${action} is blocked while RFQ operations are ${RFQ_OPERATIONS_CONTROL.mode}; claims and refunds remain enabled.`,
      );
    }
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", BACKEND_TARGET);
      if (
        request.method === "GET" &&
        url.pathname === "/rfq/operations/status"
      ) {
        const observedAt = Math.floor(Date.now() / 1_000);
        const makers = makerClients.map((client) =>
          browserSafeMakerStatus(client, observedAt),
        );
        const invited = makers.filter(
          (maker) => maker.invitationStatus !== "not-invited",
        ).length;
        jsonResponse(response, 200, {
          result: {
            schema: RFQ_OPERATIONS_STATUS_SCHEMA,
            environment: "localnet",
            observedAt,
            validUntil: observedAt + RFQ_OPERATIONS_STATUS_MAX_AGE_SECONDS,
            mode: RFQ_OPERATIONS_CONTROL.mode,
            reason: RFQ_OPERATIONS_CONTROL.reason,
            claimsAndRefundsEnabled: true,
            directory: {
              epoch: 0,
              checkpoint: "local-fixture-checkpoint-v1",
              validUntil: observedAt + RFQ_OPERATIONS_STATUS_MAX_AGE_SECONDS,
            },
            cohort: {
              governed: makers.length,
              invited,
              responded: makers.filter(
                (maker) => maker.invitationStatus === "responded",
              ).length,
              refused: makers.filter(
                (maker) => maker.invitationStatus === "refused",
              ).length,
              unavailable: makers.filter(
                (maker) => maker.invitationStatus === "unavailable",
              ).length,
            },
            makers,
            rawInventoryExposed: false,
          },
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        jsonResponse(response, authorityPipelineFailed ? 503 : 200, {
          result: { ok: !authorityPipelineFailed },
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/config") {
        jsonResponse(response, 200, { result: config });
        return;
      }
      if (request.method !== "POST") {
        jsonResponse(response, 404, {
          error: "Unknown localnet wallet route.",
        });
        return;
      }
      assertLocalnetMutationGuards(request, {
        expectedOrigin: APP_URL,
        controlToken,
      });

      const body = await readRequestBody(request);
      assertLocalnetRuntimeEpoch(url.pathname, body, RUNTIME_EPOCH);
      if (url.pathname === "/rfq/unresolved-deals") {
        const account = feltInput(body.account, "account", starknet);
        const chainId = feltInput(body.chainId, "chainId", starknet);
        const sellToken = feltInput(body.sellToken, "sellToken", starknet);
        const buyToken = feltInput(body.buyToken, "buyToken", starknet);
        if (sellToken === buyToken)
          fail(
            "unresolved-deal discovery requires two different market tokens.",
          );
        const market = [sellToken.toLowerCase(), buyToken.toLowerCase()]
          .sort()
          .join("/");
        const deals = await listBrowserSafeUnresolvedLocalnetDeals({
          requests: coordinator.listRequests(),
          deals: coordinator.listDeals(),
          account,
          chainId,
          market,
          escrowAddress: starknet.num.toHex(escrowAddress),
          observeEscrow: (dealId) =>
            readLocalEscrowDeal(dealId, env, escrowAddress),
          validateObservation: (observed, terms, status) =>
            validateLocalnetDealObservation(
              observed,
              terms,
              status,
              starknet.num.toBigInt,
            ),
        });
        jsonResponse(response, 200, {
          result: {
            schema: "app20/localnet-unresolved-deals/v1",
            environment: "localnet",
            rawInventoryExposed: false,
            deals,
          },
        });
        return;
      }
      if (url.pathname === "/rfq/authority/verify") {
        const intentDigest = canonicalHex32(body.intentDigest, "intentDigest");
        const rfqId = feltInput(body.rfqId, "rfqId", starknet);
        const account = feltInput(body.account, "account", starknet);
        const chainId = feltInput(body.chainId, "chainId", starknet);
        const dealId = feltInput(body.dealId, "dealId", starknet);
        const requestRecord = coordinator.getRequest(intentDigest);
        const dealRecord = coordinator.getDeal(dealId);
        if (
          !requestRecord ||
          !dealRecord ||
          requestRecord.rfqId !== rfqId ||
          requestRecord.account !== account ||
          requestRecord.chainId !== chainId ||
          dealRecord.intentDigest !== intentDigest ||
          dealRecord.dealId !== dealId ||
          dealRecord.rfqId !== rfqId ||
          !requestRecord.selection ||
          !requestRecord.market
        )
          fail("authority query does not match the durable RFQ coordinator.");
        const terms =
          requestRecord.ticketAuthorization?.settlementTerms ??
          requestRecord.settlementTerms;
        if (!terms)
          fail("authority query has no durable exact settlement terms.");
        const observedDeal = await readLocalEscrowDeal(
          dealId,
          env,
          escrowAddress,
        );
        const outcome =
          observedDeal.status === 3
            ? "settled"
            : observedDeal.status === 4
              ? "refunded"
              : undefined;
        if (!outcome)
          fail(
            "authority query is verification-only until a terminal escrow status exists.",
          );
        const stages =
          outcome === "settled"
            ? ["fund", "fill", "claim"]
            : ["fund", "timeout"];
        const transactions = Object.fromEntries(
          stages.map((stage) => [
            stage,
            feltInput(
              body.transactions?.[stage],
              `${stage} transaction`,
              starknet,
            ),
          ]),
        );
        const commitmentDigest = `0x${createHash("sha256")
          .update(
            JSON.stringify({
              intentDigest,
              rfqId,
              dealId,
              selection: requestRecord.selection,
              terms,
            }),
          )
          .digest("hex")}`;
        const query = {
          runtimeEpoch: RUNTIME_EPOCH,
          chainId,
          account,
          rfqId,
          dealId,
          intentDigest,
          commitmentDigest,
          reservationId: requestRecord.selection.reservationId,
          reservationFence: requestRecord.selection.fence,
          quoteDigest: requestRecord.selection.quoteDigest,
          makerId: requestRecord.selection.makerId,
          sellToken: terms.sellToken,
          sellAmount: terms.sellAmount,
          buyToken: terms.buyToken,
          buyAmount: terms.buyAmount,
          deadline: terms.deadline,
          ticketAddress: terms.ticketAddress,
          outcome,
          transactions,
        };
        const projection = await verifyAuthorityOrFailStop({
          query,
          market: requestRecord.market,
        });
        jsonResponse(response, 200, { result: projection });
        return;
      }
      if (url.pathname === "/escrow/ensure-mail-ticket") {
        const dealId = feltInput(body.dealId, "dealId", starknet);
        const ticketAddress = await serializeOperation(
          "ensure mail claim ticket",
          "localnet-admin",
          () => ensureLocalEscrowTicket(dealId, env, escrowAddress, starknet),
        );
        jsonResponse(response, 200, { result: { ticketAddress } });
        return;
      }
      if (url.pathname === "/escrow/ensure-ticket") {
        if (body.operation !== "funding-ticket")
          fail(
            "RFQ ticket deployment requires an exact funding-ticket target.",
          );
        if (
          typeof body.attemptId !== "string" ||
          !body.attemptId.trim() ||
          body.attemptId.includes("\0")
        )
          fail("attemptId is required for exact funding-ticket replay.");
        const { sellToken, buyToken } = assertLocalIntentPair(
          body,
          env,
          starknet,
        );
        const sellAmount = positiveBaseUnits(
          body.sellAmount,
          "sellAmount",
          starknet,
        );
        const buyAmount = positiveBaseUnits(
          body.buyAmount,
          "buyAmount",
          starknet,
        );
        const intentDigest = canonicalHex32(
          body.requestDigest,
          "requestDigest",
        );
        const reservationId = canonicalHex32(
          body.reservationId,
          "reservationId",
        );
        const dealId = feltInput(body.dealId, "dealId", starknet);
        const exact = {
          intentDigest,
          rfqId: feltInput(body.rfqId, "rfqId", starknet),
          account: feltInput(body.account, "account", starknet),
          chainId: feltInput(body.chainId, "chainId", starknet),
          dealId,
          reservationId,
          makerId: body.solverId,
          fence: body.reservationFence,
          quoteDigest: canonicalHex32(body.quoteDigest, "quoteDigest"),
          attemptId: body.attemptId,
        };
        if (!Number.isSafeInteger(body.deadline) || body.deadline <= 0)
          fail("deadline must be a positive timestamp.");
        const result = await runLocalnetEnsureTicketRoute({
          coordinator,
          target: exact,
          settlementTerms: {
            sellToken: starknet.num.toHex(sellToken),
            sellAmount: sellAmount.toString(),
            buyToken: starknet.num.toHex(buyToken),
            buyAmount: buyAmount.toString(),
            deadline: body.deadline,
          },
          resolveOwner: exactOwnerForObservation,
          validateOwner: (owner) => {
            if (
              !owner?.selected ||
              owner.intentDigest !== intentDigest ||
              owner.client.solverId !== body.solverId ||
              String(owner.fence) !== String(body.reservationFence) ||
              owner.quoteDigest !== exact.quoteDigest ||
              starknet.num.toBigInt(owner.sellToken) !==
                starknet.num.toBigInt(sellToken) ||
              owner.sellAmount !== sellAmount ||
              starknet.num.toBigInt(owner.buyToken) !==
                starknet.num.toBigInt(buyToken) ||
              owner.buyAmount !== buyAmount ||
              owner.deadline !== body.deadline
            )
              fail(
                "coordinator selection does not authorize the exact funding ticket target.",
              );
          },
          ensureTicket: (exactDealId) =>
            serializeOperation(
              "ensure claim ticket",
              "localnet-admin",
              async () =>
                starknet.num.toHex(
                  await ensureLocalEscrowTicket(
                    exactDealId,
                    env,
                    escrowAddress,
                    starknet,
                  ),
                ),
            ),
        });
        const makerClient = makerById.get(exact.makerId);
        if (!makerClient)
          fail("selected maker is unavailable for durable settlement binding.");
        await makerRequest(makerClient, "/v1/reconciliation/bind", {
          target: {
            reservationId: exact.reservationId,
            intentDigest: exact.intentDigest,
            fence: exact.fence,
            quoteDigest: exact.quoteDigest,
            dealId: exact.dealId,
            sellToken: starknet.num.toHex(sellToken),
            sellAmount: sellAmount.toString(),
            buyToken: starknet.num.toHex(buyToken),
            buyAmount: buyAmount.toString(),
            deadline: body.deadline,
            ticketAddress: result.ticketAddress,
          },
        });
        jsonResponse(response, 200, { result });
        return;
      }
      if (url.pathname === "/escrow/deal") {
        const dealId = feltInput(body.dealId, "dealId", starknet);
        const deal = await readLocalEscrowDeal(dealId, env, escrowAddress);
        jsonResponse(response, 200, {
          result: {
            ...deal,
            legAAmount: deal.legAAmount.toString(),
            legBTerms: deal.legBTerms.toString(),
            legBAmount: deal.legBAmount.toString(),
          },
        });
        return;
      }
      if (url.pathname === "/private-intents/quotes") {
        assertRfqStartAllowed("New RFQ requests");
        const now = Math.floor(Date.now() / 1_000);
        const intentDigest = canonicalHex32(body.intentDigest, "intentDigest");
        const rfqId = feltInput(body.rfqId, "rfqId", starknet);
        if (body.rfqId !== rfqId)
          fail("rfqId must be a canonical lowercase Starknet felt.");
        const account = feltInput(body.account, "account", starknet);
        const chainId = feltInput(body.chainId, "chainId", starknet);
        if (
          !Number.isSafeInteger(body.createdAt) ||
          body.createdAt > now + 30 ||
          body.createdAt < now - 5 * 60
        ) {
          fail(
            "the private RFQ creation time is missing or outside clock skew.",
          );
        }
        if (!Number.isSafeInteger(body.expiresAt) || body.expiresAt <= now) {
          fail("the private RFQ expiry is missing or already elapsed.");
        }
        const plannedCohort = body.cohort;
        const plannedMakers = makerClients.map(({ solverId, solverKey }) => ({
          makerId: solverId,
          keyId: solverKey,
        }));
        const expectedBinding = [
          RFQ_OPERATIONS_STATUS_SCHEMA,
          0,
          "local-fixture-checkpoint-v1",
          plannedCohort?.validUntil,
          ...plannedMakers.flatMap(({ makerId, keyId }) => [makerId, keyId]),
        ].join("|");
        if (
          !plannedCohort ||
          plannedCohort.epoch !== 0 ||
          plannedCohort.checkpoint !== "local-fixture-checkpoint-v1" ||
          !Number.isSafeInteger(plannedCohort.validUntil) ||
          plannedCohort.validUntil <= now ||
          plannedCohort.validUntil >
            now + RFQ_OPERATIONS_STATUS_MAX_AGE_SECONDS ||
          JSON.stringify(plannedCohort.makers) !==
            JSON.stringify(plannedMakers) ||
          plannedCohort.binding !== expectedBinding
        ) {
          fail(
            "the confirmed planned maker cohort is stale or does not match the actual invitation recipients.",
          );
        }
        const { sellToken, buyToken, direction } = assertLocalIntentPair(
          body,
          env,
          starknet,
        );
        const sellAmount = positiveBaseUnits(
          body.sellAmount,
          "sellAmount",
          starknet,
        );
        const minBuyAmount = positiveBaseUnits(
          body.minBuyAmount,
          "minBuyAmount",
          starknet,
        );
        try {
          localnetEconomicReview({
            pairId: direction,
            sellAmount,
            requestedFloor: minBuyAmount,
            surface: "block",
          });
        } catch (error) {
          fail(
            error instanceof Error
              ? error.message
              : "the named localnet economic policy rejected this RFQ.",
          );
        }
        const { sellTokenId, buyTokenId } = localnetPairTokenIds(direction);
        const referenceBuyAmount = deriveLocalnetReferenceBuyAmount({
          sellTokenId,
          buyTokenId,
          sellAmountBaseUnits: sellAmount,
        });
        if (referenceBuyAmount === undefined) {
          fail(
            "RFQ economic policy refused request: REFERENCE_UNAVAILABLE. No exact localnet reference can be derived from the requested amounts.",
          );
        }
        const requestEconomics = rfqEconomics.evaluate({
          action: "request",
          decisionAt: now,
          makerId: "localnet-request",
          sellTokenId,
          buyTokenId,
          requestedSellAmountBaseUnits: sellAmount,
          offeredSellAmountBaseUnits: sellAmount,
          offeredBuyAmountBaseUnits: referenceBuyAmount,
          quoteTtlSeconds: RFQ_MAX_QUOTE_TTL_SECONDS,
          referenceObservedAt: now,
        });
        if (!requestEconomics.allowed) {
          fail(formatRfqEconomicRefusal(requestEconomics));
        }
        const recomputedIntentDigest = await digestPrivateSwapIntent({
          version: 1,
          intentId: rfqId,
          pool: "starknet:APP20_LOCALNET",
          sellToken,
          sellAmount,
          buyToken,
          minBuyAmount,
          createdAt: body.createdAt,
          expiresAt: body.expiresAt,
        });
        if (recomputedIntentDigest !== intentDigest) {
          fail("intentDigest does not match the canonical received RFQ terms.");
        }
        await coordinator.beginRequest({
          intentDigest,
          rfqId,
          account,
          chainId,
          createdAt: body.createdAt,
          expiresAt: body.expiresAt,
          makerIds: makerClients.map(({ solverId }) => solverId),
          market: [sellToken.toLowerCase(), buyToken.toLowerCase()]
            .sort()
            .join("/"),
        });
        const rfq = {
          version: 1,
          domain: PRIVATE_RFQ_DOMAIN,
          rfqId: intentDigest,
          intentDigest,
          chainId: "starknet:APP20_LOCALNET",
          registryRevision: "app20/token-registry/2026-08-25",
          directoryEpoch: 0,
          settlementHelper: escrowAddress,
          sellToken,
          sellAmountBaseUnits: sellAmount,
          buyToken,
          minBuyAmountBaseUnits: minBuyAmount,
          createdAt: body.createdAt,
          responseDeadline: Math.min(body.expiresAt, body.createdAt + 10 * 60),
          expiresAt: body.expiresAt,
        };
        const rfqDigest = await digestPrivateRfq(rfq);
        const wireRfq = {
          ...rfq,
          sellAmountBaseUnits: rfq.sellAmountBaseUnits.toString(),
          minBuyAmountBaseUnits: rfq.minBuyAmountBaseUnits.toString(),
        };
        const outcomes = await Promise.allSettled(
          makerClients.map(async (client) => {
            try {
              const result = await makerRequest(client, "/v1/reservations", {
                rfq: wireRfq,
                rfqDigest,
                intentDigest,
                expiresAt: body.expiresAt,
                sellToken,
                sellAmount: sellAmount.toString(),
                buyToken,
                minBuyAmount: minBuyAmount.toString(),
              });
              const offer = result.offer;
              const decisionAt = Math.floor(Date.now() / 1_000);
              const offeredBuyAmount = reservedBuyAmountFromGross(
                BigInt(offer.grossBuyAmount),
                offer.spreadBps,
              );
              const quoteEconomics = rfqEconomics.evaluate({
                action: "quote",
                decisionAt,
                makerId: client.solverId,
                sellTokenId,
                buyTokenId,
                requestedSellAmountBaseUnits: sellAmount,
                offeredSellAmountBaseUnits: sellAmount,
                offeredBuyAmountBaseUnits: offeredBuyAmount,
                quoteTtlSeconds: offer.reservationExpiresAt - decisionAt,
                referenceObservedAt: now,
              });
              if (!quoteEconomics.allowed) {
                try {
                  await makerRequest(client, "/v1/release", {
                    reservationId: offer.reservationId,
                    reason: formatRfqEconomicRefusal(quoteEconomics),
                  });
                } catch {
                  // Inventory remains locked until TTL; fail closed rather than retry.
                }
                throw new Error(formatRfqEconomicRefusal(quoteEconomics));
              }
              if (quoteEconomics.derivedUsdcEquivalentBaseUnits !== undefined) {
                // Persist risk accounting before coordinator registration. A
                // crash can conservatively count an unregistered quote, but
                // cannot lose a maker commitment and reopen the 24h limit.
                rfqEconomics.commit(
                  client.solverId,
                  quoteEconomics.derivedUsdcEquivalentBaseUnits,
                  decisionAt,
                  offer.reservationId,
                );
              }
              const registered = await coordinator.register(
                {
                  intentDigest,
                  reservationId: offer.reservationId,
                  makerId: client.solverId,
                  expiresAt: offer.reservationExpiresAt,
                },
                releaseAttempt,
                decisionAt,
              );
              return { ...result, registered };
            } catch (error) {
              const declined = isLocalnetMakerDecline(error);
              if (declined) {
                await coordinator.markFanoutRefused(
                  intentDigest,
                  client.solverId,
                );
              }
              throw error;
            }
          }),
        );
        const offers = [];
        const cohort = [];
        const policyRefusals = [];
        for (const [index, outcome] of outcomes.entries()) {
          const client = makerClients[index];
          if (outcome.status === "rejected") {
            const declined = isLocalnetMakerDecline(outcome.reason);
            const policyRefusal = isLocalnetEconomicPolicyRefusal(
              outcome.reason,
            );
            const refusalMessage =
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason);
            if (policyRefusal) policyRefusals.push(refusalMessage);
            console.warn(
              `Invited maker ${client.solverId} declined the browser-safe local request: ${refusalMessage}`,
            );
            cohort.push({
              makerId: client.solverId,
              keyId: client.solverKey,
              keyStatus: "valid",
              keyValidUntil: RFQ_MAKER_KEY_VALID_UNTIL,
              invitationStatus: declined ? "refused" : "unavailable",
              capacityBand: declined ? "none" : "unknown",
              eligible: false,
              rationale: policyRefusal
                ? `Excluded because the reviewed RFQ economic policy refused this quote: ${refusalMessage}`
                : declined
                  ? "Excluded because the maker refused the exact clip under its local fixture capacity policy."
                  : "Excluded because a safe maker response was unavailable for this request.",
            });
            continue;
          }
          const offer = outcome.value.offer;
          const registered = outcome.value.registered;
          if (registered.state !== "reserved") {
            continue;
          }
          reservationOwners.set(offer.reservationId, {
            client: makerClients[index],
            intentDigest,
            selected: false,
            expiresAt: offer.reservationExpiresAt,
            sellToken,
            sellAmount,
            buyToken,
            deadline: body.expiresAt,
          });
          offers.push(offer);
          cohort.push({
            makerId: client.solverId,
            keyId: client.solverKey,
            keyStatus: "valid",
            keyValidUntil: RFQ_MAKER_KEY_VALID_UNTIL,
            invitationStatus: "responded",
            capacityBand: "medium",
            eligible: true,
            rationale:
              "Eligible because the maker reserved the exact reviewed clip; the band is coarse and is not inventory proof.",
          });
        }
        await coordinator.completeRequestFanout(intentDigest);
        if (offers.length === 0 && policyRefusals.length > 0) {
          fail(policyRefusals.join(" "));
        }
        jsonResponse(response, 200, { result: { offers, cohort } });
        return;
      }
      if (url.pathname === "/private-intents/select-quote") {
        assertRfqStartAllowed("Quote selection");
        const intentDigest = canonicalHex32(body.intentDigest, "intentDigest");
        const selectedReservationId = canonicalHex32(
          body.selectedReservationId,
          "selectedReservationId",
        );
        const selected = reservationOwners.get(selectedReservationId);
        if (!selected || selected.intentDigest !== intentDigest) {
          fail(
            "the selected quote belongs to a different or missing private RFQ.",
          );
        }
        const { unresolved } = await selectQuoteThroughCoordinator({
          coordinator,
          intentDigest,
          reservationId: selectedReservationId,
          makerId: selected.client.solverId,
          makerSelect: ({ reservationId, intentDigest: digest }) =>
            makerRequest(selected.client, "/v1/select", {
              reservationId,
              intentDigest: digest,
            }),
          publishConfirmed: (durableSelection) => {
            selected.selected = true;
            selected.fence = durableSelection.fence;
            selected.quoteDigest = durableSelection.quoteDigest;
          },
          release: releaseAttempt,
          now: Math.floor(Date.now() / 1_000),
        });
        for (const attempt of coordinator.list()) {
          if (
            attempt.intentDigest === intentDigest &&
            (attempt.state === "released" || attempt.state === "expired")
          ) {
            reservationOwners.delete(attempt.reservationId);
          }
        }
        if (unresolved.length) {
          jsonResponse(response, 409, {
            error:
              "Quote selection is quarantined because a losing reservation release is unresolved.",
            state: "quarantined",
            unresolved: unresolved.map((attempt) => ({
              makerId: attempt.makerId,
              reservationId: attempt.reservationId,
            })),
          });
          return;
        }
        jsonResponse(response, 200, {
          result: {
            selectedReservationId,
            solverId: selected.client.solverId,
            reservationFence: selected.fence,
            quoteDigest: selected.quoteDigest,
          },
        });
        return;
      }
      if (url.pathname === "/private-intents/release-intent") {
        const intentDigest = canonicalHex32(
          body.requestDigest,
          "requestDigest",
        );
        const rfqId = feltInput(body.rfqId, "rfqId", starknet);
        const release = await rfqStateHandlers.releaseIntent(
          {
            requestDigest: intentDigest,
            rfqId,
            account: feltInput(body.account, "account", starknet),
            chainId: feltInput(body.chainId, "chainId", starknet),
          },
          body.releaseLeaseId,
        );
        for (const attempt of coordinator.list()) {
          if (
            attempt.intentDigest === intentDigest &&
            (attempt.state === "released" || attempt.state === "expired")
          ) {
            reservationOwners.delete(attempt.reservationId);
          }
        }
        jsonResponse(response, release.released ? 200 : 409, {
          ...(release.released
            ? { result: { released: true } }
            : {
                error: "One or more RFQ reservations remain unresolved.",
                state: "quarantined",
              }),
        });
        return;
      }
      if (
        [
          "/private-intents/funding-prepare",
          "/private-intents/funding-unknown",
          "/private-intents/funding-abandon",
          "/private-intents/funding-observe",
          "/private-intents/converge",
        ].includes(url.pathname)
      ) {
        const { sellToken, buyToken } = assertLocalIntentPair(
          body,
          env,
          starknet,
        );
        const target = {
          intentDigest: canonicalHex32(body.intentDigest, "intentDigest"),
          rfqId: feltInput(body.rfqId, "rfqId", starknet),
          account: feltInput(body.account, "account", starknet),
          chainId: feltInput(body.chainId, "chainId", starknet),
          dealId: feltInput(body.dealId, "dealId", starknet),
          reservationId: canonicalHex32(body.reservationId, "reservationId"),
          solverId: body.solverId,
          reservationFence: body.reservationFence,
          quoteDigest: canonicalHex32(body.quoteDigest, "quoteDigest"),
          sellToken,
          sellAmount: positiveBaseUnits(
            body.sellAmount,
            "sellAmount",
            starknet,
          ),
          buyToken,
          buyAmount: positiveBaseUnits(body.buyAmount, "buyAmount", starknet),
          deadline: body.deadline,
          ticketAddress: feltInput(
            body.ticketAddress,
            "ticketAddress",
            starknet,
          ),
        };
        if (!Number.isSafeInteger(target.deadline) || target.deadline <= 0)
          fail("deadline must be a positive timestamp.");
        if (url.pathname === "/private-intents/funding-prepare") {
          assertRfqStartAllowed("Wallet funding");
          await rfqStateHandlers.prepareFunding(target, body.attemptId);
        } else if (url.pathname === "/private-intents/funding-unknown") {
          await rfqStateHandlers.markFundingUnknown(target, body.attemptId);
        } else if (url.pathname === "/private-intents/funding-abandon") {
          await rfqStateHandlers.abandonFunding(target, body.attemptId);
        } else if (url.pathname === "/private-intents/converge") {
          if (![1, 2, 3, 4].includes(body.status))
            fail("status must be an exact value-bearing escrow status.");
          await rfqStateHandlers.convergeObservation(
            target,
            body.attemptId,
            body.status,
          );
        } else {
          await rfqStateHandlers.observeFunding(target, body.attemptId);
        }
        jsonResponse(response, 200, { result: { ok: true } });
        return;
      }
      if (url.pathname === "/private-intents/sign-quote") {
        assertLocalIntentPair(body, env, starknet);
        positiveBaseUnits(body.sellAmount, "sellAmount", starknet);
        positiveBaseUnits(body.buyAmount, "buyAmount", starknet);
        const reservationId = canonicalHex32(
          body.reservationId,
          "reservationId",
        );
        const owner = reservationOwners.get(reservationId);
        const maker = makerById.get(body.solverId);
        if (
          !owner ||
          !maker ||
          owner.client.solverId !== maker.solverId ||
          maker.solverKey !== body.solverKey
        ) {
          fail("the quote named an unexpected maker reservation or key.");
        }
        const result = await makerRequest(maker, "/v1/sign", body);
        owner.buyAmount = positiveBaseUnits(
          body.buyAmount,
          "buyAmount",
          starknet,
        );
        jsonResponse(response, 200, { result });
        return;
      }
      if (url.pathname === "/private-intents/solve") {
        assertRfqStartAllowed("Maker fills");
        if (
          typeof body.attemptId !== "string" ||
          !body.attemptId.trim() ||
          body.attemptId.includes("\0")
        )
          fail("attemptId is required for exact maker-fill replay.");
        const { sellToken, buyToken } = assertLocalIntentPair(
          body,
          env,
          starknet,
        );
        const sellAmount = positiveBaseUnits(
          body.sellAmount,
          "sellAmount",
          starknet,
        );
        const buyAmount = positiveBaseUnits(
          body.buyAmount,
          "buyAmount",
          starknet,
        );
        const intentDigest = canonicalHex32(body.intentDigest, "intentDigest");
        const reservationId = canonicalHex32(
          body.reservationId,
          "reservationId",
        );
        const owner = exactOwnerForObservation({
          intentDigest,
          reservationId,
        });
        if (
          !owner?.selected ||
          owner.intentDigest !== intentDigest ||
          owner.client.solverId !== body.solverId
        ) {
          fail("the selected private quote does not authorize this fill.");
        }
        const dealId = feltInput(body.dealId, "dealId", starknet);
        const target = {
          intentDigest,
          rfqId: feltInput(body.rfqId, "rfqId", starknet),
          account: feltInput(body.account, "account", starknet),
          chainId: feltInput(body.chainId, "chainId", starknet),
          dealId,
          reservationId,
          solverId: body.solverId,
          reservationFence: body.reservationFence,
          quoteDigest: canonicalHex32(body.quoteDigest, "quoteDigest"),
        };
        const deal = await readLocalEscrowDeal(dealId, env, escrowAddress);
        if (!Number.isSafeInteger(body.deadline) || body.deadline <= 0)
          fail("deadline must be a positive timestamp.");
        const ticketAddress = feltInput(
          body.ticketAddress,
          "ticketAddress",
          starknet,
        );
        const solveTarget = {
          ...target,
          sellToken,
          sellAmount,
          buyToken,
          buyAmount,
          deadline: body.deadline,
          ticketAddress,
        };
        const filled = await runLocalnetSolve({
          target: solveTarget,
          observed: deal,
          validateObservation: validateCanonicalFundedObservation,
          bind: (exact) =>
            bindExpiryHttpTargetThroughCoordinator({
              coordinator,
              target: exact,
            }),
          submitExact: () =>
            makerRequest(owner.client, "/v1/fill", {
              reservationId,
              intentDigest,
              fence: owner.fence,
              quoteDigest: owner.quoteDigest,
              dealId,
              sellToken,
              sellAmount: sellAmount.toString(),
              buyToken,
              buyAmount: buyAmount.toString(),
              deadline: body.deadline,
              ticketAddress,
              attemptId: body.attemptId,
            }),
          reconcileCommitted: (exact, observedStatus) =>
            observedStatus === 1
              ? terminalizeHttpTargetThroughCoordinator({
                  coordinator,
                  target: exact,
                  outcome: "filled",
                })
              : rfqStateHandlers.convergeObservation(
                  exact,
                  body.attemptId,
                  observedStatus,
                ),
        });
        reservationOwners.delete(reservationId);
        jsonResponse(response, 200, {
          result: {
            transaction_hash: filled.transactionHash,
            solverId: owner.client.solverId,
          },
        });
        return;
      }
      if (url.pathname === "/private-intents/expire") {
        const { sellToken, buyToken } = assertLocalIntentPair(
          body,
          env,
          starknet,
        );
        const sellAmount = positiveBaseUnits(
          body.sellAmount,
          "sellAmount",
          starknet,
        );
        const buyAmount = positiveBaseUnits(
          body.buyAmount,
          "buyAmount",
          starknet,
        );
        const intentDigest = canonicalHex32(body.intentDigest, "intentDigest");
        const reservationId = canonicalHex32(
          body.reservationId,
          "reservationId",
        );
        if (!Number.isSafeInteger(body.deadline) || body.deadline <= 0)
          fail("deadline must be a positive timestamp.");
        const target = {
          intentDigest,
          rfqId: feltInput(body.rfqId, "rfqId", starknet),
          account: feltInput(body.account, "account", starknet),
          chainId: feltInput(body.chainId, "chainId", starknet),
          dealId: feltInput(body.dealId, "dealId", starknet),
          reservationId,
          solverId: body.solverId,
          reservationFence: body.reservationFence,
          quoteDigest: canonicalHex32(body.quoteDigest, "quoteDigest"),
          sellToken,
          sellAmount,
          buyToken,
          buyAmount,
          deadline: body.deadline,
          ticketAddress: feltInput(
            body.ticketAddress,
            "ticketAddress",
            starknet,
          ),
        };
        const expiry = await expiryHandler.expire(target);
        jsonResponse(response, 200, { result: expiry });
        return;
      }

      const identity = normalizeIdentity(body.identity, identities);
      if (url.pathname === "/invoke") {
        const calls = assertCalls(body.calls);
        const result = await serializeOperation(
          "public invoke",
          identity.id,
          async () => {
            const submitted = await identity.account.execute(calls);
            await waitForSuccess(
              env.node,
              submitted.transaction_hash,
              `${identity.label} public invoke`,
            );
            return { transaction_hash: submitted.transaction_hash };
          },
        );
        jsonResponse(response, 200, { result });
        return;
      }
      if (url.pathname === "/privacy") {
        const actions = assertActions(body.actions);
        const result = await executePrivacyActions(
          identity,
          actions,
          "compile, mock-prove, and submit privacy actions",
          env,
          starknet,
        );
        jsonResponse(response, 200, { result });
        return;
      }
      if (url.pathname === "/balances") {
        const result = await serializeOperation(
          "discover private balances",
          identity.id,
          () => privateBalances(identity, body.tokens ?? [], starknet),
        );
        jsonResponse(response, 200, { result });
        return;
      }
      jsonResponse(response, 404, { error: "Unknown localnet wallet route." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Localnet wallet request failed: ${message}`);
      jsonResponse(
        response,
        error instanceof LocalnetMutationGuardError ? error.status : 400,
        { error: message },
      );
    }
  });

  let authorityRecoveryInFlight = false;
  const authorityMonitor = setInterval(() => {
    if (authorityRecoveryInFlight) return;
    authorityRecoveryInFlight = true;
    void authorityReconciliation
      .recover()
      .then(() => {
        authorityPipelineFailed =
          authorityReconciliation.hasUnresolvedAuthority();
      })
      .catch(() => {
        authorityPipelineFailed = true;
        console.warn(
          "Localnet chain/maker authority monitor fail-stopped; no operation was retried.",
        );
      })
      .finally(() => {
        authorityRecoveryInFlight = false;
      });
  }, 15_000);
  authorityMonitor.unref();
  server.once("close", () => clearInterval(authorityMonitor));

  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(API_PORT, API_HOST, () => {
      server.removeListener("error", rejectListen);
      resolveListen(server);
    });
  });
}

function writeGeneratedEnv({
  rpcTarget,
  helperAddress,
  escrowAddress,
  poolAddress,
  usdcTokenAddress,
}) {
  const contents = [
    "# Generated by npm run dev:localnet. Do not edit or commit.",
    "VITE_E2E_WALLET=true",
    `VITE_LOCALNET_WALLET_URL=${WALLET_PROXY_PATH}`,
    `VITE_LOCALNET_RPC_URL=${RPC_PROXY_PATH}`,
    `VITE_MAIL_HELPER_LOCALNET=${helperAddress}`,
    `VITE_ESCROW_HELPER_LOCALNET=${escrowAddress}`,
    `VITE_LOCALNET_POOL_ADDRESS=${poolAddress}`,
    `VITE_LOCALNET_USDC_TOKEN_ADDRESS=${usdcTokenAddress}`,
    `APP20_LOCALNET_BACKEND_TARGET=${BACKEND_TARGET}`,
    `APP20_LOCALNET_RPC_TARGET=${rpcTarget}`,
    "",
  ].join("\n");
  writeFileSync(GENERATED_ENV_FILE, contents, { mode: 0o600 });
}

async function waitForVite() {
  const deadline = Date.now() + 30_000;
  let lastError = "Vite did not answer.";
  while (Date.now() < deadline) {
    if (!viteProcess || !childIsRunning(viteProcess)) {
      fail(
        `Vite exited early with ${viteProcess?.signalCode ? `signal ${viteProcess.signalCode}` : `code ${viteProcess?.exitCode}`}.`,
      );
    }
    try {
      const response = await fetch(APP_URL, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(2_000, deadline - Date.now())),
        ),
      });
      const healthy = response.ok;
      if (!healthy) lastError = `HTTP ${response.status}`;
      await response.body?.cancel();
      if (healthy) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  fail(`Vite was not ready within 30 seconds (${lastError}).`);
}

async function verifyServedApp() {
  for (const path of ["/", "/inbox"]) {
    const response = await fetch(`${APP_URL}${path}`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.text();
    if (!response.ok || !body.includes('id="root"')) {
      fail(`${path} did not serve the Vite SPA (HTTP ${response.status}).`);
    }
  }
  const configResponse = await fetch(`${APP_URL}${WALLET_PROXY_PATH}/config`, {
    signal: AbortSignal.timeout(5_000),
  });
  const configPayload = await configResponse.json();
  if (
    !configResponse.ok ||
    configPayload?.result?.walletName !== "Localnet (dev)"
  ) {
    fail("the Vite dev-wallet proxy did not expose Localnet (dev) config.");
  }
}

try {
  console.log("\n==> checking and building pinned prerequisites");
  runPrerequisites();

  currentStage = "runtime imports";
  const runtime = await importRuntime();
  process.env.PATH = `${join(ROOT, "vendor", "bin")}:${process.env.PATH ?? ""}`;

  currentStage = "deployment epoch rotation";
  RUNTIME_LAYOUT = rotateLocalnetDeploymentEpoch(RUNTIME_DIR);
  RUNTIME_EPOCH = RUNTIME_LAYOUT.epoch;
  MAKER_RUNTIME_DIR = RUNTIME_LAYOUT.makerRuntimeDir;
  RESERVATION_COORDINATOR_JOURNAL = RUNTIME_LAYOUT.coordinatorJournal;
  console.log(
    `\n==> fresh chain deployment is isolated in runtime epoch ${RUNTIME_EPOCH}`,
  );

  currentStage = "real privacy_Privacy deployment";
  console.log("\n==> booting native devnet and deploying real privacy_Privacy");
  devnet = new runtime.testing.Devnet({ userAccounts: 4 });
  const { env } = await runtime.testing.createDevnetTestEnv(devnet);
  const poolClassHash = await env.node.getClassHashAt(env.privacy.address);

  currentStage = "APP20 helpers deployment";
  console.log(
    "\n==> deploying App20Mail and App20Escrow against the real pool",
  );
  const helper = await deployHelper(env, runtime.starknet);
  const escrow = await deployEscrow(env, runtime.starknet);

  const identities = {
    alice: {
      id: "alice",
      label: "Alice",
      ...makePrivacyRuntime(env.alice, "app20-localnet-alice-v1", env, runtime),
    },
    bob: {
      id: "bob",
      label: "Bob",
      ...makePrivacyRuntime(env.bob, "app20-localnet-bob-v1", env, runtime),
    },
  };

  currentStage = "local USDC deployment";
  console.log("\n==> deploying six-decimal local USDC inventory token");
  const usdc = await deployLocalUsdc(env, runtime.starknet, env.admin.address);
  env.usdc = usdc.address;
  if (env.extraAccounts.length !== 2) {
    fail("localnet requires exactly two independent maker custody accounts.");
  }
  await fundMakerPublicUsdc(env, env.usdc, env.extraAccounts, runtime.starknet);

  const privateBalanceFixture = createLocalnetPrivateBalanceFixture(
    identities,
    env,
  );
  currentStage = "local user balance seed";
  console.log("\n==> seeding Alice and Bob shielded local user balances");
  await seedEscrowPrivateBalances(privateBalanceFixture, env, runtime.starknet);

  currentStage = "independent maker-node startup";
  console.log("\n==> starting independent WAL-backed maker custody processes");
  const makers = await startMakerNodes({
    rpcUrl: devnet.url,
    poolAddress: env.privacy.address,
    escrowAddress: escrow.address,
    strkToken: env.strk,
    usdcToken: env.usdc,
    extraAccounts: env.extraAccounts,
  });

  const config = {
    walletName: "Localnet (dev)",
    runtimeEpoch: RUNTIME_EPOCH,
    chainId: LOCALNET_CHAIN_ID,
    rpcUrl: RPC_PROXY_PATH,
    poolAddress: env.privacy.address,
    helperAddress: helper.address,
    escrowAddress: escrow.address,
    escrowClassHash: escrow.classHash,
    tokenAddress: env.strk,
    counterTokenAddress: env.eth,
    usdcTokenAddress: env.usdc,
    marketTokens: [
      { symbol: "STRK", address: env.strk, decimals: 18 },
      { symbol: "USDC", address: env.usdc, decimals: 6 },
    ],
    marketPairs: ["STRK_USDC", "USDC_STRK"],
    proofMode: "upstream devnet mock proof · no STARK bytes",
    identities: Object.values(identities).map((identity) => ({
      id: identity.id,
      label: identity.label,
      address: identity.account.address,
    })),
  };

  currentStage = "local wallet API startup";
  const localnetControlToken = randomBytes(32).toString("base64url");
  apiServer = await startApi({
    config,
    identities,
    env,
    helperAddress: helper.address,
    escrowAddress: escrow.address,
    escrowClassHash: escrow.classHash,
    starknet: runtime.starknet,
    makerClients: makers,
    controlToken: localnetControlToken,
  });
  writeGeneratedEnv({
    rpcTarget: devnet.url,
    helperAddress: helper.address,
    escrowAddress: escrow.address,
    poolAddress: env.privacy.address,
    usdcTokenAddress: env.usdc,
  });

  currentStage = "Vite startup";
  console.log("\n==> starting Vite with the dev-only Wallet Standard wallet");
  const viteEnvironment = {
    ...process.env,
    VITE_E2E_WALLET: "true",
    VITE_LOCALNET_WALLET_URL: WALLET_PROXY_PATH,
    VITE_LOCALNET_RPC_URL: RPC_PROXY_PATH,
    VITE_MAIL_HELPER_LOCALNET: helper.address,
    VITE_ESCROW_HELPER_LOCALNET: escrow.address,
    VITE_LOCALNET_POOL_ADDRESS: env.privacy.address,
    VITE_LOCALNET_USDC_TOKEN_ADDRESS: env.usdc,
    APP20_LOCALNET_BACKEND_TARGET: BACKEND_TARGET,
    APP20_LOCALNET_RPC_TARGET: devnet.url,
    APP20_LOCALNET_CONTROL_TOKEN: localnetControlToken,
  };
  viteProcess = spawn(
    join(ROOT, "node_modules", ".bin", "vite"),
    [
      "--mode",
      "localnet",
      "--host",
      "127.0.0.1",
      "--port",
      String(VITE_PORT),
      "--strictPort",
    ],
    {
      cwd: ROOT,
      env: viteEnvironment,
      stdio: "inherit",
    },
  );
  viteProcess.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `Vite stopped unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}).`,
      );
      void shutdown(code || 1);
    }
  });
  await waitForVite();

  currentStage = "served-app verification";
  await verifyServedApp();

  const state = {
    pid: process.pid,
    runtimeEpoch: RUNTIME_EPOCH,
    startedAt: new Date().toISOString(),
    appUrl: APP_URL,
    apiUrl: BACKEND_TARGET,
    rpcUrl: devnet.url,
    poolAddress: env.privacy.address,
    poolClassHash,
    helperAddress: helper.address,
    helperDeclareTransactionHash: helper.declareTransactionHash,
    helperDeployTransactionHash: helper.deployTransactionHash,
    escrowAddress: escrow.address,
    escrowDeclareTransactionHash: escrow.declareTransactionHash,
    escrowDeployTransactionHash: escrow.deployTransactionHash,
    usdcAddress: usdc.address,
    usdcDeclareTransactionHash: usdc.declareTransactionHash,
    usdcDeployTransactionHash: usdc.deployTransactionHash,
    aliceAddress: identities.alice.account.address,
    bobAddress: identities.bob.account.address,
    makers: makers.map((maker) => ({
      makerId: maker.solverId,
      settlementAccount: maker.settlementAccount,
      pid: makerProcesses.get(maker.solverId)?.pid,
      walPath: join(MAKER_RUNTIME_DIR, maker.solverId, "reservations.wal"),
    })),
  };
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });

  console.log("\nAPP20 local demo is ready:");
  console.log(`  App:                ${APP_URL}`);
  console.log(`  Inbox:              ${APP_URL}/inbox`);
  console.log(`  privacy_Privacy:    ${env.privacy.address}`);
  console.log(`  pool class hash:    ${poolClassHash}`);
  console.log(`  App20Mail:      ${helper.address}`);
  console.log(`  App20Escrow:    ${escrow.address}`);
  console.log(`  Market token USDC:  ${env.usdc}`);
  console.log("  Private market:     USDC ↔ STRK · 1 STRK = 2 USDC fixture");
  console.log(`  Alice:              ${identities.alice.account.address}`);
  console.log(`  Bob:                ${identities.bob.account.address}`);
  for (const fixtureLine of formatLocalnetPrivateBalanceSummary(
    privateBalanceFixture,
  )) {
    console.log(fixtureLine);
  }
  for (const maker of makers) {
    console.log(
      `  ${maker.solverId}: ${maker.settlementAccount} · WAL-backed process`,
    );
  }
  console.log(
    "  Wallet discovery:   Localnet (dev) registered via Wallet Standard",
  );
  console.log(
    "  Proof mode:         upstream devnet mock (no STARK proof bytes)",
  );
  console.log("  Stop:               npm run localnet:stop");
} catch (error) {
  console.error(
    `\nAPP20 localnet failed during ${currentStage}: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  await shutdown(1);
}
