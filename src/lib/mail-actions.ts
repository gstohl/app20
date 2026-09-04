import type { EncryptedMailRecord } from "./mail";
import {
  type App20Strk20Action,
  OPEN_NOTE_ID_PLACEHOLDER,
  POOL_ADDRESS_PLACEHOLDER,
  APP20_HELPER_FUNDING_BASE_UNITS,
  buildMailInvokeActions,
  buildMemoTransferActions,
} from "./strk20";

export { OPEN_NOTE_ID_PLACEHOLDER, POOL_ADDRESS_PLACEHOLDER };

const STRK_DECIMALS = 18;
const STRK_SCALE = 10n ** BigInt(STRK_DECIMALS);

export function isConfiguredMailHelper(
  address: string | null | undefined,
): address is string {
  if (!address) return false;
  try {
    return BigInt(address) !== 0n;
  } catch {
    return false;
  }
}

export function parseOptionalStrkAmount(value: string): bigint | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error("Attached STRK must be a positive decimal amount.");
  }

  const fraction = match[2] ?? "";
  if (fraction.length > STRK_DECIMALS) {
    throw new Error("Attached STRK supports at most 18 decimal places.");
  }

  const amount =
    BigInt(match[1]) * STRK_SCALE +
    BigInt(fraction.padEnd(STRK_DECIMALS, "0") || "0");
  if (amount <= 0n) {
    throw new Error("Attached STRK must be greater than zero.");
  }
  return amount;
}

type BuildMailActionsInput = {
  helperAddress: string;
  tokenAddress: string;
  senderAddress: string;
  recipientAddress: string;
  record: EncryptedMailRecord;
  attachmentAmount?: bigint;
};

/**
 * Backward-compatible facade for the compose screen. Every helper invoke has
 * explicit atomic helper funding plus a recovery OPEN note; an attachment adds
 * one numeric transfer before those actions.
 */
export function buildMailActions({
  helperAddress,
  tokenAddress,
  senderAddress,
  recipientAddress,
  record,
  attachmentAmount,
}: BuildMailActionsInput): App20Strk20Action[] {
  if (!isConfiguredMailHelper(helperAddress)) {
    throw new Error("A deployed mail helper is required before sending.");
  }
  if (attachmentAmount === undefined) {
    return buildMailInvokeActions({
      helperAddress,
      tokenAddress,
      recoveryAddress: senderAddress,
      helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
      record,
    });
  }
  return buildMemoTransferActions({
    helperAddress,
    tokenAddress,
    recoveryAddress: senderAddress,
    recipient: recipientAddress,
    amount: attachmentAmount,
    helperFundingAmount: APP20_HELPER_FUNDING_BASE_UNITS,
    record,
  });
}
