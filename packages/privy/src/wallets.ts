import type { PrivyClient, Wallet } from "@privy-io/node";
import { PrivyError } from "./errors.js";
import { computeReadyAddress } from "./ready.js";
import type { CreateWalletInput, StarknetWalletInfo } from "./types.js";

export function toWalletInfo(
  wallet: Wallet,
  classHash: string,
): StarknetWalletInfo {
  if (wallet.chain_type !== "starknet") {
    throw new PrivyError(
      `Expected a starknet wallet, got ${wallet.chain_type}.`,
    );
  }
  const publicKey = wallet.public_key;
  if (!publicKey) {
    throw new PrivyError(
      `Wallet ${wallet.id} is missing a Starknet public key.`,
    );
  }
  return {
    walletId: wallet.id,
    publicKey,
    privyAddress: wallet.address,
    address: computeReadyAddress(publicKey, classHash),
    chainType: wallet.chain_type,
    raw: wallet,
  };
}

export async function createStarknetWallet(
  privy: PrivyClient,
  classHash: string,
  input: CreateWalletInput = {},
): Promise<StarknetWalletInfo> {
  let owner: { user_id: string } | { public_key: string } | undefined;
  if (input.owner && "userId" in input.owner) {
    owner = { user_id: input.owner.userId };
  } else if (input.owner && "publicKey" in input.owner) {
    owner = { public_key: input.owner.publicKey };
  }
  const wallet = await privy.wallets().create({
    chain_type: "starknet",
    ...(owner ? { owner } : {}),
    ...(input.owner && "ownerId" in input.owner
      ? { owner_id: input.owner.ownerId }
      : {}),
    ...(input.policyIds ? { policy_ids: input.policyIds } : {}),
  });
  return toWalletInfo(wallet, classHash);
}

export async function getStarknetWallet(
  privy: PrivyClient,
  walletId: string,
  classHash: string,
): Promise<StarknetWalletInfo> {
  const wallet = await privy.wallets().get(walletId);
  return toWalletInfo(wallet, classHash);
}

export async function listStarknetWallets(
  privy: PrivyClient,
  classHash: string,
  userId?: string,
): Promise<StarknetWalletInfo[]> {
  const wallets: StarknetWalletInfo[] = [];
  for await (const wallet of privy.wallets().list({
    chain_type: "starknet",
    ...(userId ? { user_id: userId } : {}),
  })) {
    try {
      wallets.push(toWalletInfo(wallet, classHash));
    } catch {
      // Skip incomplete / non-starknet rows.
    }
  }
  return wallets;
}
