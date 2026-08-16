"use client";

import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import type {
  AccountInterface,
  ProviderInterface,
  WalletAccountV6,
} from "starknet";
import { create } from "zustand";
import type { Strk20Capability } from "@/lib/strk20";

export interface WalletState {
  StarknetWalletObject: WalletWithStarknetFeatures | undefined;
  setMyStarknetWalletObject: (
    wallet: WalletWithStarknetFeatures | undefined
  ) => void;
  address: string;
  setAddressAccount: (address: string) => void;
  chain: string;
  setChain: (chain: string) => void;
  myWalletAccount: WalletAccountV6 | undefined;
  setMyWalletAccount: (myWAccount: WalletAccountV6 | undefined) => void;
  account: AccountInterface | undefined;
  setAccount: (account: AccountInterface | undefined) => void;
  provider: ProviderInterface | undefined;
  setProvider: (provider: ProviderInterface | undefined) => void;
  isConnected: boolean;
  setConnected: (isConnected: boolean) => void;
  displaySelectWalletUI: boolean;
  setSelectWalletUI: (displaySelectWalletUI: boolean) => void;
  walletApiList: string[];
  setWalletApiList: (version: string[]) => void;
  selectedApiVersion: string;
  setSelectedApiVersion: (version: string) => void;
  isStrk20Capable: boolean;
  setStrk20Capable: (supported: boolean) => void;
  strk20Capability: Strk20Capability | null;
  setStrk20Capability: (capability: Strk20Capability | null) => void;
  connectionNotice: string;
  setConnectionNotice: (notice: string) => void;
  disconnect: () => void;
}

export const useStoreWallet = create<WalletState>()((set) => ({
  StarknetWalletObject: undefined,
  setMyStarknetWalletObject: (StarknetWalletObject) =>
    set({ StarknetWalletObject }),
  address: "",
  setAddressAccount: (address) => set({ address }),
  chain: "",
  setChain: (chain) => set({ chain }),
  myWalletAccount: undefined,
  setMyWalletAccount: (myWalletAccount) => set({ myWalletAccount }),
  account: undefined,
  setAccount: (account) => set({ account }),
  provider: undefined,
  setProvider: (provider) => set({ provider }),
  isConnected: false,
  setConnected: (isConnected) => set({ isConnected }),
  displaySelectWalletUI: false,
  setSelectWalletUI: (displaySelectWalletUI) => set({ displaySelectWalletUI }),
  walletApiList: [],
  setWalletApiList: (walletApiList) => set({ walletApiList }),
  selectedApiVersion: "default",
  setSelectedApiVersion: (selectedApiVersion) => set({ selectedApiVersion }),
  isStrk20Capable: false,
  setStrk20Capable: (isStrk20Capable) => set({ isStrk20Capable }),
  strk20Capability: null,
  setStrk20Capability: (strk20Capability) => set({ strk20Capability }),
  connectionNotice: "",
  setConnectionNotice: (connectionNotice) => set({ connectionNotice }),
  disconnect: () =>
    set({
      StarknetWalletObject: undefined,
      address: "",
      chain: "",
      myWalletAccount: undefined,
      account: undefined,
      provider: undefined,
      isConnected: false,
      walletApiList: [],
      selectedApiVersion: "default",
      isStrk20Capable: false,
      strk20Capability: null,
    }),
}));
