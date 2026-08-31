#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ABI_MANIFEST_SCHEMA = "app20/abi-manifest/v1";
export const PINNED_ABI_DECODER_SCHEMA = "app20/pinned-abi-decoder/v1";
export const TEST_FIXTURE_CLASSIFICATION = "p0-21-generator-test-fixture";
export const DEFAULT_MANIFESTS_DIR = "docs/evidence/abi-manifests";
export const TEST_FIXTURE_RELATIVE_PATH =
  "docs/evidence/abi-manifests/p0-21-generator-test-fixture.json";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const STAGES = Object.freeze(["fund", "fill", "claim", "timeout"]);
const FIELD_KINDS = new Set(["felt", "u128", "u64"]);
const ARTIFACT_KEYS = Object.freeze([
  "schema",
  "classification",
  "warning",
  "canonicalProductionAbi",
  "runtimeAllowed",
  "productionEligible",
  "p0_07_canonical_abi_present",
  "p0_21_status",
  "chainId",
  "contractAddress",
  "classHash",
  "deploymentBlock",
  "abiBytes",
  "abiDigest",
  "selectors",
  "eventLayouts",
]);
const LAYOUT_KEYS = Object.freeze(["name", "keys", "data"]);
const FIELD_KEYS = Object.freeze(["name", "decodedName", "kind"]);
const INDEX_KEYS = Object.freeze([
  "schemaVersion",
  "scope",
  "runtimeAllowed",
  "productionEligible",
  "canonicalAbiPresent",
  "generatedDecoderPresent",
  "p0_21_status",
  "blockedUntil",
  "schema",
  "records",
]);
const FORBIDDEN_OUTPUT_TOP_LEVEL = new Set([
  "src",
  "public",
  "workers",
  "packages",
  "dist",
]);
const FORBIDDEN_OUTPUT_FILES = Object.freeze([
  "scripts/localnet-chain-decoder.mjs",
  "scripts/localnet-chain-decoder.test.mjs",
  "scripts/generate-abi-decoder.mjs",
  "scripts/generate-abi-decoder.test.mjs",
]);

export class DecoderGenerationRefusal extends Error {}

function fail(message) {
  throw new DecoderGenerationRefusal(message);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    fail(`${label} keys are not exact.`);
}

function canonicalFelt(value, label, allowZero = false) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value))
    fail(`${label} must be a lowercase hexadecimal felt.`);
  const parsed = BigInt(value);
  if (parsed >= 1n << 252n || (!allowZero && parsed === 0n))
    fail(`${label} is outside the accepted felt range.`);
  const canonical = `0x${parsed.toString(16)}`;
  if (value !== canonical) fail(`${label} must be canonical.`);
  return canonical;
}

