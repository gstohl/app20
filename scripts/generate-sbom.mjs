#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateThirdPartyNoticesFile,
  serializeThirdPartyNotices,
} from "./generate-third-party-notices.mjs";

export const DEFAULT_LOCKFILE_PATH = "package-lock.json";
export const DEFAULT_SBOM_PATH = "docs/evidence/app20-sbom.cdx.json";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const integrityAlgorithms = new Map([
  ["sha1", { algorithm: "SHA-1", byteLength: 20 }],
  ["sha256", { algorithm: "SHA-256", byteLength: 32 }],
  ["sha384", { algorithm: "SHA-384", byteLength: 48 }],
  ["sha512", { algorithm: "SHA-512", byteLength: 64 }],
]);

export function isDependencyPackagePath(path, entry) {
  return path.includes("node_modules/") && entry?.link !== true;
}

export function packageNameFromPath(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index < 0) throw new Error(`Not a dependency package path: ${path}`);
  const suffix = path.slice(index + marker.length);
  const segments = suffix.split("/");
  if (segments[0]?.startsWith("@")) {
    if (!segments[1]) throw new Error(`Invalid scoped package path: ${path}`);
    return `${segments[0]}/${segments[1]}`;
  }
  if (!segments[0]) throw new Error(`Invalid package path: ${path}`);
  return segments[0];
}

export function npmPurl(name, version) {
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

export function parseIntegrity(integrity) {
  if (typeof integrity !== "string" || integrity.trim() === "") {
    throw new Error("Dependency integrity must be a non-empty string.");
  }
  const token = integrity.trim().split(/\s+/)[0];
  const separator = token.indexOf("-");
  const sourceAlgorithm = token.slice(0, separator).toLowerCase();
  const algorithm = integrityAlgorithms.get(sourceAlgorithm);
  const encoded = token.slice(separator + 1);
  if (!algorithm || separator < 1 || encoded === "") {
    throw new Error(`Unsupported dependency integrity: ${integrity}`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length !== algorithm.byteLength ||
    bytes.toString("base64") !== encoded
  ) {
    throw new Error(`Invalid dependency integrity: ${integrity}`);
  }
  return {
    algorithm: algorithm.algorithm,
    content: bytes.toString("hex").toUpperCase(),
    source: token,
  };
}

export function resolvedRegistry(resolved) {
  if (resolved.startsWith("file:")) return "repository-vendored-file";
  return new URL(resolved).origin;
}

function directDependencyPaths(packages) {
  const paths = new Set();
  const root = packages[""] ?? {};
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const name of Object.keys(root[field] ?? {})) {
      paths.add(`node_modules/${name}`);
    }
  }
  return paths;
}

export function resolvedPackageName(path, entry) {
  return typeof entry?.name === "string" && entry.name.trim() !== ""
    ? entry.name
    : packageNameFromPath(path);
}

export const UNKNOWN_LICENSE = "NOASSERTION";

export function declaredLicense(entry) {
  return typeof entry?.license === "string" && entry.license.trim() !== ""
    ? entry.license.trim()
    : UNKNOWN_LICENSE;
}

export function cycloneDxLicenses(license) {
  if (license === UNKNOWN_LICENSE || license.startsWith("SEE LICENSE IN ")) {
    return [{ license: { name: license } }];
  }
  if (/\s(?:AND|OR|WITH)\s|[()]/.test(license)) {
    return [{ expression: license }];
  }
  return [{ license: { id: license } }];
}

function rootComponent(lockfile) {
  const root = lockfile.packages?.[""] ?? {};
  const name = root.name ?? lockfile.name;
  const version = root.version ?? lockfile.version;
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error(
      "package-lock.json must name and version its root package.",
    );
  }
  const purl = npmPurl(name, version);
  return { type: "application", "bom-ref": purl, name, version, purl };
}

