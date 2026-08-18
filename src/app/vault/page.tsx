"use client";

import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { privyBrowserConfigured } from "@/app/vault/privy-config";
import PrivacyWalletMenu from "@/components/mail/PrivacyWalletMenu";
import { readPublicStrkBalance } from "@/lib/mainnet-safety";
import { formatStrkAmount } from "@/lib/strk-amount";
import { myFrontendProviders } from "@/utils/constants";
import { useQuery } from "@tanstack/react-query";
import { useVaultMode } from "@/app/vault/vaultMode";
import { lazy, Suspense } from "react";

const PrivySepoliaVault = lazy(() => import("./PrivySepoliaVault"));

export default function VaultPage() {
  const connected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const chain = useStoreWallet((state) => state.chain);
  const capable = useStoreWallet((state) => state.isStrk20Capable);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const mode = useVaultMode((state) => state.mode);
  const setMode = useVaultMode((state) => state.setMode);
  const publicBalance = useQuery({
    queryKey: ["ready-public-strk", providerIndex, address],
    enabled: mode === "ready" && connected && Boolean(address),
    queryFn: () =>
      readPublicStrkBalance(myFrontendProviders[providerIndex], address),
  });

  return (
    <main className="vault-page">
      <header className="vault-intro">
        <div>
          <p>APP20 / SHIELDED WALLET</p>
          <h1>Public entry. Private balance. Explicit exit.</h1>
          <span>
            Mainnet routes through the Ready Wallet Standard adapter. Privy is
            deliberately restricted to Sepolia and cannot request a Mainnet
            signature, proof, discovery scan, or submission.
          </span>
        </div>
        <div className="vault-mode-switch" aria-label="Vault authorization rail">
          <button
            type="button"
            aria-pressed={mode === "ready"}
            className={mode === "ready" ? "is-active" : ""}
            onClick={() => setMode("ready")}
          >
            MAINNET / READY
          </button>
          <button
            type="button"
            aria-pressed={mode === "privy"}
            className={mode === "privy" ? "is-active" : ""}
            onClick={() => setMode("privy")}
            disabled={!privyBrowserConfigured}
            title={
              privyBrowserConfigured
                ? "Open the Privy Sepolia recovery vault"
                : "Configure the public Privy App ID and Client ID to enable Sepolia"
            }
          >
            SEPOLIA / PRIVY
          </button>
          {!privyBrowserConfigured ? (
            <p className="vault-mode-note">
              Sepolia / Privy is disabled until the public App ID, Client ID,
              and reviewed OHTTP key pins are configured.
            </p>
          ) : null}
        </div>
      </header>

      {mode === "privy" && privyBrowserConfigured ? (
        <Suspense fallback={<div className="privy-vault-empty">LOADING PRIVY VAULT…</div>}>
          <PrivySepoliaVault />
        </Suspense>
      ) : (
        <div className="vault-grid">
          <section
            className="vault-public panel-frame"
            aria-labelledby="public-rail-title"
          >
            <div className="panel-heading">
              <span>READY / WALLET STANDARD</span>
              <strong id="public-rail-title">Connected account</strong>
            </div>
            <div className="vault-state">
              <span
                className={`rail-indicator ${connected ? "is-live" : ""}`}
                aria-hidden="true"
              />
              <div>
                <small>
                  {connected ? "WALLET STANDARD CONNECTED" : "CONNECTION REQUIRED"}
                </small>
                <strong>{address || "No public account"}</strong>
                <p>
                  {chain || "Select Starknet Mainnet in Ready."} · Mainnet
                  rejects Privy and every unreviewed Wallet Standard feature ID
                  before privacy execution.
                </p>
              </div>
            </div>
            <SelectWallet variant="ctaBig" />
            <div className="rail-facts">
              <span>
                <b>Public STRK</b>
                {publicBalance.data === undefined
                  ? publicBalance.isError
                    ? "Unavailable"
                    : "—"
                  : formatStrkAmount(publicBalance.data)}
                <button
                  type="button"
                  onClick={() => void publicBalance.refetch()}
                  disabled={!connected || publicBalance.isFetching}
                >
                  Refresh
                </button>
              </span>
              <span><b>Unshield exit</b>Public transaction</span>
              <span><b>Privacy API</b>{capable ? "Available" : "Not available"}</span>
            </div>
          </section>

          <section
            className="vault-private panel-frame"
            aria-labelledby="shielded-rail-title"
          >
            <div className="panel-heading">
              <span>SHIELDED RAIL</span>
              <strong id="shielded-rail-title">Ready privacy controls</strong>
            </div>
            <PrivacyWalletMenu showIdentity={false} />
          </section>
        </div>
      )}
    </main>
  );
}
