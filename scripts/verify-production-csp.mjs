#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const outputDirectory = resolve(root, process.argv[2] ?? "dist");
const wranglerPath = resolve(root, "wrangler.jsonc");
const workerHandlerPath = resolve(root, "workers/relay/src/index.ts");
const knownViolationsPath = resolve(
  root,
  "scripts/production-csp-known-violations.json",
);
const routes = [
  "/rfq",
  "/rfq/operations",
  "/rfq/markets/strk/usdc/proposal",
  "/mail/inbox",
  "/funding",
  "/send",
  "/cross-chain-review",
  "/recovery/privy",
];

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

function configuredOrigins(value, variableName) {
  if (typeof value !== "string") {
    throw new Error(`${variableName} must be a string in wrangler.jsonc.`);
  }
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export async function loadProductionSecurityHeaders(
  rootDirectory = root,
  assets = {
    fetch: async () =>
      new Response("APP20 Worker asset-path probe", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
  },
) {
  const configPath = resolve(rootDirectory, "wrangler.jsonc");
  const implementationPath = resolve(
    rootDirectory,
    "workers/relay/src/index.ts",
  );
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      "Unable to read wrangler.jsonc as strict JSON; production CSP verification will not guess or hardcode Worker configuration.",
      { cause: error },
    );
  }
  if (config?.assets?.run_worker_first !== true) {
    throw new Error(
      "wrangler.jsonc assets.run_worker_first must be true for the verified Worker policy to ship on asset responses.",
    );
  }

  const frameOrigins = configuredOrigins(
    config?.vars?.PRIVY_FRAME_ORIGINS,
    "PRIVY_FRAME_ORIGINS",
  );
  const connectOrigins = configuredOrigins(
    config?.vars?.PRIVY_CONNECT_ORIGINS,
    "PRIVY_CONNECT_ORIGINS",
  );

  let createRelayHandler;
  try {
    ({ createRelayHandler } = await import(pathToFileURL(implementationPath)));
  } catch (error) {
    throw new Error(
      `Unable to import the shipping Worker handler at ${implementationPath}; refusing to verify a duplicated CSP. Node 24+ TypeScript type stripping is required.`,
      { cause: error },
    );
  }
  if (typeof createRelayHandler !== "function") {
    throw new Error(
      `${implementationPath} does not export createRelayHandler(); refusing to bypass the Worker asset response path.`,
    );
  }

  const handler = createRelayHandler();
  const env = {
    ASSETS: assets,
    PRIVY_FRAME_ORIGINS: frameOrigins.join(","),
    PRIVY_CONNECT_ORIGINS: connectOrigins.join(","),
  };
  const probe = await handler(
    new Request("https://app20.invalid/__production_csp_asset_probe__"),
    env,
  );
  const csp = probe.headers.get("content-security-policy");
  if (!csp) {
    throw new Error(
      "createRelayHandler() did not apply Content-Security-Policy to the ASSETS response.",
    );
  }
  const assetProbeBody = await probe.text();
  return {
    handler,
    env,
    headers: probe.headers,
    csp,
    assetProbeBody,
    frameOrigins,
    connectOrigins,
  };
}

function recordKey(record) {
  return `${record.route}\u0000${record.directive}\u0000${record.blockedURI}`;
}

export function validateKnownViolations(document) {
  if (
    document?.schemaVersion !== 2 ||
    !Array.isArray(document.knownViolations)
  ) {
    throw new Error(
      "Known CSP violations must use schemaVersion 2 and a knownViolations array.",
    );
  }
  const requiredFields = [
    "route",
    "directive",
    "blockedURI",
    "affectedFeature",
    "userVisibleConsequence",
    "exactFile",
    "exactChange",
  ];
  const keys = new Set();
  for (const [index, record] of document.knownViolations.entries()) {
    for (const field of requiredFields) {
      if (typeof record?.[field] !== "string" || !record[field].trim()) {
        throw new Error(
          `Known CSP violation ${index} must have a non-empty ${field}.`,
        );
      }
    }
    if (
      !Number.isSafeInteger(record.occurrenceCount) ||
      record.occurrenceCount < 1
    ) {
      throw new Error(
        `Known CSP violation ${index} must have a positive integer occurrenceCount.`,
      );
    }
    const key = recordKey(record);
    if (keys.has(key)) {
      throw new Error(`Duplicate known CSP violation: ${key}`);
    }
    keys.add(key);
  }
  return document.knownViolations;
}

