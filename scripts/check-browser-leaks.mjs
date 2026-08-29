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
  "STARKNET_MAINNET_RPC_URL",
  "STARKNET_SEPOLIA_RPC_URL",
  "STARKNET_MAINNET_AUTHORIZATION",
  "STARKNET_SEPOLIA_AUTHORIZATION",
  "OHTTP_SESSION_SECRET",
  "PROXY_IDENTITY_HMAC_SECRET",
  "RFQ_MAKER_AUTH",
  "RFQ_TAKER_CAPABILITY_SECRET",
  "APP20_LOCALNET_CONTROL_TOKEN",
  "directory authority private",
  "NEAR_INTENTS_API_KEY",
  "ONE_CLICK_API_KEY",
  "ONE_CLICK_PARTNER_JWT",
  "INTENTS_UPSTREAM_AUTHORIZATION",
  "POLICY_ENCLAVE_URL",
  "POLICY_ENCLAVE_AUTHORIZATION",
  "POLICY_ENCLAVE_PRIVATE_KEY",
  "TEE_POLICY_SIGNING_KEY",
  "PHALA_API_KEY",
  "VITE_E2E_WALLET",
  "VITE_LOCALNET_WALLET_URL",
  "VITE_LOCALNET_RPC_URL",
  "VITE_LOCALNET_POOL_ADDRESS",
  "VITE_LOCALNET_USDC_TOKEN_ADDRESS",
  "APP20_LOCALNET_DEV_WALLET_SENTINEL_7C91E2",
  "APP20_LOCALNET_CHAIN_AUTHORITY_SERVER_ONLY_83F0A2",
  "/__app20_localnet_wallet",
  "@privy-io/node",
  "@app20/private-intents/hpke-open",
  "hpke-open.ts",
  "VITE_VIEWING_KEY",
  "APP20_VIEWING_KEY",
  "maker-viewing-key",
  "maker-private-key",
  "makerPrivateKeyPath",
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
  "STARKNET_MAINNET_RPC_URL",
  "STARKNET_SEPOLIA_RPC_URL",
  "STARKNET_MAINNET_AUTHORIZATION",
  "STARKNET_SEPOLIA_AUTHORIZATION",
  "RPC_URL",
  "OHTTP_SESSION_SECRET",
  "PROXY_IDENTITY_HMAC_SECRET",
  "RFQ_MAKER_AUTH",
  "RFQ_TAKER_CAPABILITY_SECRET",
  "APP20_LOCALNET_CONTROL_TOKEN",
  "NEAR_INTENTS_API_KEY",
  "ONE_CLICK_API_KEY",
  "ONE_CLICK_PARTNER_JWT",
  "INTENTS_UPSTREAM_AUTHORIZATION",
  "POLICY_ENCLAVE_URL",
  "POLICY_ENCLAVE_AUTHORIZATION",
  "POLICY_ENCLAVE_PRIVATE_KEY",
  "TEE_POLICY_SIGNING_KEY",
  "PHALA_API_KEY",
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
    throw new Error(
      `Browser output directory does not exist: ${outputDirectory}`,
    );
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
  const additionalCanaries = (process.env.APP20_PRIVATE_CANARIES ?? "")
    .split("\n")
    .filter((value) => value.length >= 8)
    .map((value, index) => ({
      name: `APP20_PRIVATE_CANARIES[${index}]`,
      value,
    }));

  for (const file of files) {
    const content = await readFile(file);
    const text = content.toString("utf8");
    for (const marker of forbiddenMarkers) {
      if (text.includes(marker)) findings.push({ file, marker });
    }
    if (
      /\"kty\"\s*:\s*\"EC\"[\s\S]{0,500}\"d\"\s*:|\"d\"\s*:[\s\S]{0,500}\"kty\"\s*:\s*\"EC\"/.test(
        text,
      )
    ) {
      findings.push({ file, marker: "an EC private JWK d coordinate" });
    }
    for (const secret of [...secretValues, ...additionalCanaries]) {
      if (text.includes(secret.value)) {
        findings.push({ file, marker: `value of ${secret.name}` });
      }
    }
    for (const match of text.matchAll(/https:\/\/[^\s"'`)<>{}]+/g)) {
      try {
        const url = new URL(match[0]);
        const sensitiveServiceHost = /prover|discovery|indexer/i.test(
          url.hostname,
        );
        const credentialedRpcHost = /^starknet-.*\.g\.alchemy\.com$/i.test(
          url.hostname,
        );
        if (
          (sensitiveServiceHost && !url.hostname.endsWith(".invalid")) ||
          credentialedRpcHost
        ) {
          findings.push({
            file,
            marker: "a private-service or credentialed RPC origin",
          });
        }
      } catch {
        // Ignore a non-URL string fragment; fixed marker and canary checks remain.
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
