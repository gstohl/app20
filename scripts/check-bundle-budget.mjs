#!/usr/bin/env node

import { builtinModules } from "node:module";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultBudgetPath = resolve(scriptDirectory, "bundle-budgets.json");
const defaultCompatibilityPath = resolve(
  scriptDirectory,
  "browser-runtime-compatibility.json",
);

function validateBudgets(config) {
  if (
    config?.schemaVersion !== 1 ||
    config.unit !== "bytes" ||
    !Array.isArray(config.budgets) ||
    config.budgets.length === 0
  ) {
    throw new Error(
      "Bundle budget configuration must use schemaVersion 1 and byte budgets.",
    );
  }
  return config.budgets.map((budget) => {
    if (
      typeof budget?.id !== "string" ||
      typeof budget.pattern !== "string" ||
      !Number.isSafeInteger(budget.maxBytes) ||
      budget.maxBytes <= 0
    ) {
      throw new Error(
        "Every bundle budget needs an id, regex pattern, and positive integer maxBytes.",
      );
    }
    return { ...budget, matcher: new RegExp(budget.pattern) };
  });
}

/**
 * Pure comparison used by both the emitted-artifact checker and node:test.
 * Rules are ordered: the first matching rule is the recorded budget for a chunk.
 */
export function compareChunkBudgets(chunks, config) {
  const budgets = validateBudgets(config);
  const results = chunks.map((chunk) => {
    const budget = budgets.find((candidate) =>
      candidate.matcher.test(chunk.name),
    );
    if (!budget) {
      return {
        name: chunk.name,
        bytes: chunk.bytes,
        budgetId: null,
        maxBytes: null,
        status: "unbudgeted",
      };
    }
    return {
      name: chunk.name,
      bytes: chunk.bytes,
      budgetId: budget.id,
      maxBytes: budget.maxBytes,
      status: chunk.bytes <= budget.maxBytes ? "within-budget" : "over-budget",
    };
  });
  return {
    results,
    violations: results.filter((result) => result.status !== "within-budget"),
  };
}

const builtins = new Set(
  builtinModules.flatMap((name) => {
    const plain = name.replace(/^node:/, "");
    return [plain, `node:${plain}`];
  }),
);

export function hasDirectEval(source) {
  return /(?:^|[^\w$.])eval\s*\(/.test(source);
}

export function findNodeBuiltinImports(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import(?!\s*\()|export)\s*(?:[^;"']*?\bfrom\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      const root = specifier.startsWith("node:")
        ? `node:${specifier.slice(5).split("/")[0]}`
        : specifier.split("/")[0];
      if (builtins.has(root)) specifiers.add(specifier);
    }
  }
  return [...specifiers].sort();
}

function staticRelativeImports(source) {
  const imports = new Set();
  const pattern =
    /\bimport(?!\s*\()\s*(?:[^;"']*?\bfrom\s*)?["'](\.[^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) imports.add(match[1]);
  }
  return [...imports];
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function initialModuleClosure(outputDirectory, sourceByPath) {
  const html = await readFile(resolve(outputDirectory, "index.html"), "utf8");
  const entrySources = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/g),
  ]
    .map((match) => match[1])
    .filter(Boolean);
  if (entrySources.length === 0) {
    throw new Error("Built index.html has no JavaScript module entry.");
  }

  const pending = entrySources.map((source) =>
    resolve(outputDirectory, `.${source}`),
  );
  const closure = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || closure.has(path)) continue;
    const source = sourceByPath.get(path);
    if (source === undefined) {
      throw new Error(
        `Initial module graph references missing output: ${relative(outputDirectory, path)}`,
      );
    }
    closure.add(path);
    for (const specifier of staticRelativeImports(source)) {
      const dependency = resolve(dirname(path), specifier);
      if (!closure.has(dependency)) pending.push(dependency);
    }
  }
  return closure;
}