export function reconcileViolations(observed, known) {
  const knownCounts = new Map(
    known.map((record) => [recordKey(record), record.occurrenceCount]),
  );
  const observedCounts = new Map();
  const unexpected = [];
  for (const violation of observed) {
    const key = recordKey(violation);
    const count = (observedCounts.get(key) ?? 0) + 1;
    observedCounts.set(key, count);
    if (count > (knownCounts.get(key) ?? 0)) unexpected.push(violation);
  }
  const missing = known
    .filter(
      (record) =>
        (observedCounts.get(recordKey(record)) ?? 0) < record.occurrenceCount,
    )
    .map((record) => ({
      ...record,
      observedCount: observedCounts.get(recordKey(record)) ?? 0,
    }));
  return { unexpected, missing };
}

function safeOutputPath(directory, urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(urlPath, "http://localhost").pathname,
    );
  } catch {
    return null;
  }
  const candidate = resolve(directory, `.${pathname}`);
  if (candidate !== directory && !candidate.startsWith(`${directory}${sep}`)) {
    return null;
  }
  return candidate;
}

async function existingFile(path) {
  const metadata = await stat(path).catch(() => undefined);
  return metadata?.isFile() ? path : null;
}

export function createBuiltAssetBinding(directory) {
  return {
    async fetch(request) {
      const requested = safeOutputPath(directory, request.url);
      if (!requested) return new Response("Bad request", { status: 400 });
      const path =
        (await existingFile(requested)) ?? resolve(directory, "index.html");
      const body = await readFile(path);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type":
            mimeTypes.get(extname(path).toLowerCase()) ??
            "application/octet-stream",
        },
      });
    },
  };
}

