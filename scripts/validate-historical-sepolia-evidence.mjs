#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = resolve(ROOT, "docs/evidence/historical-sepolia-proofs");
const INDEX = resolve(EVIDENCE, "index.json");
const CANDIDATES = resolve(ROOT, "deployments/sepolia/candidates");
const TEMPLATE = resolve(
  ROOT,
  "deployments/sepolia/deployment-manifest.template.json",
);
const EXPECTED_RECORDS = [
  "docs/evidence/historical-sepolia-proofs/App20Mail.proof.json",
  "docs/evidence/historical-sepolia-proofs/LegacyEscrowClaimTicket.proof.json",
];
const MAIL_ADDRESS =
  "0x0204ce7efff77e4bef8f05ea4ee0e810c51cd1f1532ec0c04da3fdcb662fe545";
const MAIL_CLASS =
  "0x05f066234003eb6f9104e7730c88f50dab82113ad5e9dbbc0db3f75972d586ca";
const LEGACY_ESCROW_ADDRESS =
  "0x06a9ea8288df876d1e174db1e0b8d58bc8bc4641b3ed9f592fb56003f69712a4";
const LEGACY_ESCROW_CLASS =
  "0x0638d8554dc095f63f253c8dd32ac09a3e9ffedd5a308b0d0f188e5fca6c8c3b";
const LEGACY_TICKET_CLASS =
  "0x07619ea7dcb8615874fb9d29b217f649e9b7b596f01d47d673e4e37132b17196";

function fail(message) {
  throw new Error(`Invalid historical Sepolia evidence: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...keys].sort())
  ) {
    fail(`${label} keys are not exact`);
  }
}

function readRegular(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${label} must be a regular non-symlink file`);
  }
  const bytes = readFileSync(path);
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

function resolvePinned(relativePath) {
  const path = resolve(ROOT, relativePath);
  if (!path.startsWith(`${ROOT}${sep}`)) fail("index path escapes repository");
  return path;
}

if (existsSync(CANDIDATES)) {
  fail(
    "historical artifacts must not remain under deployments/sepolia/candidates",
  );
}

const { value: index } = readRegular(INDEX, "evidence index");
exactKeys(
  index,
  [
    "schemaVersion",
    "scope",
    "runtimeAllowed",
    "productionEligible",
    "canonicalProductionAddressesConfigured",
    "blockedProductionManifest",
    "schema",
    "records",
  ],
  "evidence index",
);
exactKeys(index.schema, ["path", "sha256"], "evidence index schema");
if (!Array.isArray(index.records) || index.records.length !== 2) {
  fail("evidence index records must be the exact two-record array");
}
for (const [position, record] of index.records.entries()) {
  exactKeys(
    record,
    ["path", "sha256", "classification"],
    `index record ${position}`,
  );
}
if (
  index.schemaVersion !== 1 ||
  index.scope !== "historical-sepolia-proof-evidence-only" ||
  index.runtimeAllowed !== false ||
  index.productionEligible !== false ||
  index.canonicalProductionAddressesConfigured !== false ||
  index.blockedProductionManifest !==
    "deployments/sepolia/deployment-manifest.template.json"
) {
  fail(
    "index must remain evidence-only, runtime-ineligible, and bound to the blocked manifest",
  );
}
if (
  JSON.stringify(index.records?.map((record) => record.path)) !==
  JSON.stringify(EXPECTED_RECORDS)
) {
  fail("record paths are not the exact historical proof set");
}

const schema = readRegular(resolvePinned(index.schema.path), "evidence schema");
if (schema.sha256 !== index.schema.sha256) fail("schema digest mismatch");
if (schema.value?.$schema !== "https://json-schema.org/draft/2020-12/schema") {
  fail("schema draft pin changed");
}

