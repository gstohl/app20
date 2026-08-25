"use client";

import type { WALLET_API } from "@starknet-io/types-js";
import { num } from "starknet";
import { useEffect, useRef, useState } from "react";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import AddressBookField from "@/components/address-book/AddressBookField";
import { loadAddressBook, resolveAddressBookInput } from "@/lib/address-book";
import Strk20CapabilityDiagnostic from "@/app/components/client/WalletHandle/Strk20CapabilityDiagnostic";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { authorizeStrk20ValueAction } from "@/lib/mainnet-safety";
import {
  assertReadyExecutionUnchanged,
  snapshotReadyExecution,
} from "@/lib/ready-execution";
import { assertWalletOperationPolicy } from "@/lib/wallet-policy";
import {
  formatStrkAmount,
  loadStrkAmount,
  parseStrkAmount,
  saveStrkAmount,
} from "@/lib/strk-amount";
import {
  Strk20WaitTimeoutError,
  strk20ErrorMessage,
  submitActions,
} from "@/lib/strk20";
import { feltEquals } from "@/lib/addresses";
import * as constants from "@/utils/constants";
import { ProvingProgress } from "@/components/mail/OperationProgress";
import styles from "./PrivacyWalletMenu.module.css";

const TOKEN = constants.addrSTRK;

type BalanceState = {
  kind: "idle" | "loading" | "ok" | "error" | "unavailable";
  amount?: bigint;
  message?: string;
};

type ActionResult = {
  kind: "idle" | "proving" | "ok" | "error";
  title?: string;
  message?: string;
  transactionHash?: string;
  startedAt?: number;
};

function formatStrk(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const fraction = (amount % 10n ** 18n)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "")
    .slice(0, 4);
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function shortHex(value: string): string {
  const hex = num.toHex(value);
  return hex.length <= 15 ? hex : `${hex.slice(0, 9)}…${hex.slice(-5)}`;
}

function unwrapWalletValue(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "value" in raw) {
    return (raw as { value?: unknown }).value;
  }
  return raw;
}

function readStrkBalance(raw: unknown): bigint {
  const value = unwrapWalletValue(raw);
  if (!Array.isArray(value)) {
    throw new Error(
      "The wallet returned an unfamiliar shielded-balance response.",
    );
  }

  for (const entry of value) {
    const tuple = Array.isArray(entry) ? entry : [];
    const record =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const token = record.token ?? record.token_address ?? tuple[0];
    const amount = record.amount ?? record.balance ?? tuple[1];
    try {
      if (num.toBigInt(String(token)) === num.toBigInt(TOKEN)) {
        return num.toBigInt(String(amount));
      }
    } catch {
      // Ignore wallet entries that are not parseable token balances.
    }
  }
  return 0n;
}

