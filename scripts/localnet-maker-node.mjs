#!/usr/bin/env node

import { readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DurableMakerNode,
  DurableMakerTranscriptJournal,
  DurableReservationStore,
  MakerNodeError,
  MakerTranscriptConflictError,
  MakerWalletOperationError,
} from "../packages/maker-node/src/index.ts";
import {
  LOCALNET_SECONDARY_SOLVER_ID,
  decodePrivateRfqV2,
  decodeSelectionTranscript,
  encodeMakerMid,
  encodeSolverQuoteV3,
  importQuotePrivateKey,
  signCanonicalQuote,
} from "../packages/private-intents/src/index.ts";
import {
  buildLocalnetMakerLockActions,
  buildLocalnetMakerSettlementActions,
  dispatchLocalnetMakerFill,
  parseLocalnetEscrowLockResult,
  parseLocalnetMakerReconciliationTarget,
} from "./localnet-maker-http.mjs";
import {
  buildLocalnetMakerSchedule,
  createLocalnetRfqEconomics,
  formatRfqEconomicRefusal,
  localnetPairTokenIds,
} from "./localnet-rfq-economics.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_REQUEST_BYTES = 1_000_000;
const configPath = process.argv[2];
if (!configPath)
  throw new Error("APP20 maker node requires a private config path.");

function fail(message) {
  throw new Error(`APP20 maker node: ${message}`);
}

class KnownTransactionRevertError extends Error {
  constructor(message) {
    super(message);
    this.name = "KnownTransactionRevertError";
  }
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

let devnetRpcSequence = 0;
async function callDevnetRpc(rpcUrl, method, params = []) {
  const id = ++devnetRpcSequence;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await response.json();
  if (
    !response.ok ||
    payload?.id !== id ||
    payload?.error ||
    payload?.result === undefined
  ) {
    fail(`devnet RPC ${method} is unavailable.`);
  }
  return payload.result;
}

async function predeployedAccount(rpcUrl, accountIndex) {
  const accounts = await callDevnetRpc(rpcUrl, "devnet_getPredeployedAccounts");
  const account = accounts?.[accountIndex];
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
    await callDevnetRpc(rpcUrl, "devnet_createBlock");
  }
}

