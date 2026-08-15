"use client";

import type { WALLET_API } from "@starknet-io/types-js";
import { num } from "starknet";
import { useEffect, useRef, useState } from "react";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import {
  Strk20WaitTimeoutError,
  strk20ErrorMessage,
  submitActions,
} from "@/lib/strk20";
import * as constants from "@/utils/constants";
import { ProvingProgress } from "./OperationProgress";
import styles from "./mail.module.css";

const TOKEN = constants.addrSTRK;
const TEN_STRK = 10n * 10n ** 18n;
const ONE_STRK = 10n ** 18n;

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
    throw new Error("Ready returned an unfamiliar shielded-balance response.");
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

export default function PrivacyWalletMenu() {
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const connectedAddress = useStoreWallet((state) => state.address);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const [balance, setBalance] = useState<BalanceState>({ kind: "idle" });
  const [action, setAction] = useState<ActionResult>({ kind: "idle" });
  const balanceGeneration = useRef(0);

  const networkName = constants.Strk20Networks[providerIndex];
  const isStrk20Network = networkName !== undefined;
  const actionPending = action.kind === "proving";

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

    setBalance({ kind: "loading", message: "Checking with Ready…" });
    try {
      const raw = await walletAccount.strk20Balances([TOKEN]);
      if (generation !== balanceGeneration.current) return;
      setBalance({ kind: "ok", amount: readStrkBalance(raw) });
    } catch (error: unknown) {
      if (generation !== balanceGeneration.current) return;
      setBalance({ kind: "error", message: strk20ErrorMessage(error) });
    }
  }

  useEffect(() => {
    if (!walletAccount || !isConnected) {
      balanceGeneration.current += 1;
      setBalance({ kind: "idle" });
      setAction({ kind: "idle" });
      return;
    }
    void refreshBalance();
  }, [connectedAddress, isConnected, isStrk20Capable, providerIndex, walletAccount]);

  async function runAction(
    actions: WALLET_API.STRK20_ACTION[],
    actionName: "Shield" | "Unshield",
    amountLabel: string,
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
    if (!isStrk20Network) {
      setAction({
        kind: "error",
        title: "Unsupported network",
        message: "STRK20 actions require Mainnet or Sepolia.",
      });
      return;
    }

    const startedAt = Date.now();
    setAction({
      kind: "proving",
      title: `${actionName} ${amountLabel}`,
      message: "Waiting for Ready to prepare the private action…",
      startedAt,
    });

    let submittedHash: string | undefined;
    try {
      const provider = constants.myFrontendProviders[providerIndex];
      const { transactionHash } = await submitActions(
        walletAccount,
        provider,
        actions,
        {
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
            : "The public withdrawal completed. Shielded balance discovery is refreshing.",
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
    void runAction(
      [{ type: "deposit", token: TOKEN, amount: num.toHex(TEN_STRK) }],
      "Shield",
      "10 STRK",
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
    void runAction(
      [
        {
          type: "withdraw",
          token: TOKEN,
          amount: num.toHex(ONE_STRK),
          recipient: connectedAddress,
        },
      ],
      "Unshield",
      "1 STRK",
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
    <section className={styles.sidebarAccount} aria-label="Wallet and shielded balance">
      <div className={styles.accountHeading}>
        <div>
          <span className={styles.sidebarLabel}>IDENTITY</span>
          <strong>{isConnected ? "Mailbox account" : "Wallet disconnected"}</strong>
        </div>
        <SelectWallet variant="nav" />
      </div>

      {connectedAddress ? (
        <code className={styles.accountAddress} title={connectedAddress}>
          {connectedAddress}
        </code>
      ) : (
        <p className={styles.accountHint}>Connect Ready to open this mailbox.</p>
      )}

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

      <div className={styles.sidebarWalletActions}>
        <button
          type="button"
          onClick={shield}
          disabled={!isConnected || !isStrk20Network || actionPending}
        >
          <span>Shield</span>
          <small>10 STRK · public entry</small>
        </button>
        <button
          type="button"
          onClick={unshield}
          disabled={!isConnected || !isStrk20Network || actionPending}
        >
          <span>Unshield</span>
          <small>1 STRK · public exit</small>
        </button>
      </div>

      {isConnected ? isStrk20Capable ? null : (
        <p className={styles.walletError} role="alert">
          This wallet did not declare Wallet API/spec 0.10 support. Connect Ready
          for privacy actions.
        </p>
      ) : null}
      {balance.kind === "error" ? (
        <p className={styles.walletError} role="alert">{balance.message}</p>
      ) : null}
      {providerIndex === 0 ? (
        <p className={styles.mainnetSafety} role="note">
          Use Sepolia for Phase 1 checks; do not send Quietline mail on mainnet yet.
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
