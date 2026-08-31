#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "starknet";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  EgressFailure,
  EgressRefusal,
  assertHttpsUrl,
  createEgressSession,
} from "./egress-policy.mjs";

const MAX_RECORD_BYTES = 64 * 1024;
const PLACEHOLDER_ADDRESS = "<REPLACE_WITH_REVIEWED_STARKNET_TOKEN_ADDRESS>";
const CHAIN_IDS = Object.freeze({
  mainnet: "0x534e5f4d41494e",
  sepolia: "0x534e5f5345504f4c4941",
});
const RECORD_KEYS = Object.freeze([
  "chain",
  "chainId",
  "proposedAddress",
  "expectedSymbol",
  "expectedName",
  "expectedDecimals",
  "claimProvenance",
  "reviewerIdentity",
  "reviewDate",
  "verified",
]);
const PROVENANCE_KEYS = Object.freeze(["sourceUrl", "claim", "accessedAt"]);
const SELECTORS = Object.freeze({
  symbol: hash.getSelectorFromName("symbol"),
  name: hash.getSelectorFromName("name"),
  decimals: hash.getSelectorFromName("decimals"),
});

export class VerificationRefusal extends Error {}
export class VerificationFailure extends Error {}

function rethrowVerification(error) {
  if (
    error instanceof VerificationRefusal ||
    error instanceof VerificationFailure
  ) {
    throw error;
  }
  if (error instanceof EgressRefusal) {
    throw new VerificationRefusal(error.message);
  }
  if (error instanceof EgressFailure) {
    throw new VerificationFailure(error.message);
  }
  throw error;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VerificationRefusal(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new VerificationRefusal(
      `${label} keys must exactly match the schema`,
    );
  }
}

function validDateTime(value) {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match) return false;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return false;
  return (
    instant.getUTCFullYear() === Number(match[1]) &&
    instant.getUTCMonth() + 1 === Number(match[2]) &&
    instant.getUTCDate() === Number(match[3]) &&
    instant.getUTCHours() === Number(match[4]) &&
    instant.getUTCMinutes() === Number(match[5]) &&
    instant.getUTCSeconds() === Number(match[6])
  );
}

function httpsUrl(value, label) {
  try {
    return assertHttpsUrl(value, label);
  } catch (error) {
    rethrowVerification(error);
  }
}

function parseFelt(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new VerificationFailure(`${label} is not a hexadecimal felt`);
  }
  const felt = BigInt(value);
  if (felt < 0n || felt >= 1n << 251n) {
    throw new VerificationFailure(`${label} is outside the bounded felt range`);
  }
  return felt;
}

export function validateCandidateRecord(record) {
  exactKeys(record, RECORD_KEYS, "candidate record");
  if (!Object.hasOwn(CHAIN_IDS, record.chain)) {
    throw new VerificationRefusal("chain must be mainnet or sepolia");
  }
  if (record.chainId !== CHAIN_IDS[record.chain]) {
    throw new VerificationRefusal("chainId does not match chain");
  }
  if (record.proposedAddress === PLACEHOLDER_ADDRESS) {
    throw new VerificationRefusal(
      "the example placeholder is not a token address",
    );
  }
  if (
    typeof record.proposedAddress !== "string" ||
    !/^0x[0-9a-fA-F]{1,63}$/.test(record.proposedAddress)
  ) {
    throw new VerificationRefusal(
      "proposedAddress must be a non-zero bounded Starknet felt",
    );
  }
  const address = BigInt(record.proposedAddress);
  if (address === 0n || address >= 1n << 251n) {
    throw new VerificationRefusal(
      "proposedAddress must be a non-zero bounded Starknet felt",
    );
  }
  for (const [field, maximum] of [
    ["expectedSymbol", 64],
    ["expectedName", 256],
  ]) {
    if (
      typeof record[field] !== "string" ||
      record[field].length < 1 ||
      record[field].length > maximum
    ) {
      throw new VerificationRefusal(
        `${field} must be a non-empty bounded string`,
      );
    }
  }
  if (
    !Number.isInteger(record.expectedDecimals) ||
    record.expectedDecimals < 0 ||
    record.expectedDecimals > 255
  ) {
    throw new VerificationRefusal(
      "expectedDecimals must be an integer from 0 to 255",
    );
  }
  exactKeys(record.claimProvenance, PROVENANCE_KEYS, "claimProvenance");
  httpsUrl(record.claimProvenance.sourceUrl, "claimProvenance.sourceUrl");
  if (
    typeof record.claimProvenance.claim !== "string" ||
    record.claimProvenance.claim.trim().length === 0 ||
    record.claimProvenance.claim.length > 2000
  ) {
    throw new VerificationRefusal(
      "claimProvenance.claim must be non-empty and bounded",
    );
  }
  if (!validDateTime(record.claimProvenance.accessedAt)) {
    throw new VerificationRefusal(
      "claimProvenance.accessedAt must be a UTC date-time",
    );
  }
  if (
    typeof record.reviewerIdentity !== "string" ||
    record.reviewerIdentity.trim().length === 0 ||
    record.reviewerIdentity.length > 256 ||
    !validDateTime(record.reviewDate)
  ) {
    throw new VerificationRefusal(
      "candidate is unreviewed: reviewerIdentity and reviewDate are required",
    );
  }
  if (record.verified !== false) {
    throw new VerificationRefusal(
      "verified must remain false for untrusted single-RPC evidence",
    );
  }
  return Object.freeze({
    ...record,
    claimProvenance: Object.freeze({ ...record.claimProvenance }),
  });
}