function sha256Digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function booleanFlag(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be a boolean.`);
  return value;
}

function requiredText(value, label, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(`${label} is invalid.`);
  return value;
}

function containedPath(root, candidate, label) {
  const resolved = resolve(candidate);
  const rel = relative(root, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
    fail(`${label} escapes the repository.`);
  return resolved;
}

async function readRegularJson(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} is missing.`);
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink())
    fail(`${label} must be a regular non-symlink file.`);
  if (metadata.size <= 0 || metadata.size > MAX_ARTIFACT_BYTES)
    fail(`${label} exceeds the accepted size.`);
  const bytes = await readFile(path);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  return {
    bytes,
    value,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function validateField(field, label) {
  exactKeys(field, FIELD_KEYS, label);
  if (typeof field.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(field.name))
    fail(`${label}.name is invalid.`);
  if (
    typeof field.decodedName !== "string" ||
    !/^[a-z][A-Za-z0-9]*$/.test(field.decodedName)
  )
    fail(`${label}.decodedName is invalid.`);
  if (!FIELD_KINDS.has(field.kind)) fail(`${label}.kind is not supported.`);
  return Object.freeze({
    name: field.name,
    decodedName: field.decodedName,
    kind: field.kind,
  });
}

function validateLayout(layout, abiEvent, label) {
  exactKeys(layout, LAYOUT_KEYS, label);
  if (
    typeof layout.name !== "string" ||
    !/^[A-Z][A-Za-z0-9]*$/.test(layout.name)
  )
    fail(`${label}.name is invalid.`);
  if (!Array.isArray(layout.keys) || layout.keys.length < 1)
    fail(`${label}.keys must be a non-empty array.`);
  if (!Array.isArray(layout.data) || layout.data.length < 1)
    fail(`${label}.data must be a non-empty array.`);
  const keys = layout.keys.map((field, index) =>
    validateField(field, `${label}.keys[${index}]`),
  );
  const data = layout.data.map((field, index) =>
    validateField(field, `${label}.data[${index}]`),
  );
  if (!abiEvent || typeof abiEvent !== "object" || Array.isArray(abiEvent))
    fail(`${label} is missing from abiBytes events.`);
  exactKeys(abiEvent, ["keys", "data"], `${label} abi event`);
  if (!Array.isArray(abiEvent.keys) || !Array.isArray(abiEvent.data))
    fail(`${label} abi event keys/data must be arrays.`);
  if (
    JSON.stringify(abiEvent.keys) !==
    JSON.stringify(keys.map((field) => field.name))
  )
    fail(`${label} keys do not match abiBytes.`);
  if (
    JSON.stringify(abiEvent.data) !==
    JSON.stringify(data.map((field) => field.name))
  )
    fail(`${label} data do not match abiBytes.`);
  return Object.freeze({ name: layout.name, keys, data });
}

export function validateAbiArtifact(value) {
  exactKeys(value, ARTIFACT_KEYS, "ABI artifact");
  if (value.schema !== ABI_MANIFEST_SCHEMA)
    fail("ABI artifact schema is not app20/abi-manifest/v1.");
  const classification = requiredText(
    value.classification,
    "classification",
    64,
  );
  if (!/^[a-z0-9-]{8,64}$/.test(classification))
    fail("classification is invalid.");
  const warning = requiredText(value.warning, "warning");
  const canonicalProductionAbi = booleanFlag(
    value.canonicalProductionAbi,
    "canonicalProductionAbi",
  );
  const runtimeAllowed = booleanFlag(value.runtimeAllowed, "runtimeAllowed");
  const productionEligible = booleanFlag(
    value.productionEligible,
    "productionEligible",
  );
  const p007Present = booleanFlag(
    value.p0_07_canonical_abi_present,
    "p0_07_canonical_abi_present",
  );
  const p021Status = requiredText(value.p0_21_status, "p0_21_status", 32);
  if (classification === TEST_FIXTURE_CLASSIFICATION) {
    if (!warning.includes("TEST FIXTURE"))
      fail(
        "Test fixture warning must identify the artifact as a TEST FIXTURE.",
      );
    if (
      canonicalProductionAbi ||
      runtimeAllowed ||
      productionEligible ||
      p007Present
    )
      fail("Test fixture artifacts cannot claim canonical or production ABI.");
    if (p021Status !== "open")
      fail("Test fixture artifacts cannot close P0-21.");
  }
  if (typeof value.abiBytes !== "string" || value.abiBytes.length === 0)
    fail("abiBytes must be a non-empty string.");
  const digest = sha256Digest(value.abiBytes);
  if (value.abiDigest !== digest)
    fail("abiDigest does not match sha256(abiBytes).");
  if (!/^sha256:[0-9a-f]{64}$/.test(value.abiDigest))
    fail("abiDigest is not a sha256 digest.");
  let abi;
  try {
    abi = JSON.parse(value.abiBytes);
  } catch (error) {
    fail(`abiBytes is invalid JSON: ${error.message}`);
  }
  exactKeys(abi, ["contract", "version", "events"], "abiBytes");
  if (typeof abi.contract !== "string" || !abi.contract.trim())
    fail("abiBytes.contract is invalid.");
  if (abi.version !== 1) fail("abiBytes.version must be 1.");
  if (
    !abi.events ||
    typeof abi.events !== "object" ||
    Array.isArray(abi.events)
  )
    fail("abiBytes.events must be an object.");
  exactKeys(value.selectors, STAGES, "selectors");
  exactKeys(value.eventLayouts, STAGES, "eventLayouts");
  const selectors = {};
  const seenSelectors = new Set();
  const seenEventNames = new Set();
  const eventLayouts = {};
  for (const stage of STAGES) {
    const selector = canonicalFelt(value.selectors[stage], `${stage} selector`);
    if (seenSelectors.has(selector)) fail("Event selectors must be unique.");
    seenSelectors.add(selector);
    selectors[stage] = selector;
    const layout = validateLayout(
      value.eventLayouts[stage],
      abi.events[value.eventLayouts[stage]?.name],
      `eventLayouts.${stage}`,
    );
    if (seenEventNames.has(layout.name)) fail("Event names must be unique.");
    seenEventNames.add(layout.name);
    eventLayouts[stage] = layout;
  }
  if (!Number.isSafeInteger(value.deploymentBlock) || value.deploymentBlock < 0)
    fail("deploymentBlock must be a non-negative safe integer.");
  return Object.freeze({
    schema: ABI_MANIFEST_SCHEMA,
    classification,
    warning,
    canonicalProductionAbi,
    runtimeAllowed,
    productionEligible,
    p0_07_canonical_abi_present: p007Present,
    p0_21_status: p021Status,
    chainId: canonicalFelt(value.chainId, "chainId"),
    contractAddress: canonicalFelt(value.contractAddress, "contractAddress"),
    classHash: canonicalFelt(value.classHash, "classHash"),
    deploymentBlock: value.deploymentBlock,
    abiBytes: value.abiBytes,
    abiDigest: value.abiDigest,
    selectors: Object.freeze(selectors),
    eventLayouts: Object.freeze(eventLayouts),
  });
}

export async function loadAbiArtifact(path) {
  const { value } = await readRegularJson(path, "ABI artifact");
  return validateAbiArtifact(value);
}

export async function loadAbiManifestIndex(
  manifestsDir = DEFAULT_MANIFESTS_DIR,
) {
  const directory = containedPath(
    repositoryRoot,
    resolve(repositoryRoot, manifestsDir),
    "ABI manifests directory",
  );
  const indexPath = resolve(directory, "index.json");
  const { value } = await readRegularJson(indexPath, "ABI manifest index");
  exactKeys(value, INDEX_KEYS, "ABI manifest index");
  if (value.schemaVersion !== 1)
    fail("ABI manifest index schemaVersion must be 1.");
  if (value.runtimeAllowed !== false)
    fail("ABI manifest index must keep runtimeAllowed false.");
  if (value.productionEligible !== false)
    fail("ABI manifest index must keep productionEligible false.");
  if (typeof value.canonicalAbiPresent !== "boolean")
    fail("canonicalAbiPresent must be a boolean.");
  if (value.generatedDecoderPresent !== false)
    fail("ABI manifest index must keep generatedDecoderPresent false.");
  if (value.p0_21_status !== "open")
    fail("ABI manifest index cannot close P0-21.");
  requiredText(value.scope, "scope", 128);
  requiredText(value.blockedUntil, "blockedUntil", 256);
  exactKeys(value.schema, ["path", "sha256"], "ABI manifest index schema");
  if (!Array.isArray(value.records) || value.records.length < 1)
    fail("ABI manifest index records are invalid.");
  const schemaPath = containedPath(
    repositoryRoot,
    resolve(repositoryRoot, value.schema.path),
    "ABI manifest schema",
  );
  const schemaFile = await readRegularJson(schemaPath, "ABI manifest schema");
  if (schemaFile.sha256 !== value.schema.sha256)
    fail("ABI manifest schema sha256 does not match index.");
  for (const [position, record] of value.records.entries()) {
    exactKeys(
      record,
      ["path", "sha256", "classification", "canonicalProductionAbi"],
      `index record ${position}`,
    );
    if (
      typeof record.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(record.sha256)
    )
      fail(`index record ${position} sha256 is invalid.`);
    if (typeof record.classification !== "string")
      fail(`index record ${position} classification is invalid.`);
    if (typeof record.canonicalProductionAbi !== "boolean")
      fail(`index record ${position} canonicalProductionAbi is invalid.`);
    const recordPath = containedPath(
      repositoryRoot,
      resolve(repositoryRoot, record.path),
      `index record ${position}`,
    );
    const loaded = await readRegularJson(
      recordPath,
      `index record ${position}`,
    );
    if (loaded.sha256 !== record.sha256)
      fail(`index record ${position} sha256 does not match file bytes.`);
  }
  return Object.freeze({
    ...value,
    path: indexPath,
    directory,
  });
}

export async function resolveCanonicalAbiArtifact(
  manifestsDir = DEFAULT_MANIFESTS_DIR,
) {
  const index = await loadAbiManifestIndex(manifestsDir);
  if (index.canonicalAbiPresent !== true)
    fail(
      "No canonical ABI artifact is present; decoder generation fails closed.",
    );
  const canonical = index.records.filter(
    (record) => record?.canonicalProductionAbi === true,
  );
  if (canonical.length !== 1)
    fail("Canonical ABI presence requires exactly one canonical record.");
  const relativePath = canonical[0].path;
  if (typeof relativePath !== "string")
    fail("Canonical ABI record path is invalid.");
  const path = containedPath(
    repositoryRoot,
    resolve(repositoryRoot, relativePath),
    "canonical ABI artifact",
  );
  const artifact = await loadAbiArtifact(path);
  if (!artifact.canonicalProductionAbi || !artifact.p0_07_canonical_abi_present)
    fail("Canonical ABI record is not a P0-07 accepted artifact.");
  return artifact;
}

export function parseGeneratorArgs(argv) {
  const options = { artifactPath: null, outPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--artifact" || token === "--out") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.startsWith("--") || !value.trim())
        fail(`${token} requires a path.`);
      if (token === "--artifact") options.artifactPath = value;
      else options.outPath = value;
      index += 1;
      continue;
    }
    fail(`Unknown generator argument: ${token}`);
  }
  return options;
}

