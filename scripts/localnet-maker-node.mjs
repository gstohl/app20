#!/usr/bin/env node

import { readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DurableMakerNode,
  DurableReservationStore,
} from "../packages/maker-node/src/index.ts";
import {
  importQuotePrivateKey,
  signCanonicalQuote,
} from "../packages/private-intents/src/index.ts";
import { dispatchLocalnetMakerFill } from "./localnet-maker-http.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_REQUEST_BYTES = 1_000_000;
const configPath = process.argv[2];
if (!configPath)
  throw new Error("APP20 maker node requires a private config path.");

function fail(message) {
  throw new Error(`APP20 maker node: ${message}`);
}

function readPrivateConfig(path) {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    fail("private config must not be readable by group or other users.");
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("APP20 maker node: private config is not valid JSON.", {
      cause: error,
    });
  } finally {
    rmSync(path, { force: true });
  }
}

const config = readPrivateConfig(configPath);
if (
  !Number.isSafeInteger(config.port) ||
  config.port <= 0 ||
  config.port > 65_535
) {
  fail("port must be a valid TCP port.");
}
if (typeof config.authToken !== "string" || config.authToken.length < 32) {
  fail("authToken must contain at least 32 characters.");
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
  const abi = await import(
    pathToFileURL(
      join(
        ROOT,
        "vendor",
        "starknet-privacy",
        "sdk",
        "dist",
        "internal",
        "abi.js",
      ),
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
  return { client, sdk, abi, testing, starknet };
}

async function predeployedAccount(rpcUrl, accountIndex) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "devnet_getPredeployedAccounts",
    }),
  });
  const payload = await response.json();
  const account = payload?.result?.[accountIndex];
  if (!account?.address || !account?.private_key) {
    fail(`predeployed account index ${accountIndex} is unavailable.`);
  }
  return account;
}

function signerBytes(privateKey) {
  const body = privateKey.replace(/^0x/, "");
  if (!/^[0-9a-f]+$/i.test(body) || body.length % 2 !== 0) {
    fail("devnet returned a malformed account key.");
  }
  return new Uint8Array(
    body.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)),
  );
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

async function createBlocks(rpcUrl, count = 10) {
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
    if (!response.ok) fail("could not advance devnet for proof validation.");
  }
}

async function waitForSuccess(node, transactionHash, label) {
  if (!transactionHash) fail(`${label} returned no transaction hash.`);
  const receipt = await node.waitForTransaction(transactionHash);
  if (!receipt.isSuccess()) {
    fail(`${label} reverted: ${receipt.revert_reason ?? "unknown"}`);
  }
  return receipt;
}

function createPrivacyRuntime(account, privacy, node, runtime) {
  const discovery = new runtime.testing.ContractDiscoveryProvider(privacy);
  const proving = new runtime.testing.ScreeningCallMockProofProvider(
    node,
    runtime.starknet.constants.StarknetChainId.SN_SEPOLIA,
  );
  const viewingKeyProvider = runtime.client.passphraseViewingKeyProvider(
    config.passphrase,
    account.address,
  );
  const transfers = runtime.sdk.createPrivateTransfers({
    account,
    viewingKeyProvider,
    provingProvider: proving,
    discoveryProvider: discovery,
    poolContractAddress: config.poolAddress,
  });
  const prover = new runtime.client.CorePrivateTransfersProver({
    signer: account.signer,
    address: account.address,
    passphrase: config.passphrase,
    node,
    discovery,
    prover: proving,
    poolContractAddress: config.poolAddress,
    shadowAccountAnonymizerAddress: "0x1",
    storage: {
      loadRegistry: async () => runtime.sdk.createEmptyRegistry(),
      saveRegistry: async () => {},
    },
  });
  const coreTransfers = prover.transfers;
  if (!coreTransfers || typeof coreTransfers.build !== "function") {
    fail("the pinned private-transfer builder seam changed.");
  }
  const coreBuild = coreTransfers.build.bind(coreTransfers);
  coreTransfers.build = (...args) =>
    coreBuild(...args).surplusTo(account.address, false);
  return { transfers, prover };
}

