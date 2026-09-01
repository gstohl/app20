import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DecoderGenerationRefusal,
  TEST_FIXTURE_CLASSIFICATION,
  TEST_FIXTURE_RELATIVE_PATH,
  generatePinnedDecoder,
  generatePinnedDecoderSource,
  loadAbiArtifact,
  loadAbiManifestIndex,
  main,
  parseGeneratorArgs,
} from "./generate-abi-decoder.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repositoryRoot, TEST_FIXTURE_RELATIVE_PATH);
const generatorPath = resolve(
  repositoryRoot,
  "scripts/generate-abi-decoder.mjs",
);
const localnetDecoderPath = resolve(
  repositoryRoot,
  "scripts/localnet-chain-decoder.mjs",
);
const LOCALNET_ESCROW_EVENT_ABI_DIGEST =
  "sha256:348f1586e617deac28e3dc05773f9b4ab09fcac2c48e8e03bd3d640e735d3935";

const tmpRoots = [];
after(async () => {
  await Promise.all(
    tmpRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempDir() {
  const root = await mkdtemp(join(tmpdir(), "app20-abi-decoder-"));
  tmpRoots.push(root);
  return root;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function identityFrom(source) {
  return Object.freeze({
    abiDigest: source.abiDigest ?? source.PINNED_ABI_DIGEST,
    chainId: source.chainId ?? source.PINNED_CHAIN_ID,
    contractAddress: source.contractAddress ?? source.PINNED_CONTRACT_ADDRESS,
    classHash: source.classHash ?? source.PINNED_CLASS_HASH,
    deploymentBlock: source.deploymentBlock ?? source.PINNED_DEPLOYMENT_BLOCK,
  });
}

test("committed fixture is a test fixture and not a canonical ABI", async () => {
  const index = await loadAbiManifestIndex();
  const fixture = await readJson(fixturePath);
  const artifact = await loadAbiArtifact(fixturePath);
  assert.equal(index.canonicalAbiPresent, false);
  assert.equal(index.generatedDecoderPresent, false);
  assert.equal(index.productionEligible, false);
  assert.equal(index.runtimeAllowed, false);
  assert.equal(index.p0_21_status, "open");
  assert.equal(index.records.length, 1);
  assert.equal(index.records[0].classification, TEST_FIXTURE_CLASSIFICATION);
  assert.equal(index.records[0].canonicalProductionAbi, false);
  assert.equal(fixture.classification, TEST_FIXTURE_CLASSIFICATION);
  assert.match(fixture.warning, /TEST FIXTURE ONLY/);
  assert.equal(fixture.canonicalProductionAbi, false);
  assert.equal(fixture.productionEligible, false);
  assert.equal(fixture.runtimeAllowed, false);
  assert.equal(fixture.p0_07_canonical_abi_present, false);
  assert.equal(fixture.p0_21_status, "open");
  assert.equal(
    JSON.parse(fixture.abiBytes).contract,
    "App20PinnedAbiDecoderGeneratorTestFixture",
  );
  assert.notEqual(artifact.abiDigest, LOCALNET_ESCROW_EVENT_ABI_DIGEST);
  assert.equal(artifact.contractAddress, "0xab1");
  assert.equal(artifact.classHash, "0xc1a55");
  assert.equal(artifact.deploymentBlock, 1);
});

test("index sha256 pins match the committed fixture and schema bytes", async () => {
  const { createHash } = await import("node:crypto");
  const index = await readJson(
    resolve(repositoryRoot, "docs/evidence/abi-manifests/index.json"),
  );
  const fixtureBytes = await readFile(fixturePath);
  const schemaBytes = await readFile(
    resolve(
      repositoryRoot,
      "docs/evidence/abi-manifests/abi-manifest.schema.json",
    ),
  );
  assert.equal(
    index.records[0].sha256,
    createHash("sha256").update(fixtureBytes).digest("hex"),
  );
  assert.equal(
    index.schema.sha256,
    createHash("sha256").update(schemaBytes).digest("hex"),
  );
});

test("given nothing, generation fails closed and emits no decoder", async () => {
  const root = await tempDir();
  const outPath = join(root, "decoder.mjs");
  await assert.rejects(
    main([]),
    (error) =>
      error instanceof DecoderGenerationRefusal &&
      /fails closed/.test(error.message),
  );
  await assert.rejects(
    generatePinnedDecoder({}),
    (error) =>
      error instanceof DecoderGenerationRefusal &&
      /fails closed/.test(error.message),
  );
  assert.equal(existsSync(outPath), false);
  const cli = spawnSync(process.execPath, [generatorPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.notEqual(cli.status, 0);
  assert.match(`${cli.stdout}\n${cli.stderr}`, /fails closed/);
  assert.equal(existsSync(outPath), false);
  assert.equal(
    existsSync(
      resolve(repositoryRoot, "docs/evidence/abi-manifests/decoder.mjs"),
    ),
    false,
  );
});

test("missing --out or missing artifact file emits no decoder", async () => {
  const root = await tempDir();
  const outPath = join(root, "decoder.mjs");
  await assert.rejects(
    generatePinnedDecoder({ artifactPath: fixturePath }),
    /explicit --out path/,
  );
  await assert.rejects(
    generatePinnedDecoder({
      artifactPath: join(root, "missing.json"),
      outPath,
    }),
    /missing/,
  );
  await assert.rejects(
    generatePinnedDecoder({ outPath }),
    /No canonical ABI artifact is present/,
  );
  assert.equal(existsSync(outPath), false);
});

test("incomplete, mismatched, or production-claiming fixture mutations fail closed", async () => {
  const root = await tempDir();
  const outPath = join(root, "decoder.mjs");
  const fixture = await readJson(fixturePath);
  const mutations = [
    { ...fixture, classHash: undefined },
    { ...fixture, abiDigest: "sha256:" + "0".repeat(64) },
    { ...fixture, contractAddress: "0x0" },
    { ...fixture, deploymentBlock: -1 },
    { ...fixture, productionEligible: true },
    { ...fixture, canonicalProductionAbi: true },
    { ...fixture, p0_21_status: "closed" },
    { ...fixture, warning: "not labelled correctly" },
    {
      ...fixture,
      selectors: { ...fixture.selectors, fund: fixture.selectors.fill },
    },
  ];
  for (const [index, mutation] of mutations.entries()) {
    const path = join(root, `mutation-${index}.json`);
    const serialized = JSON.parse(JSON.stringify(mutation));
    if (mutation.classHash === undefined) delete serialized.classHash;
    assert.throws(
      () => generatePinnedDecoderSource(serialized),
      DecoderGenerationRefusal,
    );
    await writeFile(path, JSON.stringify(serialized));
    await assert.rejects(
      generatePinnedDecoder({ artifactPath: path, outPath }),
      DecoderGenerationRefusal,
    );
    assert.equal(existsSync(outPath), false);
  }
});

test("artifact layouts refuse decoder-owned and duplicate decoded field names", async () => {
  const fixture = await readJson(fixturePath);
  for (const decodedName of ["stage", "status", "blockNumber", "outcome"]) {
    const mutation = structuredClone(fixture);
    mutation.eventLayouts.fund.keys[0].decodedName = decodedName;
    assert.throws(
      () => generatePinnedDecoderSource(mutation),
      (error) =>
        error instanceof DecoderGenerationRefusal &&
        /reserved decoded field name/.test(error.message),
    );
  }

  const duplicate = structuredClone(fixture);
  duplicate.eventLayouts.fund.data[0].decodedName =
    duplicate.eventLayouts.fund.keys[0].decodedName;
  assert.throws(
    () => generatePinnedDecoderSource(duplicate),
    (error) =>
      error instanceof DecoderGenerationRefusal &&
      /duplicate decoded field name/.test(error.message),
  );
});

test("explicit artifacts cannot bypass the governed manifest index", async () => {
  const root = await tempDir();
  const artifactPath = join(root, "unindexed-production-claim.json");
  const outPath = join(root, "unindexed-decoder.mjs");
  const artifact = {
    ...(await readJson(fixturePath)),
    classification: "p0-21-unindexed-production-claim",
    warning: "Unindexed regression-test artifact.",
    canonicalProductionAbi: true,
    runtimeAllowed: true,
    productionEligible: true,
    p0_07_canonical_abi_present: true,
    p0_21_status: "closed",
  };
  await writeFile(artifactPath, JSON.stringify(artifact));
  const loaded = await loadAbiArtifact(artifactPath);
  assert.equal(loaded.productionEligible, true);
  assert.equal(loaded.p0_21_status, "closed");

  await assert.rejects(
    generatePinnedDecoder({ artifactPath, outPath }),
    (error) =>
      error instanceof DecoderGenerationRefusal &&
      /governed ABI manifest index/.test(error.message),
  );
  assert.equal(existsSync(outPath), false);

  const cli = spawnSync(
    process.execPath,
    [generatorPath, "--artifact", artifactPath, "--out", outPath],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.notEqual(cli.status, 0);
  assert.match(`${cli.stdout}\n${cli.stderr}`, /governed ABI manifest index/);
  assert.equal(existsSync(outPath), false);
});

test("generator binds a decoder to the committed fixture pins and does not supersede localnet", async () => {
  const root = await tempDir();
  const outPath = join(root, "decoder.mjs");
  const artifact = await loadAbiArtifact(fixturePath);
  const result = await generatePinnedDecoder({
    artifactPath: fixturePath,
    outPath,
  });
  assert.equal(result.classification, TEST_FIXTURE_CLASSIFICATION);
  assert.equal(result.productionEligible, false);
  assert.equal(result.p0_21_status, "open");
  assert.equal(result.abiDigest, artifact.abiDigest);
  assert.equal(existsSync(outPath), true);
  const source = await readFile(outPath, "utf8");
  assert.match(source, /TEST FIXTURE|p0-21-generator-test-fixture/);
  assert.doesNotMatch(source, /localnet-chain-decoder/);
  assert.match(source, /does not close P0-21/);
  const decoder = await import(pathToFileURL(outPath).href);
  assert.equal(decoder.PINNED_ABI_DIGEST, artifact.abiDigest);
  assert.equal(decoder.PINNED_CONTRACT_ADDRESS, artifact.contractAddress);
  assert.equal(decoder.PINNED_CLASS_HASH, artifact.classHash);
  assert.equal(decoder.PINNED_DEPLOYMENT_BLOCK, artifact.deploymentBlock);
  assert.equal(decoder.PINNED_CHAIN_ID, artifact.chainId);
  assert.deepEqual(decoder.PINNED_SELECTORS, artifact.selectors);
  assert.equal(decoder.PRODUCTION_ELIGIBLE, false);
  assert.equal(decoder.CANONICAL_PRODUCTION_ABI, false);
  assert.equal(decoder.RUNTIME_ALLOWED, false);
  assert.equal(decoder.P0_21_STATUS, "open");
  const identity = identityFrom(decoder);
  const funded = decoder.decodePinnedAbiEvent(
    {
      fromAddress: artifact.contractAddress,
      keys: [artifact.selectors.fund, "0xabc"],
      data: ["0x11", "0x64", "0x22", "0xc8"],
      blockNumber: 1,
    },
    identity,
  );
  assert.deepEqual(funded, {
    stage: "fund",
    status: 1,
    blockNumber: 1,
    dealId: "0xabc",
    sellToken: "0x11",
    sellAmount: "100",
    buyToken: "0x22",
    buyAmount: "200",
  });
  assert.equal(typeof funded.sellAmount, "string");
  assert.equal(
    decoder.decodePinnedAbiEvent(
      {
        fromAddress: artifact.contractAddress,
        keys: [artifact.selectors.fill, "0xabc"],
        data: ["0x11", "0x64", "0x22", "0xc8"],
        blockNumber: 2,
      },
      identity,
    ).buyAmount,
    "200",
  );
  assert.equal(
    decoder.decodePinnedAbiEvent(
      {
        fromAddress: artifact.contractAddress,
        keys: [artifact.selectors.claim, "0xabc"],
        data: ["0x22", "0xc8"],
        blockNumber: 3,
      },
      identity,
    ).outcome,
    "settled",
  );
  assert.equal(
    decoder.decodePinnedAbiEvent(
      {
        fromAddress: artifact.contractAddress,
        keys: [artifact.selectors.timeout, "0xabc"],
        data: ["0x11", "0x64"],
        blockNumber: 4,
      },
      identity,
    ).outcome,
    "refunded",
  );
  const localnet = await readFile(localnetDecoderPath, "utf8");
  assert.match(localnet, /LOCALNET_CHAIN_AUTHORITY_SERVER_SENTINEL/);
  assert.doesNotMatch(
    await readFile(generatorPath, "utf8"),
    /from "\.\/localnet-chain-decoder\.mjs"/,
  );
});

test("generated decoder rejects pin, selector, length, and numeric mutations", async () => {
  const root = await tempDir();
  const outPath = join(root, "decoder.mjs");
  await generatePinnedDecoder({ artifactPath: fixturePath, outPath });
  const decoder = await import(pathToFileURL(outPath).href);
  const identity = identityFrom(decoder);
  const base = Object.freeze({
    fromAddress: decoder.PINNED_CONTRACT_ADDRESS,
    keys: [decoder.PINNED_SELECTORS.fund, "0xabc"],
    data: ["0x11", "0x64", "0x22", "0xc8"],
    blockNumber: 1,
  });
  const mutations = [
    { ...base, fromAddress: "0x999" },
    { ...base, keys: ["0x1", "0xabc"] },
    { ...base, keys: [decoder.PINNED_SELECTORS.fund] },
    { ...base, keys: [...base.keys, "0x1"] },
    { ...base, data: base.data.slice(0, -1) },
    { ...base, data: [...base.data, "0x1"] },
    { ...base, data: ["0x11", "0x0", ...base.data.slice(2)] },
    { ...base, data: ["0x011", ...base.data.slice(1)] },
    { ...base, blockNumber: 0 },
  ];
  for (const mutation of mutations)
    assert.throws(() => decoder.decodePinnedAbiEvent(mutation, identity));
  assert.throws(() =>
    decoder.assertPinnedAbiIdentity({
      ...identity,
      abiDigest: "sha256:" + "0".repeat(64),
    }),
  );
  assert.throws(() =>
    decoder.assertPinnedAbiIdentity({ ...identity, classHash: "0x0" }),
  );
  assert.throws(() =>
    decoder.assertPinnedAbiIdentity({ ...identity, deploymentBlock: 99 }),
  );
  assert.throws(() =>
    decoder.assertPinnedAbiIdentity({ ...identity, contractAddress: "0x999" }),
  );
});

test("generator refuses to overwrite the localnet decoder or emit into src/", async () => {
  await assert.rejects(
    generatePinnedDecoder({
      artifactPath: fixturePath,
      outPath: localnetDecoderPath,
    }),
    /fixed localnet decoder/,
  );
  await assert.rejects(
    generatePinnedDecoder({
      artifactPath: fixturePath,
      outPath: resolve(repositoryRoot, "src/lib/pinned-abi-decoder.mjs"),
    }),
    /runtime\/browser path/,
  );
  const localnet = await readFile(localnetDecoderPath, "utf8");
  assert.match(
    localnet,
    /Fixed generated-style decoder for the local legacy fixture only/,
  );
});

test("CLI with the committed fixture writes only the requested out path", async () => {
  const root = await tempDir();
  const outPath = join(root, "cli-decoder.mjs");
  const cli = spawnSync(
    process.execPath,
    [generatorPath, "--artifact", fixturePath, "--out", outPath],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(cli.status, 0, cli.stderr);
  const payload = JSON.parse(cli.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.productionEligible, false);
  assert.equal(payload.p0_21_status, "open");
  assert.equal(payload.classification, TEST_FIXTURE_CLASSIFICATION);
  assert.equal(existsSync(outPath), true);
  parseGeneratorArgs(["--artifact", fixturePath, "--out", outPath]);
  assert.throws(() => parseGeneratorArgs(["--help"]), DecoderGenerationRefusal);
  const source = generatePinnedDecoderSource(
    await loadAbiArtifact(fixturePath),
  );
  assert.match(source, /PINNED_DEPLOYMENT_BLOCK = 1/);
});
