#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
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
} from "../packages/private-intents/src/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = join(ROOT, ".app20-localnet");
const STATE_FILE = join(RUNTIME_DIR, "state.json");
const LOCK_FILE = join(RUNTIME_DIR, "start.lock");
const GENERATED_ENV_FILE = join(ROOT, ".env.localnet.local");
const API_HOST = "127.0.0.1";
const API_PORT = Number(process.env.APP20_LOCALNET_API_PORT ?? 5051);
const VITE_PORT = Number(process.env.APP20_LOCALNET_VITE_PORT ?? 5173);
const APP_URL = `http://127.0.0.1:${VITE_PORT}`;
const BACKEND_TARGET = `http://${API_HOST}:${API_PORT}`;
const WALLET_PROXY_PATH = "/__app20_localnet_wallet";
const RPC_PROXY_PATH = "/__app20_localnet_rpc";
const LOCALNET_CHAIN_ID = "0x51554945544c494e455f4c4f43414c";
const MAX_REQUEST_BYTES = 1_000_000;
const LOCALNET_QUOTE_RESERVATION_SECONDS = 10 * 60;
const MAKER_RUNTIME_DIR = join(RUNTIME_DIR, "makers");
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

function removeRuntimeFiles() {
  rmSync(STATE_FILE, { force: true });
  rmSync(LOCK_FILE, { force: true });
  rmSync(GENERATED_ENV_FILE, { force: true });
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
  const state = readJsonFile(STATE_FILE);
  const lock = readJsonFile(LOCK_FILE);
  const pid = Number(state?.pid ?? lock?.pid ?? 0);

  if (!pid || !isProcessAlive(pid)) {
    removeRuntimeFiles();
    console.log("APP20 localnet is already stopped.");
    return;
  }

  console.log(`Stopping APP20 localnet (pid ${pid})…`);
  process.kill(pid, "SIGTERM");
  if (!(await waitForExit(pid, 20_000))) {
    fail(
      `process ${pid} did not stop within 20 seconds; inspect it before sending SIGKILL.`,
    );
  }
  removeRuntimeFiles();
  console.log("APP20 localnet stopped.");
}

if (process.argv.includes("--stop")) {
  await stopExisting();
  process.exit(0);
}

if (!Number.isInteger(API_PORT) || API_PORT <= 0 || API_PORT > 65_535) {
  fail("APP20_LOCALNET_API_PORT must be a valid TCP port.");
}
if (!Number.isInteger(VITE_PORT) || VITE_PORT <= 0 || VITE_PORT > 65_535) {
  fail("APP20_LOCALNET_VITE_PORT must be a valid TCP port.");
}

const priorState = readJsonFile(STATE_FILE);
if (priorState?.pid && isProcessAlive(Number(priorState.pid))) {
  try {
    const response = await fetch(`${BACKEND_TARGET}/health`);
    if (response.ok) {
      console.log(
        `APP20 localnet is already running at ${priorState.appUrl ?? APP_URL}.`,
      );
      process.exit(0);
    }
  } catch {
    // Fall through to the explicit error below.
  }
  fail(
    `pid ${priorState.pid} is alive but its health endpoint is unavailable; run npm run localnet:stop before retrying.`,
  );
}

mkdirSync(RUNTIME_DIR, { recursive: true });
rmSync(MAKER_RUNTIME_DIR, { recursive: true, force: true });
rmSync(STATE_FILE, { force: true });
rmSync(GENERATED_ENV_FILE, { force: true });
const priorLock = readJsonFile(LOCK_FILE);
if (priorLock?.pid && isProcessAlive(Number(priorLock.pid))) {
  fail(`another localnet startup is already running as pid ${priorLock.pid}.`);
}
rmSync(LOCK_FILE, { force: true });
let lockDescriptor;
try {
  lockDescriptor = openSync(LOCK_FILE, "wx");
  writeFileSync(
    lockDescriptor,
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
  );
  closeSync(lockDescriptor);
} catch (error) {
  if (lockDescriptor !== undefined) closeSync(lockDescriptor);
  rmSync(LOCK_FILE, { force: true });
  fail(`could not acquire the startup lock: ${String(error)}`);
}

