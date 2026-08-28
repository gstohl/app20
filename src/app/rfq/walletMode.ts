import { create } from "zustand";
import { privyBrowserConfigured } from "@/app/rfq/privy-config";

export type WalletMode = "ready" | "privy";

type WalletModeState = {
  mode: WalletMode;
  setMode: (mode: WalletMode) => void;
  privyConnected: boolean;
  privyAddress: string;
  setPrivyStatus: (connected: boolean, address?: string) => void;
};

export function assertPrivyRailSelected(mode: WalletMode): void {
  if (mode !== "privy") {
    throw new Error("Switch explicitly to the Privy rail before using its signer or wallet export.");
  }
}

export const useWalletMode = create<WalletModeState>((set) => ({
  mode: privyBrowserConfigured ? "privy" : "ready",
  setMode: (mode) => set({ mode }),
  privyConnected: false,
  privyAddress: "",
  setPrivyStatus: (connected, address = "") =>
    set({ privyConnected: connected, privyAddress: address }),
}));