export default function PrivacyWalletMenu({
  showIdentity = true,
  active = true,
}: {
  showIdentity?: boolean;
  active?: boolean;
}) {
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const selectedWallet = useStoreWallet((state) => state.StarknetWalletObject);
  const connectedAddress = useStoreWallet((state) => state.address);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const strk20Capability = useStoreWallet((state) => state.strk20Capability);
  const connectionNotice = useStoreWallet((state) => state.connectionNotice);
  const [balance, setBalance] = useState<BalanceState>({ kind: "idle" });
  const [action, setAction] = useState<ActionResult>({ kind: "idle" });
  const [amountInput, setAmountInput] = useState("0.1");
  const [recipientInput, setRecipientInput] = useState("");
  const balanceGeneration = useRef(0);

  const networkName = constants.Strk20Networks[providerIndex];
  const networkKey = networkName ?? `network-${providerIndex}`;
  const poolAddress = constants.strk20PoolForProviderIndex(providerIndex);
  const isStrk20Network = networkName !== undefined && poolAddress !== null;
  const actionPending = action.kind === "proving";
  let parsedAmount: bigint | null = null;
  let amountError = "";
  try {
    parsedAmount = parseStrkAmount(amountInput);
  } catch (error: unknown) {
    amountError =
      error instanceof Error ? error.message : "Enter a valid STRK amount.";
  }

  async function refreshBalance() {
    const generation = ++balanceGeneration.current;
    if (!walletAccount || !isConnected) {
      setBalance({ kind: "idle" });
      return;
    }
    if (!isStrk20Capable || !isStrk20Network) {
      setBalance({
        kind: "unavailable",
        message: "Wallet privacy unavailable",
      });
      return;
    }

    setBalance({ kind: "loading", message: "Checking with the wallet…" });
    try {
      if (!selectedWallet) throw new Error("Wallet policy context is missing.");
      assertWalletOperationPolicy(
        selectedWallet,
        providerIndex as 0 | 2 | 3,
        "private-read",
      );
      const raw = await walletAccount.strk20Balances([TOKEN]);
      if (generation !== balanceGeneration.current) return;
      setBalance({ kind: "ok", amount: readStrkBalance(raw) });
    } catch (error: unknown) {
      if (generation !== balanceGeneration.current) return;
      setBalance({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  useEffect(() => {
    try {
      setAmountInput(loadStrkAmount(window.localStorage, networkKey));
    } catch {
      setAmountInput("0.1");
    }
  }, [networkKey]);

  useEffect(() => {
    setRecipientInput(connectedAddress);
  }, [connectedAddress]);

  useEffect(() => {
    if (!active || !walletAccount || !isConnected) {
      balanceGeneration.current += 1;
      if (!active) return;
      setBalance({ kind: "idle" });
      setAction({ kind: "idle" });
      return;
    }
    void refreshBalance();
  }, [
    active,
    connectedAddress,
    isConnected,
    isStrk20Capable,
    providerIndex,
    selectedWallet,
    walletAccount,
  ]);

  async function runAction(
    actions: WALLET_API.STRK20_ACTION[],
    actionName: "Shield" | "Unshield" | "Private transfer",
    amount: bigint,
  ) {
    if (!walletAccount || !isConnected) {
      setAction({
        kind: "error",
        title: `${actionName} unavailable`,
        message: "Connect a wallet first.",
      });
      return;
    }
    if (!isStrk20Capable) {
      setAction({
        kind: "error",
        title: "Privacy actions unavailable",
        message:
          "This wallet did not declare Wallet API/spec support at version 0.10 or newer.",
      });
      return;
    }
    if (!isStrk20Network || !networkName || !poolAddress) {
      setAction({
        kind: "error",
        title: "Unsupported network",
        message: "STRK20 actions require Mainnet or Sepolia.",
      });
      return;
    }

    const amountLabel = `${formatStrkAmount(amount)} STRK`;
    const provider = constants.myFrontendProviders[providerIndex];
    const startedAt = Date.now();
    setAction({
      kind: "proving",
      title: `${actionName} preflight`,
      message: "Reading the live pool fee and public STRK balance…",
      startedAt,
    });

    const operation =
      actionName === "Shield"
        ? "shield"
        : actionName === "Unshield"
          ? "unshield"
          : "private-transfer";
    let submittedHash: string | undefined;
    try {
      const started = snapshotReadyExecution();
      assertReadyExecutionUnchanged(started, operation);
      await authorizeStrk20ValueAction({
        provider: constants.myFrontendProviders[started.providerIndex],
        poolAddress,
        accountAddress: started.address,
        network: constants.Strk20Networks[started.providerIndex] ?? networkName,
        action: actionName,
        amount,
      });
      try {
        saveStrkAmount(window.localStorage, networkKey, amountInput);
      } catch {
        // Storage availability must not alter an already confirmed amount.
      }
      setAction({
        kind: "proving",
        title: `${actionName} ${amountLabel}`,
        message: "Waiting for the wallet to prepare the private action…",
        startedAt: Date.now(),
      });
      const { transactionHash } = await submitActions(
        started.account,
        constants.myFrontendProviders[started.providerIndex],
        actions,
        {
          policy: () => {
            assertReadyExecutionUnchanged(started, operation);
          },
          onSubmitted: (hash) => {
            submittedHash = hash;
            setAction({
              kind: "proving",
              title: `${actionName} submitted`,
              message: "Proof accepted; waiting for transaction confirmation…",
              transactionHash: hash,
              startedAt: Date.now(),
            });
          },
        },
      );
      setAction({
        kind: "ok",
        title: `${actionName} confirmed`,
        message:
          actionName === "Shield"
            ? "The public deposit completed. Shielded balance discovery is refreshing."
            : actionName === "Unshield"
              ? "The public withdrawal completed. Shielded balance discovery is refreshing."
              : "The private transfer completed. Shielded balance discovery is refreshing.",
        transactionHash,
      });
      void refreshBalance();
    } catch (error: unknown) {
      const timedOut = error instanceof Strk20WaitTimeoutError;
      setAction({
        kind: "error",
        title: timedOut ? "Confirmation timed out" : `${actionName} failed`,
        message: strk20ErrorMessage(error),
        transactionHash: timedOut ? error.transactionHash : submittedHash,
      });
    }
  }

  function shield() {
    if (parsedAmount === null) {
      setAction({
        kind: "error",
        title: "Shield unavailable",
        message: amountError,
      });
      return;
    }
    void runAction(
      [{ type: "deposit", token: TOKEN, amount: num.toHex(parsedAmount) }],
      "Shield",
      parsedAmount,
    );
  }

  function unshield() {
    if (!connectedAddress) {
      setAction({
        kind: "error",
        title: "Unshield unavailable",
        message: "Connect a wallet first.",
      });
      return;
    }
    if (parsedAmount === null) {
      setAction({
        kind: "error",
        title: "Unshield unavailable",
        message: amountError,
      });
      return;
    }
    void runAction(
      [
        {
          type: "withdraw",
          token: TOKEN,
          amount: num.toHex(parsedAmount),
          recipient: connectedAddress,
        },
      ],
      "Unshield",
      parsedAmount,
    );
  }

  async function privateTransfer() {
    if (parsedAmount === null) {
      setAction({
        kind: "error",
        title: "Private transfer unavailable",
        message: amountError,
      });
      return;
    }
    let book: Awaited<ReturnType<typeof loadAddressBook>> = [];
    if (connectedAddress) {
      try {
        book = await loadAddressBook(window.localStorage, connectedAddress);
      } catch {
        book = [];
      }
    }
    const resolved = resolveAddressBookInput(book, recipientInput);
    if (!resolved) {
      setAction({
        kind: "error",
        title: "Private transfer unavailable",
        message:
          "Enter a valid Starknet address or a saved address-book label.",
      });
      return;
    }
    await runAction(
      [
        {
          type: "transfer",
          token: TOKEN,
          amount: num.toHex(parsedAmount),
          recipient: resolved.address,
        },
      ],
      "Private transfer",
      parsedAmount,
    );
  }

  const balanceLabel =
    balance.kind === "ok"
      ? `${formatStrk(balance.amount ?? 0n)} STRK`
      : balance.kind === "loading"
        ? "Checking…"
        : balance.kind === "unavailable"
          ? "Unavailable"
          : "— STRK";
  const explorerBase =
    providerIndex === 0
      ? "https://voyager.online/tx/"
      : providerIndex === 2
        ? "https://sepolia.voyager.online/tx/"
        : null;

  return (
    <section
      className={styles.sidebarAccount}
      aria-label="Wallet and shielded balance"
    >
      {showIdentity ? (
        <>
          <div className={styles.accountHeading}>
            <div>
              <span className={styles.sidebarLabel}>IDENTITY</span>
              <strong>
                {isConnected ? "Mailbox account" : "Wallet disconnected"}
              </strong>
            </div>
            <SelectWallet variant="nav" />
          </div>

          {connectedAddress ? (
            <code className={styles.accountAddress} title={connectedAddress}>
              {connectedAddress}
            </code>
          ) : (
            <p className={styles.accountHint}>
              Connect a privacy-enabled wallet to open this mailbox.
            </p>
          )}
        </>
      ) : null}

      {connectionNotice ? (
        <p className={styles.walletError} role="alert">
          {connectionNotice}
        </p>
      ) : null}

      <div className={styles.sidebarBalance}>
        <span>Shielded balance</span>
        <strong>{balanceLabel}</strong>
        <button
          type="button"
          onClick={() => void refreshBalance()}
          disabled={!isConnected || balance.kind === "loading"}
        >
          Refresh
        </button>
      </div>

      <label className={styles.walletAmount}>
        <span>Value amount</span>
        <span className={styles.walletAmountInput}>
          <input
            aria-label="Wallet action amount in STRK"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            disabled={actionPending}
          />
          <strong>STRK</strong>
        </span>
        <small className={amountError ? styles.walletErrorText : undefined}>
          {parsedAmount === null
            ? amountError
            : `${formatStrkAmount(parsedAmount)} STRK · ${parsedAmount} base units`}
        </small>
      </label>

      <AddressBookField
        className={styles.walletAmount}
        errorClassName={styles.walletErrorText}
        label="Private-transfer recipient"
        inputAriaLabel="Private transfer recipient"
        selfAddress={connectedAddress ?? ""}
        value={recipientInput}
        onChange={setRecipientInput}
        disabled={actionPending}
        placeholder="0x… or saved label"
      />

      <div className={styles.sidebarWalletActions}>
        <button
          type="button"
          onClick={shield}
          disabled={
            !isConnected ||
            !isStrk20Capable ||
            !isStrk20Network ||
            parsedAmount === null ||
            actionPending
          }
        >
          <span>Shield</span>
          <small>{amountInput || "—"} STRK · public entry</small>
        </button>
        <button
          type="button"
          onClick={unshield}
          disabled={
            !isConnected ||
            !isStrk20Capable ||
            !isStrk20Network ||
            parsedAmount === null ||
            actionPending
          }
        >
          <span>Unshield</span>
          <small>{amountInput || "—"} STRK · public exit</small>
        </button>
        <button
          type="button"
          onClick={() => void privateTransfer()}
          disabled={
            !isConnected ||
            !isStrk20Capable ||
            !isStrk20Network ||
            parsedAmount === null ||
            !recipientInput.trim() ||
            actionPending
          }
        >
          <span>Private transfer</span>
          <small>{amountInput || "—"} STRK · inside the pool</small>
        </button>
      </div>

      {isConnected && !isStrk20Capable ? (
        strk20Capability ? (
          <Strk20CapabilityDiagnostic capability={strk20Capability} compact />
        ) : (
          <p className={styles.walletError} role="status">
            Checking the wallet's dapp-facing STRK20 capability. Privacy actions
            remain disabled.
          </p>
        )
      ) : null}
      {balance.kind === "error" ? (
        <p className={styles.walletError} role="alert">
          {balance.message}
        </p>
      ) : null}
      {providerIndex === 0 ? (
        <p className={styles.mainnetSafety} role="note">
          Mainnet Shield and Unshield move real funds. Each action reads the
          live pool fee and public STRK balance, then requires an exact
          real-funds confirmation. Escrow remains disabled on Mainnet.
        </p>
      ) : null}

      <ProvingProgress
        active={actionPending}
        startedAt={action.startedAt}
        label={action.title ?? "Preparing privacy proof"}
      />
      {action.kind !== "idle" && action.kind !== "proving" ? (
        <div
          className={`${styles.walletResult} ${
            action.kind === "error" ? styles.walletResultError : ""
          }`}
          role={action.kind === "error" ? "alert" : "status"}
        >
          <strong>{action.title}</strong>
          {action.message ? <p>{action.message}</p> : null}
          {action.transactionHash ? (
            explorerBase ? (
              <a
                href={`${explorerBase}${action.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortHex(action.transactionHash)} ↗
              </a>
            ) : (
              <code>{shortHex(action.transactionHash)}</code>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
