"use client";

import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { privyBrowserConfigured } from "@/app/vault/privy-config";
import { useVaultMode } from "@/app/vault/vaultMode";
import PrivacyWalletMenu from "@/components/mail/PrivacyWalletMenu";
import { readPublicStrkBalance } from "@/lib/mainnet-safety";
import { formatStrkAmount } from "@/lib/strk-amount";
import * as constants from "@/utils/constants";
import { useQuery } from "@tanstack/react-query";
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
            One full-width execution desk for public STRK, shielded state, and
            the three reviewed movements between them. Mainnet routes through
            Ready Wallet Standard. Privy remains a separate Sepolia-only
            recovery rail and cannot request a Mainnet signature, proof,
            discovery scan, or submission.
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
              Sepolia / Privy waits for public application IDs and reviewed
              OHTTP key pins.
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
        <div className={styles.readyDesk}>
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
                  {connected
                    ? "Ready execution rail active"
                    : "Ready wallet required"}
                </strong>
                <p>
                  {chain ||
                    "Select Starknet Mainnet from the shared header session."}
                  {" · "}Mainnet rejects Privy and every unreviewed Wallet
                  Standard feature ID before privacy execution. Display names
                  are never trusted.
                </p>
              </div>
            </div>
            <dl className={styles.sessionFacts}>
              <div>
                <dt>Connection</dt>
                <dd>{connected ? "Connected" : "Use header control"}</dd>
              </div>
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
          </section>

          <div className={styles.desk}>
            <section
              className={`${styles.panel} ${styles.publicPanel}`}
              aria-labelledby="vault-public-title"
            >
              <header className={styles.panelHeading}>
                <span>PUBLIC RAIL</span>
                <strong id="vault-public-title">
                  Public STRK entry and exit
                </strong>
              </header>
              <div className={styles.publicOverview}>
                <div className={styles.metric}>
                  <span>PUBLIC BALANCE</span>
                  <div>
                    <strong>{publicStrkLabel}</strong>
                    <small>STRK</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => void publicBalance.refetch()}
                    disabled={!connected || publicBalance.isFetching}
                  >
                    {publicBalance.isFetching
                      ? "Refreshing…"
                      : "Refresh balance"}
                  </button>
                </div>
                <p className={styles.metricCaption}>
                  Public STRK is held by the connected Ready account. Every
                  action re-reads this balance and the live pool fee before the
                  wallet is asked to sign.
                </p>
                <ul className={styles.railList}>
                  <li>
                    <b>Shield entry</b>
                    <span>Public deposit. Amount and sender are on-chain.</span>
                  </li>
                  <li>
                    <b>Unshield exit</b>
                    <span>
                      Public withdrawal. Amount and recipient are on-chain.
                    </span>
                  </li>
                  <li>
                    <b>Pool</b>
                    <span>
                      {poolAddress ? (
                        <code title={poolAddress}>
                          {shortAddress(poolAddress)}
                        </code>
                      ) : (
                        "No STRK20 pool on this network."
                      )}
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            <section
              className={`${styles.panel} ${styles.shieldedPanel}`}
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
                Deposit STRK from the public account into the pool. The entry
                transaction remains visible.
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
                hidden. Mail memos and payments use the same rail.
              </p>
            </article>
            <article className={styles.railStage}>
              <header>
                <h2>3 · Unshield</h2>
                <span className={styles.stageBadge}>PUBLIC</span>
              </header>
              <p>
                Withdraw to a public account. The exit and its timing remain
                visible and may be correlated with entry.
              </p>
            </article>
          </section>

          <p className={styles.disclosure}>
            APP20 hides in-pool activity, not pool usage. Shield and unshield
            legs, timing, and pool interaction remain public. This desk never
            fabricates a cached balance.
          </p>
        </div>
      )}
    </main>
  );
}