export function assertWritableDecoderPath(outPath) {
  if (typeof outPath !== "string" || !outPath.trim())
    fail("Refusing to emit a decoder without an explicit --out path.");
  const resolved = resolve(outPath);
  for (const relativePath of FORBIDDEN_OUTPUT_FILES) {
    if (resolved === resolve(repositoryRoot, relativePath))
      fail("Refusing to overwrite the fixed localnet decoder or generator.");
  }
  const rel = relative(repositoryRoot, resolved);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    const top = rel.split(/[\\/]/)[0];
    if (FORBIDDEN_OUTPUT_TOP_LEVEL.has(top))
      fail(
        "Refusing to emit a pinned ABI decoder into a runtime/browser path.",
      );
  }
  return resolved;
}

function jsString(value) {
  return JSON.stringify(value);
}

export function generatePinnedDecoderSource(artifact) {
  const identity = validateAbiArtifact(artifact);
  const layoutsLiteral = JSON.stringify(identity.eventLayouts);
  const selectorsLiteral = JSON.stringify(identity.selectors);
  return `#!/usr/bin/env node
// GENERATED by scripts/generate-abi-decoder.mjs. Do not hand-edit.
// Classification: ${identity.classification}
// This module does not close P0-21. It is bound only to the pins below.

import { createHash } from "node:crypto";

export const PINNED_ABI_DECODER_SCHEMA = ${jsString(PINNED_ABI_DECODER_SCHEMA)};
export const PINNED_ABI_DECODER_SENTINEL =
  "APP20_PINNED_ABI_DECODER_SERVER_ONLY";
export const ARTIFACT_CLASSIFICATION = ${jsString(identity.classification)};
export const PRODUCTION_ELIGIBLE = ${identity.productionEligible};
export const CANONICAL_PRODUCTION_ABI = ${identity.canonicalProductionAbi};
export const RUNTIME_ALLOWED = ${identity.runtimeAllowed};
export const P0_21_STATUS = ${jsString(identity.p0_21_status)};
export const PINNED_ABI_BYTES = ${jsString(identity.abiBytes)};
export const PINNED_ABI_DIGEST = ${jsString(identity.abiDigest)};
export const PINNED_SELECTORS = Object.freeze(${selectorsLiteral});
export const PINNED_CONTRACT_ADDRESS = ${jsString(identity.contractAddress)};
export const PINNED_CLASS_HASH = ${jsString(identity.classHash)};
export const PINNED_DEPLOYMENT_BLOCK = ${identity.deploymentBlock};
export const PINNED_CHAIN_ID = ${jsString(identity.chainId)};
export const PINNED_EVENT_LAYOUTS = Object.freeze(${layoutsLiteral});

const STAGE_BY_SELECTOR = new Map(
  Object.entries(PINNED_SELECTORS).map(([stage, selector]) => [selector, stage]),
);
const STATUS_BY_STAGE = Object.freeze({
  fund: 1,
  fill: 2,
  claim: 3,
  timeout: 4,
});
const IDENTITY_KEYS = Object.freeze([
  "abiDigest",
  "chainId",
  "contractAddress",
  "classHash",
  "deploymentBlock",
]);
const EVENT_KEYS = Object.freeze(["fromAddress", "keys", "data", "blockNumber"]);

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(label + " must be an object.");
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    throw new Error(label + " keys are not exact.");
}

function canonicalFelt(value, label, allowZero = false) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value))
    throw new Error(label + " must be a lowercase hexadecimal felt.");
  const parsed = BigInt(value);
  if (parsed >= 1n << 252n || (!allowZero && parsed === 0n))
    throw new Error(label + " is outside the accepted felt range.");
  const canonical = "0x" + parsed.toString(16);
  if (value !== canonical) throw new Error(label + " must be canonical.");
  return canonical;
}

function positiveU128(value, label) {
  const parsed = BigInt(canonicalFelt(value, label));
  if (parsed <= 0n || parsed >= 1n << 128n)
    throw new Error(label + " must be a positive u128.");
  return parsed.toString();
}

function positiveU64(value, label) {
  const parsed = BigInt(canonicalFelt(value, label));
  if (parsed <= 0n || parsed >= 1n << 64n)
    throw new Error(label + " must be a positive u64.");
  const asNumber = Number(parsed);
  if (!Number.isSafeInteger(asNumber))
    throw new Error(label + " must be a JavaScript safe integer.");
  return asNumber;
}

function decodeField(value, field) {
  if (field.kind === "u128") return positiveU128(value, field.decodedName);
  if (field.kind === "u64") return positiveU64(value, field.decodedName);
  return canonicalFelt(value, field.decodedName);
}

export function assertPinnedAbiIdentity(value) {
  exactKeys(value, IDENTITY_KEYS, "pinned ABI identity");
  if (value.abiDigest !== PINNED_ABI_DIGEST)
    throw new Error("ABI digest is not the pinned digest.");
  const calculated =
    "sha256:" + createHash("sha256").update(PINNED_ABI_BYTES).digest("hex");
  if (calculated !== PINNED_ABI_DIGEST)
    throw new Error("Pinned ABI bytes do not match their digest.");
  if (canonicalFelt(value.chainId, "chainId") !== PINNED_CHAIN_ID)
    throw new Error("Chain ID is not the pinned chain ID.");
  if (
    canonicalFelt(value.contractAddress, "contractAddress") !==
    PINNED_CONTRACT_ADDRESS
  )
    throw new Error("Contract address is not the pinned contract address.");
  if (canonicalFelt(value.classHash, "classHash") !== PINNED_CLASS_HASH)
    throw new Error("Class hash is not the pinned class hash.");
  if (
    !Number.isSafeInteger(value.deploymentBlock) ||
    value.deploymentBlock !== PINNED_DEPLOYMENT_BLOCK
  )
    throw new Error("Deployment block is not the pinned deployment block.");
  return Object.freeze({
    abiDigest: PINNED_ABI_DIGEST,
    chainId: PINNED_CHAIN_ID,
    contractAddress: PINNED_CONTRACT_ADDRESS,
    classHash: PINNED_CLASS_HASH,
    deploymentBlock: PINNED_DEPLOYMENT_BLOCK,
  });
}

export function decodePinnedAbiEvent(value, artifact) {
  const identity = assertPinnedAbiIdentity(artifact);
  exactKeys(value, EVENT_KEYS, "pinned ABI event");
  const fromAddress = canonicalFelt(value.fromAddress, "event source");
  if (fromAddress !== identity.contractAddress)
    throw new Error("Settlement event was emitted by another contract.");
  if (!Array.isArray(value.keys) || !Array.isArray(value.data))
    throw new Error("Event keys and data must be arrays.");
  if (
    !Number.isSafeInteger(value.blockNumber) ||
    value.blockNumber < identity.deploymentBlock
  )
    throw new Error("Event block is before the pinned deployment block.");
  const keys = value.keys.map((item, index) =>
    canonicalFelt(item, "event key " + index),
  );
  const data = value.data.map((item, index) =>
    canonicalFelt(item, "event data " + index, true),
  );
  const stage = STAGE_BY_SELECTOR.get(keys[0]);
  if (!stage) throw new Error("Event selector is not in the pinned ABI.");
  const layout = PINNED_EVENT_LAYOUTS[stage];
  if (keys.length !== layout.keys.length + 1)
    throw new Error(layout.name + " key length is invalid.");
  if (data.length !== layout.data.length)
    throw new Error(layout.name + " data length is invalid.");
  const decoded = {
    stage,
    status: STATUS_BY_STAGE[stage],
    blockNumber: value.blockNumber,
  };
  for (const [index, field] of layout.keys.entries())
    decoded[field.decodedName] = decodeField(keys[index + 1], field);
  for (const [index, field] of layout.data.entries())
    decoded[field.decodedName] = decodeField(data[index], field);
  if (stage === "claim") decoded.outcome = "settled";
  if (stage === "timeout") decoded.outcome = "refunded";
  return Object.freeze(decoded);
}
`;
}

