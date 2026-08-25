"use client";

import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { privyBrowserConfigured } from "@/app/vault/privy-config";
import { useVaultMode } from "@/app/vault/vaultMode";
import AddressBookField from "@/components/address-book/AddressBookField";
import PrivacyWalletMenu from "@/app/vault/PrivacyWalletMenu";
import {
  loadAddressBook,
  resolveAddressBookInput,
  type AddressBookEntry,
} from "@/lib/address-book";
import {
  assertReadyExecutionUnchanged,
  snapshotReadyExecution,
} from "@/lib/ready-execution";
import { readPublicStrkBalance } from "@/lib/mainnet-safety";
import { formatStrkAmount, parseStrkAmount } from "@/lib/strk-amount";
import {
  Strk20WaitTimeoutError,
  strk20ErrorMessage,
  transactionHashFromError,
  waitForStrk20Transaction,
} from "@/lib/strk20";
import * as constants from "@/utils/constants";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import IntentsPage from "@/app/intents/page";
import DeskMarketBoard from "./DeskMarketBoard";
import type { LocalnetMarketPairId } from "./LocalnetPrivateIntentDesk";
import styles from "./vault.module.css";

const PrivySepoliaVault = lazy(() => import("./PrivySepoliaVault"));
const LocalnetPrivateIntentDesk = lazy(
  () => import("./LocalnetPrivateIntentDesk"),
);

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

type SendState =
  | { kind: "idle" }
  | { kind: "pending"; message: string; transactionHash?: string }
  | { kind: "ok"; message: string; transactionHash: string }
  | { kind: "error"; message: string; transactionHash?: string };

function explorerTx(providerIndex: number, hash: string): string | null {
  if (providerIndex === 0) return `https://voyager.online/tx/${hash}`;
  if (providerIndex === 2) return `https://sepolia.voyager.online/tx/${hash}`;
  return null;
}

