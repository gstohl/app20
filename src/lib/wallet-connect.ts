export function chainIdFromStandardAccount(account: {
  chains?: readonly string[];
}): string | null {
  const standardChain = account.chains?.[0];
  if (!standardChain) return null;
  return standardChain.startsWith("starknet:")
    ? standardChain.slice("starknet:".length)
    : standardChain;
}

export function describeWalletConnectError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Wallet connection failed.";
  if (/\bnot preauthorized\b/i.test(message)) {
    return "This site is not authorized in the wallet yet. Approve the connection prompt in Ready. If none appeared, open Ready → Connected sites, remove this origin, and try again. Use http://localhost:5173 — not 127.0.0.1 — so the origin matches.";
  }
  return message;
}
