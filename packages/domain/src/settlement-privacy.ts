/** Public funding boundaries are separate from settlement. */
export const PUBLIC_SETTLEMENT_ENABLED = false;
export const CHAT_ONE_SIDED_ACCEPT_ENABLED = false;

export function rejectPublicSettlement(): void {
  throw new Error("Confidential settlement is required. The earlier RFQ route exposes trade amounts and assets and is disabled. Use the confidential escrow when your wallet and network support it.");
}

export function rejectOneSidedChatSwap(): void {
  throw new Error("This Chat offer requires a confidential atomic swap. One-sided acceptance is disabled; no payment was sent. Independent wallet support for the confidential escrow is pending.");
}

/** A payment must spend existing shielded notes, without public trade legs. */
export function assertEncryptedPaymentActions(actions: readonly { type: string; amount?: unknown }[]): void {
  const encryptedTransfer = (action: { type: string; amount?: unknown }) => {
    if (action.type !== "transfer" || typeof action.amount !== "string" || !/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(action.amount)) return false;
    return BigInt(action.amount) > 0n;
  };
  if (!actions.some(encryptedTransfer) ||
      actions.some(action => action.type !== "compute_and_invoke" && !encryptedTransfer(action))) {
    throw new Error("Private payments require encrypted notes only. Public funding, withdrawals and OPEN notes cannot be bundled with settlement.");
  }
}
