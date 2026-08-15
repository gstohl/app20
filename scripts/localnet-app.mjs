#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = join(ROOT, ".quietline-localnet");
const STATE_FILE = join(RUNTIME_DIR, "state.json");
const LOCK_FILE = join(RUNTIME_DIR, "start.lock");
const GENERATED_ENV_FILE = join(ROOT, ".env.localnet.local");
const API_HOST = "127.0.0.1";
const API_PORT = Number(process.env.QUIETLINE_LOCALNET_API_PORT ?? 5051);
const VITE_PORT = Number(process.env.QUIETLINE_LOCALNET_VITE_PORT ?? 5173);
const APP_URL = `http://127.0.0.1:${VITE_PORT}`;
const BACKEND_TARGET = `http://${API_HOST}:${API_PORT}`;
const WALLET_PROXY_PATH = "/__quietline_localnet_wallet";
const RPC_PROXY_PATH = "/__quietline_localnet_rpc";
const LOCALNET_CHAIN_ID = "0x51554945544c494e455f4c4f43414c";
const RECOVERY_DUST = 7n;
const MAX_REQUEST_BYTES = 1_000_000;

function fail(message) {
  throw new Error(`Quietline localnet: ${message}`);
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
    console.log("Quietline localnet is already stopped.");
    return;
  }

  console.log(`Stopping Quietline localnet (pid ${pid})…`);
  process.kill(pid, "SIGTERM");
  if (!(await waitForExit(pid, 20_000))) {
    fail(
      `process ${pid} did not stop within 20 seconds; inspect it before sending SIGKILL.`,
    );
  }
  removeRuntimeFiles();
  console.log("Quietline localnet stopped.");
}

if (process.argv.includes("--stop")) {
  await stopExisting();
  process.exit(0);
}

if (!Number.isInteger(API_PORT) || API_PORT <= 0 || API_PORT > 65_535) {
  fail("QUIETLINE_LOCALNET_API_PORT must be a valid TCP port.");
}
if (!Number.isInteger(VITE_PORT) || VITE_PORT <= 0 || VITE_PORT > 65_535) {
  fail("QUIETLINE_LOCALNET_VITE_PORT must be a valid TCP port.");
}

