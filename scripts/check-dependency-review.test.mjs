import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareSbomBytes,
  compareThirdPartyNoticesBytes,
  isReviewedResolvedSource,
  reviewLicensePolicy,
  reviewLockfile,
} from "./check-dependency-review.mjs";
import {
  UNKNOWN_LICENSE,
  generateSbom,
  serializeSbom,
} from "./generate-sbom.mjs";
import { serializeThirdPartyNotices } from "./generate-third-party-notices.mjs";

function lockfile() {
  return {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "fixture",
        version: "1.0.0",
        dependencies: {
          alpha: "1.0.0",
          "alpha-alias": "npm:real-alpha@4.0.0",
        },
        devDependencies: { gamma: "3.0.0" },
      },
      "node_modules/alpha": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz",
        integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
        license: "MIT",
      },
      "node_modules/alpha/node_modules/beta": {
        version: "2.0.0",
        resolved: "https://registry.npmjs.org/beta/-/beta-2.0.0.tgz",
        integrity: `sha256-${Buffer.alloc(32, 2).toString("base64")}`,
        license: "Apache-2.0",
      },
      "node_modules/dependent/node_modules/alpha": {
        version: "0.9.0",
        resolved: "https://registry.npmjs.org/alpha/-/alpha-0.9.0.tgz",
        integrity: `sha512-${Buffer.alloc(64, 4).toString("base64")}`,
        license: "MIT OR Apache-2.0",
      },
      "node_modules/alpha-alias": {
        name: "real-alpha",
        version: "4.0.0",
        resolved:
          "https://registry.npmjs.org/real-alpha/-/real-alpha-4.0.0.tgz",
        integrity: `sha512-${Buffer.alloc(64, 5).toString("base64")}`,
        license: "SEE LICENSE IN LICENSE.md",
      },
      "node_modules/gamma": {
        version: "3.0.0",
        resolved: "https://registry.npmjs.org/gamma/-/gamma-3.0.0.tgz",
        integrity: `sha384-${Buffer.alloc(48, 3).toString("base64")}`,
        license: "ISC",
        dev: true,
      },
      "node_modules/@app20/local": {
        resolved: "packages/local",
        link: true,
      },
      "packages/local": {
        name: "@app20/local",
        version: "1.0.0",
      },
    },
  };
}

function property(component, name) {
  return component.properties.find((candidate) => candidate.name === name)
    ?.value;
}

test("pure lockfile review accepts integrity-pinned reviewed registry entries and workspace links", () => {
  assert.deepEqual(reviewLockfile(lockfile()), []);
});

test("pure lockfile review rejects missing pins, missing sources, and unreviewed registries", () => {
  const missingIntegrity = lockfile();
  delete missingIntegrity.packages["node_modules/alpha"].integrity;
  assert.match(
    reviewLockfile(missingIntegrity).join("\n"),
    /lacks an integrity hash/,
  );

  const missingResolved = lockfile();
  delete missingResolved.packages["node_modules/alpha"].resolved;
  assert.match(
    reviewLockfile(missingResolved).join("\n"),
    /lacks a resolved URL/,
  );

  const outsideRegistry = lockfile();
  outsideRegistry.packages["node_modules/alpha"].resolved =
    "https://registry.npmjs.org.evil.invalid/alpha.tgz";
  assert.match(
    reviewLockfile(outsideRegistry).join("\n"),
    /does not resolve to the canonical/,
  );
});

test("registry source identity rejects mismatched names, versions, and hosts", () => {
  const mismatchedName = lockfile();
  mismatchedName.packages["node_modules/alpha"].resolved =
    "https://registry.npmjs.org/not-alpha/-/not-alpha-1.0.0.tgz";
  assert.match(
    reviewLockfile(mismatchedName).join("\n"),
    /canonical.*alpha@1\.0\.0/,
  );

  const mismatchedVersion = lockfile();
  mismatchedVersion.packages["node_modules/alpha"].resolved =
    "https://registry.npmjs.org/alpha/-/alpha-9.9.9.tgz";
  assert.match(
    reviewLockfile(mismatchedVersion).join("\n"),
    /canonical.*alpha@1\.0\.0/,
  );

  const wrongHost = lockfile();
  wrongHost.packages["node_modules/alpha"].resolved =
    "https://packages.example/alpha/-/alpha-1.0.0.tgz";
  assert.match(
    reviewLockfile(wrongHost).join("\n"),
    /canonical.*alpha@1\.0\.0/,
  );
});

test("registry source identity supports canonical scoped-package tarballs", () => {
  assert.equal(
    isReviewedResolvedSource(
      "@scope/alpha",
      "1.2.3",
      "https://registry.npmjs.org/@scope/alpha/-/alpha-1.2.3.tgz",
    ),
    true,
  );
});

test("resolved-source policy allows only the exact reviewed vendored tarball exception", () => {
  assert.equal(
    isReviewedResolvedSource(
      "@starkware-libs/starknet-privacy-sdk",
      "0.14.3-rc.5",
      "file:packages/privy/vendor/starkware-libs-starknet-privacy-sdk-0.14.3-rc.5.tgz",
    ),
    true,
  );
  assert.equal(
    isReviewedResolvedSource("alpha", "1.0.0", "file:vendor/alpha.tgz"),
    false,
  );
  assert.equal(
    isReviewedResolvedSource(
      "alpha",
      "1.0.0",
      "https://registry.npmjs.org/alpha.tgz?token=x",
    ),
    false,
  );
});