export async function checkBundleDirectory(
  outputDirectory,
  {
    budgetPath = defaultBudgetPath,
    compatibilityPath = defaultCompatibilityPath,
  } = {},
) {
  const metadata = await stat(outputDirectory).catch(() => undefined);
  if (!metadata?.isDirectory()) {
    throw new Error(
      `Browser output directory does not exist: ${outputDirectory}`,
    );
  }

  const [budgetConfig, compatibility, files] = await Promise.all([
    readJson(budgetPath),
    readJson(compatibilityPath),
    filesUnder(outputDirectory),
  ]);
  const javascript = files.filter((file) => file.endsWith(".js"));
  const chunks = await Promise.all(
    javascript.map(async (file) => ({
      file,
      name: basename(file),
      bytes: (await stat(file)).size,
      source: await readFile(file, "utf8"),
    })),
  );
  const comparison = compareChunkBudgets(chunks, budgetConfig);
  const findings = comparison.violations.map((violation) =>
    violation.status === "unbudgeted"
      ? `${violation.name} has no recorded chunk budget`
      : `${violation.name} is ${violation.bytes} bytes; ${violation.budgetId} allows ${violation.maxBytes}`,
  );

  for (const chunk of chunks) {
    const imports = findNodeBuiltinImports(chunk.source);
    if (imports.length > 0) {
      findings.push(
        `${chunk.name} imports Node builtin(s): ${imports.join(", ")}`,
      );
    }
    if (
      /__vite-browser-external|browser-external:(?:async_hooks|crypto)|Module ["'](?:async_hooks|crypto)["'] has been externalized/.test(
        chunk.source,
      )
    ) {
      findings.push(
        `${chunk.name} retains a Vite Node-builtin externalization shim`,
      );
    }
  }

  const sourceByPath = new Map(
    chunks.map((chunk) => [chunk.file, chunk.source]),
  );
  const initial = await initialModuleClosure(outputDirectory, sourceByPath);
  const discoveryMarkers = compatibility.directEval.emittedChunkMarkers;
  if (!Array.isArray(discoveryMarkers) || discoveryMarkers.length === 0) {
    throw new Error(
      "Runtime compatibility record must identify wallet-discovery chunk markers.",
    );
  }
  const walletDiscoveryChunks = chunks.filter((chunk) =>
    discoveryMarkers.every((marker) => chunk.source.includes(marker)),
  );
  if (walletDiscoveryChunks.length !== 1) {
    findings.push(
      `expected one marked lazy wallet-discovery chunk, found ${walletDiscoveryChunks.length}`,
    );
  }
  for (const chunk of walletDiscoveryChunks) {
    if (initial.has(chunk.file)) {
      findings.push(
        `${chunk.name} puts wallet discovery in the initial module graph`,
      );
    }
  }
  const directEvalChunks = chunks.filter((chunk) =>
    hasDirectEval(chunk.source),
  );
  if (directEvalChunks.length === 0) {
    findings.push(
      "reviewed runtime record says direct eval ships, but no emitted chunk contains it",
    );
  }
  for (const chunk of directEvalChunks) {
    if (initial.has(chunk.file)) {
      findings.push(
        `${chunk.name} puts @module-federation/sdk direct eval in the initial module graph`,
      );
    } else if (!walletDiscoveryChunks.includes(chunk)) {
      findings.push(
        `${chunk.name} contains unrecorded direct eval outside the reviewed lazy wallet-discovery chunk`,
      );
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Bundle compatibility/budget check failed:\n- ${findings.join("\n- ")}`,
    );
  }

  const largest = [...comparison.results]
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 8)
    .map((item) => `${item.name}=${item.bytes}/${item.maxBytes}`)
    .join(", ");
  console.log(
    `bundle-budget: checked ${chunks.length} JavaScript chunks; ${initial.size} initial modules; no Node builtin imports; largest budgets: ${largest}`,
  );
  if (directEvalChunks.length > 0) {
    console.log(
      `bundle-runtime: ${compatibility.directEval.package}@${compatibility.directEval.version} direct eval is isolated to lazy chunk(s): ${directEvalChunks.map((chunk) => chunk.name).join(", ")}`,
    );
  }
  return { comparison, initial, directEvalChunks };
}

async function main() {
  const outputDirectory = resolve(process.cwd(), process.argv[2] ?? "dist");
  await checkBundleDirectory(outputDirectory);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
