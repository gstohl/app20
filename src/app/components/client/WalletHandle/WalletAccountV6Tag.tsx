"use client";

import type { WALLET_API } from "@starknet-io/types-js";
import { json, num, validateAndParseAddress } from "starknet";
import { useEffect, useState } from "react";
import { authorizeStrk20ValueAction } from "@/lib/mainnet-safety";
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
import * as constants from "@/utils/constants";
import styles from "../../../uni.module.css";
import { StrkCoin } from "../../TokenIcons";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";
import SelectWallet from "./SelectWallet";
import Strk20CapabilityDiagnostic from "./Strk20CapabilityDiagnostic";

const TOKEN = constants.addrSTRK;

function fmtStrk(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function shortHex(value: string): string {
  const hex = num.toHex(value);
  return hex.length <= 13 ? hex : `${hex.slice(0, 7)}...${hex.slice(-4)}`;
}

type ResultRow = { label: string; value: string; hash?: string };
type ActionResult = {
  status: "pending" | "ok" | "error";
  title: string;
  rows?: ResultRow[];
  note?: string;
};

function prettyStatus(finality?: string, execution?: string): string {
  const finalityLabel =
    finality === "ACCEPTED_ON_L2"
      ? "Accepted on L2"
      : finality === "ACCEPTED_ON_L1"
        ? "Accepted on L1"
        : finality === "RECEIVED"
          ? "Received"
          : (finality ?? "");
  const executionLabel =
    execution === "SUCCEEDED"
      ? "Succeeded"
      : execution === "REVERTED"
        ? "Reverted"
        : "";
  return [finalityLabel, executionLabel].filter(Boolean).join(" · ") || "Confirmed";
}

function receiptToResult(
  receipt: unknown,
  transactionHash: string,
  amountLabel: string
): ActionResult {
  const container = receipt as { value?: unknown } | undefined;
  const value = (container?.value ?? receipt) as
    | {
        execution_status?: string;
        finality_status?: string;
        actual_fee?: { amount?: unknown } | unknown;
        events?: unknown[];
      }
    | undefined;
  const execution = value?.execution_status;
  const finality = value?.finality_status;
  const reverted = execution === "REVERTED";
  const rows: ResultRow[] = [];

  if (amountLabel) rows.push({ label: "Amount", value: amountLabel });
  rows.push({ label: "Status", value: prettyStatus(finality, execution) });

  const feeRaw =
    value?.actual_fee &&
    typeof value.actual_fee === "object" &&
    "amount" in value.actual_fee
      ? value.actual_fee.amount
      : value?.actual_fee;
  try {
    if (feeRaw !== undefined && feeRaw !== null) {
      rows.push({
        label: "Network fee",
        value: `${fmtStrk(num.toBigInt(String(feeRaw)))} STRK`,
      });
    }
  } catch {
    // Receipts from different RPC versions expose fee fields differently.
  }

  if (Array.isArray(value?.events)) {
    rows.push({ label: "Events", value: String(value.events.length) });
  }
  rows.push({
    label: "Transaction",
    value: shortHex(transactionHash),
    hash: transactionHash,
  });

  return {
    status: reverted ? "error" : "ok",
    title: reverted ? "Transaction reverted" : "Transaction confirmed",
    rows,
  };
}

function balancesToResult(raw: unknown): ActionResult {
  const container = raw as { value?: unknown } | undefined;
  const value = container?.value ?? raw;
  if (!Array.isArray(value)) {
    return {
      status: "ok",
      title: "Shielded balances",
      note: json.stringify(value, undefined, 2),
    };
  }
  if (!value.length) {
    return {
      status: "ok",
      title: "No shielded balances",
      note: "This account holds nothing in the privacy pool yet.",
    };
  }

  const rows: ResultRow[] = value.map((entry: unknown) => {
    const balance = entry as Record<string, unknown>;
    const tuple = Array.isArray(entry) ? entry : [];
    const token = balance.token ?? balance.token_address ?? tuple[0];
    const amount = balance.amount ?? balance.balance ?? tuple[1];
    let label = "token";
    let amountLabel = String(amount);

    try {
      label =
        num.toBigInt(String(token)) === num.toBigInt(TOKEN)
          ? "STRK"
          : shortHex(String(token));
    } catch {
      // Preserve the generic label when a wallet returns an unknown shape.
    }
    try {
      amountLabel = fmtStrk(num.toBigInt(String(amount)));
    } catch {
      // Preserve the raw amount for unknown response shapes.
    }

    return { label, value: amountLabel };
  });

  return { status: "ok", title: "Shielded balances", rows };
}

function errorResult(message: string): ActionResult {
  return { status: "error", title: "Action failed", note: message };
}

type TabKey = "shield" | "send" | "unshield" | "balances";
const TABS: { key: TabKey; label: string }[] = [
  { key: "shield", label: "Shield" },
  { key: "send", label: "Send" },
  { key: "unshield", label: "Unshield" },
  { key: "balances", label: "Balances" },
];

export default function WalletAccountV6Tag() {
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex
  );
  const walletAccount = useStoreWallet((state) => state.myWalletAccount);
  const connectedAddress = useStoreWallet((state) => state.address);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const strk20Capability = useStoreWallet(
    (state) => state.strk20Capability,
  );
  const networkName = constants.Strk20Networks[providerIndex];
  const networkKey = networkName ?? `network-${providerIndex}`;
  const poolAddress = constants.strk20PoolForProviderIndex(providerIndex);
  const isStrk20Network = networkName !== undefined && poolAddress !== null;

  const [resultBalances, setResultBalances] = useState<ActionResult | null>(null);
  const [resultShield, setResultShield] = useState<ActionResult | null>(null);
  const [resultUnshield, setResultUnshield] = useState<ActionResult | null>(null);
  const [resultTransfer, setResultTransfer] = useState<ActionResult | null>(null);
  const [tab, setTab] = useState<TabKey>("shield");
  const [amountInput, setAmountInput] = useState("0.1");
  let parsedAmount: bigint | null = null;
  let amountError = "";
  try {
    parsedAmount = parseStrkAmount(amountInput);
  } catch (error: unknown) {
    amountError = error instanceof Error ? error.message : "Enter a valid STRK amount.";
  }

  useEffect(() => {
    try {
      setAmountInput(loadStrkAmount(window.localStorage, networkKey));
    } catch {
      setAmountInput("0.1");
    }
  }, [networkKey]);

  async function submit(
    actions: WALLET_API.STRK20_ACTION[],
    setResult: (result: ActionResult) => void,
    actionName: string,
    amount: bigint,
  ) {
    if (!walletAccount) {
      setResult(errorResult("No WalletAccount is connected."));
      return;
    }

    if (!networkName || !poolAddress || !isStrk20Network) {
      setResult(errorResult("STRK20 actions require Starknet Mainnet or Sepolia."));
      return;
    }

    const amountLabel = `${formatStrkAmount(amount)} STRK`;
    const provider = constants.myFrontendProviders[providerIndex];
    let submittedHash: string | undefined;
    try {
      setResult({
        status: "pending",
        title: "Checking live fee and public balance…",
        rows: [
          { label: "Amount", value: amountLabel },
          { label: "Base units", value: amount.toString() },
        ],
      });
      await authorizeStrk20ValueAction({
        provider,
        poolAddress,
        accountAddress: connectedAddress || walletAccount.address,
        network: networkName,
        action: actionName,
        amount,
      });
      try {
        saveStrkAmount(window.localStorage, networkKey, amountInput);
      } catch {
        // Storage availability does not alter the explicitly reviewed amount.
      }
      const { transactionHash, receipt } = await submitActions(
        walletAccount,
        provider,
        actions,
        {
          onSubmitted: (hash) => {
            submittedHash = hash;
            setResult({
              status: "pending",
              title: "Waiting for confirmation…",
              rows: [
                { label: "Amount", value: amountLabel },
                { label: "Transaction", value: shortHex(hash), hash },
              ],
            });
          },
        }
      );
      setResult(receiptToResult(receipt, transactionHash, amountLabel));
    } catch (error: unknown) {
      const timedOut = error instanceof Strk20WaitTimeoutError;
      const transactionHash = timedOut
        ? error.transactionHash
        : submittedHash;
      setResult({
        status: "error",
        title: timedOut
          ? "Confirmation timed out"
          : transactionHash
            ? "Could not confirm transaction"
            : "Action failed",
        rows: transactionHash
          ? [
              {
                label: "Transaction",
                value: shortHex(transactionHash),
                hash: transactionHash,
              },
            ]
          : undefined,
        note: strk20ErrorMessage(error),
      });
    }
  }

  async function handleBalances() {
    setResultBalances(null);
    if (!walletAccount) {
      setResultBalances(errorResult("No WalletAccount is connected."));
      return;
    }
    try {
      const balances = await walletAccount.strk20Balances([]);
      setResultBalances(balancesToResult(balances));
    } catch (error: unknown) {
      setResultBalances(errorResult(strk20ErrorMessage(error)));
    }
  }

  async function handleShield() {
    setResultShield(null);
    if (parsedAmount === null) {
      setResultShield(errorResult(amountError));
      return;
    }
    await submit(
      [{ type: "deposit", token: TOKEN, amount: num.toHex(parsedAmount) }],
      setResultShield,
      "Shield",
      parsedAmount,
    );
  }

  async function handleUnshield() {
    setResultUnshield(null);
    if (!connectedAddress) {
      setResultUnshield(errorResult("Connect a wallet first."));
      return;
    }
    if (parsedAmount === null) {
      setResultUnshield(errorResult(amountError));
      return;
    }
    await submit(
      [
        {
          type: "withdraw",
          token: TOKEN,
          amount: num.toHex(parsedAmount),
          recipient: connectedAddress,
        },
      ],
      setResultUnshield,
      "Unshield",
      parsedAmount,
    );
  }

  async function handleSelfTransfer() {
    setResultTransfer(null);
    if (!connectedAddress) {
      setResultTransfer(errorResult("Connect a wallet first."));
      return;
    }
    if (parsedAmount === null) {
      setResultTransfer(errorResult(amountError));
      return;
    }
    await submit(
      [
        {
          type: "transfer",
          token: TOKEN,
          amount: num.toHex(parsedAmount),
          recipient: connectedAddress,
        },
      ],
      setResultTransfer,
      "Private self-transfer",
      parsedAmount,
    );
  }

  const explorerTxUrl = (hash: string) =>
    providerIndex === 0
      ? `https://voyager.online/tx/${hash}`
      : `https://sepolia.voyager.online/tx/${hash}`;

  const ResultCard = ({ result }: { result: ActionResult }) => (
    <div
      className={`${styles.receipt} ${
        result.status === "error"
          ? styles.receiptError
          : result.status === "pending"
            ? styles.receiptPending
            : styles.receiptOk
      }`}
    >
      <div className={styles.receiptHead}>
        <span className={styles.receiptIcon}>
          {result.status === "ok" ? "✓" : result.status === "error" ? "!" : "⋯"}
        </span>
        <span>{result.title}</span>
      </div>
      {result.rows?.length ? (
        <div className={styles.receiptRows}>
          {result.rows.map((row) => (
            <div key={row.label} className={styles.receiptRow}>
              <span className={styles.receiptLabel}>{row.label}</span>
              {row.hash ? (
                <a
                  className={styles.receiptLink}
                  href={explorerTxUrl(row.hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {row.value} ↗
                </a>
              ) : (
                <span className={styles.receiptValue}>{row.value}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {result.note ? <pre className={styles.receiptNote}>{result.note}</pre> : null}
    </div>
  );

  const config: Record<
    TabKey,
    {
      label: string;
      value: string;
      token: string;
      hint: string;
      cta: string;
      onRun: () => void;
      result: ActionResult | null;
      disabled: boolean;
    }
  > = {
    shield: {
      label: "You're shielding",
      value: amountInput,
      token: "STRK",
      hint: "Public deposit into the STRK20 privacy pool",
      cta: "Shield (2 wallet prompts)",
      onRun: handleShield,
      result: resultShield,
      disabled: !isStrk20Network || parsedAmount === null,
    },
    send: {
      label: "You're sending to yourself",
      value: amountInput,
      token: "STRK",
      hint: "Private in-pool transfer",
      cta: "Private self-transfer",
      onRun: handleSelfTransfer,
      result: resultTransfer,
      disabled: !isStrk20Network || parsedAmount === null,
    },
    unshield: {
      label: "You're unshielding",
      value: amountInput,
      token: "STRK",
      hint: "Public withdrawal to your connected account",
      cta: "Unshield",
      onRun: handleUnshield,
      result: resultUnshield,
      disabled: !isStrk20Network || parsedAmount === null,
    },
    balances: {
      label: "Shielded balances",
      value: "All",
      token: "tokens",
      hint: "Explicitly read your private pool balances",
      cta: "Query balances",
      onRun: handleBalances,
      result: resultBalances,
      disabled: !isStrk20Network,
    },
  };
  const active = config[tab];
  const walletAddress = walletAccount?.address
    ? validateAndParseAddress(walletAccount.address)
    : "";
  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : "-";

  if (isConnected && !isStrk20Capable) {
    return (
      <div className={styles.panel}>
        {strk20Capability ? (
          <Strk20CapabilityDiagnostic capability={strk20Capability} />
        ) : (
          <div className={styles.degradeCard}>
            <strong>Checking privacy-wallet capability</strong>
            <p>
              Quietline has not received the wallet's dapp-facing STRK20
              declarations yet. Privacy actions remain disabled.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.tabs}>
        {TABS.map((item) => (
          <button
            key={item.key}
            className={`${styles.tab} ${
              tab === item.key ? styles.tabActive : ""
            }`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={styles.inputBlock}>
        <div className={styles.inputLabel}>{active.label}</div>
        <div className={styles.inputMain}>
          {tab === "balances" ? (
            <div className={styles.bigValue}>{active.value}</div>
          ) : (
            <input
              className={styles.bigValueInput}
              aria-label="Wallet action amount in STRK"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
            />
          )}
          <span className={styles.tokenPill}>
            <span className={styles.tokenDot}>
              <StrkCoin size={22} />
            </span>
            {active.token}
          </span>
        </div>
        <div className={styles.subLine}>
          <span>
            {tab === "balances"
              ? active.hint
              : parsedAmount === null
                ? amountError
                : `${formatStrkAmount(parsedAmount)} STRK · ${parsedAmount} base units`}
          </span>
          <span className={styles.subMono}>{shortWallet}</span>
        </div>
      </div>

      <div className={styles.feeRow}>
        <span>Network</span>
        <span
          className={`${styles.feeVal} ${
            isStrk20Network ? styles.netOk : styles.netBad
          }`}
        >
          <span
            className={`${styles.netDot} ${
              isStrk20Network ? styles.netOkDot : styles.netBadDot
            }`}
          />
          {networkName ?? "Unsupported"}
        </span>
      </div>

      {tab === "shield" ? (
        <div className={styles.info}>
          Shielding is public and requires two wallet prompts: approve STRK,
          then deposit. A screening decline is enforced by the protocol.
        </div>
      ) : null}

      {isStrk20Network ? providerIndex === 0 ? (
        <div className={styles.warn}>
          Mainnet moves real funds. Quietline reads the live pool fee and public
          STRK balance, then requires an exact confirmation before submission.
          Escrow remains disabled.
        </div>
      ) : null : (
        <div className={styles.warn}>
          STRK20 actions require Starknet Sepolia or Mainnet.
        </div>
      )}

      {isConnected ? (
        <button
          className={styles.btnCta}
          disabled={active.disabled}
          onClick={active.onRun}
        >
          {active.cta}
        </button>
      ) : (
        <SelectWallet variant="ctaBig" />
      )}

      {active.result ? <ResultCard result={active.result} /> : null}
    </div>
  );
}
