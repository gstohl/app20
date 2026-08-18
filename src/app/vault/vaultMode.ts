import { create } from "zustand";
import { privyBrowserConfigured } from "@/app/vault/privy-config";

export type VaultMode = "ready" | "privy";

type VaultModeState = {
  mode: VaultMode;
  setMode: (mode: VaultMode) => void;
  privyConnected: boolean;
  privyAddress: string;
  setPrivyStatus: (connected: boolean, address?: string) => void;
};

export const useVaultMode = create<VaultModeState>((set) => ({
  mode: privyBrowserConfigured ? "privy" : "ready",
  setMode: (mode) => set({ mode }),
  privyConnected: false,
  privyAddress: "",
  setPrivyStatus: (connected, address = "") =>
    set({ privyConnected: connected, privyAddress: address }),
}));
