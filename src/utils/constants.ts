import { constants, type ProviderInterface, RpcProvider } from "starknet";
import { feltEquals } from "@/lib/addresses";

export const addrSTRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const alchemyKey = import.meta.env.VITE_PROVIDER_URL ?? "";

/** A dapp-only chain id so a production build can never mistake devnet for Sepolia. */
export const LOCALNET_CHAIN_ID = "0x51554945544c494e455f4c4f43414c";
export const LOCALNET_PROVIDER_INDEX = 3;
export const localnetWalletEnabled = import.meta.env.VITE_E2E_WALLET === true;

// Indices follow the starter's convention: Mainnet = 0, Sepolia = 2. The
// localnet provider is appended only in an explicitly flagged dev build.
export const myFrontendProviders: ProviderInterface[] = [
  new RpcProvider({
    nodeUrl:
      "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/" +
      alchemyKey,
  }),
  new RpcProvider({ nodeUrl: "https://starknet-testnet.public.blastapi.io/rpc/v0_7" }),
  new RpcProvider({
    nodeUrl:
      "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/" +
      alchemyKey,
  }),
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

// QuietlineMail helper — 0x0 until Phase 2 deploy.
export const mailHelperSepolia =
  import.meta.env.VITE_MAIL_HELPER_SEPOLIA ?? "0x0";
export const mailHelperMainnet =
  import.meta.env.VITE_MAIL_HELPER_MAINNET ?? "0x0";
export const mailHelperLocalnet = localnetWalletEnabled
  ? import.meta.env.VITE_MAIL_HELPER_LOCALNET ?? "0x0"
  : "0x0";