async function rpcRequest(method, params, id, session) {
  let response;
  try {
    response = await session.request({
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  } catch (error) {
    rethrowVerification(error);
  }
  if (!response.ok) {
    throw new VerificationFailure(`RPC returned HTTP ${response.status}`);
  }
  let body;
  try {
    body = JSON.parse(response.text);
  } catch {
    throw new VerificationFailure("RPC response is not valid JSON");
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.jsonrpc !== "2.0" ||
    body.id !== id
  ) {
    throw new VerificationFailure("RPC response envelope is invalid");
  }
  if (body.error) {
    const code = Number.isInteger(body.error.code)
      ? body.error.code
      : "unknown";
    throw new VerificationFailure(`RPC ${method} failed with code ${code}`);
  }
  if (!Object.hasOwn(body, "result")) {
    throw new VerificationFailure("RPC response has no result");
  }
  return body.result;
}

function feltToBytes(value, width, label) {
  const felt = parseFelt(value, label);
  const hex = felt.toString(16);
  if (hex.length > width * 2) {
    throw new VerificationFailure(`${label} exceeds its encoded byte width`);
  }
  return Uint8Array.from(Buffer.from(hex.padStart(width * 2, "0"), "hex"));
}

function decodeUtf8(bytes, label) {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/\u0000/.test(decoded)) {
      throw new Error("NUL");
    }
    return decoded;
  } catch {
    throw new VerificationFailure(`${label} is not valid token text`);
  }
}

export function decodeTokenText(result, label) {
  if (!Array.isArray(result) || result.length === 0) {
    throw new VerificationFailure(
      `${label} call returned an invalid felt array`,
    );
  }
  if (result.length === 1) {
    const felt = parseFelt(result[0], `${label} felt`);
    if (felt === 0n) return "";
    const width = Math.ceil(felt.toString(16).length / 2);
    return decodeUtf8(feltToBytes(result[0], width, `${label} felt`), label);
  }

  const fullWordCount = parseFelt(result[0], `${label} data length`);
  if (fullWordCount > 2048n || fullWordCount + 3n !== BigInt(result.length)) {
    throw new VerificationFailure(`${label} ByteArray shape is invalid`);
  }
  const bytes = [];
  for (let index = 0; index < Number(fullWordCount); index += 1) {
    bytes.push(...feltToBytes(result[index + 1], 31, `${label} data word`));
  }
  const pendingLength = parseFelt(
    result[result.length - 1],
    `${label} pending length`,
  );
  if (pendingLength > 30n) {
    throw new VerificationFailure(`${label} pending word is too long`);
  }
  const pendingWord = result[result.length - 2];
  if (pendingLength === 0n) {
    if (parseFelt(pendingWord, `${label} pending word`) !== 0n) {
      throw new VerificationFailure(`${label} empty pending word is non-zero`);
    }
  } else {
    bytes.push(
      ...feltToBytes(
        pendingWord,
        Number(pendingLength),
        `${label} pending word`,
      ),
    );
  }
  return decodeUtf8(Uint8Array.from(bytes), label);
}

function callParams(address, selector) {
  return [
    {
      contract_address: address,
      entry_point_selector: selector,
      calldata: [],
    },
    "latest",
  ];
}