async function main() {
  const output = await stat(outputDirectory).catch(() => undefined);
  if (!output?.isDirectory()) {
    throw new Error(`Built output does not exist: ${outputDirectory}`);
  }
  const [{ handler, env, csp }, baselineSource] = await Promise.all([
    loadProductionSecurityHeaders(
      root,
      createBuiltAssetBinding(outputDirectory),
    ),
    readFile(knownViolationsPath, "utf8"),
  ]);
  let baselineDocument;
  try {
    baselineDocument = JSON.parse(baselineSource);
  } catch (error) {
    throw new Error(`Invalid JSON in ${knownViolationsPath}.`, {
      cause: error,
    });
  }
  const knownViolations = validateKnownViolations(baselineDocument);

  if (/['"]unsafe-eval['"]/.test(csp)) {
    throw new Error(
      "Production Content-Security-Policy must not allow unsafe-eval.",
    );
  }

  const server = createServer(async (request, response) => {
    try {
      const workerResponse = await handler(
        new Request(`https://app20.invalid${request.url ?? "/"}`, {
          method: request.method,
          headers: request.headers,
        }),
        env,
      );
      for (const [name, value] of workerResponse.headers) {
        response.setHeader(name, value);
      }
      const body = Buffer.from(await workerResponse.arrayBuffer());
      response
        .writeHead(workerResponse.status, workerResponse.statusText)
        .end(body);
    } catch (error) {
      response
        .writeHead(500)
        .end(error instanceof Error ? error.message : "Server error");
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Static server did not bind TCP.");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const failures = [];
  const observedViolations = [];
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    for (const route of routes) {
      const page = await browser.newPage();
      const pageFailures = [];
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !/content security policy/i.test(message.text())
        ) {
          pageFailures.push(`console: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) =>
        pageFailures.push(`pageerror: ${error.message}`),
      );
      await page.addInitScript(() => {
        globalThis.__app20CspViolations = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          globalThis.__app20CspViolations.push({
            blockedURI: event.blockedURI,
            directive: event.effectiveDirective,
            sourceFile: event.sourceFile,
          });
        });
      });
      // Keep the reviewed CoinGecko request local and deterministic.
      await page.route("https://api.coingecko.com/**", async (requestRoute) => {
        await requestRoute.fulfill({
          contentType: "application/json",
          body: JSON.stringify([
            [1_700_000_000_000, 0.5, 0.55, 0.49, 0.52],
            [1_700_003_600_000, 0.52, 0.56, 0.51, 0.54],
          ]),
        });
      });

      const response = await page.goto(`${origin}${route}`, {
        waitUntil: "networkidle",
      });
      if (!response?.ok()) {
        pageFailures.push(`navigation status: ${response?.status() ?? "none"}`);
      }
      if (response?.headers()["content-security-policy"] !== csp) {
        pageFailures.push(
          "served CSP does not exactly match the probed Worker asset response",
        );
      }

      if (route === "/rfq") {
        const loadPublicContext = page.getByRole("button", {
          name: "Load CoinGecko context",
        });
        if (await loadPublicContext.isVisible()) {
          await loadPublicContext.click();
          await page
            .getByRole("img", { name: /candlesticks/i })
            .waitFor({ timeout: 3_000 });
        } else {
          pageFailures.push(
            "opt-in CoinGecko price-history control is not visible",
          );
        }

        const connect = page
          .getByRole("button", { name: "Connect wallet" })
          .first();
        if (await connect.isVisible()) {
          await connect.click();
          await page
            .getByRole("dialog", { name: "Connect a wallet" })
            .waitFor();
          await page
            .getByText("Loading available wallets…")
            .waitFor({ state: "hidden" });
          if (
            await page
              .getByText(
                "Wallet discovery could not load. Close this dialog and try connecting again.",
              )
              .isVisible()
          ) {
            pageFailures.push(
              "Ready wallet discovery failed after explicit connect intent",
            );
          }
        }
      }
      if (route === "/recovery/privy") {
        const switchRail = page.getByRole("button", {
          name: "Switch explicitly to Privy",
        });
        if (await switchRail.isVisible()) {
          await switchRail.click();
          await page
            .getByRole("heading", { name: "Recovery vault not configured." })
            .waitFor();
        }
      }

      const violations = await page.evaluate(
        () => globalThis.__app20CspViolations ?? [],
      );
      observedViolations.push(
        ...violations.map((violation) => ({ route, ...violation })),
      );
      if (pageFailures.length > 0) {
        failures.push(...pageFailures.map((failure) => `${route}: ${failure}`));
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  const reconciliation = reconcileViolations(
    observedViolations,
    knownViolations,
  );
  for (const violation of observedViolations) {
    const expected = !reconciliation.unexpected.includes(violation);
    console.log(
      `CSP violation [${expected ? "KNOWN" : "UNEXPECTED"}]: route=${violation.route} directive=${violation.directive} blockedURI=${violation.blockedURI || "inline content"} sourceFile=${violation.sourceFile || "document"}`,
    );
  }
  for (const violation of reconciliation.unexpected) {
    failures.push(
      `${violation.route}: unexpected CSP ${violation.directive} blocked ${violation.blockedURI || "inline content"}`,
    );
  }
  for (const record of reconciliation.missing) {
    failures.push(
      `${record.route}: stale or under-counted known violation: expected ${record.occurrenceCount} occurrence(s), observed ${record.observedCount}: CSP ${record.directive} blocking ${record.blockedURI} (${record.affectedFeature})`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `Production CSP verification failed:\n- ${failures.join("\n- ")}`,
    );
  }
  console.log(
    `production-csp: ${routes.length} routes exercised through createRelayHandler() and its ASSETS binding using ${wranglerPath} and ${workerHandlerPath}; ${observedViolations.length} observed violation(s), including exact blocked URI and occurrence count, match the reviewed baseline`,
  );
}

const isEntryPoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) await main();