export default function VaultPage() {
  const connected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const mode = useVaultMode((state) => state.mode);
  const setMode = useVaultMode((state) => state.setMode);
  const [rail, setRail] = useState<"private" | "public">("private");
  const [sendAmount, setSendAmount] = useState("0.1");
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });
  const [deskPairId, setDeskPairId] =
    useState<LocalnetMarketPairId>("STRK_USDC");
  const publicBalance = useQuery({
    queryKey: ["ready-public-strk", providerIndex, address],
    enabled: mode === "ready" && connected && Boolean(address),
    queryFn: () =>
      readPublicStrkBalance(
        constants.myFrontendProviders[providerIndex],
        address,
      ),
  });

  const publicStrkLabel =
    publicBalance.data === undefined
      ? publicBalance.isError
        ? "Unavailable"
        : "—"
      : formatStrkAmount(publicBalance.data);
  const hash = useRouterState({ select: (state) => state.location.hash });
  const onIntents = hash === "#intents" || hash === "intents";
  const sending = sendState.kind === "pending";

  async function runPublicSend() {
    if (!walletAccount || !connected || !address) {
      setSendState({ kind: "error", message: "Connect a wallet first." });
      return;
    }
    let amount: bigint;
    try {
      amount = parseStrkAmount(sendAmount);
    } catch (cause: unknown) {
      setSendState({
        kind: "error",
        message:
          cause instanceof Error ? cause.message : "Enter a valid amount.",
      });
      return;
    }
    let book: AddressBookEntry[] = [];
    try {
      book = await loadAddressBook(window.localStorage, address);
    } catch {
      book = [];
    }
    const resolved = resolveAddressBookInput(book, sendRecipient);
    if (!resolved) {
      setSendState({
        kind: "error",
        message:
          "Enter a valid Starknet address or a saved address-book label.",
      });
      return;
    }
    setSendState({
      kind: "pending",
      message: "Reading the live public STRK balance…",
    });
    try {
      const started = snapshotReadyExecution();
      assertReadyExecutionUnchanged(started, "public-send");
      const provider = constants.myFrontendProviders[started.providerIndex];
      const balance = await readPublicStrkBalance(provider, started.address);
      if (balance < amount) {
        throw new Error(
          `Public balance is ${formatStrkAmount(balance)} STRK, below the ${formatStrkAmount(amount)} STRK send. Network fees come on top.`,
        );
      }
      if (started.providerIndex === 0) {
        const confirmed = window.confirm(
          [
            "APP20 MAINNET PUBLIC SEND",
            "",
            `Send ${formatStrkAmount(amount)} STRK (${amount} base units)`,
            `To: ${resolved.entry ? `${resolved.entry.label} · ` : ""}${resolved.address}`,
            "",
            "This is a normal PUBLIC Starknet transfer: amount, sender, and recipient are visible on-chain. The wallet shows the network fee before signing.",
          ].join("\n"),
        );
        if (!confirmed) {
          setSendState({
            kind: "error",
            message: "Mainnet send cancelled. Nothing was submitted.",
          });
          return;
        }
      }
      setSendState({
        kind: "pending",
        message: "Waiting for the wallet signature…",
      });
      const low = amount & ((1n << 128n) - 1n);
      const high = amount >> 128n;
      const live = assertReadyExecutionUnchanged(started, "public-send");
      const { transaction_hash: transactionHash } = await live.account.execute({
        contractAddress: constants.addrSTRK,
        entrypoint: "transfer",
        calldata: [resolved.address, low.toString(), high.toString()],
      });
      setSendState({
        kind: "pending",
        message: "Submitted. Waiting for confirmation…",
        transactionHash,
      });
      await waitForStrk20Transaction(provider, transactionHash);
      setSendState({
        kind: "ok",
        message: `Sent ${formatStrkAmount(amount)} STRK publicly.`,
        transactionHash,
      });
      void publicBalance.refetch();
    } catch (cause: unknown) {
      const hash = transactionHashFromError(cause);
      setSendState({
        kind: "error",
        message:
          cause instanceof Strk20WaitTimeoutError
            ? cause.message
            : strk20ErrorMessage(cause),
        ...(hash === undefined ? {} : { transactionHash: hash }),
      });
    }
  }

  const sendTxLink =
    sendState.kind === "ok" ||
    sendState.kind === "pending" ||
    sendState.kind === "error"
      ? sendState.transactionHash
        ? explorerTx(providerIndex, sendState.transactionHash)
        : null
      : null;

  return (
    <main className={styles.page}>
      <nav className={styles.deskSubnav} aria-label="Value desk rails">
        <Link
          to="/vault"
          activeOptions={{ exact: true, includeHash: true }}
          aria-current={!onIntents && mode !== "privy" ? "page" : undefined}
          className={
            !onIntents && mode !== "privy" ? styles.isActive : undefined
          }
          onClick={() => setMode("ready")}
        >
          In-pool
        </Link>
        <Link
          to="/vault"
          hash="intents"
          activeOptions={{ exact: true, includeHash: true }}
          aria-current={onIntents ? "page" : undefined}
          className={onIntents ? styles.isActive : undefined}
        >
          Cross-chain
        </Link>
        {privyBrowserConfigured ? (
          <button
            type="button"
            aria-pressed={mode === "privy" && !onIntents}
            className={
              mode === "privy" && !onIntents ? styles.isActive : undefined
            }
            onClick={() => setMode("privy")}
          >
            Privy recovery
          </button>
        ) : null}
      </nav>

      {onIntents ? <IntentsPage /> : null}
      {mode === "privy" && privyBrowserConfigured && !onIntents ? (
        <Suspense
          fallback={
            <div className={styles.privyFallback}>LOADING PRIVY VAULT…</div>
          }
        >
          <PrivySepoliaVault />
        </Suspense>
      ) : null}
      <div
        className={styles.readyDesk}
        hidden={onIntents || (mode === "privy" && privyBrowserConfigured)}
      >
        <div className={styles.railPick} role="tablist" aria-label="Send rail">
          <button
            type="button"
            aria-pressed={rail === "private"}
            className={rail === "private" ? styles.isActive : undefined}
            onClick={() => setRail("private")}
          >
            PRIVATE · RECOMMENDED
          </button>
          <button
            type="button"
            aria-pressed={rail === "public"}
            className={rail === "public" ? styles.isActive : undefined}
            onClick={() => setRail("public")}
          >
            PUBLIC · VISIBLE ON-CHAIN
          </button>
          <Link to="/contacts">Contacts →</Link>
        </div>

        <div className={styles.desk}>
          <section
            className={`${styles.panel} ${styles.publicPanel}`}
            aria-labelledby="vault-public-title"
            hidden={rail !== "public"}
          >
            <header className={styles.panelHeading}>
              <span>PUBLIC RAIL</span>
              <strong id="vault-public-title">
                Tokens · balances · public send
              </strong>
            </header>
            <div className={styles.publicOverview}>
              <div className={styles.metric}>
                <span>PUBLIC STRK</span>
                <div>
                  <strong>{publicStrkLabel}</strong>
                  <small>STRK</small>
                </div>
                <button
                  type="button"
                  onClick={() => void publicBalance.refetch()}
                  disabled={!connected || publicBalance.isFetching}
                >
                  {publicBalance.isFetching ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              <div
                className={styles.tokenTable}
                role="table"
                aria-label="Public token balances"
              >
                <div className={styles.tokenHead} role="row">
                  <span role="columnheader">TOKEN</span>
                  <span role="columnheader">PUBLIC BALANCE</span>
                  <span role="columnheader">SOURCE</span>
                </div>
                <div role="row">
                  <span role="cell">
                    STRK
                    <code title={constants.addrSTRK}>
                      {shortAddress(constants.addrSTRK)}
                    </code>
                  </span>
                  <span role="cell">{connected ? publicStrkLabel : "—"}</span>
                  <span role="cell">
                    {publicBalance.isError
                      ? "RPC read failed"
                      : "Live balance_of"}
                  </span>
                </div>
                <p className={styles.tokenNote}>
                  Only tokens with live RPC reads get a row. Balances are never
                  fabricated; other ERC-20s appear once this build reads them.
                </p>
              </div>
            </div>
            <div className={styles.sendForm} aria-label="Public STRK send">
              <div className={styles.sendHead}>
                <span>PUBLIC SEND</span>
                <small>Visible on-chain · wallet shows the network fee</small>
              </div>
              <div className={styles.sendControls}>
                <label className={styles.sendAmount}>
                  <span>AMOUNT / STRK</span>
                  <input
                    aria-label="Public send amount in STRK"
                    value={sendAmount}
                    onChange={(event) => setSendAmount(event.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={sending}
                  />
                </label>
                <AddressBookField
                  className={styles.sendRecipient}
                  rowClassName={styles.sendBookRow}
                  hintClassName={styles.sendHint}
                  errorClassName={styles.sendError}
                  label="RECIPIENT"
                  inputAriaLabel="Public send recipient"
                  selfAddress={address ?? ""}
                  value={sendRecipient}
                  onChange={setSendRecipient}
                  disabled={sending}
                />
                <button
                  className={styles.sendButton}
                  type="button"
                  onClick={() => void runPublicSend()}
                  disabled={
                    !connected ||
                    sending ||
                    !sendRecipient.trim() ||
                    !sendAmount.trim()
                  }
                >
                  {sending ? "Sending…" : "Send public STRK"}
                </button>
              </div>
              {sendState.kind === "idle" ? null : (
                <p
                  className={`${styles.sendStatus} ${
                    sendState.kind === "error" ? styles.sendStatusError : ""
                  }`}
                  role={sendState.kind === "error" ? "alert" : "status"}
                >
                  {sendState.message}
                  {sendTxLink ? (
                    <a href={sendTxLink} target="_blank" rel="noreferrer">
                      View transaction ↗
                    </a>
                  ) : null}
                </p>
              )}
            </div>
          </section>

          <section
            className={`${styles.panel} ${styles.shieldedPanel}`}
            aria-labelledby="vault-shielded-title"
            hidden={rail !== "private"}
          >
            <div className={styles.privateWorkspace}>
              <section className={styles.marketWorkspace}>
                <header className={styles.marketHeader}>
                  <div>
                    <span>PRIVATE MARKET</span>
                    <h2 id="vault-shielded-title">
                      {deskPairId === "STRK_USDC"
                        ? "STRK / USDC"
                        : "USDC / STRK"}
                    </h2>
                  </div>
                  <strong>INVENTORY FIRST</strong>
                </header>

                <DeskMarketBoard pairId={deskPairId} />

                <section
                  className={styles.railMap}
                  aria-label="How STRK moves through the vault"
                >
                  <article className={styles.railStage}>
                    <header>
                      <h2>1 · Shield</h2>
                      <span className={styles.stageBadge}>PUBLIC</span>
                    </header>
                    <p>Public deposit into the pool. Entry stays visible.</p>
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
                    <p>Sender, recipient, and amount stay hidden in-pool.</p>
                  </article>
                  <article className={styles.railStage}>
                    <header>
                      <h2>3 · Unshield</h2>
                      <span className={styles.stageBadge}>PUBLIC</span>
                    </header>
                    <p>Public exit. Timing can be correlated with entry.</p>
                  </article>
                </section>

                <details className={styles.fundingDetails}>
                  <summary>Balances &amp; funding</summary>
                  <PrivacyWalletMenu
                    showIdentity={false}
                    active={
                      !onIntents &&
                      !(mode === "privy" && privyBrowserConfigured)
                    }
                  />
                </details>
              </section>

              <aside
                className={styles.tradeTicket}
                aria-label="Private swap ticket"
              >
                <Suspense
                  fallback={
                    <p className={styles.privateIntentHint}>Loading desk…</p>
                  }
                >
                  <LocalnetPrivateIntentDesk
                    initialPairId={deskPairId}
                    onPairChange={setDeskPairId}
                  />
                </Suspense>
              </aside>
            </div>
          </section>
        </div>

        <p className={styles.disclosure}>
          APP20 hides in-pool activity, not pool usage. Shield, unshield, and
          public sends remain on-chain. Balances are live reads, never cached
          fabrications. The address book never leaves this browser.
        </p>
      </div>
    </main>
  );
}
