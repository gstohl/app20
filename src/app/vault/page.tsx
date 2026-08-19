"use client";

import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { privyBrowserConfigured } from "@/app/vault/privy-config";
import { useVaultMode } from "@/app/vault/vaultMode";
import AddressBookField from "@/components/AddressBookField";
import PrivacyWalletMenu from "@/components/mail/PrivacyWalletMenu";
import {
  ADDRESS_BOOK_CHANGED_EVENT,
  loadAddressBook,
  removeAddressBookEntry,
  resolveAddressBookInput,
  saveAddressBookEntry,
  type AddressBookEntry,
} from "@/lib/address-book";
import { feltEquals } from "@/lib/addresses";
import { readPublicStrkBalance } from "@/lib/mainnet-safety";
import { formatStrkAmount, parseStrkAmount } from "@/lib/strk-amount";
import { strk20ErrorMessage } from "@/lib/strk20";
import { assertWalletSubmissionPolicy } from "@/lib/wallet-policy";
import * as constants from "@/utils/constants";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import IntentsPage from "@/app/intents/page";
import styles from "./vault.module.css";

const PrivySepoliaVault = lazy(() => import("./PrivySepoliaVault"));

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

type SendState =
  | { kind: "idle" }
  | { kind: "pending"; message: string; transactionHash?: string }
  | { kind: "ok"; message: string; transactionHash: string }
  | { kind: "error"; message: string };

function explorerTx(providerIndex: number, hash: string): string | null {
  if (providerIndex === 0) return `https://voyager.online/tx/${hash}`;
  if (providerIndex === 2) return `https://sepolia.voyager.online/tx/${hash}`;
  return null;
}

