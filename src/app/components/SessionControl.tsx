"use client";

import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useVaultMode, type VaultMode } from "@/app/vault/vaultMode";
import {
  isStrk20Chain,
  providerIndexForChain,
  Strk20Networks,
} from "@/utils/constants";
import styles from "./session.module.css";

type SessionState = {
  mode: VaultMode;
  readyConnected: boolean;
  readyAddress: string;
  readyChain: string;
  privyConnected: boolean;
  privyAddress: string;
};

export type SessionDisplay = {
  connected: boolean;
  address: string;
  network: string;
  rail: "READY" | "PRIVY" | "DEV WALLET";
};

export function shortSessionAddress(address: string): string {
  return address.length > 14
    ? `${address.slice(0, 7)}…${address.slice(-5)}`
    : address;
}

function readyNetworkLabel(chain: string): string {
  if (!chain) return "OFFLINE";
  if (isStrk20Chain(chain)) {
    return Strk20Networks[providerIndexForChain(chain)] ?? "STARKNET";
  }
  return chain.replace(/^SN_/i, "").toUpperCase();
}

export function resolveSessionDisplay(state: SessionState): SessionDisplay {
  if (state.mode === "privy") {
    return {
      connected: state.privyConnected,
      address: state.privyAddress,
      network: "SEPOLIA",
      rail: "PRIVY",
    };
  }

  const network = readyNetworkLabel(state.readyChain);
  return {
    connected: state.readyConnected,
    address: state.readyAddress,
    network,
    rail: network === "LOCALNET (DEV)" ? "DEV WALLET" : "READY",
  };
}

export function SessionControlView({ session }: { session: SessionDisplay }) {
  const accountLabel = session.address
    ? shortSessionAddress(session.address)
    : session.connected
      ? "IDENTITY CONNECTED"
      : "NO ACTIVE ACCOUNT";
  const fullLabel = `${session.network} / ${session.rail}`;

  return (
    <section
      className={styles.session}
      aria-label="Wallet session"
      data-active-rail={session.rail.toLowerCase().replace(" ", "-")}
    >
      <div
        className={styles.summary}
        title={`${fullLabel} · ${session.address || "Wallet disconnected"}`}
        aria-live="polite"
      >
        <span
          className={`${styles.statusDot} ${session.connected ? styles.connected : ""}`}
          aria-hidden="true"
        />
        <span className={styles.identity}>
          <span className={styles.rail}>{fullLabel}</span>
          <span className={styles.address}>{accountLabel}</span>
        </span>
      </div>
      <div className={styles.walletAction}>
        <SelectWallet variant="nav" />
      </div>
    </section>
  );
}

export default function SessionControl() {
  const readyConnected = useStoreWallet((state) => state.isConnected);
  const readyAddress = useStoreWallet((state) => state.address);
  const readyChain = useStoreWallet((state) => state.chain);
  const mode = useVaultMode((state) => state.mode);
  const privyConnected = useVaultMode((state) => state.privyConnected);
  const privyAddress = useVaultMode((state) => state.privyAddress);
  const session = resolveSessionDisplay({
    mode,
    readyConnected,
    readyAddress,
    readyChain,
    privyConnected,
    privyAddress,
  });

  return <SessionControlView session={session} />;
}
