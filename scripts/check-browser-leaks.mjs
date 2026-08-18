#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const outputDirectory = resolve(root, process.argv[2] ?? "dist");
const forbiddenMarkers = [
  "PRIVY_APP_SECRET",
  "PRIVY_WALLET_AUTH_PRIVATE_KEY",
  "PROVER_UPSTREAM_URL",
  "PROVER_UPSTREAM_AUTHORIZATION",
  "DISCOVERY_UPSTREAM_URL",
  "DISCOVERY_UPSTREAM_AUTHORIZATION",
  "STRK20_DISCOVERY_URL",
  "OHTTP_SESSION_SECRET",
  "PROXY_IDENTITY_HMAC_SECRET",
  "@privy-io/node",
  "src/proxy/server",
];
const privateEnvironmentNames = [
  "PRIVY_APP_SECRET",
  "PRIVY_WALLET_AUTH_PRIVATE_KEY",
  "PROVER_UPSTREAM_URL",
  "PROVER_UPSTREAM_AUTHORIZATION",
  "DISCOVERY_UPSTREAM_URL",
  "DISCOVERY_UPSTREAM_AUTHORIZATION",
  "STRK20_DISCOVERY_URL",
  "RPC_URL",
  "OHTTP_SESSION_SECRET",
  "PROXY_IDENTITY_HMAC_SECRET",
];

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function main() {
  const metadata = await stat(outputDirectory).catch(() => undefined);
  if (!metadata?.isDirectory()) {
    throw new Error(`Browser output directory does not exist: ${outputDirectory}`);
  }

  const files = await filesUnder(outputDirectory);
  const sourceMaps = files.filter((file) => file.endsWith(".map"));
  const findings = sourceMaps.map((file) => ({
    file,
    marker: "production source map",
  }));
  const secretValues = privateEnvironmentNames.flatMap((name) => {
    const value = process.env[name];
    return value && value.length >= 8 ? [{ name, value }] : [];
  });
  const additionalCanaries = (process.env.VLT20_PRIVATE_CANARIES ?? "")
    .split("\n")
    .filter((value) => value.length >= 8)
    .map((value, index) => ({ name: `VLT20_PRIVATE_CANARIES[${index}]`, value }));

  for (const file of files) {
    const content = await readFile(file);
    const text = content.toString("utf8");
    for (const marker of forbiddenMarkers) {
      if (text.includes(marker)) findings.push({ file, marker });
    }
    for (const secret of [...secretValues, ...additionalCanaries]) {
      if (text.includes(secret.value)) {
        findings.push({ file, marker: `value of ${secret.name}` });
      }
    }
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `browser-leak: ${finding.file.slice(root.length + 1)} contains ${finding.marker}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `browser-leak: checked ${files.length} files; no private markers, configured canaries, server package markers, or source maps found`,
  );
}

await main();
