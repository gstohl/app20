import type { WALLET_API } from "@starknet-io/types-js";
import { num } from "starknet";
import { OPEN_NOTE_ID_PLACEHOLDER, POOL_ADDRESS_PLACEHOLDER } from "./strk20";
import { STARK_FIELD_PRIME } from "./escrow";

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
  recoveryAddress: string;
  ticketAddress: string;
  dealId: string;
  token: string;
  amount: string | bigint;
  counterToken: string;
  counterAmount: string | bigint;
  deadline: number | bigint | string;
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
  ticketAddress: string;
  dealId: string;
  payoutToken: string;
};

function assertConfiguredEscrow(address: string): void {
  try {
    if (BigInt(address) === 0n) throw new Error();
  } catch {
    throw new Error("A deployed escrow contract is required.");
  }
}

function boundedHex(value: FeltInput, max: bigint, label: string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer or integer string.`);
  }
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

function felt(value: FeltInput, label: string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer or integer string.`);
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be a felt.`);
  }
  if (parsed <= 0n || parsed >= STARK_FIELD_PRIME) {
    throw new Error(`${label} must be a non-zero felt.`);
  }
  return num.toHex(parsed);
}

function withdraw(
  token: string,
  amount: string,
  recipient: string,
): WALLET_API.STRK20_WITHDRAW_ACTION {
  return { type: "withdraw", token, amount, recipient };
}

function openNote(
  token: string,
  recipient: string,
): WALLET_API.STRK20_TRANSFER_ACTION {
  return { type: "transfer", token, amount: "OPEN", recipient };
}

function invoke(
  escrowAddress: string,
  calldata: string[],
): WALLET_API.STRK20_INVOKE_ACTION {
  assertConfiguredEscrow(escrowAddress);
  return { type: "invoke", contract: escrowAddress, calldata };
}

/** Fund locks leg A and mints the deal ticket into an OPEN private note. */
export function buildEscrowFundActions({
  escrowAddress,
  recoveryAddress,
  ticketAddress,
  dealId,
  token,
  amount,
  counterToken,
  counterAmount,
  deadline,
}: EscrowFundBatchInput): WALLET_API.STRK20_ACTION[] {
  assertConfiguredEscrow(escrowAddress);
  felt(ticketAddress, "Ticket address");
  return [
    withdraw(token, positiveU128(amount, "Funding amount"), escrowAddress),
    openNote(ticketAddress, recoveryAddress),
    invoke(escrowAddress, [
      ESCROW_OPERATION_VARIANT.Fund,
      token,
      counterToken,
      positiveU128(counterAmount, "Counter amount"),
      boundedHex(deadline, U64_MAX, "Deadline"),
      felt(dealId, "Deal id"),
      POOL_ADDRESS_PLACEHOLDER,
      OPEN_NOTE_ID_PLACEHOLDER,
    ]),
  ];
}

/** Fill deposits leg B and creates the taker's OPEN leg-A destination. */
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
    withdraw(token, positiveU128(amount, "Fill amount"), escrowAddress),
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
    ticketAddress,
    dealId,
    payoutToken,
  }: EscrowPayoutBatchInput,
): WALLET_API.STRK20_ACTION[] {
  assertConfiguredEscrow(escrowAddress);
  felt(ticketAddress, "Ticket address");
  return [
    withdraw(ticketAddress, "0x1", escrowAddress),
    openNote(payoutToken, recoveryAddress),
    invoke(escrowAddress, [
      ESCROW_OPERATION_VARIANT[operation],
      felt(dealId, "Deal id"),
      POOL_ADDRESS_PLACEHOLDER,
      OPEN_NOTE_ID_PLACEHOLDER,
    ]),
  ];
}

export function buildEscrowClaimActions(
  input: EscrowPayoutBatchInput,
): WALLET_API.STRK20_ACTION[] {
  return buildPayoutActions("Claim", input);
}

export function buildEscrowTimeoutActions(
  input: EscrowPayoutBatchInput,
): WALLET_API.STRK20_ACTION[] {
  return buildPayoutActions("Timeout", input);
}
