"use client";

import { useState } from "react";
import { useActiveStarknetSession } from "@/app/active-session";
import { constants as snConstants, walletV6 } from "starknet";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useVaultMode, type VaultMode } from "@/app/vault/vaultMode";
import {
  isStrk20Chain,
  localnetWalletEnabled,
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

function NetworkToggle() {
  const mode = useVaultMode((state) => state.mode);
  const wallet = useStoreWallet((state) => state.StarknetWalletObject);
  const connected = useStoreWallet((state) => state.isConnected);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const setProviderIndex = useFrontendProvider(
    (state) => state.setCurrentFrontendProviderIndex,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  if (mode === "privy") return null;

  async function choose(target: 0 | 2 | 3) {
    setNotice("");
    if (providerIndex === target) return;
    if (!connected || !wallet) {
      setProviderIndex(target);
      return;
    }
    if (target === 3) {
      setNotice("Disconnect the live wallet, then connect Localnet (dev).");
      return;
    }
    if (providerIndex === 3) {
      setNotice("Disconnect Localnet (dev) before selecting a live network.");
      return;
    }
    setBusy(true);
    try {
      await walletV6.switchStarknetChain(
        wallet,
        target === 0
          ? snConstants.StarknetChainId.SN_MAIN
          : snConstants.StarknetChainId.SN_SEPOLIA,
      );
      // The wallet-standard change event updates chain and provider index.
    } catch (error: unknown) {
      setNotice(
        error instanceof Error && error.message.trim()
          ? "The wallet declined the network switch. Change it in Ready."
          : "The wallet declined the network switch.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.networkToggle} aria-label="Network">
      <button
        type="button"
        aria-pressed={providerIndex === 0}
        className={providerIndex === 0 ? styles.networkActive : undefined}
        onClick={() => void choose(0)}
        disabled={busy}
      >
        MAIN
      </button>
      <button
        type="button"
        aria-pressed={providerIndex === 2}
        className={providerIndex === 2 ? styles.networkActive : undefined}
        onClick={() => void choose(2)}
        disabled={busy}
      >
        SEPOLIA
      </button>
      {localnetWalletEnabled ? (
        <button
          type="button"
          aria-pressed={providerIndex === 3}
          className={providerIndex === 3 ? styles.networkActive : undefined}
          onClick={() => void choose(3)}
          disabled={busy}
        >
          LOCAL
        </button>
      ) : null}
      {notice ? <span role="status">{notice}</span> : null}
    </div>
  );
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
      <NetworkToggle />
      <div className={styles.walletAction}>
        <SelectWallet variant="nav" />
      </div>
    </section>
  );
}

export default function SessionControl() {
  const active = useActiveStarknetSession();
  const network = active.network
    ? active.network === "localnet"
      ? "LOCALNET (DEV)"
      : active.network.toUpperCase()
    : "OFFLINE";
  const session: SessionDisplay = {
    connected: active.connected,
    address: active.account ?? "",
    network,
    rail:
      active.rail === "privy"
        ? "PRIVY"
        : active.network === "localnet"
          ? "DEV WALLET"
          : "READY",
  };

  return <SessionControlView session={session} />;
}
