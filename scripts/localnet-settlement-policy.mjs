import { assertEncryptedPaymentActions, rejectPublicSettlement } from "../packages/domain/src/settlement-privacy.ts";

const sameFelt = (left, right) => {
  try { return BigInt(left) === BigInt(right); } catch { return false; }
};
const publicRecovery = new Set([2n, 3n, 6n, 7n]);
const invokes = action => ["invoke", "compute_and_invoke"].includes(action.type);
const fail = () => { throw new Error("Unsupported legacy settlement batch. Only encrypted payments, message envelopes and historical recovery are available."); };

/** Reconciliation and claim/refund endpoints stay available for earlier deals. */
export function assertLocalnetSettlementRoute(pathname) {
  if (["/escrow/ensure-mail-ticket", "/escrow/ensure-ticket", "/private-intents/quotes",
    "/private-intents/select-quote", "/private-intents/transcript", "/private-intents/sign-quote",
    "/private-intents/funding-prepare", "/private-intents/take-prepare", "/private-intents/solve"].includes(pathname)) {
    rejectPublicSettlement();
  }
}

/** Guard the raw local wallet API before approvals, proving, or submission. */
export function assertLocalnetSettlementActions(actions, { escrowAddress, mailHelperAddress, strkAddress }) {
  const payments = actions.some(action => action.type === "transfer" && action.amount !== "OPEN");
  if (payments) assertEncryptedPaymentActions(actions);
  const calls = actions.filter(invokes);
  if (!calls.length) return; // Explicit shield/unshield and private transfers remain separate wallet operations.
  if (calls.length !== 1 || calls[0] !== actions.at(-1)) fail();
  const call = calls[0];
  const calldata = call.type === "invoke" ? call.calldata : call.invoke_calldata;
  if (!Array.isArray(calldata)) fail();
  if (sameFelt(call.contract, escrowAddress)) {
    let operation;
    try { operation = BigInt(calldata[0]); } catch { fail(); }
    if ([0n, 1n, 4n, 5n].includes(operation)) rejectPublicSettlement();
    if (!publicRecovery.has(operation) || call.type !== "invoke" || payments) fail();
    const [ticket, output] = actions;
    if (![2, 3].includes(actions.length) || ticket.type !== "withdraw" ||
        !sameFelt(ticket.recipient, escrowAddress) || !sameFelt(ticket.amount, 1n)) fail();
    if (actions.length === 3 && (output.type !== "transfer" || output.amount !== "OPEN")) fail();
    return;
  }
  if (!sameFelt(call.contract, mailHelperAddress) || !sameFelt(calldata[0], strkAddress)) fail();
  if (call.type === "compute_and_invoke" &&
      (!Array.isArray(call.compute_calldata) || !sameFelt(call.compute_calldata[0], strkAddress))) fail();
  if (sameFelt(calldata[2], 0n)) {
    if (call.type !== "compute_and_invoke" || !sameFelt(call.compute_calldata[1], 0n) ||
        actions.slice(0, -1).some(action => action.type !== "transfer" || action.amount === "OPEN")) fail();
    return;
  }
  // Earlier message-only envelopes return the fixed seven-unit helper fee.
  const [funding, recovery] = actions;
  if (payments || actions.length !== 3 || funding.type !== "withdraw" ||
      !sameFelt(funding.token, strkAddress) || !sameFelt(funding.amount, 7n) ||
      !sameFelt(funding.recipient, mailHelperAddress) || recovery.type !== "transfer" ||
      recovery.amount !== "OPEN" || !sameFelt(recovery.token, strkAddress) ||
      calldata[2] !== "${openNoteIds[0]}") fail();
}
