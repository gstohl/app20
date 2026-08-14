import type { WALLET_API } from "@starknet-io/types-js";
import { num } from "starknet";
import type { EncryptedMailRecord } from "./mail";

export const POOL_ADDRESS_PLACEHOLDER = "${poolAddress}";
export const OPEN_NOTE_ID_PLACEHOLDER = "${openNoteIds[0]}";

const STRK_DECIMALS = 18;
const STRK_SCALE = 10n ** BigInt(STRK_DECIMALS);

export function isConfiguredMailHelper(
  address: string | null | undefined
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
 * Builds the atomic private-payment + public-ciphertext action batch. The open
 * note is a recovery slot for any token dust the helper echoes back to the
 * sender. Wallet placeholders must remain literal strings until wallet
 * assembly; converting them with num.toHex would corrupt the request.
 */
export function buildMailActions({
  helperAddress,
  tokenAddress,
  senderAddress,
  recipientAddress,
  record,
  attachmentAmount,
}: BuildMailActionsInput): WALLET_API.STRK20_ACTION[] {
  if (!isConfiguredMailHelper(helperAddress)) {
    throw new Error("A deployed mail helper is required before sending.");
  }
  if (attachmentAmount !== undefined && attachmentAmount <= 0n) {
    throw new Error("Attached STRK must be greater than zero.");
  }

  const actions: WALLET_API.STRK20_ACTION[] = [];
  if (attachmentAmount !== undefined) {
    actions.push({
      type: "transfer",
      token: tokenAddress,
      amount: num.toHex(attachmentAmount),
      recipient: recipientAddress,
    });
  }

  actions.push({
    type: "transfer",
    token: tokenAddress,
    amount: "OPEN",
    recipient: senderAddress,
  });
  actions.push({
    type: "invoke",
    contract: helperAddress,
    calldata: [
      tokenAddress,
      POOL_ADDRESS_PLACEHOLDER,
      OPEN_NOTE_ID_PLACEHOLDER,
      record.ephemeralPub[0],
      record.ephemeralPub[1],
      num.toHex(record.viewTag),
      record.nonce[0],
      record.nonce[1],
      num.toHex(record.ciphertextFelts.length),
      ...record.ciphertextFelts,
    ],
  });

  return actions;
}