const priorState = readJsonFile(STATE_FILE);
if (priorState?.pid && isProcessAlive(Number(priorState.pid))) {
  try {
    const response = await fetch(`${BACKEND_TARGET}/health`);
    if (response.ok) {
      console.log(
        `Quietline localnet is already running at ${priorState.appUrl ?? APP_URL}.`,
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

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping Quietline localnet…");

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
      `QuietlineMail requires Scarb 2.18.x; ${scarb} reported ${version.split("\n")[0]}.`,
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
      join(artifactRoot, "quietline_mail_QuietlineMail.contract_class.json"),
      "utf8",
    ),
  );
  const casm = starknet.json.parse(
    readFileSync(
      join(
        artifactRoot,
        "quietline_mail_QuietlineMail.compiled_contract_class.json",
      ),
      "utf8",
    ),
  );

  const declaration = await env.admin.declare({ contract: sierra, casm });
  await waitForSuccess(
    env.node,
    declaration.transaction_hash,
    "QuietlineMail declaration",
  );
  const deployment = await env.admin.deployContract({
    classHash: declaration.class_hash,
    constructorCalldata: [env.privacy.address],
  });
  await waitForSuccess(
    env.node,
    deployment.transaction_hash,
    "QuietlineMail deployment",
  );
  const helperAddress = deployment.contract_address ?? deployment.address;
  if (!helperAddress) fail("QuietlineMail deployment returned no address.");
  return {
    address: helperAddress,
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

async function fundHelperRecovery(
  identity,
  actions,
  helperAddress,
  env,
  starknet,
) {
  const helperInvokes = actions.filter(
    (action) =>
      action.type === "invoke" &&
      starknet.num.toBigInt(action.contract) ===
        starknet.num.toBigInt(helperAddress),
  ).length;
  const openNotes = actions.filter(
    (action) => action.type === "transfer" && action.amount === "OPEN",
  ).length;
  const dust = RECOVERY_DUST * BigInt(Math.min(helperInvokes, openNotes));
  if (dust === 0n) return;

  const value = starknet.cairo.uint256(dust);
  const response = await identity.account.execute({
    contractAddress: env.strk,
    entrypoint: "transfer",
    calldata: [helperAddress, value.low, value.high],
  });
  await waitForSuccess(
    env.node,
    response.transaction_hash,
    `${identity.label} helper recovery-dust transfer`,
  );
}

async function privateBalances(identity, tokens, env, starknet) {
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

function startApi({ config, identities, env, helperAddress, starknet }) {
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
        const result = await serializeOperation(
          "compile, mock-prove, and submit privacy actions",
          identity.id,
          async () => {
            await approveDeposits(identity, actions, env, starknet);
            await fundHelperRecovery(
              identity,
              actions,
              helperAddress,
              env,
              starknet,
            );
            const prepared = await identity.prover.prove(actions);
            if (
              prepared.proof.data !== undefined &&
              prepared.proof.data !== ""
            ) {
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
            const receipt = await devnet.executeOutside(
              toCoreCallAndProof(prepared),
            );
            const transactionHash = receipt.transaction_hash;
            if (!transactionHash)
              fail("outside execution returned no transaction hash.");
            return { transaction_hash: transactionHash };
          },
        );
        jsonResponse(response, 200, { result });
        return;
      }
      if (url.pathname === "/balances") {
        const result = await serializeOperation(
          "discover private balances",
          identity.id,
          () => privateBalances(identity, body.tokens ?? [], env, starknet),
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

function writeGeneratedEnv({ rpcTarget, helperAddress, poolAddress }) {
  const contents = [
    "# Generated by npm run dev:localnet. Do not edit or commit.",
    "VITE_E2E_WALLET=true",
    `VITE_LOCALNET_WALLET_URL=${WALLET_PROXY_PATH}`,
    `VITE_LOCALNET_RPC_URL=${RPC_PROXY_PATH}`,
    `VITE_MAIL_HELPER_LOCALNET=${helperAddress}`,
    `VITE_LOCALNET_POOL_ADDRESS=${poolAddress}`,
    `QUIETLINE_LOCALNET_BACKEND_TARGET=${BACKEND_TARGET}`,
    `QUIETLINE_LOCALNET_RPC_TARGET=${rpcTarget}`,
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
  devnet = new runtime.testing.Devnet();
  const { env } = await runtime.testing.createDevnetTestEnv(devnet);
  const poolClassHash = await env.node.getClassHashAt(env.privacy.address);

  currentStage = "QuietlineMail deployment";
  console.log("\n==> deploying QuietlineMail against the real pool");
  const helper = await deployHelper(env, runtime.starknet);

  const identities = {
    alice: {
      id: "alice",
      label: "Alice",
      ...makePrivacyRuntime(
        env.alice,
        "quietline-localnet-alice-v1",
        env,
        runtime,
      ),
    },
    bob: {
      id: "bob",
      label: "Bob",
      ...makePrivacyRuntime(env.bob, "quietline-localnet-bob-v1", env, runtime),
    },
  };
  const config = {
    walletName: "Localnet (dev)",
    chainId: LOCALNET_CHAIN_ID,
    rpcUrl: RPC_PROXY_PATH,
    poolAddress: env.privacy.address,
    helperAddress: helper.address,
    tokenAddress: env.strk,
    proofMode: "upstream devnet mock proof · no STARK bytes",
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
    starknet: runtime.starknet,
  });
  writeGeneratedEnv({
    rpcTarget: devnet.url,
    helperAddress: helper.address,
    poolAddress: env.privacy.address,
  });

  currentStage = "Vite startup";
  console.log("\n==> starting Vite with the dev-only Wallet Standard wallet");
  const viteEnvironment = {
    ...process.env,
    VITE_E2E_WALLET: "true",
    VITE_LOCALNET_WALLET_URL: WALLET_PROXY_PATH,
    VITE_LOCALNET_RPC_URL: RPC_PROXY_PATH,
    VITE_MAIL_HELPER_LOCALNET: helper.address,
    VITE_LOCALNET_POOL_ADDRESS: env.privacy.address,
    QUIETLINE_LOCALNET_BACKEND_TARGET: BACKEND_TARGET,
    QUIETLINE_LOCALNET_RPC_TARGET: devnet.url,
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
    aliceAddress: identities.alice.account.address,
    bobAddress: identities.bob.account.address,
  };
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  rmSync(LOCK_FILE, { force: true });

  console.log("\nQuietline local demo is ready:");
  console.log(`  App:                ${APP_URL}`);
  console.log(`  Inbox:              ${APP_URL}/inbox`);
  console.log(`  privacy_Privacy:    ${env.privacy.address}`);
  console.log(`  pool class hash:    ${poolClassHash}`);
  console.log(`  QuietlineMail:      ${helper.address}`);
  console.log(`  Alice:              ${identities.alice.account.address}`);
  console.log(`  Bob:                ${identities.bob.account.address}`);
  console.log(
    "  Wallet discovery:   Localnet (dev) registered via Wallet Standard",
  );
  console.log(
    "  Proof mode:         upstream devnet mock (no STARK proof bytes)",
  );
  console.log("  Stop:               npm run localnet:stop");
} catch (error) {
  console.error(
    `\nQuietline localnet failed during ${currentStage}: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  await shutdown(1);
}
