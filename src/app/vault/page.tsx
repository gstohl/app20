"use client";

import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { privyBrowserConfigured } from "@/app/vault/privy-config";
import PrivacyWalletMenu from "@/components/mail/PrivacyWalletMenu";
import { readPublicStrkBalance } from "@/lib/mainnet-safety";
import { formatStrkAmount } from "@/lib/strk-amount";
import * as constants from "@/utils/constants";
import { useQuery } from "@tanstack/react-query";
import { useVaultMode } from "@/app/vault/vaultMode";
import { lazy, Suspense } from "react";
import styles from "./vault.module.css";

const PrivySepoliaVault = lazy(() => import("./PrivySepoliaVault"));

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

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
      readPublicStrkBalance(
        constants.myFrontendProviders[providerIndex],
        address,
      ),
  });

  const networkName = constants.Strk20Networks[providerIndex];
  const poolAddress = constants.strk20PoolForProviderIndex(providerIndex);
  const publicStrkLabel =
    publicBalance.data === undefined
      ? publicBalance.isError
        ? "Unavailable"
        : "—"
      : formatStrkAmount(publicBalance.data);

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadCopy}>
          <p className={styles.eyebrow}>APP20 / VAULT</p>
          <h1>Public entry. Private balance. Explicit exit.</h1>
          <span>
            The vault is APP20&apos;s primary wallet: public STRK on one side,
            the shielded pool balance on the other, and only three ways across —
            Shield, Private transfer, Unshield. The same account signs Mail.
            Mainnet routes through the Ready Wallet Standard adapter; Privy is
            deliberately restricted to Sepolia and cannot request a Mainnet
            signature, proof, discovery scan, or submission.
          </span>
        </div>
        <div
          className={styles.railSwitch}
          aria-label="Vault authorization rail"
        >
          <button
            type="button"
            aria-pressed={mode === "ready"}
            className={mode === "ready" ? styles.isActive : ""}
            onClick={() => setMode("ready")}
          >
            MAINNET / READY
          </button>
          <button
            type="button"
            aria-pressed={mode === "privy"}
            className={mode === "privy" ? styles.isActive : ""}
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
          {privyBrowserConfigured ? null : (
            <p className={styles.railSwitchNote}>
              Sepolia / Privy is disabled until the public App ID, Client ID,
              and reviewed OHTTP key pins are configured.
            </p>
          )}
        </div>
      </header>

      {mode === "privy" && privyBrowserConfigured ? (
        <Suspense
          fallback={
            <div className={styles.privyFallback}>LOADING PRIVY VAULT…</div>
          }
        >
          <PrivySepoliaVault />
        </Suspense>
      ) : (
        <>
          <section
            className={styles.session}
            aria-labelledby="vault-session-title"
          >
            <div className={styles.sessionMain}>
              <span
                className={`${styles.beacon} ${connected ? styles.beaconLive : ""}`}
                aria-hidden="true"
              />
              <div className={styles.sessionIdentity}>
                <small>READY / WALLET STANDARD</small>
                <strong id="vault-session-title">
                  {connected ? "Vault session" : "Connect the vault"}
                </strong>
                <code>{address || "No public account connected"}</code>
                <p>
                  {chain || "Select Starknet Mainnet in Ready."} · Mainnet
                  rejects Privy and every unreviewed Wallet Standard feature ID
                  before privacy execution. Display names are never trusted.
                </p>
              </div>
            </div>
            <div className={styles.sessionSide}>
              <SelectWallet variant="ctaBig" />
              <dl className={styles.sessionFacts}>
                <div>
                  <dt>Network</dt>
                  <dd>{networkName ?? chain ?? "Not selected"}</dd>
                </div>
                <div>
                  <dt>Privacy API</dt>
                  <dd>{capable ? "Available" : "Not available"}</dd>
                </div>
                <div>
                  <dt>Signing rail</dt>
                  <dd>Ready only on Mainnet</dd>
                </div>
              </dl>
            </div>
          </section>

          <div className={styles.desk}>
            <section
              className={styles.panel}
              aria-labelledby="vault-public-title"
            >
              <header className={styles.panelHeading}>
                <span>PUBLIC RAIL</span>
                <strong id="vault-public-title">Public STRK</strong>
              </header>
              <div className={styles.metric}>
                <strong>{publicStrkLabel}</strong>
                <span>STRK</span>
                <button
                  type="button"
                  onClick={() => void publicBalance.refetch()}
                  disabled={!connected || publicBalance.isFetching}
                >
                  {publicBalance.isFetching ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              <p className={styles.metricCaption}>
                Held by the connected account and visible to everyone. Shield
                preflight re-reads this balance and the live pool fee before
                asking the wallet to sign.
              </p>
              <ul className={styles.railList}>
                <li>
                  <b>Shield entry</b>
                  Public deposit into the pool. Amount and sender are on-chain.
                </li>
                <li>
                  <b>Unshield exit</b>
                  Public withdrawal to this account. Amount and recipient are
                  on-chain.
                </li>
                <li>
                  <b>Pool</b>
                  {poolAddress ? (
                    <code title={poolAddress}>{shortAddress(poolAddress)}</code>
                  ) : (
                    "No STRK20 pool on this network."
                  )}
                </li>
              </ul>
            </section>

            <section
              className={styles.panel}
              aria-labelledby="vault-shielded-title"
            >
              <header className={styles.panelHeading}>
                <span>SHIELDED RAIL</span>
                <strong id="vault-shielded-title">
                  Shield · Private transfer · Unshield
                </strong>
              </header>
              <div className={styles.controlsBody}>
                <PrivacyWalletMenu showIdentity={false} />
              </div>
            </section>
          </div>

          <section
            className={styles.railMap}
            aria-label="How STRK moves through the vault"
          >
            <article className={styles.railStage}>
              <header>
                <h2>1 · Shield</h2>
                <span className={styles.stageBadge}>PUBLIC</span>
              </header>
              <p>
                Deposit STRK from the public account into the pool. The deposit
                leg is a normal transaction; everyone can see it happened.
              </p>
            </article>
            <article className={styles.railStage}>
              <header>
                <h2>2 · Private transfer</h2>
                <span
                  className={`${styles.stageBadge} ${styles.stageBadgePrivate}`}
                >
                  IN-POOL
                </span>
              </header>
              <p>
                Move STRK inside the pool. Sender, recipient, and amount stay
                hidden. Mail memos and payments ride this same rail.
              </p>
            </article>
            <article className={styles.railStage}>
              <header>
                <h2>3 · Unshield</h2>
                <span className={styles.stageBadge}>PUBLIC</span>
              </header>
              <p>
                Withdraw back to a public account. The exit leg is public, so
                shield and unshield timing can be correlated — space them out.
              </p>
            </article>
          </section>

          <p className={styles.disclosure}>
            APP20 hides in-pool activity, not pool usage. Shield and unshield
            legs, timing, and pool interaction remain public, and this desk
            never fabricates a cached balance — every action re-verifies against
            the wallet and the live pool fee.
          </p>
        </>
      )}
    </main>
  );
}