async function executeOutside(account, node, prepared) {
  await createBlocks(config.rpcUrl);
  const now = Math.floor(Date.now() / 1_000);
  const callAndProof = toCoreCallAndProof(prepared);
  const outside = await account.getOutsideTransaction(
    {
      caller: account.address,
      execute_after: now - 3_600,
      execute_before: now + 3_600,
    },
    callAndProof.call,
    runtime.starknet.OutsideExecutionVersion.V2,
  );
  const response = await account.executeFromOutside(outside, {
    proofFacts: callAndProof.proof.proofFacts,
    proof: callAndProof.proof.data,
  });
  return waitForSuccess(node, response.transaction_hash, "private execution");
}

async function approveDeposits(account, node, actions) {
  const totals = new Map();
  for (const action of actions) {
    if (action.type !== "deposit") continue;
    const amount = runtime.starknet.num.toBigInt(action.amount);
    totals.set(action.token, (totals.get(action.token) ?? 0n) + amount);
  }
  for (const [token, amount] of totals) {
    const value = runtime.starknet.cairo.uint256(amount);
    const response = await account.execute({
      contractAddress: token,
      entrypoint: "approve",
      calldata: [config.poolAddress, value.low, value.high],
    });
    await waitForSuccess(node, response.transaction_hash, "pool approval");
  }
}

let operationTail = Promise.resolve();
function serializeOperation(operation) {
  const run = operationTail.then(operation);
  operationTail = run.catch(() => undefined);
  return run;
}

const runtime = await importRuntime();
const rawAccount = await predeployedAccount(config.rpcUrl, config.accountIndex);
if (
  rawAccount.address.toLowerCase() !== config.settlementAccount.toLowerCase()
) {
  fail(
    "configured settlement account does not match its devnet custody index.",
  );
}
const node = new runtime.testing.TracingRpcProvider({
  nodeUrl: config.rpcUrl,
  transactionRetryIntervalFallback: 50,
  batch: 0,
  chainId: "0x534e5f5345504f4c4941",
});
const account = new runtime.starknet.Account({
  provider: node,
  address: rawAccount.address,
  signer: signerBytes(rawAccount.private_key),
});
const privacy = new runtime.starknet.Contract({
  abi: runtime.abi.PrivacyPoolABI,
  address: config.poolAddress,
  providerOrAccount: account,
}).typedv2(runtime.abi.PrivacyPoolABI);
const privacyRuntime = createPrivacyRuntime(account, privacy, node, runtime);

async function privateBalance(asset) {
  const discovery = await privacyRuntime.transfers.discoverNotes({
    tokens: [runtime.starknet.num.toBigInt(asset)],
  });
  const notes = discovery.notes.get(runtime.starknet.num.toBigInt(asset)) ?? [];
  return notes.reduce((total, note) => total + note.amount, 0n);
}

async function executeActions(actions) {
  return serializeOperation(async () => {
    await approveDeposits(account, node, actions);
    const prepared = await privacyRuntime.prover.prove(actions);
    if (prepared.proof.data !== undefined && prepared.proof.data !== "") {
      fail("devnet unexpectedly returned non-mock proof bytes.");
    }
    return executeOutside(account, node, prepared);
  });
}

async function seedPrivateInventory() {
  for (const [token, targetText] of [
    [config.strkToken, config.seedStrk],
    [config.usdcToken, config.seedUsdc],
  ]) {
    const target = BigInt(targetText);
    const current = await privateBalance(token);
    if (current >= target) continue;
    const amount = target - current;
    await executeActions([
      {
        type: "deposit",
        token,
        amount: runtime.starknet.num.toHex(amount),
      },
    ]);
  }
}

