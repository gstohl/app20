"use client";

import type { WALLET_API } from "@starknet-io/types-js";
import { num } from "starknet";
import { useEffect, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !actionPending) setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [actionPending, open]);

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
              startedAt,
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
    <div className={styles.walletMenu}>
      <button
        className={styles.balanceChip}
        type="button"
        aria-expanded={open}
        aria-controls="privacy-wallet-drawer"
        onClick={() => setOpen(true)}
      >
        <span>SHIELDED BALANCE</span>
        <strong>{balanceLabel}</strong>
        <em>WALLET-PRIVATE</em>
      </button>

      {open ? (
        <div
          className={styles.drawerBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !actionPending) setOpen(false);
          }}
        >
          <aside
            id="privacy-wallet-drawer"
            className={styles.walletDrawer}
            aria-labelledby="privacy-wallet-title"
          >
            <div className={styles.drawerHeading}>
              <div>
                <p className={styles.kicker}>WALLET-PRIVATE / LIVE STATE</p>
                <h2 id="privacy-wallet-title">Shielded STRK</h2>
              </div>
              <button
                className={styles.drawerClose}
                type="button"
                onClick={() => setOpen(false)}
                disabled={actionPending}
                aria-label="Close wallet actions"
              >
                ×
              </button>
            </div>

            <div className={styles.liveBalance}>
              <span>Available balance reported by Ready</span>
              <strong>{balanceLabel}</strong>
              <button
                type="button"
                onClick={() => void refreshBalance()}
                disabled={balance.kind === "loading" || !isStrk20Capable}
              >
                Refresh live state
              </button>
            </div>
            {balance.kind === "error" ? (
              <p className={styles.walletError} role="alert">{balance.message}</p>
            ) : null}
            <p className={styles.walletPrivacyCopy}>
              This balance read is requested from your wallet. It is not written
              to Quietline or to MessagePosted.
            </p>

            {isConnected && !isStrk20Capable ? (
              <div className={styles.capabilityState} role="alert">
                <strong>Wallet not privacy-capable</strong>
                <p>
                  This wallet did not declare Wallet API/spec support at version
                  0.10 or newer. Install or connect Ready to use Quietline
                  privacy actions.
                </p>
                <a href="https://www.ready.co/" target="_blank" rel="noreferrer">
                  Get Ready ↗
                </a>
              </div>
            ) : (
              <div className={styles.walletActionStack}>
                <article className={styles.walletActionCard}>
                  <div>
                    <span className={styles.publicLabel}>PUBLIC ENTRY</span>
                    <h3>Shield 10 STRK</h3>
                    <p>
                      Public deposit into the STRK20 pool. Depositor, token, and
                      amount are visible.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={shield}
                    disabled={!isConnected || !isStrk20Network || actionPending}
                  >
                    Shield · 2 prompts
                  </button>
                  <small>
                    Screening is enforced by the protocol. A decline stops the
                    action; Quietline does not retry around it.
                  </small>
                </article>

                <article className={styles.walletActionCard}>
                  <div>
                    <span className={styles.publicLabel}>PUBLIC EXIT</span>
                    <h3>Unshield 1 STRK</h3>
                    <p>
                      Public withdrawal to the connected account. Destination,
                      token, and amount are visible.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={unshield}
                    disabled={!isConnected || !isStrk20Network || actionPending}
                  >
                    Unshield
                  </button>
                </article>
              </div>
            )}

            {isConnected ? null : (
              <p className={styles.walletError}>Connect Ready from the header first.</p>
            )}
            {isStrk20Network ? null : (
              <p className={styles.walletError} role="alert">
                STRK20 actions require Mainnet or Sepolia. Use Sepolia for Phase
                1 checks; do not send Quietline mail on mainnet yet.
              </p>
            )}
            {providerIndex === 0 ? (
              <p className={styles.mainnetSafety} role="note">
                Use Sepolia for Phase 1 checks; do not send Quietline mail on
                mainnet yet.
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
                    <code>{action.transactionHash}</code>
                  )
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
