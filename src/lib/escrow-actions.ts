import type { WALLET_API } from "@starknet-io/types-js";
import { num } from "starknet";
import {
  OPEN_NOTE_ID_PLACEHOLDER,
  POOL_ADDRESS_PLACEHOLDER,
} from "./strk20";
import type { EscrowSignature } from "./escrow";

export { OPEN_NOTE_ID_PLACEHOLDER, POOL_ADDRESS_PLACEHOLDER };

export const ESCROW_OPERATION_VARIANT = {
  Fund: "0x0",
  Fill: "0x1",
  Claim: "0x2",
  Timeout: "0x3",
} as const;

const U128_MAX = 2n ** 128n - 1n;
const U64_MAX = 2n ** 64n - 1n;

type FeltInput = string | bigint | number;

export type EscrowFundBatchInput = {
  escrowAddress: string;
  dealId: string;
  token: string;
  amount: string | bigint;
  counterToken: string;
  counterAmount: string | bigint;
  deadline: number | bigint | string;
  claimPubkey: string;
};

export type EscrowFillBatchInput = {
  escrowAddress: string;
  recoveryAddress: string;
  dealId: string;
  token: string;
  amount: string | bigint;
  payoutToken: string;
};

export type EscrowPayoutBatchInput = {
  escrowAddress: string;
  recoveryAddress: string;
  dealId: string;
  payoutToken: string;
  signature: EscrowSignature;
  /**
   * Literal note id already bound by signature, or `${openNoteIds[0]}` for a
   * compiler that can sign only after assembling the OPEN note (localnet).
   */
  noteId: string;
};

function assertConfiguredEscrow(address: string): void {
  try {
    if (BigInt(address) === 0n) throw new Error();
  } catch {
    throw new Error("A deployed QuietlineEscrow contract is required.");
  }
}

function boundedHex(value: FeltInput, max: bigint, label: string): string {
  if (
    typeof value === "string" &&
    !/^(?:0[xX][0-9a-fA-F]+|0|[1-9]\d*)$/.test(value)
  ) {
    throw new Error(`${label} must be an unsigned integer felt.`);
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be an unsigned integer felt.`);
  }
  if (parsed <= 0n || parsed > max) {
    throw new Error(`${label} must be greater than zero and within range.`);
  }
  return num.toHex(parsed);
}

function positiveU128(value: string | bigint, label: string): string {
  return boundedHex(value, U128_MAX, label);
}

function felt(value: FeltInput, label: string, allowZero = false): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be a felt.`);
  }
  if (parsed < 0n || parsed >= 2n ** 251n || (!allowZero && parsed === 0n)) {
    throw new Error(`${label} must be ${allowZero ? "a" : "a non-zero"} felt.`);
  }
  return num.toHex(parsed);
}

function transfer(
  token: string,
  amount: string,
  recipient: string,
): WALLET_API.STRK20_TRANSFER_ACTION {
  return { type: "transfer", token, amount, recipient };
}

function openNote(
  token: string,
  recipient: string,
): WALLET_API.STRK20_TRANSFER_ACTION {
  return transfer(token, "OPEN", recipient);
}

function invoke(
  escrowAddress: string,
  calldata: string[],
): WALLET_API.STRK20_INVOKE_ACTION {
  assertConfiguredEscrow(escrowAddress);
  return { type: "invoke", contract: escrowAddress, calldata };
}

/**
 * Fund flattening: enum tag, FundParams fields, then privacy_invoke's deal,
 * pool-placeholder, and unused note id.
 */
export function buildEscrowFundActions({
  escrowAddress,
  dealId,
  token,
  amount,
  counterToken,
  counterAmount,
  deadline,
  claimPubkey,
}: EscrowFundBatchInput): WALLET_API.STRK20_ACTION[] {
  assertConfiguredEscrow(escrowAddress);
  const fundingAmount = positiveU128(amount, "Funding amount");
  return [
    transfer(token, fundingAmount, escrowAddress),
    invoke(escrowAddress, [
      ESCROW_OPERATION_VARIANT.Fund,
      token,
      counterToken,
      positiveU128(counterAmount, "Counter amount"),
      boundedHex(deadline, U64_MAX, "Deadline"),
      felt(claimPubkey, "Claim public key"),
      felt(dealId, "Deal id"),
      POOL_ADDRESS_PLACEHOLDER,
      "0x0",
    ]),
  ];
}

/**
 * Fill deposits leg B, creates the taker's OPEN leg-A destination, then invokes
 * the flattened Fill variant. The contract will not release A unless it
 * observes at least the agreed leg-B amount.
 */
export function buildEscrowFillActions({
  escrowAddress,
  recoveryAddress,
  dealId,
  token,
  amount,
  payoutToken,
}: EscrowFillBatchInput): WALLET_API.STRK20_ACTION[] {
  assertConfiguredEscrow(escrowAddress);
  return [
    transfer(token, positiveU128(amount, "Fill amount"), escrowAddress),
    openNote(payoutToken, recoveryAddress),
    invoke(escrowAddress, [
      ESCROW_OPERATION_VARIANT.Fill,
      token,
      felt(dealId, "Deal id"),
      POOL_ADDRESS_PLACEHOLDER,
      OPEN_NOTE_ID_PLACEHOLDER,
    ]),
  ];
}

function buildPayoutActions(
  operation: "Claim" | "Timeout",
  {
    escrowAddress,
    recoveryAddress,
    dealId,
    payoutToken,
    signature,
    noteId,
  }: EscrowPayoutBatchInput,
): WALLET_API.STRK20_ACTION[] {
  assertConfiguredEscrow(escrowAddress);
  const calldataNoteId =
    noteId === OPEN_NOTE_ID_PLACEHOLDER
      ? OPEN_NOTE_ID_PLACEHOLDER
      : felt(noteId, "Payout note id");
  const payoutInvoke = invoke(escrowAddress, [
    ESCROW_OPERATION_VARIANT[operation],
    felt(signature.sigR, "Signature r"),
    felt(signature.sigS, "Signature s"),
    felt(dealId, "Deal id"),
    POOL_ADDRESS_PLACEHOLDER,
    calldataNoteId,
  ]);

  // An explicit id is for a compatible compiler that has already assembled the
  // destination note. The current Wallet API route can only express the
  // placeholder form, which requires dynamic signing and is intentionally not
  // submitted by production UI.
  return calldataNoteId === OPEN_NOTE_ID_PLACEHOLDER
    ? [openNote(payoutToken, recoveryAddress), payoutInvoke]
    : [payoutInvoke];
}

/** Pure Claim builder; it never derives or invents a destination-bound signature. */
export function buildEscrowClaimActions(
  input: EscrowPayoutBatchInput,
): WALLET_API.STRK20_ACTION[] {
  return buildPayoutActions("Claim", input);
}

/** Pure Timeout builder; it never derives or invents a destination-bound signature. */
export function buildEscrowTimeoutActions(
  input: EscrowPayoutBatchInput,
): WALLET_API.STRK20_ACTION[] {
  return buildPayoutActions("Timeout", input);
}