export function generateSbom(lockfile) {
  if (!lockfile || typeof lockfile !== "object" || !lockfile.packages) {
    throw new Error("A package-lock.json packages object is required.");
  }
  const directPaths = directDependencyPaths(lockfile.packages);
  const merged = new Map();

  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (!isDependencyPackagePath(path, entry)) continue;
    const name = resolvedPackageName(path, entry);
    const direct = directPaths.has(path);
    if (typeof entry.version !== "string" || entry.version === "") {
      throw new Error(`${path} has no package version.`);
    }
    if (typeof entry.resolved !== "string" || entry.resolved === "") {
      throw new Error(`${path} has no resolved source.`);
    }
    const integrity = parseIntegrity(entry.integrity);
    const purl = npmPurl(name, entry.version);
    const license = declaredLicense(entry);
    const developmentOnly = entry.dev === true || entry.devOptional === true;
    const existing = merged.get(purl);
    if (
      existing &&
      (existing.integrity.source !== integrity.source ||
        existing.resolved !== entry.resolved ||
        existing.license !== license)
    ) {
      throw new Error(
        `${purl} has inconsistent lockfile sources, integrity hashes, or license declarations.`,
      );
    }
    if (existing) {
      existing.direct ||= direct;
      existing.runtime ||= !developmentOnly;
      existing.paths.push(path);
      continue;
    }
    merged.set(purl, {
      name,
      version: entry.version,
      purl,
      integrity,
      resolved: entry.resolved,
      license,
      direct,
      runtime: !developmentOnly,
      paths: [path],
    });
  }

  const compareText = (left, right) =>
    left < right ? -1 : left > right ? 1 : 0;
  const components = [...merged.values()]
    .sort((left, right) => compareText(left.purl, right.purl))
    .map((dependency) => ({
      type: "library",
      "bom-ref": dependency.purl,
      name: dependency.name,
      version: dependency.version,
      purl: dependency.purl,
      scope: dependency.runtime ? "required" : "excluded",
      licenses: cycloneDxLicenses(dependency.license),
      hashes: [
        {
          alg: dependency.integrity.algorithm,
          content: dependency.integrity.content,
        },
      ],
      externalReferences: [{ type: "distribution", url: dependency.resolved }],
      properties: [
        {
          name: "app20:dependencyRelationship",
          value: dependency.direct ? "direct" : "transitive",
        },
        {
          name: "app20:dependencyScope",
          value: dependency.runtime ? "runtime" : "development",
        },
        {
          name: "app20:resolvedRegistry",
          value: resolvedRegistry(dependency.resolved),
        },
        {
          name: "app20:packageLockIntegrity",
          value: dependency.integrity.source,
        },
        {
          name: "app20:packageLockPaths",
          value: dependency.paths.sort(compareText).join(","),
        },
      ],
    }));

  const application = rootComponent(lockfile);
  return {
    $schema: "https://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: { component: application },
    components,
    dependencies: [
      {
        ref: application["bom-ref"],
        dependsOn: components
          .filter((component) =>
            component.properties.some(
              (property) =>
                property.name === "app20:dependencyRelationship" &&
                property.value === "direct",
            ),
          )
          .map((component) => component["bom-ref"]),
      },
    ],
  };
}

export function serializeSbom(lockfile) {
  return `${JSON.stringify(generateSbom(lockfile), null, 2)}\n`;
}

export async function generateSbomFile(
  lockfilePath = resolve(repositoryRoot, DEFAULT_LOCKFILE_PATH),
  outputPath = resolve(repositoryRoot, DEFAULT_SBOM_PATH),
) {
  const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
  const sbom = generateSbom(lockfile);
  const serialized = `${JSON.stringify(sbom, null, 2)}\n`;
  serializeThirdPartyNotices(lockfile);
  await writeFile(outputPath, serialized, "utf8");
  const notices = await generateThirdPartyNoticesFile(lockfile);
  return {
    outputPath,
    bytes: Buffer.byteLength(serialized),
    components: sbom.components.length,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    notices,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const lockfilePath = resolve(
    process.argv[2] ?? resolve(repositoryRoot, DEFAULT_LOCKFILE_PATH),
  );
  const outputPath = resolve(
    process.argv[3] ?? resolve(repositoryRoot, DEFAULT_SBOM_PATH),
  );
  const result = await generateSbomFile(lockfilePath, outputPath);
  console.log(
    `CycloneDX 1.5 SBOM: wrote ${result.components} components (${result.bytes} bytes, sha256 ${result.sha256}) to ${result.outputPath}`,
  );
  console.log(
    `Third-party notices: wrote ${result.notices.packages} redistributed packages (${result.notices.bytes} bytes) to ${result.notices.outputPath}`,
  );
}
