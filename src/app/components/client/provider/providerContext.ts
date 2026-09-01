"use client";
import { create } from "zustand";
import { localnetWalletEnabled } from "@/utils/constants";

// StarknetChainId
//   0  SN_MAIN = "0x534e5f4d41494e",
//   1  SN_GOERLI = "0x534e5f474f45524c49",
//   2  SN_SEPOLIA = "0x534e5f5345504f4c4941",

const NETWORK_TOGGLE_STORAGE_KEY = "app20/network-toggle/v1";

// Only the header toggle position is remembered. Connecting a wallet still
// requires an explicit click, and network policy is enforced at submit time,
// so restoring this display state cannot route value to the wrong network.
function readInitialProviderIndex(): number {
  try {
    const raw = globalThis.localStorage?.getItem(NETWORK_TOGGLE_STORAGE_KEY);
    if (raw === "0" || raw === "2") return Number(raw);
    if (raw === "3" && localnetWalletEnabled) return 3;
  } catch {
    // Storage may be unavailable (private mode, SSR); fall through.
  }
  return 2;
}

function persistProviderIndex(index: number): void {
  try {
    if (index === 0 || index === 2 || index === 3) {
      globalThis.localStorage?.setItem(
        NETWORK_TOGGLE_STORAGE_KEY,
        String(index),
      );
    }
  } catch {
    // Best effort only.
  }
}

interface FrontEndProviderState {
  currentFrontendProviderIndex: number;
  setCurrentFrontendProviderIndex: (
    currentFrontendProviderIndex: number,
  ) => void;
}

export const useFrontendProvider = create<FrontEndProviderState>()((set) => ({
  currentFrontendProviderIndex: readInitialProviderIndex(),
  setCurrentFrontendProviderIndex: (currentFrontendProviderIndex: number) => {
    set((state) => {
      if (state.currentFrontendProviderIndex === currentFrontendProviderIndex) {
        return state;
      }
      persistProviderIndex(currentFrontendProviderIndex);
      return { currentFrontendProviderIndex };
    });
  },
}));
