/**
 * Build a real STRK20 proof invocation with a Privy signer and the official
 * SDK's call-based mock. Nothing is submitted and no shielded state changes.
 *
 * Required: PRIVY_APP_ID, PRIVY_APP_SECRET, authorization, RPC, and the
 * optional @starkware-libs/starknet-privacy-sdk peer package.
 */
import { Strk20Privy, contractDiscovery, mockProver } from "../src/index.js";

function stringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

async function main() {
  const client = new Strk20Privy({
    prover: mockProver(),
    discovery: contractDiscovery(),
  });
  const wallet = process.env.PRIVY_WALLET_ID
    ? await client.getWallet(process.env.PRIVY_WALLET_ID)
    : await client.createWallet();
  const session = await client.session(wallet);

  const result = await session.register();
  if (result.submitted) {
    throw new Error("Mock mode unexpectedly submitted a transaction.");
  }

  process.stdout.write(
    `${stringify({
      walletId: wallet.walletId,
      address: wallet.address,
      prover: result.proverKind,
      submitted: result.submitted,
      callAndProof: result.callAndProof,
    })}\n`,
  );
}

main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