async function waitForSuccess(node, transactionHash, label) {
  if (!transactionHash) fail(`${label} returned no transaction hash.`);
  const receipt = await node.waitForTransaction(transactionHash);
  if (!receipt.isSuccess()) {
    throw new KnownTransactionRevertError(
      `APP20 maker node: ${label} reverted: ${receipt.revert_reason ?? "unknown"}`,
    );
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

async function executeOutside(account, node, prepared, onSubmissionAttempt) {
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
  onSubmissionAttempt?.();
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

async function executeActions(actions, { onSubmissionAttempt } = {}) {
  return serializeOperation(async () => {
    await approveDeposits(account, node, actions);
    const prepared = await privacyRuntime.prover.prove(actions);
    if (prepared.proof.data !== undefined && prepared.proof.data !== "") {
      fail("devnet unexpectedly returned non-mock proof bytes.");
    }
    return executeOutside(account, node, prepared, onSubmissionAttempt);
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

function rpcFelt(value, label) {
  try {
    const felt = runtime.starknet.num.toBigInt(value);
    if (felt < 0n) throw new Error("negative");
    return runtime.starknet.num.toHex(felt);
  } catch (error) {
    throw new Error(`APP20 maker node: escrow returned an invalid ${label}.`, {
      cause: error,
    });
  }
}

async function readEscrowLock(lockId) {
  return parseLocalnetEscrowLockResult(
    await node.callContract({
      contractAddress: config.escrowAddress,
      entrypoint: "get_lock",
      calldata: [lockId],
    }),
  );
}

async function ensureLockTicket(lockId) {
  return serializeOperation(async () => {
    try {
      const response = await account.execute({
        contractAddress: config.escrowAddress,
        entrypoint: "ensure_lock_ticket",
        calldata: [lockId],
      });
      await waitForSuccess(
        node,
        response.transaction_hash,
        "lock-ticket deployment",
      );
      const result = await node.callContract({
        contractAddress: config.escrowAddress,
        entrypoint: "get_lock_ticket",
        calldata: [lockId],
      });
      if (!Array.isArray(result) || result.length !== 1) {
        fail("escrow returned a malformed lock ticket.");
      }
      const ticket = rpcFelt(result[0], "lock ticket");
      if (runtime.starknet.num.toBigInt(ticket) === 0n) {
        fail("escrow returned a zero lock ticket.");
      }
      return ticket;
    } catch (error) {
      throw new MakerWalletOperationError(
        error instanceof KnownTransactionRevertError ? "reverted" : "unknown",
        "Lock-ticket deployment failed.",
        { cause: error },
      );
    }
  });
}

async function lockInventory(request) {
  const ticket = await ensureLockTicket(request.lockId);
  let submissionAttempted = false;
  try {
    const receipt = await executeActions(
      buildLocalnetMakerLockActions(
        { ...request, ticket },
        {
          escrowAddress: config.escrowAddress,
          recoveryAddress: account.address,
        },
      ),
      {
        onSubmissionAttempt() {
          submissionAttempted = true;
        },
      },
    );
    return Object.freeze({
      ticket,
      transactionHash: receipt.transaction_hash,
      lock: await readEscrowLock(request.lockId),
    });
  } catch (error) {
    throw new MakerWalletOperationError(
      error instanceof KnownTransactionRevertError || !submissionAttempted
        ? "reverted"
        : "unknown",
      "Escrow lock submission failed.",
      { cause: error },
    );
  }
}

async function executeLockSettlement(request, operation) {
  const proceeds = operation === "0x6";
  let submissionAttempted = false;
  try {
    const receipt = await executeActions(
      buildLocalnetMakerSettlementActions(
        { ...request, operation },
        {
          escrowAddress: config.escrowAddress,
          recoveryAddress: account.address,
        },
      ),
      {
        onSubmissionAttempt() {
          submissionAttempted = true;
        },
      },
    );
    return { transactionHash: receipt.transaction_hash };
  } catch (error) {
    throw new MakerWalletOperationError(
      error instanceof KnownTransactionRevertError || !submissionAttempted
        ? "reverted"
        : "unknown",
      proceeds
        ? "Lock proceeds settlement failed."
        : "Lock collateral release failed.",
      { cause: error },
    );
  }
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
const transcripts = DurableMakerTranscriptJournal.open(
  `${config.walPath}.transcripts.json`,
);
const economics = createLocalnetRfqEconomics({
  accountingPath: `${config.walPath}.rfq-accounting.json`,
});
const makerVariant =
  config.makerId === LOCALNET_SECONDARY_SOLVER_ID ? "B" : "A";
const strkTokenValue = runtime.starknet.num.toBigInt(config.strkToken);
const usdcTokenValue = runtime.starknet.num.toBigInt(config.usdcToken);
function tokenSymbol(token) {
  const value = runtime.starknet.num.toBigInt(token);
  if (value === strkTokenValue) return "STRK";
  if (value === usdcTokenValue) return "USDC";
  return undefined;
}

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
    lock: lockInventory,
    getLock: readEscrowLock,
    settleProceeds: (request) => executeLockSettlement(request, "0x6"),
    releaseCollateral: (request) => executeLockSettlement(request, "0x7"),
  },
  v3: {
    tokenSymbol,
    buildSchedule({ rfq, availableBuyInventory }) {
      const sellSymbol = tokenSymbol(rfq.sellToken);
      const buySymbol = tokenSymbol(rfq.buyToken);
      const direction =
        sellSymbol === "STRK" && buySymbol === "USDC"
          ? "STRK_USDC"
          : sellSymbol === "USDC" && buySymbol === "STRK"
            ? "USDC_STRK"
            : undefined;
      if (!direction) {
        throw new Error(
          "Maker supports only opposite sides of the reviewed STRK/USDC pair.",
        );
      }
      return buildLocalnetMakerSchedule({
        maker: makerVariant,
        direction,
        bucketMinBaseUnits: rfq.sellBucketMinBaseUnits,
        bucketMaxBaseUnits: rfq.sellBucketMaxBaseUnits,
        availableBuyBaseUnits: availableBuyInventory,
      });
    },
    economicPolicy: {
      evaluate(input) {
        const sellSymbol = tokenSymbol(input.rfq.sellToken);
        const buySymbol = tokenSymbol(input.rfq.buyToken);
        if (!sellSymbol || !buySymbol) {
          return Object.freeze({
            allowed: false,
            reason: "Maker supports only the reviewed STRK/USDC market.",
          });
        }
        const direction = sellSymbol === "STRK" ? "STRK_USDC" : "USDC_STRK";
        const tokenIds = localnetPairTokenIds(direction);
        const decision = economics.evaluateSchedule({
          action: "quote",
          decisionAt: input.now,
          makerId: config.makerId,
          sellTokenId: tokenIds.sellTokenId,
          buyTokenId: tokenIds.buyTokenId,
          schedule: input.schedule,
          quoteTtlSeconds: input.quoteTtlSeconds,
          referenceObservedAt: input.now,
          referenceMidE18:
            makerVariant === "B"
              ? 2_010_000_000_000_000_000n
              : 2_000_000_000_000_000_000n,
        });
        return Object.freeze({
          allowed: decision.allowed,
          ...(decision.allowed
            ? {
                commitmentUsdcBaseUnits:
                  decision.derivedUsdcEquivalentBaseUnits,
              }
            : { reason: formatRfqEconomicRefusal(decision) }),
        });
      },
      commit(input) {
        economics.commit(
          config.makerId,
          input.commitmentUsdcBaseUnits,
          input.now,
          input.lockId,
        );
      },
    },
    midE18:
      makerVariant === "B"
        ? 2_010_000_000_000_000_000n
        : 2_000_000_000_000_000_000n,
    transcriptJournal: transcripts,
    clock: () => Math.floor(Date.now() / 1_000),
  },
});
await maker.recoverAfterRestart(Math.floor(Date.now() / 1_000));
let settlementScanRunning = false;
const settlementTimer = setInterval(() => {
  if (settlementScanRunning) return;
  settlementScanRunning = true;
  void maker
    .settleExpiredLocks(Math.floor(Date.now() / 1_000))
    .catch((error) => {
      console.error(
        `APP20 maker node: settlement scan failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      settlementScanRunning = false;
    });
}, 5_000);

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

function requireExactBody(body, fields, label) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${label} must be an object.`);
  }
  const expected = new Set(fields);
  for (const field of fields) {
    if (!(field in body)) throw new Error(`${label}.${field} is required.`);
  }
  for (const field of Object.keys(body)) {
    if (!expected.has(field)) {
      throw new Error(`${label}.${field} is unsupported.`);
    }
  }
  return body;
}

function parseReconciliationTarget(value) {
  return parseLocalnetMakerReconciliationTarget(value);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${config.port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, { result: maker.health() });
      return;
    }
    requireAuth(request);
    const now = Math.floor(Date.now() / 1_000);
    if (request.method === "GET" && url.pathname === "/v1/mids") {
      try {
        jsonResponse(response, 200, {
          mid: encodeMakerMid(await maker.indicativeMid(now)),
        });
      } catch {
        jsonResponse(response, 500, {
          error: "Maker indicative mid signing failed closed.",
        });
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/transcripts") {
      try {
        jsonResponse(response, 200, { transcripts: maker.listTranscripts() });
      } catch {
        jsonResponse(response, 500, {
          error: "Maker transcript journal is unavailable.",
        });
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/locks") {
      try {
        jsonResponse(response, 200, { locks: maker.listLocks() });
      } catch {
        jsonResponse(response, 500, {
          error: "Maker lock journal is unavailable.",
        });
      }
      return;
    }
    if (request.method !== "POST") {
      jsonResponse(response, 404, { error: "Unknown maker-node route." });
      return;
    }
    const body = await readBody(request);
    if (url.pathname === "/v1/quotes-v3") {
      requireExactBody(body, ["rfq"], "Quote v3 request");
      const decoded = decodePrivateRfqV2(body.rfq);
      let result;
      try {
        result = await maker.quoteV3(decoded, now);
      } catch (error) {
        if (
          error instanceof MakerNodeError &&
          /does not match this maker's localnet settlement context/i.test(
            error.message,
          )
        ) {
          throw error;
        }
        result = {
          refused: {
            code: "lock-failed",
            reason: "Maker quote pipeline failed closed.",
          },
        };
      }
      jsonResponse(
        response,
        200,
        "quote" in result
          ? {
              quote: encodeSolverQuoteV3(result.quote),
              lock: result.lock,
            }
          : result,
      );
      return;
    }
    if (url.pathname === "/v1/transcripts") {
      requireExactBody(body, ["transcript"], "Transcript request");
      const transcript = decodeSelectionTranscript(body.transcript);
      try {
        jsonResponse(
          response,
          200,
          await maker.journalTranscript(transcript, now),
        );
      } catch (error) {
        if (error instanceof MakerTranscriptConflictError) throw error;
        jsonResponse(response, 500, {
          error: "Maker transcript journal failed closed.",
        });
      }
      return;
    }
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
    if (url.pathname === "/v1/reconciliation/bind") {
      const result = await maker.bindSettlementForReconciliation(
        parseReconciliationTarget(body.target),
        now,
      );
      jsonResponse(response, 200, { result });
      return;
    }
    if (url.pathname === "/v1/reconciliation/snapshot") {
      const result = await maker.readReconciliationSnapshot(
        parseReconciliationTarget(body.target),
        now,
      );
      jsonResponse(response, 200, { result });
      return;
    }
    if (url.pathname === "/v1/reconciliation/quarantine") {
      const result = await maker.quarantineForAuthority(
        {
          target: parseReconciliationTarget(body.target),
          attemptId: body.attemptId,
          authorityDigest: body.authorityDigest,
          authorityRevision: body.authorityRevision,
          outcome: body.outcome,
          reason: body.reason,
        },
        now,
      );
      jsonResponse(response, 200, { result });
      return;
    }
    if (url.pathname === "/v1/reconciliation/terminal") {
      const result = await maker.reconcileAuthoritativeTerminal(
        {
          target: parseReconciliationTarget(body.target),
          attemptId: body.attemptId,
          authorityDigest: body.authorityDigest,
          authorityRevision: body.authorityRevision,
          outcome: body.outcome,
          settlementTransactionHash: body.settlementTransactionHash,
        },
        now,
      );
      jsonResponse(response, 200, { result });
      return;
    }
    jsonResponse(response, 404, { error: "Unknown maker-node route." });
  } catch (error) {
    jsonResponse(
      response,
      error instanceof MakerTranscriptConflictError ? 409 : 400,
      { error: error instanceof Error ? error.message : String(error) },
    );
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
  clearInterval(settlementTimer);
  await new Promise((resolveClose) => server.close(resolveClose));
  await store.close();
  process.exit(code);
}
process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