async function atomicWrite(outPath, contents) {
  const temporary = `${outPath}.generating`;
  await mkdir(dirname(outPath), { recursive: true });
  try {
    await rm(temporary, { force: true });
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, outPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function generatePinnedDecoder(options) {
  const artifactPath = options?.artifactPath ?? null;
  const outPath = options?.outPath ?? null;
  if (!artifactPath && !outPath) {
    fail(
      "No ABI artifact was provided and no canonical ABI is configured; decoder generation fails closed.",
    );
  }
  let artifact;
  if (artifactPath) {
    artifact = await loadAbiArtifact(resolve(artifactPath));
  } else {
    artifact = await resolveCanonicalAbiArtifact(options?.manifestsDir);
  }
  if (!outPath)
    fail("Refusing to emit a decoder without an explicit --out path.");
  const resolvedOut = assertWritableDecoderPath(outPath);
  const source = generatePinnedDecoderSource(artifact);
  await atomicWrite(resolvedOut, source);
  return Object.freeze({
    outPath: resolvedOut,
    abiDigest: artifact.abiDigest,
    classification: artifact.classification,
    productionEligible: artifact.productionEligible,
    p0_21_status: artifact.p0_21_status,
    generatedModuleDigest: sha256Digest(source),
  });
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseGeneratorArgs(argv);
  if (!parsed.artifactPath && !parsed.outPath) {
    fail(
      "No ABI artifact was provided and no canonical ABI is configured; decoder generation fails closed.",
    );
  }
  if (!parsed.artifactPath) {
    await resolveCanonicalAbiArtifact();
  }
  const result = await generatePinnedDecoder(parsed);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      classification: result.classification,
      productionEligible: result.productionEligible,
      p0_21_status: result.p0_21_status,
      abiDigest: result.abiDigest,
      generatedModuleDigest: result.generatedModuleDigest,
      outPath: result.outPath,
    })}\n`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const message =
      error instanceof DecoderGenerationRefusal
        ? error.message
        : (error?.stack ?? String(error));
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