export async function verifyTokenIdentity(record, rpcUrlInput, options = {}) {
  const candidate = validateCandidateRecord(record);
  const rpcUrl = httpsUrl(rpcUrlInput, "RPC URL");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  let session;
  try {
    session = await createEgressSession(rpcUrl, {
      kind: "RPC",
      timeoutMs,
      maxResponseBytes,
      lookupImpl: options.lookupImpl,
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    rethrowVerification(error);
  }
  try {
    const actualChainId = await rpcRequest("starknet_chainId", [], 1, session);
    if (
      parseFelt(actualChainId, "RPC chain id") !==
      parseFelt(candidate.chainId, "candidate chain id")
    ) {
      throw new VerificationFailure(
        "RPC chain id does not match candidate chainId",
      );
    }

    const symbolResult = await rpcRequest(
      "starknet_call",
      callParams(candidate.proposedAddress, SELECTORS.symbol),
      2,
      session,
    );
    const nameResult = await rpcRequest(
      "starknet_call",
      callParams(candidate.proposedAddress, SELECTORS.name),
      3,
      session,
    );
    const decimalsResult = await rpcRequest(
      "starknet_call",
      callParams(candidate.proposedAddress, SELECTORS.decimals),
      4,
      session,
    );
    const actual = Object.freeze({
      symbol: decodeTokenText(symbolResult, "symbol"),
      name: decodeTokenText(nameResult, "name"),
      decimals:
        Array.isArray(decimalsResult) && decimalsResult.length === 1
          ? parseFelt(decimalsResult[0], "decimals")
          : null,
    });
    if (actual.decimals === null) {
      throw new VerificationFailure(
        "decimals call returned an invalid felt array",
      );
    }
    const mismatches = [];
    if (actual.symbol !== candidate.expectedSymbol) mismatches.push("symbol");
    if (actual.name !== candidate.expectedName) mismatches.push("name");
    if (actual.decimals !== BigInt(candidate.expectedDecimals)) {
      mismatches.push("decimals");
    }
    if (mismatches.length > 0) {
      throw new VerificationFailure(
        `RPC-reported identity mismatch: ${mismatches.join(", ")}`,
      );
    }
    return Object.freeze({
      chain: candidate.chain,
      chainId: candidate.chainId,
      proposedAddress: candidate.proposedAddress,
      rpcOrigin: rpcUrl.origin,
      symbol: actual.symbol,
      name: actual.name,
      decimals: actual.decimals.toString(10),
      evidenceStatus: "rpc-reported-match-untrusted-single-source",
      rpcReportedMatch: true,
      candidateVerifiedFlag: candidate.verified,
      recordModified: false,
    });
  } finally {
    session.close();
  }
}

function usage() {
  console.log(`Read-only collection of RPC-reported token candidate evidence.

Usage:
  node scripts/verify-token-identity.mjs <candidate.json> --rpc-url <https-url>
  APP20_TOKEN_IDENTITY_RPC_URL=<https-url> node scripts/verify-token-identity.mjs <candidate.json>

The RPC URL is operator-supplied and is never written. A matching response is
untrusted single-source RPC evidence only, never verified on-chain identity.
The candidate record is never modified. Match exits with status 3 so automation
cannot mistake this evidence-collection result for verification or promotion.`);
}

function parseArguments(argv, environment) {
  if (argv.length === 1 && ["-h", "--help"].includes(argv[0])) {
    return { help: true };
  }
  let candidatePath;
  let rpcUrl = environment.APP20_TOKEN_IDENTITY_RPC_URL;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rpc-url") {
      if (index + 1 >= argv.length || rpcUrl) {
        throw new VerificationRefusal("RPC URL must be supplied exactly once");
      }
      rpcUrl = argv[++index];
    } else if (!argument.startsWith("-") && !candidatePath) {
      candidatePath = argument;
    } else {
      throw new VerificationRefusal(`unexpected argument: ${argument}`);
    }
  }
  if (!candidatePath)
    throw new VerificationRefusal("candidate record path is required");
  if (!rpcUrl)
    throw new VerificationRefusal("operator-supplied RPC URL is required");
  return { candidatePath, rpcUrl, help: false };
}

async function readCandidate(path) {
  const absolutePath = resolve(path);
  const stat = await lstat(absolutePath).catch((error) => {
    throw new VerificationRefusal(
      `candidate record cannot be opened: ${error.message}`,
    );
  });
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new VerificationRefusal(
      "candidate record must be a regular non-symlink file",
    );
  }
  if (stat.size > MAX_RECORD_BYTES) {
    throw new VerificationRefusal(
      "candidate record exceeds the input-size limit",
    );
  }
  let record;
  try {
    record = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new VerificationRefusal(
      `candidate record is invalid JSON: ${error.message}`,
    );
  }
  return record;
}

export async function main(
  argv = process.argv.slice(2),
  environment = process.env,
  verificationOptions = {},
) {
  try {
    const arguments_ = parseArguments(argv, environment);
    if (arguments_.help) {
      usage();
      return 0;
    }
    const record = await readCandidate(arguments_.candidatePath);
    const result = await verifyTokenIdentity(
      record,
      arguments_.rpcUrl,
      verificationOptions,
    );
    console.log(
      "RPC-REPORTED MATCH: UNTRUSTED SINGLE-SOURCE EVIDENCE; HUMAN REVIEW REQUIRED",
    );
    console.log(JSON.stringify(result, null, 2));
    console.log(
      "NOTICE: this is not verified on-chain identity; no candidate file or verified flag was modified",
    );
    return 3;
  } catch (error) {
    if (error instanceof VerificationRefusal) {
      console.error(`REFUSED: ${error.message}`);
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL: ${message}`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