test("SBOM generation is byte-stable and records required dependency classifications", () => {
  const first = serializeSbom(lockfile());
  const second = serializeSbom(structuredClone(lockfile()));
  assert.equal(first, second);
  assert.equal(first.includes("timestamp"), false);
  assert.equal(first.includes("serialNumber"), false);

  const sbom = generateSbom(lockfile());
  assert.equal(sbom.specVersion, "1.5");
  const alpha = sbom.components.find(
    (component) => component.name === "alpha" && component.version === "1.0.0",
  );
  const oldAlpha = sbom.components.find(
    (component) => component.name === "alpha" && component.version === "0.9.0",
  );
  const aliasedAlpha = sbom.components.find(
    (component) => component.name === "real-alpha",
  );
  const beta = sbom.components.find((component) => component.name === "beta");
  const gamma = sbom.components.find((component) => component.name === "gamma");
  assert.equal(property(alpha, "app20:dependencyRelationship"), "direct");
  assert.equal(property(alpha, "app20:dependencyScope"), "runtime");
  assert.equal(
    property(oldAlpha, "app20:dependencyRelationship"),
    "transitive",
  );
  assert.equal(aliasedAlpha.name, "real-alpha");
  assert.equal(aliasedAlpha.purl, "pkg:npm/real-alpha@4.0.0");
  assert.equal(
    property(aliasedAlpha, "app20:dependencyRelationship"),
    "direct",
  );
  assert.equal(property(beta, "app20:dependencyRelationship"), "transitive");
  assert.equal(property(beta, "app20:dependencyScope"), "runtime");
  assert.equal(property(gamma, "app20:dependencyScope"), "development");
  assert.deepEqual(alpha.licenses, [{ license: { id: "MIT" } }]);
  assert.deepEqual(oldAlpha.licenses, [{ expression: "MIT OR Apache-2.0" }]);
  assert.deepEqual(aliasedAlpha.licenses, [
    { license: { name: "SEE LICENSE IN LICENSE.md" } },
  ]);
  assert.equal(alpha.hashes[0].alg, "SHA-512");
  assert.equal(
    property(alpha, "app20:resolvedRegistry"),
    "https://registry.npmjs.org",
  );
  assert.deepEqual(
    sbom.dependencies[0].dependsOn.filter((purl) => purl.includes("alpha")),
    ["pkg:npm/alpha@1.0.0", "pkg:npm/real-alpha@4.0.0"],
  );
});

test("license policy rejects drift and bounds known unknowns", () => {
  const reviewedLockfile = lockfile();
  const baseline = {
    schemaVersion: 1,
    licenses: Object.fromEntries(
      generateSbom(reviewedLockfile).components.map((component) => [
        component.purl,
        component.licenses[0].expression ??
          component.licenses[0].license.id ??
          component.licenses[0].license.name,
      ]),
    ),
  };
  const exceptions = { schemaVersion: 1, knownUnknownLicenses: [] };
  assert.deepEqual(
    reviewLicensePolicy(reviewedLockfile, baseline, exceptions),
    [],
  );

  const changed = structuredClone(reviewedLockfile);
  changed.packages["node_modules/alpha"].license = "ISC";
  assert.match(
    reviewLicensePolicy(changed, baseline, exceptions).join("\n"),
    /license changed from MIT to ISC/,
  );

  const unknown = structuredClone(reviewedLockfile);
  delete unknown.packages["node_modules/alpha"].license;
  const unknownBaseline = structuredClone(baseline);
  unknownBaseline.licenses["pkg:npm/alpha@1.0.0"] = UNKNOWN_LICENSE;
  assert.match(
    reviewLicensePolicy(unknown, unknownBaseline, exceptions).join("\n"),
    /unreviewed unknown license/,
  );

  const bounded = {
    schemaVersion: 1,
    knownUnknownLicenses: [
      {
        purl: "pkg:npm/alpha@1.0.0",
        reason: "Published metadata omits a license declaration.",
        resolution: "Replace the package or obtain release-specific proof.",
      },
    ],
  };
  assert.deepEqual(reviewLicensePolicy(unknown, unknownBaseline, bounded), []);
  assert.match(
    reviewLicensePolicy(reviewedLockfile, baseline, bounded).join("\n"),
    /exception is stale.*declares MIT/,
  );
});

test("generated deployable notices cover every redistributed OFL font", () => {
  const fontLockfile = {
    packages: Object.fromEntries(
      [
        "@fontsource-variable/newsreader",
        "@fontsource-variable/source-sans-3",
        "@fontsource/ibm-plex-mono",
      ].map((name) => [
        `node_modules/${name}`,
        { version: "5.3.0", license: "OFL-1.1" },
      ]),
    ),
  };
  const notices = serializeThirdPartyNotices(fontLockfile);
  assert.match(notices, /@fontsource-variable\/newsreader@5\.3\.0/);
  assert.match(notices, /@fontsource-variable\/source-sans-3@5\.3\.0/);
  assert.match(notices, /@fontsource\/ibm-plex-mono@5\.3\.0/);
  assert.match(notices, /SIL OPEN FONT LICENSE Version 1\.1/);

  fontLockfile.packages["node_modules/@fontsource/ibm-plex-mono"].version =
    "5.4.0";
  assert.throws(
    () => serializeThirdPartyNotices(fontLockfile),
    /must be reviewed before regenerating notices/,
  );
});

test("committed artifact byte comparisons detect drift", () => {
  const generated = serializeSbom(lockfile());
  assert.deepEqual(compareSbomBytes(generated, generated), []);
  assert.match(
    compareSbomBytes(`${generated} `, generated).join("\n"),
    /does not byte-match/,
  );
  assert.deepEqual(compareThirdPartyNoticesBytes("notice", "notice"), []);
  assert.match(
    compareThirdPartyNoticesBytes("notice ", "notice").join("\n"),
    /notices do not byte-match/,
  );
});
