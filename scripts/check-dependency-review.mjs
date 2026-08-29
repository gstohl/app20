#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCKFILE_PATH,
  DEFAULT_SBOM_PATH,
  isDependencyPackagePath,
  packageNameFromPath,
  parseIntegrity,
  serializeSbom,
} from "./generate-sbom.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const REVIEWED_NPM_REGISTRY = "https://registry.npmjs.org";
export const REVIEWED_VENDORED_SOURCES = Object.freeze({
  "@starkware-libs/starknet-privacy-sdk": Object.freeze({
    version: "0.14.3-rc.5",
    locator:
      "file:packages/privy/vendor/starkware-libs-starknet-privacy-sdk-0.14.3-rc.5.tgz",
    sha256: "69f69827c58a5876f6cca3628b6c9ecb1a3a68b5f985d564664c11674f3f1519",
  }),
});

export function canonicalRegistryTarballUrl(name, version) {
  if (
    typeof name !== "string" ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
    typeof version !== "string" ||
    version.trim() === "" ||
    /[/?#\\]/.test(version)
  ) {
    return null;
  }
  const tarballName = name.includes("/")
    ? name.slice(name.indexOf("/") + 1)
    : name;
  return `${REVIEWED_NPM_REGISTRY}/${name}/-/${tarballName}-${version}.tgz`;
}

export function isReviewedResolvedSource(name, version, resolved) {
  if (typeof resolved !== "string" || resolved.trim() === "") return false;
  if (resolved.startsWith("file:")) {
    return (
      REVIEWED_VENDORED_SOURCES[name]?.version === version &&
      REVIEWED_VENDORED_SOURCES[name]?.locator === resolved
    );
  }
  const canonical = canonicalRegistryTarballUrl(name, version);
  return canonical !== null && resolved === canonical;
}

export function reviewLockfile(lockfile) {
  const failures = [];
  if (!lockfile || typeof lockfile !== "object") {
    return ["package-lock.json must contain a JSON object."];
  }
  if (lockfile.lockfileVersion !== 3) {
    failures.push("package-lock.json must use reviewed lockfileVersion 3.");
  }
  if (!lockfile.packages || typeof lockfile.packages !== "object") {
    failures.push("package-lock.json must contain a packages object.");
    return failures;
  }

  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (!isDependencyPackagePath(path, entry)) continue;
    const pathName = packageNameFromPath(path);
    const name =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name
        : pathName;
    if (typeof entry.integrity !== "string" || entry.integrity.trim() === "") {
      failures.push(`${path} lacks an integrity hash.`);
    } else {
      try {
        parseIntegrity(entry.integrity);
      } catch (error) {
        failures.push(
          `${path} has an invalid integrity hash (${error.message}).`,
        );
      }
    }
    if (typeof entry.resolved !== "string" || entry.resolved.trim() === "") {
      failures.push(
        `${path} lacks a resolved URL or reviewed vendored locator.`,
      );
    } else if (!isReviewedResolvedSource(name, entry.version, entry.resolved)) {
      failures.push(
        `${path} does not resolve to the canonical ${REVIEWED_NPM_REGISTRY} tarball for ${name}@${entry.version ?? "unknown"} or the exact reviewed vendored-source locator: ${entry.resolved}`,
      );
    }
  }
  return failures;
}

async function verifyVendoredSourceBytes(root, lockfile) {
  const failures = [];
  const referencedNames = new Set();
  for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
    if (!isDependencyPackagePath(path, entry)) continue;
    const name =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name
        : packageNameFromPath(path);
    if (
      REVIEWED_VENDORED_SOURCES[name]?.version === entry.version &&
      REVIEWED_VENDORED_SOURCES[name]?.locator === entry.resolved
    ) {
      referencedNames.add(name);
    }
  }
  for (const name of referencedNames) {
    const reviewed = REVIEWED_VENDORED_SOURCES[name];
    const path = resolve(root, reviewed.locator.slice("file:".length));
    let bytes;
    try {
      bytes = await readFile(path);
    } catch (error) {
      failures.push(
        `${name} reviewed vendored tarball bytes could not be read at ${reviewed.locator}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== reviewed.sha256) {
      failures.push(
        `${name} reviewed vendored tarball SHA-256 mismatch: expected ${reviewed.sha256}, received ${actual}.`,
      );
    }
  }
  return failures;
}

export function compareSbomBytes(committed, generated) {
  return Buffer.from(committed).equals(Buffer.from(generated))
    ? []
    : ["Committed CycloneDX SBOM does not byte-match package-lock.json."];
}

export async function checkDependencyReview(
  root = repositoryRoot,
  lockfileRelativePath = DEFAULT_LOCKFILE_PATH,
  sbomRelativePath = DEFAULT_SBOM_PATH,
) {
  const canonicalRoot = await realpath(resolve(root));
  const lockfilePath = resolve(canonicalRoot, lockfileRelativePath);
  const sbomPath = resolve(canonicalRoot, sbomRelativePath);
  const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
  const failures = reviewLockfile(lockfile);
  if (failures.length === 0) {
    failures.push(
      ...(await verifyVendoredSourceBytes(canonicalRoot, lockfile)),
    );
  }
  if (failures.length === 0) {
    const committed = await readFile(sbomPath);
    failures.push(...compareSbomBytes(committed, serializeSbom(lockfile)));
  }
  return failures;
}

export function printDependencyReviewResult(failures) {
  if (failures.length > 0) {
    console.error("APP20 dependency review failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    return false;
  }
  console.log(
    `APP20 dependency review passed: every external lock entry resolves to its name-and-version-specific canonical tarball at ${REVIEWED_NPM_REGISTRY} or the exact reviewed vendored locator, the vendored tarball bytes match the pinned SHA-256, and the committed SBOM byte-matches.`,
  );
  return true;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : repositoryRoot;
  if (!printDependencyReviewResult(await checkDependencyReview(root))) {
    process.exitCode = 1;
  }
}