const records = index.records.map((entry) => {
  const record = readRegular(resolvePinned(entry.path), entry.path);
  if (record.sha256 !== entry.sha256) fail(`${entry.path} digest mismatch`);
  const value = record.value;
  const commonKeys = [
    "$schema",
    "schemaVersion",
    "network",
    "classification",
    "canonicalContractName",
    "canonicalProductionDeployment",
    "runtimeAllowed",
    "productionEligible",
    "supersededByLocalnetDecision",
    "warning",
    "source",
    "testCapture",
    "excludedLocalTestAssets",
  ];
  const classificationKeys =
    entry.classification === "unaudited-one-off-deployability-proof"
      ? [
          "artifactAttestation",
          "constructor",
          "deployer",
          "declaration",
          "deployment",
        ]
      : [
          "claimTicketDeclaration",
          "legacyEscrowDeclaration",
          "legacyEscrowDeployment",
        ];
  exactKeys(value, [...commonKeys, ...classificationKeys], entry.path);
  exactKeys(
    value.testCapture,
    ["command", "passed", "failed"],
    `${entry.path}.testCapture`,
  );
  if (entry.classification === "unaudited-one-off-deployability-proof") {
    exactKeys(
      value.source,
      [
        "commit",
        "cairoDiffFromCommit",
        "libCairoSha256",
        "scarbTomlSha256",
        "scarbLockSha256",
      ],
      `${entry.path}.source`,
    );
    exactKeys(
      value.artifactAttestation,
      ["sierraSha256", "casmSha256", "classHash", "compiledClassHash"],
      `${entry.path}.artifactAttestation`,
    );
    exactKeys(value.constructor, ["pool"], `${entry.path}.constructor`);
    exactKeys(
      value.deployer,
      ["address", "accountDeploymentTransaction", "publicRpcStatus"],
      `${entry.path}.deployer`,
    );
    exactKeys(
      value.declaration,
      ["transactionHash", "blockNumber", "publicRpcStatus", "executionStatus"],
      `${entry.path}.declaration`,
    );
    exactKeys(
      value.deployment,
      [
        "transactionHash",
        "blockNumber",
        "address",
        "publicRpcStatus",
        "executionStatus",
        "verifiedClassHash",
        "verifiedPoolStorage",
        "verifiedInitialMessageCount",
      ],
      `${entry.path}.deployment`,
    );
  } else {
    exactKeys(
      value.source,
      ["commit", "cairoDiffFromCommit"],
      `${entry.path}.source`,
    );
    exactKeys(
      value.claimTicketDeclaration,
      [
        "historicalName",
        "canonicalProductionName",
        "classHash",
        "sierraSha256",
        "casmSha256",
        "compiledClassHash",
        "transactionHash",
        "blockNumber",
        "recordedStatus",
        "standaloneInstance",
        "instancePolicy",
      ],
      `${entry.path}.claimTicketDeclaration`,
    );
    exactKeys(
      value.legacyEscrowDeclaration,
      [
        "historicalName",
        "canonicalProductionReplacementRequired",
        "classHash",
        "sierraSha256",
        "casmSha256",
        "compiledClassHash",
        "transactionHash",
        "blockNumber",
        "recordedStatus",
      ],
      `${entry.path}.legacyEscrowDeclaration`,
    );
    exactKeys(
      value.legacyEscrowDeployment,
      [
        "address",
        "transactionHash",
        "blockNumber",
        "publicRpcStatus",
        "executionStatus",
        "verifiedClassHash",
        "verifiedPool",
        "verifiedTicketClassHash",
      ],
      `${entry.path}.legacyEscrowDeployment`,
    );
  }
  if (
    value.schemaVersion !== 1 ||
    value.network !== "SN_SEPOLIA" ||
    value.classification !== entry.classification ||
    value.canonicalProductionDeployment !== false ||
    value.runtimeAllowed !== false ||
    value.productionEligible !== false ||
    value.supersededByLocalnetDecision !== true ||
    value.excludedLocalTestAssets !== true ||
    value.source?.cairoDiffFromCommit !== false ||
    !/^[0-9a-f]{40}$/.test(value.source?.commit ?? "") ||
    value.testCapture?.failed !== 0
  ) {
    fail(`${entry.path} lost mandatory deny labels or source/test pins`);
  }
  if (record.bytes.toString("utf8").includes("MockErc20")) {
    fail(`${entry.path} names a local-test asset in Sepolia evidence`);
  }
  return value;
});

const [mail, legacy] = records;
if (
  mail.canonicalContractName !== "App20Mail" ||
  mail.artifactAttestation?.classHash !== MAIL_CLASS ||
  mail.deployment?.address !== MAIL_ADDRESS ||
  mail.deployment?.verifiedClassHash !== MAIL_CLASS ||
  mail.deployer?.publicRpcStatus !== "ACCEPTED_ON_L1" ||
  mail.declaration?.publicRpcStatus !== "ACCEPTED_ON_L1" ||
  mail.deployment?.publicRpcStatus !== "ACCEPTED_ON_L1" ||
  mail.declaration?.executionStatus !== "SUCCEEDED" ||
  mail.deployment?.executionStatus !== "SUCCEEDED"
) {
  fail("App20Mail one-off proof identity/status changed");
}
if (
  legacy.canonicalContractName !== null ||
  legacy.claimTicketDeclaration?.canonicalProductionName !== "App20Claim" ||
  legacy.claimTicketDeclaration?.classHash !== LEGACY_TICKET_CLASS ||
  legacy.legacyEscrowDeclaration?.classHash !== LEGACY_ESCROW_CLASS ||
  legacy.legacyEscrowDeployment?.address !== LEGACY_ESCROW_ADDRESS ||
  legacy.legacyEscrowDeployment?.verifiedClassHash !== LEGACY_ESCROW_CLASS ||
  legacy.legacyEscrowDeployment?.verifiedTicketClassHash !==
    LEGACY_TICKET_CLASS ||
  legacy.legacyEscrowDeployment?.publicRpcStatus !== "ACCEPTED_ON_L2" ||
  legacy.legacyEscrowDeployment?.executionStatus !== "SUCCEEDED"
) {
  fail("legacy escrow/ClaimTicket proof identity/status changed");
}

const { value: template } = readRegular(
  TEMPLATE,
  "blocked production template",
);
if (
  template.releaseReady !== false ||
  template.releaseApproval?.approved !== false
) {
  fail("production template must remain blocked");
}
for (const name of ["App20Mail", "App20Escrow", "App20Claim"]) {
  const contract = template.contracts?.[name];
  if (
    contract?.deploymentAllowed !== false ||
    contract?.classHash !== "0x0" ||
    contract?.deployment?.address !== "0x0"
  ) {
    fail(
      `${name} production identity must remain unconfigured and unauthorized`,
    );
  }
}

console.log("Valid historical Sepolia evidence: 2 denylisted proof records.");
console.log(
  "Blocked production manifest remains separate and releaseReady=false.",
);
