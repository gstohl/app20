#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Account,
  RpcProvider,
  hash,
  json,
  num,
} from "starknet";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC_URL = process.env.APP20_DEVNET_RPC ?? "http://127.0.0.1:5050/rpc";
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const AMBIENT_DONATION = 1_000_000_000_000_000n; // 0.001 STRK
const RECOVERY_AMOUNT = 7n;
const NOTE_ID = "0x515";
const TX_DETAILS = { tip: 0n };

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function feltEqual(left, right) {
  return BigInt(left) === BigInt(right);
}

function u256FromFelts(values) {
  check(values.length >= 2, "Expected a serialized u256 response.");
  return BigInt(values[0]) + (BigInt(values[1]) << 128n);
}

function localExecutable(name) {
  const local = join(homedir(), ".local", "bin", name);
  return existsSync(local) ? local : name;
}

function buildLocalArtifacts() {
  execFileSync(localExecutable("scarb"), ["build"], {
    cwd: join(ROOT, "cairo"),
    stdio: "inherit",
  });

  const outDir = join(ROOT, ".e2e-build");
  mkdirSync(outDir, { recursive: true });
  execFileSync(
    join(ROOT, "node_modules", ".bin", "tsc"),
    ["--project", join(ROOT, "scripts", "tsconfig.mail.json")],
    { cwd: ROOT, stdio: "inherit" },
  );
  writeFileSync(join(outDir, "package.json"), '{"type":"module"}\n');
}

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  check(response.ok, `${method} returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method}: ${payload.error.message ?? JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function wait(provider, transactionHash) {
  check(transactionHash, "A transaction hash was not returned.");
  await provider.waitForTransaction(transactionHash, {
    retryInterval: 250,
    retries: 120,
  });
}

async function callU256(provider, contractAddress, entrypoint, calldata) {
  const result = await provider.callContract({
    contractAddress,
    entrypoint,
    calldata,
  });
  return u256FromFelts(result);
}

function findCallTrace(value, contractAddress, selector) {
  if (!value || typeof value !== "object") return undefined;
  if (
    "contract_address" in value &&
    "entry_point_selector" in value &&
    feltEqual(value.contract_address, contractAddress) &&
    feltEqual(value.entry_point_selector, selector)
  ) {
    return value;
  }
  for (const child of Object.values(value)) {
    const found = findCallTrace(child, contractAddress, selector);
    if (found) return found;
  }
  return undefined;
}

function parseMessageEvent(event) {
  check(event.keys.length === 2, "MessagePosted must have selector and index keys.");
  check(BigInt(event.keys[1]) === 0n, "Unexpected first message index.");
  check(event.data.length >= 6, "MessagePosted event data is truncated.");

  const ciphertextLength = Number(BigInt(event.data[5]));
  check(
    Number.isSafeInteger(ciphertextLength) && ciphertextLength >= 0,
    "Invalid ciphertext felt length.",
  );
  check(
    event.data.length === 7 + ciphertextLength,
    "MessagePosted ciphertext length does not match its event data.",
  );

  return {
    ephemeralPub: [event.data[0], event.data[1]],
    viewTag: Number(BigInt(event.data[2])),
    nonce: [event.data[3], event.data[4]],
    ciphertextFelts: event.data.slice(6, 6 + ciphertextLength),
    actionId: event.data[6 + ciphertextLength],
  };
}

async function main() {
  await rpc("starknet_chainId");
  buildLocalArtifacts();
  const {
    deriveKeypair,
    encryptMail,
    publicKeyFromFelts,
    publicKeyToFelts,
    scanAndDecrypt,
  } = await import(pathToFileURL(join(ROOT, ".e2e-build", "mail.js")).href);

  const accounts = await rpc("devnet_getPredeployedAccounts");
  check(accounts.length >= 2, "Devnet did not expose two prefunded accounts.");

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const pool = new Account({
    provider,
    address: accounts[0].address,
    signer: accounts[0].private_key,
    cairoVersion: "1",
  });
  const recipientAccount = new Account({
    provider,
    address: accounts[1].address,
    signer: accounts[1].private_key,
    cairoVersion: "1",
  });

  const artifactRoot = join(ROOT, "cairo", "target", "dev");
  const sierra = json.parse(
    readFileSync(
      join(artifactRoot, "app20_mail_App20Mail.contract_class.json"),
      "utf8",
    ),
  );
  const casm = json.parse(
    readFileSync(
      join(
        artifactRoot,
        "app20_mail_App20Mail.compiled_contract_class.json",
      ),
      "utf8",
    ),
  );

  const declaration = await pool.declareIfNot(
    { contract: sierra, casm },
    TX_DETAILS,
  );
  if (declaration.transaction_hash) {
    await wait(provider, declaration.transaction_hash);
  }

  const deployment = await pool.deployContract(
    {
      classHash: declaration.class_hash,
      constructorCalldata: [pool.address],
    },
    TX_DETAILS,
  );
  await wait(provider, deployment.transaction_hash);
  const helperAddress = deployment.address;

  const recipient = deriveKeypair(new Uint8Array(32).fill(0x42));
  const stranger = deriveKeypair(new Uint8Array(32).fill(0x43));
  const pubkeyFelts = publicKeyToFelts(recipient.publicKey);

  const register = await recipientAccount.execute(
    {
      contractAddress: helperAddress,
      entrypoint: "register_pubkey",
      calldata: pubkeyFelts,
    },
    TX_DETAILS,
  );
  await wait(provider, register.transaction_hash);

  const registeredKey = await provider.callContract({
    contractAddress: helperAddress,
    entrypoint: "get_pubkey",
    calldata: [recipientAccount.address],
  });
  check(registeredKey.length === 2, "Directory returned an invalid public key.");
  check(
    feltEqual(registeredKey[0], pubkeyFelts[0]) &&
      feltEqual(registeredKey[1], pubkeyFelts[1]),
    "Directory public-key roundtrip failed.",
  );

  const record = await encryptMail(
    publicKeyFromFelts(registeredKey),
    "hello from APP20",
  );

  const dustTransfer = await pool.execute(
    {
      contractAddress: STRK,
      entrypoint: "transfer",
      calldata: [helperAddress, num.toHex(AMBIENT_DONATION), "0x0"],
    },
    TX_DETAILS,
  );
  await wait(provider, dustTransfer.transaction_hash);
  check(
    (await callU256(provider, STRK, "balance_of", [helperAddress])) ===
      AMBIENT_DONATION,
    "Helper did not receive the 0.001 STRK dust case.",
  );
  check(
    (await callU256(provider, STRK, "allowance", [helperAddress, pool.address])) === 0n,
    "Ambient donation unexpectedly created a pool allowance.",
  );

  const privacyCalldata = [
    STRK,
    pool.address,
    NOTE_ID,
    record.ephemeralPub[0],
    record.ephemeralPub[1],
    num.toHex(record.viewTag),
    record.nonce[0],
    record.nonce[1],
    num.toHex(record.ciphertextFelts.length),
    ...record.ciphertextFelts,
    "0x0",
  ];
  const posted = await pool.execute(
    [
      {
        contractAddress: helperAddress,
        entrypoint: "prepare_funding",
        calldata: [STRK],
      },
      {
        contractAddress: STRK,
        entrypoint: "transfer",
        calldata: [helperAddress, num.toHex(RECOVERY_AMOUNT), "0x0"],
      },
      {
        contractAddress: helperAddress,
        entrypoint: "privacy_invoke",
        calldata: privacyCalldata,
      },
    ],
    TX_DETAILS,
  );
  await wait(provider, posted.transaction_hash);

  const allowance = await callU256(provider, STRK, "allowance", [
    helperAddress,
    pool.address,
  ]);
  check(
    allowance === RECOVERY_AMOUNT,
    "Helper did not approve the exact Mail recovery amount.",
  );

  const invokeSelector = hash.getSelectorFromName("privacy_invoke");
  const trace = await provider.getTransactionTrace(posted.transaction_hash);
  const helperTrace = findCallTrace(trace, helperAddress, invokeSelector);
  check(helperTrace, "privacy_invoke was not found in the transaction trace.");
  const echo = helperTrace.result ?? [];
  check(echo.length === 4, "privacy_invoke did not return one OpenNoteDeposit.");
  check(BigInt(echo[0]) === 1n, "Open-note return span has the wrong length.");
  check(feltEqual(echo[1], NOTE_ID), "Open-note return has the wrong note id.");
  check(feltEqual(echo[2], STRK), "Open-note return has the wrong token.");
  check(BigInt(echo[3]) === RECOVERY_AMOUNT, "Open-note return has the wrong amount.");

  const eventSelector = hash.getSelectorFromName("MessagePosted");
  const events = [];
  const seenTokens = new Set();
  let continuationToken;
  do {
    const chunk = await provider.getEvents({
      address: helperAddress,
      from_block: { block_number: 0 },
      to_block: "latest",
      keys: [[eventSelector]],
      chunk_size: 100,
      ...(continuationToken
        ? { continuation_token: continuationToken }
        : {}),
    });
    events.push(...chunk.events);
    continuationToken = chunk.continuation_token;
    if (continuationToken) {
      check(
        !seenTokens.has(continuationToken),
        "RPC repeated an event continuation token.",
      );
      seenTokens.add(continuationToken);
    }
  } while (continuationToken);
  check(events.length === 1, "Expected exactly one MessagePosted event.");
  const eventRecord = parseMessageEvent(events[0]);
  check(BigInt(eventRecord.actionId) === 0n, "Mock-pool mail must use action_id = 0.");

  const decrypted = await scanAndDecrypt(recipient.privateKey, [eventRecord]);
  check(decrypted.length === 1, "Recipient did not discover exactly one message.");
  check(
    decrypted[0].plaintext === "hello from APP20",
    "Recipient recovered the wrong plaintext.",
  );
  check(
    (await scanAndDecrypt(stranger.privateKey, [eventRecord])).length === 0,
    "A second keypair decrypted recipient mail.",
  );

  const cleanup = await pool.execute(
    {
      contractAddress: STRK,
      entrypoint: "transfer_from",
      calldata: [helperAddress, pool.address, num.toHex(RECOVERY_AMOUNT), "0x0"],
    },
    TX_DETAILS,
  );
  await wait(provider, cleanup.transaction_hash);
  check(
    (await callU256(provider, STRK, "balance_of", [helperAddress])) ===
      AMBIENT_DONATION,
    "Mock pool captured the helper's pre-existing donation.",
  );

  const count = await provider.callContract({
    contractAddress: helperAddress,
    entrypoint: "message_count",
    calldata: [],
  });
  check(BigInt(count[0]) === 1n, "Helper message count is not one.");

  console.log("APP20 devnet e2e passed.");
  console.log(`  helper: ${helperAddress}`);
  console.log(`  MessagePosted tx: ${posted.transaction_hash}`);
  console.log("  decrypted: hello from APP20");
  console.log("  wrong-key messages: 0");
  console.log("  recovery: exact 7 base units approved and pulled; ambient donation preserved");
}

main().catch((error) => {
  console.error("APP20 devnet e2e failed:");
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
