import { constants, type ProviderInterface, RpcProvider } from "starknet";
import { feltEquals } from "@/lib/addresses";

export const addrSTRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const alchemyKey = process.env.NEXT_PUBLIC_PROVIDER_URL ?? "";

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

// DEMO only: an optional echo helper retained from the starter for debugging.
// Feltproof does not deploy or depend on it in Phase 1.
const Strk20EchoHelperAddress =
  "0x78ae662e0cc6d1ab2cfeaf2a51ba8783d88e31886f88a794d142f95a6f8735b";
const Strk20EchoHelperSepolia =
  process.env.NEXT_PUBLIC_STRK20_ECHO_HELPER_SEPOLIA ?? "0x0";

export function echoHelperForIndex(index: number): string {
  if (index === 0) return Strk20EchoHelperAddress;
  if (index === 2) return Strk20EchoHelperSepolia;
  return "0x0";
}
