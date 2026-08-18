import { constants } from "starknet";

export type StarknetNetwork = "mainnet" | "sepolia";

/**
 * Ready / Argent account v0.5.0. Privy's returned Starknet address assumes this
 * class hash plus the constructor compiled in `src/ready.ts`.
 *
 * Source: https://github.com/argentlabs/argent-contracts-starknet/blob/6243bcf39fac0df25cff183056a9bc8f1e15ef28/deployments/account.txt
 */
export const READY_ACCOUNT_CLASS_HASH_V0_5_0 =
  "0x073414441639dcd11d1846f287650a00c60c416b9d3ba45d31c651672125b2c2";

/** Official STRK ERC-20 on Starknet mainnet. */
export const STRK_MAINNET =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Official STRK ERC-20 on Starknet Sepolia. */
export const STRK_SEPOLIA =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/**
 * Privacy pool v2.0 on Sepolia.
 * Source: https://strk20-by-example.org/sdk/getting-started
 */
export const STRK20_POOL_SEPOLIA =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

/**
 * Notes mature 10 blocks after creation. The sequencer also only accepts
 * proofs whose base block is at least this many blocks behind the tip.
 */
export const NOTE_MATURITY_BLOCKS = 10;

/** Domain used when deriving a viewing key from a Privy-signed SNIP-12 message. */
export const VIEWING_KEY_TYPED_DATA_NAME = "strk20-privy";
export const VIEWING_KEY_TYPED_DATA_VERSION = "1";
export const VIEWING_KEY_MESSAGE = "STRK20 viewing key";

export const NETWORK_DEFAULTS: Record<
  StarknetNetwork,
  {
    chainId: constants.StarknetChainId;
    alchemyNetwork: "starknet-mainnet" | "starknet-sepolia";
    strk: string;
    poolAddress?: string;
    paymasterUrl?: string;
    explorerTx: (hash: string) => string;
    explorerAddress: (address: string) => string;
  }
> = {
  mainnet: {
    chainId: constants.StarknetChainId.SN_MAIN,
    alchemyNetwork: "starknet-mainnet",
    strk: STRK_MAINNET,
    paymasterUrl: "https://starknet.paymaster.avnu.fi",
    explorerTx: (hash) => `https://voyager.online/tx/${hash}`,
    explorerAddress: (address) => `https://voyager.online/contract/${address}`,
  },
  sepolia: {
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    alchemyNetwork: "starknet-sepolia",
    strk: STRK_SEPOLIA,
    poolAddress: STRK20_POOL_SEPOLIA,
    paymasterUrl: "https://sepolia.paymaster.avnu.fi",
    explorerTx: (hash) => `https://sepolia.voyager.online/tx/${hash}`,
    explorerAddress: (address) =>
      `https://sepolia.voyager.online/contract/${address}`,
  },
};

export function alchemyRpcUrl(
  network: StarknetNetwork,
  apiKey: string,
): string {
  const slug = NETWORK_DEFAULTS[network].alchemyNetwork;
  return `https://${slug}.g.alchemy.com/starknet/version/rpc/v0_10/${apiKey}`;
}
