#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function sorted(values) {
  return [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function artifactManifest(directory) {
  const manifest = {};
  for (const path of sorted(await filesUnder(directory))) {
    const name = relative(directory, path).split("\\").join("/");
    const content = await readFile(path);
    manifest[name] = createHash("sha256").update(content).digest("hex");
  }
  return manifest;
}

export function compareArtifactManifests(first, second) {
  const differences = [];
  const paths = sorted(
    new Set([...Object.keys(first), ...Object.keys(second)]),
  );
  for (const path of paths) {
    if (!Object.hasOwn(first, path)) {
      differences.push({
        path,
        kind: "only-in-second",
        secondHash: second[path],
      });
    } else if (!Object.hasOwn(second, path)) {
      differences.push({ path, kind: "only-in-first", firstHash: first[path] });
    } else if (first[path] !== second[path]) {
      differences.push({
        path,
        kind: "hash-mismatch",
        firstHash: first[path],
        secondHash: second[path],
      });
    }
  }
  return differences;
}

function runCommand(root, command, args, description) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) accept();
      else {
        reject(
          new Error(
            `${description} failed ${signal ? `with signal ${signal}` : `with exit code ${code}`}.`,
          ),
        );
      }
    });
  });
}

function runPackageBuild(root) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return runCommand(
    root,
    npm,
    ["run", "build:packages"],
    "Production workspace package build",
  );
}

function runViteBuild(root, outputDirectory) {
  const viteCli = resolve(root, "node_modules/vite/bin/vite.js");
  return runCommand(
    root,
    process.execPath,
    [viteCli, "build", "--outDir", outputDirectory, "--emptyOutDir"],
    "Vite build",
  );
}

async function productionArtifactManifest(root, appDirectory) {
  const packageDirectory = resolve(root, "packages/privy/dist");
  const [app, workspacePackage] = await Promise.all([
    artifactManifest(appDirectory),
    artifactManifest(packageDirectory),
  ]);
  return {
    manifest: Object.fromEntries([
      ...Object.entries(app).map(([path, hash]) => [`app/${path}`, hash]),
      ...Object.entries(workspacePackage).map(([path, hash]) => [
        `packages/privy/dist/${path}`,
        hash,
      ]),
    ]),
    appArtifactCount: Object.keys(app).length,
    packageArtifactCount: Object.keys(workspacePackage).length,
  };
}

export async function checkBuildDeterminism(root = repositoryRoot) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "app20-build-determinism-"),
  );
  const firstDirectory = join(temporaryRoot, "build-a");
  const secondDirectory = join(temporaryRoot, "build-b");
  try {
    await runPackageBuild(root);
    await runViteBuild(root, firstDirectory);
    const first = await productionArtifactManifest(root, firstDirectory);

    await runPackageBuild(root);
    await runViteBuild(root, secondDirectory);
    const second = await productionArtifactManifest(root, secondDirectory);

    return {
      artifactCount: Object.keys(first.manifest).length,
      appArtifactCount: first.appArtifactCount,
      packageArtifactCount: first.packageArtifactCount,
      differences: compareArtifactManifests(first.manifest, second.manifest),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : repositoryRoot;
  const result = await checkBuildDeterminism(root);
  if (result.differences.length > 0) {
    console.error("APP20 build determinism failed:");
    for (const difference of result.differences) {
      console.error(`- ${difference.path}: ${difference.kind}`);
      if (difference.firstHash)
        console.error(`  first:  ${difference.firstHash}`);
      if (difference.secondHash)
        console.error(`  second: ${difference.secondHash}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `APP20 build determinism passed: ${result.appArtifactCount} Vite assets and ${result.packageArtifactCount} @app20/privy dist files byte-match; each pass ran the production workspace package build before its isolated Vite build.`,
    );
  }
}
