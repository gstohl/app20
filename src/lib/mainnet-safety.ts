import type { ProviderInterface } from "starknet";
import { addrSTRK } from "./tokens";
import { formatStrkAmount } from "./strk-amount";

export type ValueActionPreflight = {
  network: string;
  action: string;
  amount: bigint;
  poolAddress: string;
  poolFee?: bigint;
  poolFeeError?: string;
  publicBalance?: bigint;
  publicBalanceError?: string;
  requiredPublicBalance?: bigint;
  sufficientBalance: boolean;
  publicCover: "amount-and-fee" | "fee-only";
};

export type MainnetPreflightPresenter = (
  preflight: ValueActionPreflight,
) => boolean | Promise<boolean>;

export class PoolFeeUnavailableError extends Error {
  constructor(message = "The live STRK20 pool fee could not be read.") {
    super(`${message} The action was blocked rather than guessing a fee.`);
    this.name = "PoolFeeUnavailableError";
  }
}

export class PublicBalanceUnavailableError extends Error {
  constructor(message = "The public STRK balance could not be read.") {
    super(`${message} The action was blocked before opening the wallet.`);
    this.name = "PublicBalanceUnavailableError";
  }
}

export class InsufficientPublicStrkBalanceError extends Error {
  readonly balance: bigint;
  readonly required: bigint;

  constructor(balance: bigint, required: bigint) {
    super(
      `Public STRK balance is ${formatStrkAmount(balance)} STRK, but this action requires ${formatStrkAmount(required)} STRK (amount + live pool fee). Nothing was submitted.`,
    );
    this.name = "InsufficientPublicStrkBalanceError";
    this.balance = balance;
    this.required = required;
  }
}

export class MainnetPreflightDeclinedError extends Error {
  constructor() {
    super(
      "Mainnet real-funds confirmation was cancelled. Nothing was submitted.",
    );
    this.name = "MainnetPreflightDeclinedError";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The RPC did not return a readable value.";
}

function parseUint256Result(result: readonly string[], label: string): bigint {
  if (result.length === 0) throw new Error(`${label} returned no value.`);
  try {
    const low = BigInt(result[0]);
    const high = result.length > 1 ? BigInt(result[1]) : 0n;
    if (low < 0n || high < 0n || low >= 2n ** 128n || high >= 2n ** 128n) {
      throw new Error();
    }
    return low + (high << 128n);
  } catch {
    throw new Error(`${label} returned an invalid uint256 value.`);
  }
}

export async function readLivePoolFee(
  provider: ProviderInterface,
  poolAddress: string,
): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: poolAddress,
    entrypoint: "get_fee_amount",
    calldata: [],
  });
  if (result.length === 0) {
    throw new Error("Pool get_fee_amount returned no value.");
  }
  try {
    const fee = BigInt(result[0]);
    if (fee < 0n) throw new Error();
    return fee;
  } catch {
    throw new Error("Pool get_fee_amount returned an invalid value.");
  }
}

export async function readPublicStrkBalance(
  provider: ProviderInterface,
  address: string,
): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: addrSTRK,
    entrypoint: "balance_of",
    calldata: [address],
  });
  return parseUint256Result(result, "STRK balance_of");
}

export function requiredPublicBalanceForAction(
  amount: bigint,
  poolFee: bigint,
  cover: "amount-and-fee" | "fee-only",
): bigint {
  if (amount <= 0n) throw new Error("Value amount must be greater than zero.");
  if (poolFee < 0n) throw new Error("Pool fee cannot be negative.");
  return cover === "fee-only" ? poolFee : amount + poolFee;
}

export function publicCoverForAction(
  action: string,
): "amount-and-fee" | "fee-only" {
  const normalized = action.trim().toLowerCase();
  if (normalized === "shield" || normalized.includes("public send")) {
    return "amount-and-fee";
  }
  return "fee-only";
}

export function assertPublicBalanceCovers(
  publicBalance: bigint,
  amount: bigint,
  poolFee: bigint,
  cover: "amount-and-fee" | "fee-only" = "amount-and-fee",
): bigint {
  const required = requiredPublicBalanceForAction(amount, poolFee, cover);
  if (publicBalance < required) {
    throw new InsufficientPublicStrkBalanceError(publicBalance, required);
  }
  return required;
}

