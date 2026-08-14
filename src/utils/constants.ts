import { constants, type ProviderInterface, RpcProvider } from "starknet";
import { feltEquals } from "@/lib/addresses";

export const addrSTRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const alchemyKey = import.meta.env.VITE_PROVIDER_URL ?? "";

// Indices follow the starter's convention: Mainnet = 0, Sepolia = 2.
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

export function isStrk20Chain(chainId: string): boolean {
  return (
    chainId === "SN_MAIN" ||
    chainId === "SN_SEPOLIA" ||
    feltEquals(chainId, constants.StarknetChainId.SN_MAIN) ||
    feltEquals(chainId, constants.StarknetChainId.SN_SEPOLIA)
  );
}

export function providerIndexForChain(chainId: string): 0 | 2 {
  return chainId === "SN_MAIN" ||
    feltEquals(chainId, constants.StarknetChainId.SN_MAIN)
    ? 0
    : 2;
}

export const Strk20Networks: Record<number, string> = {
  0: "MAINNET",
  2: "SEPOLIA",
};

// QuietlineMail helper — 0x0 until Phase 2 deploy.
export const mailHelperSepolia =
  import.meta.env.VITE_MAIL_HELPER_SEPOLIA ?? "0x0";
export const mailHelperMainnet =
  import.meta.env.VITE_MAIL_HELPER_MAINNET ?? "0x0";
