import { constants, type ProviderInterface, RpcProvider } from "starknet";
import { feltEquals } from "@/lib/addresses";
import { addrSTRK } from "@/lib/tokens";

export { addrSTRK };

export function rpcRelayUrl(
  network: "mainnet" | "sepolia",
  origin = globalThis.location?.origin ?? "http://localhost",
): string {
  return new URL(`/api/starknet/${network}`, origin).toString();
}

/** A dapp-only chain id so a production build can never mistake devnet for Sepolia. */
export const LOCALNET_CHAIN_ID = "0x51554945544c494e455f4c4f43414c";
export const LOCALNET_PROVIDER_INDEX = 3;
export const localnetWalletEnabled = import.meta.env.VITE_E2E_WALLET === true;

// Indices follow the starter's convention: Mainnet = 0, Sepolia = 2. The
// localnet provider is appended only in an explicitly flagged dev build.
export const myFrontendProviders: ProviderInterface[] = [
  new RpcProvider({ nodeUrl: rpcRelayUrl("mainnet") }),
  new RpcProvider({
    nodeUrl: "https://starknet-testnet.public.blastapi.io/rpc/v0_7",
  }),
  new RpcProvider({ nodeUrl: rpcRelayUrl("sepolia") }),
];

if (localnetWalletEnabled) {
  myFrontendProviders.push(
    new RpcProvider({
      nodeUrl: import.meta.env.VITE_LOCALNET_RPC_URL,
    }),
  );
}

export function isStrk20Chain(chainId: string): boolean {
  if (feltEquals(chainId, LOCALNET_CHAIN_ID)) return localnetWalletEnabled;

  return (
    chainId === "SN_MAIN" ||
    chainId === "SN_SEPOLIA" ||
    feltEquals(chainId, constants.StarknetChainId.SN_MAIN) ||
    feltEquals(chainId, constants.StarknetChainId.SN_SEPOLIA)
  );
}

export function providerIndexForChain(chainId: string): 0 | 2 | 3 {
  if (localnetWalletEnabled && feltEquals(chainId, LOCALNET_CHAIN_ID)) {
    return LOCALNET_PROVIDER_INDEX;
  }
  return chainId === "SN_MAIN" ||
    feltEquals(chainId, constants.StarknetChainId.SN_MAIN)
    ? 0
    : 2;
}

export const Strk20Networks: Record<number, string> = {
  0: "MAINNET",
  2: "SEPOLIA",
};
if (localnetWalletEnabled) {
  Strk20Networks[LOCALNET_PROVIDER_INDEX] = "LOCALNET (DEV)";
}

export const strk20PoolMainnet =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
export const strk20PoolSepolia =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
export const strk20PoolLocalnet = localnetWalletEnabled
  ? (import.meta.env.VITE_LOCALNET_POOL_ADDRESS ?? "0x0")
  : "0x0";

export function strk20PoolForProviderIndex(
  providerIndex: number,
): string | null {
  if (providerIndex === 0) return strk20PoolMainnet;
  if (providerIndex === 2) return strk20PoolSepolia;
  if (providerIndex === LOCALNET_PROVIDER_INDEX && localnetWalletEnabled) {
    return strk20PoolLocalnet;
  }
  return null;
}

// QuietlineMail helper — 0x0 until Phase 2 deploy.
export const mailHelperSepolia =
  import.meta.env.VITE_MAIL_HELPER_SEPOLIA ?? "0x0";
export const mailHelperMainnet =
  import.meta.env.VITE_MAIL_HELPER_MAINNET ?? "0x0";
export const mailHelperLocalnet = localnetWalletEnabled
  ? (import.meta.env.VITE_MAIL_HELPER_LOCALNET ?? "0x0")
  : "0x0";

// QuietlineEscrow remains 0x0 unless a reviewed deployment is configured.
// It is intentionally excluded from the mainnet scoring path.
export const escrowHelperSepolia =
  import.meta.env.VITE_ESCROW_HELPER_SEPOLIA ?? "0x0";
export const escrowHelperMainnet =
  import.meta.env.VITE_ESCROW_HELPER_MAINNET ?? "0x0";
export const escrowHelperLocalnet = localnetWalletEnabled
  ? (import.meta.env.VITE_ESCROW_HELPER_LOCALNET ?? "0x0")
  : "0x0";
