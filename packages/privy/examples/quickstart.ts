/**
 * Usage once keys are in the environment:
 *
 *   PRIVY_APP_ID=... PRIVY_APP_SECRET=... ALCHEMY_API_KEY=... \
 *   STRK20_PROVING_URL=... STRK20_DISCOVERY_URL=... \
 *   npm run example
 *
 * The example only creates / looks up a wallet. Deploy, shield, transfer
 * and unshield need a funded Ready account plus the privacy SDK.
 */
import { writeFile } from "node:fs/promises";
import { Strk20Privy } from "../src/index.js";

async function main() {
  const client = new Strk20Privy();
  const existing = process.env.PRIVY_WALLET_ID;
  const wallet = existing
    ? await client.getWallet(existing)
    : await client.createWallet();
  const deployed = await client.isDeployed(wallet.address);

  const report = [
    `network     ${client.network}`,
    `rpc         ${client.config.rpcUrl}`,
    `pool        ${client.config.poolAddress ?? "(set STRK20_POOL_ADDRESS)"}`,
    `class hash  ${client.config.readyClassHash}`,
    `wallet id   ${wallet.walletId}`,
    `public key  ${wallet.publicKey}`,
    `address     ${wallet.address}`,
    `deployed    ${deployed}`,
    "",
    "Next: fund the address with STRK, then:",
    "  const session = await client.session(wallet)",
    "  await session.ensureDeployed()",
    "  await session.shield({ amount: 10n ** 18n })",
    "  await session.transfer({ recipient, amount: 1n ** 17n })",
    "  await session.unshield({ amount: 1n ** 17n })",
    "",
  ].join("\n");

  process.stdout.write(`${report}\n`);
  if (process.env.QUICKSTART_REPORT) {
    await writeFile(process.env.QUICKSTART_REPORT, report);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
