import type { PriceSchedule } from "@app20/private-intents";
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
  Lock: "0x4",
  Take: "0x5",
  SettleProceeds: "0x6",
  ReleaseCollateral: "0x7",
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

export type EscrowLockBatchInput = {
  escrowAddress: string;
  recoveryAddress: string;
  lockTicketAddress: string;
  lockId: string;
  rfqId: string;
  tokenA: string;
  tokenB: string;
  takerCommitment: string;
  expiry: number | bigint | string;
  schedule: PriceSchedule;
};

export type EscrowTakeFillInput = Readonly<{
  lockId: string;
  amountA: string | bigint;
}>;

export type EscrowTakeBatchInput = {
  escrowAddress: string;
  recoveryAddress: string;
  rfqId: string;
  tokenA: string;
  tokenB: string;
  takerSecret: string;
  fills: readonly EscrowTakeFillInput[];
};

export type EscrowLockPayoutBatchInput = {
  escrowAddress: string;
  recoveryAddress: string;
  lockTicketAddress: string;
  lockId: string;
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

function assertNonZeroFelt(value: FeltInput, label: string): void {
  felt(value, label);
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
  assertNonZeroFelt(recoveryAddress, "Recovery address");
  assertNonZeroFelt(token, "Funding token");
  assertNonZeroFelt(counterToken, "Counter token");
  if (BigInt(token) === BigInt(counterToken)) {
    throw new Error("Fund legs must use different tokens.");
  }
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
  assertNonZeroFelt(recoveryAddress, "Recovery address");
  assertNonZeroFelt(token, "Fill token");
  assertNonZeroFelt(payoutToken, "Payout token");
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
  assertNonZeroFelt(recoveryAddress, "Recovery address");
  assertNonZeroFelt(payoutToken, "Payout token");
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

function assertDistinctTokens(tokenA: string, tokenB: string): void {
  assertNonZeroFelt(tokenA, "Token A");
  assertNonZeroFelt(tokenB, "Token B");
  if (BigInt(tokenA) === BigInt(tokenB)) {
    throw new Error("Escrow legs must use different tokens.");
  }
}

function flattenLockSchedule(schedule: PriceSchedule): {
  maxB: string;
  calldata: string[];
} {
  if (!Array.isArray(schedule) || schedule.length < 1 || schedule.length > 4) {
    throw new Error("Lock schedule must contain between one and four points.");
  }
  const calldata: string[] = [];
  let previousA = 0n;
  let previousB = 0n;
  for (const [index, point] of schedule.entries()) {
    if (!point || typeof point.a !== "bigint" || typeof point.b !== "bigint") {
      throw new Error(
        `Lock schedule point ${index} must contain bigint amounts.`,
      );
    }
    const a = positiveU128(point.a, `Lock schedule point ${index} amount A`);
    const b = positiveU128(point.b, `Lock schedule point ${index} amount B`);
    if (index > 0 && point.a <= previousA) {
      throw new Error(
        "Lock schedule amount A values must be strictly increasing.",
      );
    }
    if (index > 0 && point.b < previousB) {
      throw new Error("Lock schedule amount B values must be non-decreasing.");
    }
    calldata.push(a, b);
    previousA = point.a;
    previousB = point.b;
  }
  while (calldata.length < 8) calldata.push("0x0", "0x0");
  return { maxB: positiveU128(previousB, "Lock maximum payout"), calldata };
}

/** Locks maker inventory and mints its two-unit LockTicket into an OPEN note. */
export function buildEscrowLockActions({
  escrowAddress,
  recoveryAddress,
  lockTicketAddress,
  lockId,
  rfqId,
  tokenA,
  tokenB,
  takerCommitment,
  expiry,
  schedule,
}: EscrowLockBatchInput): WALLET_API.STRK20_ACTION[] {
  assertConfiguredEscrow(escrowAddress);
  assertNonZeroFelt(recoveryAddress, "Recovery address");
  assertNonZeroFelt(lockTicketAddress, "Lock ticket address");
  assertDistinctTokens(tokenA, tokenB);
  const flattened = flattenLockSchedule(schedule);
  return [
    withdraw(tokenB, flattened.maxB, escrowAddress),
    openNote(lockTicketAddress, recoveryAddress),
    invoke(escrowAddress, [
      ESCROW_OPERATION_VARIANT.Lock,
      tokenB,
      tokenA,
      felt(rfqId, "RFQ id"),
      felt(takerCommitment, "Taker commitment"),
      boundedHex(expiry, U64_MAX, "Lock expiry"),
      num.toHex(schedule.length),
      ...flattened.calldata,
      felt(lockId, "Lock id"),
      POOL_ADDRESS_PLACEHOLDER,
      OPEN_NOTE_ID_PLACEHOLDER,
    ]),
  ];
}

/** Atomically sells the exact A amounts across one to four distinct maker locks. */
export function buildEscrowTakeActions({
  escrowAddress,
  recoveryAddress,
  rfqId,
  tokenA,
  tokenB,
  takerSecret,
  fills,
}: EscrowTakeBatchInput): WALLET_API.STRK20_ACTION[] {
  assertConfiguredEscrow(escrowAddress);
  assertNonZeroFelt(recoveryAddress, "Recovery address");
  assertDistinctTokens(tokenA, tokenB);
  if (!Array.isArray(fills) || fills.length < 1 || fills.length > 4) {
    throw new Error("Take requires between one and four fills.");
  }
  const seen = new Set<string>();
  let totalA = 0n;
  const flattened: string[] = [];
  for (const [index, fillInput] of fills.entries()) {
    if (!fillInput || typeof fillInput !== "object") {
      throw new Error(`Take fill ${index} is invalid.`);
    }
    const lockId = felt(fillInput.lockId, `Take fill ${index} lock id`);
    if (seen.has(lockId)) throw new Error("Take lock ids must be distinct.");
    seen.add(lockId);
    const amountA = positiveU128(
      fillInput.amountA,
      `Take fill ${index} amount A`,
    );
    totalA += BigInt(amountA);
    if (totalA > U128_MAX) {
      throw new Error(
        "Take total amount A must be greater than zero and within range.",
      );
    }
    flattened.push(lockId, amountA);
  }
  return [
    withdraw(tokenA, num.toHex(totalA), escrowAddress),
    openNote(tokenB, recoveryAddress),
    invoke(escrowAddress, [
      ESCROW_OPERATION_VARIANT.Take,
      tokenA,
      tokenB,
      felt(takerSecret, "Taker secret"),
      num.toHex(fills.length),
      ...flattened,
      felt(rfqId, "RFQ id"),
      POOL_ADDRESS_PLACEHOLDER,
      OPEN_NOTE_ID_PLACEHOLDER,
    ]),
  ];
}

function buildLockPayoutActions(
  operation: "SettleProceeds" | "ReleaseCollateral",
  {
    escrowAddress,
    recoveryAddress,
    lockTicketAddress,
    lockId,
    payoutToken,
  }: EscrowLockPayoutBatchInput,
): WALLET_API.STRK20_ACTION[] {
  assertConfiguredEscrow(escrowAddress);
  assertNonZeroFelt(recoveryAddress, "Recovery address");
  assertNonZeroFelt(lockTicketAddress, "Lock ticket address");
  assertNonZeroFelt(payoutToken, "Payout token");
  return [
    withdraw(lockTicketAddress, "0x1", escrowAddress),
    openNote(payoutToken, recoveryAddress),
    invoke(escrowAddress, [
      ESCROW_OPERATION_VARIANT[operation],
      felt(lockId, "Lock id"),
      POOL_ADDRESS_PLACEHOLDER,
      OPEN_NOTE_ID_PLACEHOLDER,
    ]),
  ];
}

export function buildEscrowSettleProceedsActions(
  input: EscrowLockPayoutBatchInput,
): WALLET_API.STRK20_ACTION[] {
  return buildLockPayoutActions("SettleProceeds", input);
}

export function buildEscrowReleaseCollateralActions(
  input: EscrowLockPayoutBatchInput,
): WALLET_API.STRK20_ACTION[] {
  return buildLockPayoutActions("ReleaseCollateral", input);
}