export function formatMainnetPreflight(
  preflight: ValueActionPreflight,
): string {
  const amount = formatStrkAmount(preflight.amount);
  const fee =
    preflight.poolFee === undefined
      ? `UNAVAILABLE — live get_fee_amount read failed: ${preflight.poolFeeError ?? "unknown RPC error"}`
      : `${formatStrkAmount(preflight.poolFee)} STRK (${preflight.poolFee} base units)`;
  const balance =
    preflight.publicBalance === undefined
      ? `UNAVAILABLE — ${preflight.publicBalanceError ?? "live balance read failed"}`
      : `${formatStrkAmount(preflight.publicBalance)} STRK (${preflight.publicBalance} base units)`;
  const required =
    preflight.requiredPublicBalance === undefined
      ? "UNAVAILABLE — action is blocked"
      : `${formatStrkAmount(preflight.requiredPublicBalance)} STRK (${preflight.requiredPublicBalance} base units)`;

  return [
    "QUIETLINE MAINNET REAL-FUNDS PREFLIGHT",
    "",
    `Network: Starknet Mainnet (SN_MAIN)`,
    `Action: ${preflight.action}`,
    `Exact amount: ${amount} STRK`,
    `Amount in base units: ${preflight.amount}`,
    `Live pool fee (pool.get_fee_amount): ${fee}`,
    `Public STRK balance: ${balance}`,
    `Required public STRK: ${required}`,
    `Cover rule: ${preflight.publicCover === "fee-only" ? "live pool fee only (amount is already in-pool)" : "amount + live pool fee"}`,
    "",
    "Visibility: shield and unshield legs are PUBLIC on-chain. Private transfers remain inside the pool, but timing and the public pool-fee payment are observable.",
    "WARNING: This moves real funds on Starknet Mainnet.",
    preflight.sufficientBalance
      ? "Choose OK only if every value above is correct."
      : "The action is blocked because the live fee or sufficient public balance could not be verified.",
  ].join("\n");
}

export function presentMainnetPreflight(
  preflight: ValueActionPreflight,
): boolean {
  const message = formatMainnetPreflight(preflight);
  if (typeof window === "undefined") {
    throw new Error("Mainnet confirmation requires an interactive browser.");
  }
  if (!preflight.sufficientBalance) {
    window.alert(message);
    return false;
  }
  return window.confirm(message);
}

export type AuthorizeValueActionInput = {
  provider: ProviderInterface;
  poolAddress: string;
  accountAddress: string;
  network: string;
  action: string;
  amount: bigint;
  publicCover?: "amount-and-fee" | "fee-only";
  presentMainnet?: MainnetPreflightPresenter;
};

/**
 * Reads live chain state before opening the wallet. Mainnet additionally needs
 * an explicit human confirmation; Sepolia and localnet keep the same balance
 * guard without confirmation friction.
 */
export async function authorizeStrk20ValueAction({
  provider,
  poolAddress,
  accountAddress,
  network,
  action,
  amount,
  publicCover,
  presentMainnet = presentMainnetPreflight,
}: AuthorizeValueActionInput): Promise<ValueActionPreflight> {
  if (amount <= 0n) throw new Error("Value amount must be greater than zero.");
  const mainnet = network === "MAINNET";
  const cover = publicCover ?? publicCoverForAction(action);

  let poolFee: bigint;
  try {
    poolFee = await readLivePoolFee(provider, poolAddress);
  } catch (error: unknown) {
    const preflight: ValueActionPreflight = {
      network,
      action,
      amount,
      poolAddress,
      poolFeeError: errorMessage(error),
      sufficientBalance: false,
      publicCover: cover,
    };
    if (mainnet) await presentMainnet(preflight);
    throw new PoolFeeUnavailableError(errorMessage(error));
  }

  let publicBalance: bigint;
  try {
    publicBalance = await readPublicStrkBalance(provider, accountAddress);
  } catch (error: unknown) {
    const preflight: ValueActionPreflight = {
      network,
      action,
      amount,
      poolAddress,
      poolFee,
      poolFeeError: undefined,
      publicBalanceError: errorMessage(error),
      sufficientBalance: false,
      publicCover: cover,
    };
    if (mainnet) await presentMainnet(preflight);
    throw new PublicBalanceUnavailableError(errorMessage(error));
  }

  const requiredPublicBalance = requiredPublicBalanceForAction(
    amount,
    poolFee,
    cover,
  );
  const sufficientBalance = publicBalance >= requiredPublicBalance;
  const preflight: ValueActionPreflight = {
    network,
    action,
    amount,
    poolAddress,
    poolFee,
    publicBalance,
    requiredPublicBalance,
    sufficientBalance,
    publicCover: cover,
  };

  if (!sufficientBalance) {
    if (mainnet) await presentMainnet(preflight);
    assertPublicBalanceCovers(publicBalance, amount, poolFee, cover);
  }
  if (mainnet && !(await presentMainnet(preflight))) {
    throw new MainnetPreflightDeclinedError();
  }
  return preflight;
}
