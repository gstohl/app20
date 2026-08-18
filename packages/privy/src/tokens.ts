import {
  cairo,
  CallData,
  Contract,
  type Account,
  type Call,
  type RpcProvider,
} from "starknet";
import { NETWORK_DEFAULTS } from "./constants.js";
import type { StarknetNetwork } from "./constants.js";

const ERC20_ABI = [
  {
    type: "function",
    name: "balance_of",
    inputs: [
      {
        name: "account",
        type: "core::starknet::contract_address::ContractAddress",
      },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [
      {
        name: "account",
        type: "core::starknet::contract_address::ContractAddress",
      },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      {
        name: "owner",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "spender",
        type: "core::starknet::contract_address::ContractAddress",
      },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "core::integer::u8" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "core::byte_array::ByteArray" }],
    state_mutability: "view",
  },
] as const;

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

export async function readBalance(
  provider: RpcProvider,
  token: string,
  owner: string,
): Promise<bigint> {
  const contract = new Contract({
    abi: ERC20_ABI,
    address: token,
    providerOrAccount: provider,
  });
  try {
    const result = await contract.call("balance_of", [owner]);
    return toBigInt(result);
  } catch {
    const result = await contract.call("balanceOf", [owner]);
    return toBigInt(result);
  }
}

export async function readAllowance(
  provider: RpcProvider,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const contract = new Contract({
    abi: ERC20_ABI,
    address: token,
    providerOrAccount: provider,
  });
  const result = await contract.call("allowance", [owner, spender]);
  return toBigInt(result);
}

export async function ensureAllowance(
  account: Account,
  token: string,
  spender: string,
  amount: bigint,
  tip = 0n,
): Promise<string | undefined> {
  const current = await readAllowance(
    account as never,
    token,
    account.address,
    spender,
  ).catch(async () =>
    readAllowance(account.provider, token, account.address, spender),
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
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("balance" in record) return toBigInt(record.balance);
    if ("low" in record && "high" in record) {
      return BigInt(String(record.low)) + (BigInt(String(record.high)) << 128n);
    }
  }
  throw new Error(`Cannot parse u256 from ${JSON.stringify(value)}`);
}