function AddressBookPanel({ selfAddress }: { selfAddress: string }) {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [addressDraft, setAddressDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = selfAddress.trim();

  useEffect(() => {
    let cancelled = false;
    function reload() {
      if (!scope) {
        setEntries([]);
        setError(null);
        return;
      }
      loadAddressBook(window.localStorage, scope)
        .then((loaded) => {
          if (!cancelled) {
            setEntries(loaded);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setEntries([]);
            setError(
              cause instanceof Error
                ? cause.message
                : "The address book could not be opened.",
            );
          }
        });
    }
    reload();
    window.addEventListener(ADDRESS_BOOK_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(ADDRESS_BOOK_CHANGED_EVENT, reload);
    };
  }, [scope]);

  async function addEntry() {
    if (!scope) return;
    setBusy(true);
    setStatus(null);
    try {
      const next = await saveAddressBookEntry(window.localStorage, scope, {
        label: labelDraft,
        address: addressDraft,
      });
      setEntries(next);
      setLabelDraft("");
      setAddressDraft("");
      setError(null);
      setStatus("Saved. The book is AES-GCM encrypted in this browser only.");
      window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED_EVENT));
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Saving the entry failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(label: string) {
    if (!scope) return;
    setBusy(true);
    try {
      const next = await removeAddressBookEntry(
        window.localStorage,
        scope,
        label,
      );
      setEntries(next);
      setStatus(null);
      window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED_EVENT));
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Removing the entry failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`${styles.panel} ${styles.bookPanel}`}
      aria-labelledby="vault-book-title"
    >
      <header className={styles.panelHeading}>
        <span>ADDRESS BOOK</span>
        <strong id="vault-book-title">
          Encrypted on this device · usable in every address field
        </strong>
      </header>
      <div className={styles.bookBody}>
        <div className={styles.bookAdd}>
          <input
            aria-label="New address book label"
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            placeholder="Label"
            maxLength={40}
            disabled={!scope || busy}
          />
          <input
            aria-label="New address book address"
            value={addressDraft}
            onChange={(event) => setAddressDraft(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            disabled={!scope || busy}
          />
          <button
            type="button"
            onClick={() => void addEntry()}
            disabled={
              !scope || busy || !labelDraft.trim() || !addressDraft.trim()
            }
          >
            Add
          </button>
        </div>
        {error ? (
          <p className={styles.bookError} role="alert">
            {error}
          </p>
        ) : null}
        {status && !error ? (
          <p className={styles.bookStatus}>{status}</p>
        ) : null}
        {scope ? (
          entries.length ? (
            <ul className={styles.bookList}>
              {entries.map((entry) => (
                <li key={entry.label}>
                  <b>{entry.label}</b>
                  <code title={entry.address}>
                    {shortAddress(entry.address)}
                  </code>
                  <button
                    type="button"
                    onClick={() => void remove(entry.label)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.bookEmpty}>
              No saved addresses yet. Entries are stored under
              app20/address-book/v1 in this browser profile, AES-GCM encrypted
              with a device-local key, and never uploaded.
            </p>
          )
        ) : (
          <p className={styles.bookEmpty}>
            Connect a wallet to open this account's encrypted book.
          </p>
        )}
      </div>
    </section>
  );
}

export default function VaultPage() {
  const connected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const chain = useStoreWallet((state) => state.chain);
  const capable = useStoreWallet((state) => state.isStrk20Capable);
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const mode = useVaultMode((state) => state.mode);
  const setMode = useVaultMode((state) => state.setMode);
  const [sendAmount, setSendAmount] = useState("0.1");
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });
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
    const provider = constants.myFrontendProviders[providerIndex];
    setSendState({
      kind: "pending",
      message: "Reading the live public STRK balance…",
    });
    try {
      if (!selectedWallet) throw new Error("Wallet policy context is missing.");
      assertWalletSubmissionPolicy(
        selectedWallet,
        providerIndex as 0 | 2 | 3,
        "public-send",
      );
      if (!feltEquals(walletAccount.address, address)) {
        throw new Error(
          "The Ready signer no longer matches the connected account. Disconnect and connect again.",
        );
      }
      const balance = await readPublicStrkBalance(provider, address);
      if (balance < amount) {
        throw new Error(
          `Public balance is ${formatStrkAmount(balance)} STRK, below the ${formatStrkAmount(amount)} STRK send. Network fees come on top.`,
        );
      }
      if (providerIndex === 0) {
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
      const { transaction_hash: transactionHash } = await walletAccount.execute(
        {
          contractAddress: constants.addrSTRK,
          entrypoint: "transfer",
          calldata: [resolved.address, low.toString(), high.toString()],
        },
      );
      setSendState({
        kind: "pending",
        message: "Submitted. Waiting for confirmation…",
        transactionHash,
      });
      await provider.waitForTransaction(transactionHash, {
        retries: 120,
        retryInterval: 3_000,
      });
      setSendState({
        kind: "ok",
        message: `Sent ${formatStrkAmount(amount)} STRK publicly.`,
        transactionHash,
      });
      void publicBalance.refetch();
    } catch (cause: unknown) {
      setSendState({ kind: "error", message: strk20ErrorMessage(cause) });
    }
  }

  const sendTxLink =
    sendState.kind === "ok" || sendState.kind === "pending"
      ? sendState.transactionHash
        ? explorerTx(providerIndex, sendState.transactionHash)
        : null
      : null;

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadCopy}>
          <p className={styles.eyebrow}>APP20 / VALUE DESK</p>
          <h1>
            {onIntents
              ? "Set the bounds. Let execution compete."
              : "Public entry. Private balance. Explicit exit."}
          </h1>
          <span>
            {onIntents
              ? "Cross-chain Intents is a second rail on this desk, not a second wallet. Quotes stay dry. No deposit address, no submit."
              : "Tokens, public sends, shielded movements, and the encrypted address book in one desk. Mainnet is Ready only. Privy is Sepolia recovery."}
          </span>
          <nav className={styles.deskTabs} aria-label="Value desk rails">
            <Link
              to="/vault"
              aria-current={onIntents ? undefined : "page"}
              className={onIntents ? undefined : styles.isActive}
            >
              In-pool
            </Link>
            <Link
              to="/vault"
              hash="intents"
              aria-current={onIntents ? "page" : undefined}
              className={onIntents ? styles.isActive : undefined}
            >
              Cross-chain
            </Link>
          </nav>
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

      {onIntents ? (
        <IntentsPage />
      ) : mode === "privy" && privyBrowserConfigured ? (
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
                  Standard feature ID before execution.
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
                <dt>Pool</dt>
                <dd>
                  {poolAddress ? (
                    <code title={poolAddress}>{shortAddress(poolAddress)}</code>
                  ) : (
                    "None on this network"
                  )}
                </dd>
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
                    Only tokens with live RPC reads get a row. Balances are
                    never fabricated; other ERC-20s appear once this build reads
                    them.
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

          <AddressBookPanel selfAddress={address ?? ""} />

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
              <p>Sender, recipient, and amount stay hidden inside the pool.</p>
            </article>
            <article className={styles.railStage}>
              <header>
                <h2>3 · Unshield</h2>
                <span className={styles.stageBadge}>PUBLIC</span>
              </header>
              <p>Public exit. Timing can be correlated with entry.</p>
            </article>
          </section>

          <p className={styles.disclosure}>
            APP20 hides in-pool activity, not pool usage. Shield, unshield, and
            public sends remain on-chain. Balances are live reads, never cached
            fabrications. The address book never leaves this browser.
          </p>
        </div>
      )}
    </main>
  );
}