let currentStage = "prerequisite check";
let devnet;
let apiServer;
let viteProcess;
const makerProcesses = new Map();
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

async function waitForMakerHealth(client, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`${client.solverId} stopped before becoming healthy.`);
    }
    try {
      const response = await fetch(`${client.endpoint}/health`);
      if (response.ok) return;
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
    setTimeout(() => {
      void launchMakerNode(definition, makerRestartContext, authToken)
        .then((replacement) => {
          makerClients = makerClients.map((candidate) =>
            candidate.solverId === replacement.solverId
              ? replacement
              : candidate,
          );
        })
        .catch((error) => {
          console.error(
            `${definition.solverId} restart failed: ${String(error)}`,
          );
          void shutdown(1);
        });
    }, 250);
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
  const children = [...makerProcesses.values()];
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolveExit) => {
          if (child.exitCode === null) child.once("exit", resolveExit);
          else resolveExit();
        }),
    ),
  );
  makerProcesses.clear();
  makerClients = [];
  makerRestartContext = null;
}

async function makerRequest(client, pathname, body) {
  const response = await fetch(`${client.endpoint}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${client.authToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(
      `${client.solverId}: ${payload.error ?? `HTTP ${response.status}`}`,
    );
  }
  return payload.result;
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

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping APP20 localnet…");

  if (viteProcess?.pid && viteProcess.exitCode === null) {
    viteProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => viteProcess.once("exit", resolveExit)),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
    ]);
    if (viteProcess.exitCode === null) viteProcess.kill("SIGKILL");
  }
  if (apiServer) {
    await new Promise((resolveClose) => apiServer.close(() => resolveClose()));
  }
  await stopMakerNodes();
  if (devnet) {
    try {
      await devnet.cleanup();
    } catch (error) {
      console.error(`Devnet cleanup failed: ${String(error)}`);
      exitCode = exitCode || 1;
    }
  }

  removeRuntimeFiles();
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
      join(
        artifactRoot,
        "app20_mail_App20Mail.compiled_contract_class.json",
      ),
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
      join(
        artifactRoot,
        "app20_mail_MockErc20.compiled_contract_class.json",
      ),
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
      join(
        artifactRoot,
        "app20_mail_ClaimTicket.compiled_contract_class.json",
      ),
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
      join(
        artifactRoot,
        "app20_mail_App20Escrow.compiled_contract_class.json",
      ),
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

async function createDevnetBlocks(rpcUrl, count = 10) {
  for (let index = 0; index < count; index += 1) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: index + 1,
        method: "devnet_createBlock",
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      fail("devnet could not mature the seeded escrow notes.");
    }
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

async function seedEscrowPrivateBalances(identities, env, starknet) {
  // Alice and Bob remain user/demo identities. Independent maker processes seed
  // their own USDC and STRK notes after receiving public localnet fixtures.
  for (const [identity, token, amount] of [
    [identities.alice, env.strk, 10n * 10n ** 18n],
    [identities.bob, env.eth, 10n * 10n ** 18n],
  ]) {
    const actions = [
      { type: "deposit", token, amount: starknet.num.toHex(amount) },
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
  if (typeof value !== "string" || !/^0x[0-9a-f]{1,63}$/i.test(value)) {
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

function assertFundedIntentDeal(
  deal,
  { sellToken, sellAmount, buyToken, buyAmount },
  starknet,
) {
  if (deal.status !== 1)
    fail("the private intent is not awaiting a solver fill.");
  if (
    starknet.num.toBigInt(deal.legAToken) !==
      starknet.num.toBigInt(sellToken) ||
    deal.legAAmount !== sellAmount ||
    starknet.num.toBigInt(deal.legBToken) !== starknet.num.toBigInt(buyToken) ||
    deal.legBTerms !== buyAmount
  ) {
    fail("the on-chain escrow terms do not match the quoted private intent.");
  }
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

function startApi({
  config,
  identities,
  env,
  helperAddress,
  escrowAddress,
  starknet,
  makerClients,
}) {
  const reservationOwners = new Map();
  const makerById = new Map(
    makerClients.map((client) => [client.solverId, client]),
  );
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", BACKEND_TARGET);
      if (request.method === "GET" && url.pathname === "/health") {
        jsonResponse(response, 200, {
          result: {
            ok: true,
            pid: process.pid,
            appUrl: APP_URL,
            poolAddress: env.privacy.address,
            helperAddress,
            escrowAddress,
            makers: makerClients.map((maker) => ({
              makerId: maker.solverId,
              settlementAccount: maker.settlementAccount,
              processAlive:
                makerProcesses.get(maker.solverId)?.exitCode === null,
              processPid: makerProcesses.get(maker.solverId)?.pid,
            })),
            operations: operationLog,
          },
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

      const body = await readRequestBody(request);
      if (url.pathname === "/escrow/ensure-ticket") {
        const dealId = feltInput(body.dealId, "dealId", starknet);
        const ticketAddress = await serializeOperation(
          "ensure claim ticket",
          "localnet-admin",
          () => ensureLocalEscrowTicket(dealId, env, escrowAddress, starknet),
        );
        jsonResponse(response, 200, { result: { ticketAddress } });
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
        const now = Math.floor(Date.now() / 1_000);
        const intentDigest = canonicalHex32(body.intentDigest, "intentDigest");
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
        const minBuyAmount = positiveBaseUnits(
          body.minBuyAmount,
          "minBuyAmount",
          starknet,
        );
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
          makerClients.map((client) =>
            makerRequest(client, "/v1/reservations", {
              rfq: wireRfq,
              rfqDigest,
              intentDigest,
              expiresAt: body.expiresAt,
              sellToken,
              sellAmount: sellAmount.toString(),
              buyToken,
              minBuyAmount: minBuyAmount.toString(),
            }),
          ),
        );
        const offers = [];
        outcomes.forEach((outcome, index) => {
          if (outcome.status === "rejected") {
            console.warn(
              `Invited maker ${makerClients[index].solverId} declined: ${String(outcome.reason)}`,
            );
            return;
          }
          const offer = outcome.value.offer;
          reservationOwners.set(offer.reservationId, {
            client: makerClients[index],
            intentDigest,
            selected: false,
          });
          offers.push(offer);
        });
        if (offers.length === 0) {
          fail("No private maker inventory can cover this RFQ.");
        }
        jsonResponse(response, 200, { result: { offers } });
        return;
      }
      if (url.pathname === "/private-intents/select-quote") {
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
        await makerRequest(selected.client, "/v1/select", {
          reservationId: selectedReservationId,
          intentDigest,
        });
        selected.selected = true;
        const releases = [];
        for (const [reservationId, owner] of reservationOwners) {
          if (
            owner.intentDigest === intentDigest &&
            reservationId !== selectedReservationId
          ) {
            releases.push(
              makerRequest(owner.client, "/v1/release", {
                reservationId,
                reason: "losing quote released after client selection",
              }),
            );
            reservationOwners.delete(reservationId);
          }
        }
        await Promise.allSettled(releases);
        jsonResponse(response, 200, {
          result: {
            selectedReservationId,
            solverId: selected.client.solverId,
          },
        });
        return;
      }
      if (url.pathname === "/private-intents/release-quote") {
        const reservationId = canonicalHex32(
          body.reservationId,
          "reservationId",
        );
        const owner = reservationOwners.get(reservationId);
        let released = false;
        if (owner) {
          const result = await makerRequest(owner.client, "/v1/release", {
            reservationId,
            reason: "client released quote",
          });
          released = result.released;
        }
        if (released) reservationOwners.delete(reservationId);
        jsonResponse(response, 200, { result: { released } });
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
        jsonResponse(response, 200, { result });
        return;
      }
      if (url.pathname === "/private-intents/solve") {
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
        const owner = reservationOwners.get(reservationId);
        if (
          !owner?.selected ||
          owner.intentDigest !== intentDigest ||
          owner.client.solverId !== body.solverId
        ) {
          fail("the selected private quote does not authorize this fill.");
        }
        const dealId = feltInput(body.dealId, "dealId", starknet);
        const deal = await readLocalEscrowDeal(dealId, env, escrowAddress);
        assertFundedIntentDeal(
          deal,
          { sellToken, sellAmount, buyToken, buyAmount },
          starknet,
        );
        const filled = await makerRequest(owner.client, "/v1/fill", {
          reservationId,
          intentDigest,
          dealId,
          sellToken,
          sellAmount: sellAmount.toString(),
          buyToken,
          buyAmount: buyAmount.toString(),
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
        const owner = reservationOwners.get(reservationId);
        if (
          !owner?.selected ||
          owner.intentDigest !== intentDigest ||
          owner.client.solverId !== body.solverId
        ) {
          fail("the selected private quote does not match this expiry path.");
        }
        const dealId = feltInput(body.dealId, "dealId", starknet);
        const deal = await readLocalEscrowDeal(dealId, env, escrowAddress);
        assertFundedIntentDeal(
          deal,
          { sellToken, sellAmount, buyToken, buyAmount },
          starknet,
        );
        const released = await makerRequest(owner.client, "/v1/release", {
          reservationId,
          reason: "user chose the explicit no-fill expiry path",
        });
        if (!released.released) {
          fail("the selected maker reservation could not be released.");
        }
        reservationOwners.delete(reservationId);
        const timestamp = deal.deadline + 1;
        const setTimeResponse = await fetch(devnet.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "devnet_setTime",
            params: { time: timestamp },
          }),
        });
        const setTimePayload = await setTimeResponse.json();
        if (!setTimeResponse.ok || setTimePayload.error) {
          fail("devnet could not advance the private-intent expiry.");
        }
        await createDevnetBlocks(devnet.url, 1);
        jsonResponse(response, 200, { result: { expiredAt: timestamp } });
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
      jsonResponse(response, 400, { error: message });
    }
  });

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
    if (viteProcess?.exitCode !== null) {
      fail(`Vite exited early with code ${viteProcess?.exitCode}.`);
    }
    try {
      const response = await fetch(APP_URL);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  fail(`Vite was not ready within 30 seconds (${lastError}).`);
}

async function verifyServedApp() {
  for (const path of ["/", "/inbox"]) {
    const response = await fetch(`${APP_URL}${path}`);
    const body = await response.text();
    if (!response.ok || !body.includes('id="root"')) {
      fail(`${path} did not serve the Vite SPA (HTTP ${response.status}).`);
    }
  }
  const configResponse = await fetch(`${APP_URL}${WALLET_PROXY_PATH}/config`);
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
      ...makePrivacyRuntime(
        env.alice,
        "app20-localnet-alice-v1",
        env,
        runtime,
      ),
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

  currentStage = "local user balance seed";
  console.log("\n==> seeding Alice STRK and Bob Mail fixture balances");
  await seedEscrowPrivateBalances(identities, env, runtime.starknet);

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
    chainId: LOCALNET_CHAIN_ID,
    rpcUrl: RPC_PROXY_PATH,
    poolAddress: env.privacy.address,
    helperAddress: helper.address,
    escrowAddress: escrow.address,
    tokenAddress: env.strk,
    counterTokenAddress: env.eth,
    usdcTokenAddress: env.usdc,
    marketTokens: [
      { symbol: "STRK", address: env.strk, decimals: 18 },
      { symbol: "USDC", address: env.usdc, decimals: 6 },
    ],
    marketPairs: ["STRK_USDC", "USDC_STRK"],
    proofMode: "upstream devnet mock proof · no STARK bytes",
    makers: makers.map((maker) => ({
      makerId: maker.solverId,
      solverKey: maker.solverKey,
      settlementAccount: maker.settlementAccount,
      custody: "independent localnet process · WAL-backed reservations",
    })),
    identities: Object.values(identities).map((identity) => ({
      id: identity.id,
      label: identity.label,
      address: identity.account.address,
    })),
  };

  currentStage = "local wallet API startup";
  apiServer = await startApi({
    config,
    identities,
    env,
    helperAddress: helper.address,
    escrowAddress: escrow.address,
    starknet: runtime.starknet,
    makerClients: makers,
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
  rmSync(LOCK_FILE, { force: true });

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
