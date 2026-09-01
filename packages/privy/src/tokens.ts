import {
  cairo,
  CallData,
  type Account,
  type Call,
  type RpcProvider,
} from "starknet";
import { NETWORK_DEFAULTS } from "./constants.js";
import type { StarknetNetwork } from "./constants.js";

export function defaultToken(network: StarknetNetwork): string {
  return NETWORK_DEFAULTS[network].strk;
}

export function approveCall(
  token: string,
  spender: string,
  amount: bigint,
): Call {
  const value = cairo.uint256(amount);
  return {
    contractAddress: token,
    entrypoint: "approve",
    calldata: CallData.compile([spender, value.low, value.high]),
  };
}

export function transferCall(
  token: string,
  recipient: string,
  amount: bigint,
): Call {
  const value = cairo.uint256(amount);
  return {
    contractAddress: token,
    entrypoint: "transfer",
    calldata: CallData.compile([recipient, value.low, value.high]),
  };
}

async function callU256(
  provider: RpcProvider,
  token: string,
  entrypoint: string,
  calldata: string[],
): Promise<bigint> {
  return toBigInt(
    await provider.callContract({
      contractAddress: token,
      entrypoint,
      calldata,
    }),
  );
}

export async function readBalance(
  provider: RpcProvider,
  token: string,
  owner: string,
): Promise<bigint> {
  try {
    return await callU256(provider, token, "balance_of", [owner]);
  } catch {
    return await callU256(provider, token, "balanceOf", [owner]);
  }
}

export async function readAllowance(
  provider: RpcProvider,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  return callU256(provider, token, "allowance", [owner, spender]);
}

export async function ensureAllowance(
  account: Account,
  token: string,
  spender: string,
  amount: bigint,
  tip = 0n,
): Promise<string | undefined> {
  const current = await readAllowance(
    account.provider,
    token,
    account.address,
    spender,
  );
  if (current >= amount) return undefined;
  const tx = await account.execute(approveCall(token, spender, amount), {
    tip,
    // Ready/Argent validation is material on RPC 0.10 and must be included
    // in the resource estimate or Sepolia can reject the transaction OOG.
    skipValidate: false,
  });
  await account.provider.waitForTransaction(tx.transaction_hash);
  return tx.transaction_hash;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error("Cannot parse u256 from empty result");
    }
    const low = toBigInt(value[0]);
    const high = value[1] === undefined ? 0n : toBigInt(value[1]);
    return low + (high << 128n);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("balance" in record) return toBigInt(record.balance);
    if ("low" in record && "high" in record) {
      return BigInt(String(record.low)) + (BigInt(String(record.high)) << 128n);
    }
  }
  throw new Error(`Cannot parse u256 from ${JSON.stringify(value)}`);
}
