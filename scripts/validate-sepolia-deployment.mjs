#!/usr/bin/env node
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = resolve(
  ROOT,
  "deployments/sepolia/deployment-manifest.template.json",
);
const SCHEMA = resolve(
  ROOT,
  "deployments/sepolia/deployment-manifest.schema.json",
);
const POOL =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const PRODUCTS = ["App20Mail", "App20Escrow", "App20Claim"];

function usage() {
  console.log(`Validate only the checked-in, intentionally blocked Sepolia template.

Usage:
  node scripts/validate-sepolia-deployment.mjs

Arbitrary manifests, readiness modes, artifact emission, declaration evidence,
and deployment evidence are intentionally non-executable until pinned signed
attestations and immutable artifact snapshots exist.`);
}
if (process.argv.length > 2) {
  if (process.argv.length === 3 && ["-h", "--help"].includes(process.argv[2])) {
    usage();
    process.exit(0);
  }
  console.error("BLOCKED: arbitrary manifest/mode arguments are not accepted");
  process.exit(2);
}

function fail(message) {
  console.error(`BLOCKED: ${message}`);
  process.exit(1);
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...keys].sort())
  )
    fail(`${label} keys are not exact`);
}
function readPinnedJson(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    fail(`${label} must be a regular, non-symlink file`);
  try {
    return {
      text: readFileSync(path, "utf8"),
      value: JSON.parse(readFileSync(path, "utf8")),
    };
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

const schema = readPinnedJson(SCHEMA, "checked-in schema").value;
if (schema?.$schema !== "https://json-schema.org/draft/2020-12/schema")
  fail("checked-in schema draft pin changed");
const { text, value: manifest } = readPinnedJson(
  TEMPLATE,
  "checked-in template",
);
if (text.toLowerCase().includes("mockerc20"))
  fail("MockErc20 must never appear in the Sepolia template");
exactKeys(
  manifest,
  [
    "schemaVersion",
    "environment",
    "chainId",
    "chainIdHex",
    "releaseReady",
    "source",
    "networkPins",
    "tools",
    "artifactBundle",
    "contracts",
    "evidence",
    "releaseApproval",
  ],
  "manifest root",
);
if (
  manifest.schemaVersion !== 1 ||
  manifest.environment !== "sepolia" ||
  manifest.chainId !== "SN_SEPOLIA" ||
  manifest.chainIdHex !== "0x534e5f5345504f4c4941"
)
  fail("SN_SEPOLIA identity pins changed");
if (manifest.releaseReady !== false) fail("releaseReady must remain false");
exactKeys(manifest.source, ["repository", "commit", "dirty"], "source");
if (manifest.source.commit !== null || manifest.source.dirty !== null)
  fail("template source claims must remain null");
exactKeys(manifest.networkPins, ["strk20Pool", "tokens"], "networkPins");
if (manifest.networkPins.strk20Pool !== POOL) fail("STRK20 pool pin changed");
exactKeys(manifest.networkPins.tokens, ["STRK", "USDC"], "tokens");
exactKeys(
  manifest.networkPins.tokens.STRK,
  ["address", "decimals", "registryEvidence"],
  "STRK token",
);
exactKeys(
  manifest.networkPins.tokens.USDC,
  ["address", "decimals", "registryEvidence"],
  "USDC token",
);
if (
  manifest.networkPins.tokens.STRK?.address !== STRK ||
  manifest.networkPins.tokens.STRK?.decimals !== 18
)
  fail("official STRK pin changed");
const usdc = manifest.networkPins.tokens.USDC;
if (
  usdc?.address !== null ||
  usdc?.decimals !== null ||
  usdc?.registryEvidence !== null
)
  fail("USDC must remain entirely unconfigured");
exactKeys(
  manifest.tools,
  ["starkli", "scarb", "cairo", "sierraCompiler", "casmCompiler"],
  "tools",
);
if (
  manifest.tools.starkli !== "0.4.2" ||
  [
    manifest.tools.scarb,
    manifest.tools.cairo,
    manifest.tools.sierraCompiler,
    manifest.tools.casmCompiler,
  ].some((item) => item !== null)
)
  fail("tool placeholders changed");
exactKeys(
  manifest.artifactBundle,
  ["reproductionCommand", "bundleSha256", "reproducedBy", "reproducedAt"],
  "artifactBundle",
);
if (Object.values(manifest.artifactBundle).some((item) => item !== null))
  fail("artifact bundle must remain unattested/null");

exactKeys(manifest.contracts, PRODUCTS, "contracts");
for (const name of PRODUCTS) {
  const contract = manifest.contracts[name];
  exactKeys(
    contract,
    [
      "productName",
      "deploymentAllowed",
      "source",
      "artifacts",
      "constructor",
      "reviewedSelectors",
      "classHash",
      "casmClassHash",
      "declaration",
      "deployment",
      "audits",
      "review",
      "operatorApproval",
    ],
    name,
  );
  exactKeys(contract.source, ["path", "commit"], `${name}.source`);
  exactKeys(
    contract.artifacts,
    ["sierraPath", "sierraSha256", "casmPath", "casmSha256", "abiSha256"],
    `${name}.artifacts`,
  );
  exactKeys(
    contract.constructor,
    ["description", "calldata", "calldataSha256"],
    `${name}.constructor`,
  );
  exactKeys(
    contract.declaration,
    ["transactionHash", "blockNumber", "explorerUrl"],
    `${name}.declaration`,
  );
  exactKeys(
    contract.deployment,
    ["address", "transactionHash", "blockNumber", "explorerUrl"],
    `${name}.deployment`,
  );
  exactKeys(
    contract.review,
    ["status", "reviewer", "report", "reviewedAt", "remediationAcceptedBy"],
    `${name}.review`,
  );
  exactKeys(
    contract.operatorApproval,
    ["approved", "operator", "approvedAt", "scope"],
    `${name}.operatorApproval`,
  );
  if (
    !contract.reviewedSelectors ||
    typeof contract.reviewedSelectors !== "object" ||
    Array.isArray(contract.reviewedSelectors)
  )
    fail(`${name}.reviewedSelectors must be an object`);
  if (contract.productName !== name || contract.deploymentAllowed !== false)
    fail(`${name} must remain canonically named and non-executable`);
  if (
    contract.classHash !== "0x0" ||
    contract.casmClassHash !== "0x0" ||
    contract.deployment?.address !== "0x0"
  )
    fail(`${name} class/address placeholders must remain 0x0`);
  if (
    contract.declaration?.transactionHash !== null ||
    contract.declaration?.blockNumber !== null ||
    contract.declaration?.explorerUrl !== null
  )
    fail(`${name} declaration evidence must remain null`);
  if (
    contract.deployment?.transactionHash !== null ||
    contract.deployment?.blockNumber !== null ||
    contract.deployment?.explorerUrl !== null
  )
    fail(`${name} deployment evidence must remain null`);
  if (
    !Array.isArray(contract.audits) ||
    contract.audits.length !== 0 ||
    contract.review?.status !== "blocked" ||
    contract.operatorApproval?.approved !== false
  )
    fail(`${name} review/audit/approval must remain blocked`);
}
const mail = manifest.contracts.App20Mail;
if (mail.source?.path !== "cairo/src/lib.cairo" || mail.source?.commit !== null)
  fail("App20Mail source placeholder changed");
if (
  JSON.stringify(mail.constructor?.calldata) !== JSON.stringify([POOL]) ||
  mail.constructor?.calldataSha256 !== null
)
  fail("App20Mail blocked constructor placeholder changed");
if (Object.keys(mail.reviewedSelectors ?? {}).length !== 0)
  fail("App20Mail selectors must remain unattested");
for (const name of ["App20Escrow", "App20Claim"]) {
  const contract = manifest.contracts[name];
  if (contract.source?.path !== null || contract.source?.commit !== null)
    fail(`${name} source must remain null and unconditionally non-executable`);
  if (Object.values(contract.artifacts ?? {}).some((item) => item !== null))
    fail(`${name} artifacts must remain null`);
  if (
    contract.constructor?.description !== null ||
    contract.constructor?.calldata !== null ||
    contract.constructor?.calldataSha256 !== null
  )
    fail(`${name} constructor must remain null`);
  if (
    Object.values(contract.reviewedSelectors ?? {}).some(
      (item) => item !== null,
    )
  )
    fail(`${name} selectors must remain null`);
}
exactKeys(
  manifest.evidence,
  [
    "artifactReview",
    "auditReports",
    "declarationTransactions",
    "deploymentTransactions",
    "constructorVerifications",
    "classHashVerifications",
    "operatorApprovals",
    "postDeploymentChecks",
  ],
  "evidence",
);
for (const [kind, records] of Object.entries(manifest.evidence))
  if (!Array.isArray(records) || records.length !== 0)
    fail(`evidence.${kind} must remain empty`);
exactKeys(
  manifest.releaseApproval,
  ["approved", "approvers", "approvedAt", "scope", "notes"],
  "releaseApproval",
);
if (
  manifest.releaseApproval?.approved !== false ||
  manifest.releaseApproval?.approvers?.length !== 0 ||
  manifest.releaseApproval?.approvedAt !== null ||
  manifest.releaseApproval?.scope !== null
)
  fail("release approval must remain blocked");

console.log(`Valid blocked Sepolia template: ${TEMPLATE}`);
console.log(
  "No artifact trust, transaction readiness, declaration, or deployment is inferred.",
);