async function readEscrowDeal(dealId) {
  const result = await node.callContract({
    contractAddress: config.escrowAddress,
    entrypoint: "get_deal",
    calldata: [dealId],
  });
  if (!Array.isArray(result) || result.length < 8) {
    fail("escrow returned a malformed deal.");
  }
  return {
    sellToken: result[0],
    sellAmount: BigInt(result[1]),
    buyToken: result[2],
    buyAmount: BigInt(result[3]),
    deadline: Number(BigInt(result[5])),
    ticketAddress: result[6],
    status: Number(BigInt(result[7])),
  };
}

async function fillReservation(request) {
  const deal = await readEscrowDeal(request.dealId);
  if (
    deal.status !== 1 ||
    runtime.starknet.num.toBigInt(deal.sellToken) !==
      runtime.starknet.num.toBigInt(request.sellToken) ||
    deal.sellAmount !== request.sellAmount ||
    runtime.starknet.num.toBigInt(deal.buyToken) !==
      runtime.starknet.num.toBigInt(request.buyToken) ||
    deal.buyAmount !== request.buyAmount ||
    deal.deadline !== request.deadline ||
    runtime.starknet.num.toBigInt(deal.ticketAddress) !==
      runtime.starknet.num.toBigInt(request.ticketAddress)
  ) {
    fail("on-chain escrow terms do not match the selected reservation.");
  }
  const receipt = await executeActions([
    {
      type: "withdraw",
      token: request.buyToken,
      amount: runtime.starknet.num.toHex(request.buyAmount),
      recipient: config.escrowAddress,
    },
    {
      type: "transfer",
      token: request.sellToken,
      amount: "OPEN",
      recipient: account.address,
    },
    {
      type: "invoke",
      contract: config.escrowAddress,
      calldata: [
        "0x1",
        request.buyToken,
        request.dealId,
        "${poolAddress}",
        "${openNoteIds[0]}",
      ],
    },
  ]);
  return { transactionHash: receipt.transaction_hash };
}

await seedPrivateInventory();
const quoteKeyPath = resolve(config.quoteKeyPath);
const fixtureRoot = join(ROOT, "scripts", "fixtures");
if (!quoteKeyPath.startsWith(`${fixtureRoot}/`)) {
  fail("localnet quote key must come from the reviewed fixture directory.");
}
let quotePrivateJwk;
try {
  quotePrivateJwk = JSON.parse(readFileSync(quoteKeyPath, "utf8"));
} catch (error) {
  throw new Error("APP20 maker node: quote key fixture is invalid.", {
    cause: error,
  });
}
const quotePrivateKey = await importQuotePrivateKey(quotePrivateJwk);
const store = DurableReservationStore.open(config.walPath);
const maker = new DurableMakerNode(store, {
  makerId: config.makerId,
  solverKey: config.solverKey,
  pool: "starknet:APP20_LOCALNET",
  helper: config.escrowAddress,
  spreadBps: config.spreadBps,
  reservationTtlSeconds: config.reservationTtlSeconds,
  price: async ({ sellToken, sellAmount, buyToken }) => {
    const strkScale = 10n ** 18n;
    const usdcScale = 10n ** 6n;
    const sellIsStrk =
      runtime.starknet.num.toBigInt(sellToken) ===
      runtime.starknet.num.toBigInt(config.strkToken);
    const buyIsUsdc =
      runtime.starknet.num.toBigInt(buyToken) ===
      runtime.starknet.num.toBigInt(config.usdcToken);
    const sellIsUsdc =
      runtime.starknet.num.toBigInt(sellToken) ===
      runtime.starknet.num.toBigInt(config.usdcToken);
    const buyIsStrk =
      runtime.starknet.num.toBigInt(buyToken) ===
      runtime.starknet.num.toBigInt(config.strkToken);
    if ((!sellIsStrk || !buyIsUsdc) && (!sellIsUsdc || !buyIsStrk)) {
      fail("maker only supports the reviewed USDC/STRK market.");
    }
    return {
      grossBuyAmount: sellIsStrk
        ? (sellAmount * 2n * usdcScale) / strkScale
        : (sellAmount * strkScale) / (2n * usdcScale),
      provenance: `localnet:fixed-2-usdc-per-strk:${config.makerId}`,
    };
  },
  signer: (canonical) => signCanonicalQuote(canonical, quotePrivateKey),
  wallet: {
    settlementAccount: account.address,
    privateBalance,
    fill: fillReservation,
  },
});
await maker.recoverAfterRestart(Math.floor(Date.now() / 1_000));

