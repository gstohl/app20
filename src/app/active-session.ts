"use client";

import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useWalletMode, type WalletMode } from "@/app/rfq/walletMode";
import { canonicalizeStarknetAddress, feltEquals } from "@/lib/addresses";
import {
  networkForProviderIndex,
  type App20TokenNetwork,
} from "@/lib/token-registry";
import { LOCALNET_CHAIN_ID, localnetWalletEnabled } from "@/utils/constants";
import { constants } from "starknet";

export type ActiveStarknetSession = Readonly<{
  rail: "ready" | "privy";
  connected: boolean;
  account: string | null;
  chainId: string | null;
  network: App20TokenNetwork | null;
  compatible: boolean;
  reason: string;
}>;

export type ActiveStarknetSessionInput = Readonly<{
  mode: WalletMode;
  providerIndex: number;
  readyConnected: boolean;
  readyAddress: string;
  readyChainId: string;
  privyConnected: boolean;
  privyAddress: string;
}>;

function canonicalNonzero(value: string): string | null {
  try {
    const canonical = canonicalizeStarknetAddress(value);
    return canonical === "0x0" ? null : canonical;
  } catch {
    return null;
  }
}

function networkForChain(chainId: string): App20TokenNetwork | null {
  if (
    chainId === "SN_MAIN" ||
    feltEquals(chainId, constants.StarknetChainId.SN_MAIN)
  ) {
    return "mainnet";
  }
  if (
    chainId === "SN_SEPOLIA" ||
    feltEquals(chainId, constants.StarknetChainId.SN_SEPOLIA)
  ) {
    return "sepolia";
  }
  if (localnetWalletEnabled && feltEquals(chainId, LOCALNET_CHAIN_ID)) {
    return "localnet";
  }
  return null;
}

export function resolveActiveStarknetSession(
  input: ActiveStarknetSessionInput,
): ActiveStarknetSession {
  if (input.mode === "privy") {
    const account = canonicalNonzero(input.privyAddress);
    const connected = input.privyConnected && account !== null;
    return Object.freeze({
      rail: "privy" as const,
      connected,
      account,
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      network: "sepolia" as const,
      compatible: connected,
      reason: connected
        ? "Privy account is active on Sepolia."
        : "No active Privy Sepolia account.",
    });
  }

  const account = canonicalNonzero(input.readyAddress);
  const chainNetwork = networkForChain(input.readyChainId);
  const selectedNetwork = networkForProviderIndex(input.providerIndex);
  const connected = input.readyConnected && account !== null;
  const compatible =
    connected &&
    chainNetwork !== null &&
    selectedNetwork !== null &&
    chainNetwork === selectedNetwork;
  return Object.freeze({
    rail: "ready" as const,
    connected,
    account,
    chainId: chainNetwork === null ? null : input.readyChainId,
    network: chainNetwork,
    compatible,
    reason: connected
      ? chainNetwork === null
        ? "Ready reported an unsupported Starknet chain."
        : selectedNetwork === chainNetwork
          ? "Ready account and network are active."
          : "Ready account and selected network do not match."
      : "No active Ready account.",
  });
}

export function useActiveStarknetSession(): ActiveStarknetSession {
  const mode = useWalletMode((state) => state.mode);
  const privyConnected = useWalletMode((state) => state.privyConnected);
  const privyAddress = useWalletMode((state) => state.privyAddress);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const readyConnected = useStoreWallet((state) => state.isConnected);
  const readyAddress = useStoreWallet((state) => state.address);
  const readyChainId = useStoreWallet((state) => state.chain);
  return resolveActiveStarknetSession({
    mode,
    providerIndex,
    readyConnected,
    readyAddress,
    readyChainId,
    privyConnected,
    privyAddress,
  });
}