function jsonResponse(response, status, payload) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(
    `${JSON.stringify(payload, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    )}\n`,
  );
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) fail("request exceeded 1 MB.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new Error("Maker-node request body is not valid JSON.", {
      cause: error,
    });
  }
}

function requireAuth(request) {
  if (request.headers.authorization !== `Bearer ${config.authToken}`) {
    throw new Error("Unauthorized maker-node request.");
  }
}

function parseRfq(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Maker-node canonical RFQ is missing.");
  }
  return {
    ...value,
    sellAmountBaseUnits: BigInt(value.sellAmountBaseUnits),
    minBuyAmountBaseUnits: BigInt(value.minBuyAmountBaseUnits),
  };
}

function parseQuote(body) {
  return {
    domain: body.domain,
    pool: body.pool,
    helper: body.helper,
    sellToken: body.sellToken,
    sellAmount: BigInt(body.sellAmount),
    buyToken: body.buyToken,
    intentDigest: body.intentDigest,
    solverId: body.solverId,
    solverKey: body.solverKey,
    nonce: body.nonce,
    reservationId: body.reservationId,
    reservationExpiresAt: body.reservationExpiresAt,
    buyAmount: BigInt(body.buyAmount),
    spreadBps: body.spreadBps,
    pricingProvenance: body.pricingProvenance,
    quotedAt: body.quotedAt,
    quoteExpiresAt: body.quoteExpiresAt,
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${config.port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, { result: maker.health() });
      return;
    }
    requireAuth(request);
    if (request.method !== "POST") {
      jsonResponse(response, 404, { error: "Unknown maker-node route." });
      return;
    }
    const body = await readBody(request);
    const now = Math.floor(Date.now() / 1_000);
    if (url.pathname === "/v1/reservations") {
      const offer = await maker.reserve(
        {
          rfq: parseRfq(body.rfq),
          rfqDigest: body.rfqDigest,
          intentDigest: body.intentDigest,
          expiresAt: body.expiresAt,
          sellToken: body.sellToken,
          sellAmount: BigInt(body.sellAmount),
          buyToken: body.buyToken,
          minBuyAmount: BigInt(body.minBuyAmount),
        },
        now,
      );
      jsonResponse(response, 200, { result: { offer } });
      return;
    }
    if (url.pathname === "/v1/sign") {
      const result = await maker.signQuote(
        parseQuote(body),
        body.canonical,
        now,
      );
      jsonResponse(response, 200, { result });
      return;
    }
    if (url.pathname === "/v1/select") {
      const authorization = await maker.select(
        body.reservationId,
        body.intentDigest,
        now,
      );
      jsonResponse(response, 200, {
        result: { selected: true, ...authorization },
      });
      return;
    }
    if (url.pathname === "/v1/release") {
      const released = await maker.release(
        body.reservationId,
        now,
        body.reason ?? "coordinator released reservation",
      );
      jsonResponse(response, 200, { result: { released } });
      return;
    }
    if (url.pathname === "/v1/fill") {
      const result = await dispatchLocalnetMakerFill(maker, body, now);
      jsonResponse(response, 200, { result });
      return;
    }
    jsonResponse(response, 404, { error: "Unknown maker-node route." });
  } catch (error) {
    jsonResponse(response, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(config.port, "127.0.0.1", resolveListen);
});
console.log(
  `APP20 maker node ${config.makerId} ready on 127.0.0.1:${config.port}`,
);

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await new Promise((resolveClose) => server.close(resolveClose));
  await store.close();
  process.exit(code);
}
process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
