"use client";

import type { WALLET_API } from "@starknet-io/types-js";
import { json, num, validateAndParseAddress } from "starknet";
import { useState } from "react";
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

const TOKEN = constants.addrSTRK;
const TEN_STRK = 10n * 10n ** 18n;
const FIVE_STRK = 5n * 10n ** 18n;
const ONE_STRK = 10n ** 18n;

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

type TabKey = "shield" | "send" | "unshield" | "echo" | "balances";
const TABS: { key: TabKey; label: string }[] = [
  { key: "shield", label: "Shield" },
  { key: "send", label: "Send" },
  { key: "unshield", label: "Unshield" },
  { key: "echo", label: "Echo · DEMO" },
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
  const networkName = constants.Strk20Networks[providerIndex];
  const isStrk20Network = networkName !== undefined;
  const echoHelper = constants.echoHelperForIndex(providerIndex);
  const hasEchoHelper = (() => {
    try {
      return num.toBigInt(echoHelper) !== 0n;
    } catch {
      return false;
    }
  })();

  const [resultBalances, setResultBalances] = useState<ActionResult | null>(null);
  const [resultShield, setResultShield] = useState<ActionResult | null>(null);
  const [resultUnshield, setResultUnshield] = useState<ActionResult | null>(null);
  const [resultTransfer, setResultTransfer] = useState<ActionResult | null>(null);
  const [resultEcho, setResultEcho] = useState<ActionResult | null>(null);
  const [tab, setTab] = useState<TabKey>("shield");

  async function submit(
    actions: WALLET_API.STRK20_ACTION[],
    setResult: (result: ActionResult) => void,
    amountLabel: string
  ) {
    if (!walletAccount) {
      setResult(errorResult("No WalletAccount is connected."));
      return;
    }

    const provider = constants.myFrontendProviders[providerIndex];
    try {
      const { transactionHash, receipt } = await submitActions(
        walletAccount,
        provider,
        actions,
        {
          onSubmitted: (hash) =>
            setResult({
              status: "pending",
              title: "Waiting for confirmation…",
              rows: [
                { label: "Amount", value: amountLabel },
                { label: "Transaction", value: shortHex(hash), hash },
              ],
            }),
        }
      );
      setResult(receiptToResult(receipt, transactionHash, amountLabel));
    } catch (error: unknown) {
      const transactionHash =
        error instanceof Strk20WaitTimeoutError
          ? error.transactionHash
          : undefined;
      setResult({
        status: "error",
        title: transactionHash
          ? "Confirmation timed out"
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
    await submit(
      [{ type: "deposit", token: TOKEN, amount: num.toHex(TEN_STRK) }],
      setResultShield,
      "10 STRK"
    );
  }

  async function handleUnshield() {
    setResultUnshield(null);
    if (!connectedAddress) {
      setResultUnshield(errorResult("Connect a wallet first."));
      return;
    }
    await submit(
      [
        {
          type: "withdraw",
          token: TOKEN,
          amount: num.toHex(ONE_STRK),
          recipient: connectedAddress,
        },
      ],
      setResultUnshield,
      "1 STRK"
    );
  }

  async function handleSelfTransfer() {
    setResultTransfer(null);
    if (!connectedAddress) {
      setResultTransfer(errorResult("Connect a wallet first."));
      return;
    }
    await submit(
      [
        {
          type: "transfer",
          token: TOKEN,
          amount: num.toHex(ONE_STRK),
          recipient: connectedAddress,
        },
      ],
      setResultTransfer,
      "1 STRK"
    );
  }

  async function handleEcho() {
    setResultEcho(null);
    if (!connectedAddress || !hasEchoHelper) {
      setResultEcho(
        errorResult("The optional DEMO echo helper is not configured here.")
      );
      return;
    }

    // These placeholders are literal strings interpreted by the wallet.
    const actions: WALLET_API.STRK20_ACTION[] = [
      {
        type: "withdraw",
        token: TOKEN,
        amount: num.toHex(FIVE_STRK),
        recipient: num.toHex(echoHelper),
      },
      { type: "transfer", token: TOKEN, amount: "OPEN", recipient: connectedAddress },
      {
        type: "invoke",
        contract: num.toHex(echoHelper),
        calldata: [num.toHex(TOKEN), "${poolAddress}", "${openNoteIds[0]}"],
      },
    ];
    await submit(actions, setResultEcho, "5 STRK");
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
      value: "10",
      token: "STRK",
      hint: "Public deposit into the STRK20 privacy pool",
      cta: "Shield (2 wallet prompts)",
      onRun: handleShield,
      result: resultShield,
      disabled: !isStrk20Network,
    },
    send: {
      label: "You're sending to yourself",
      value: "1",
      token: "STRK",
      hint: "Private in-pool transfer",
      cta: "Private self-transfer",
      onRun: handleSelfTransfer,
      result: resultTransfer,
      disabled: !isStrk20Network,
    },
    unshield: {
      label: "You're unshielding",
      value: "1",
      token: "STRK",
      hint: "Public withdrawal to your connected account",
      cta: "Unshield",
      onRun: handleUnshield,
      result: resultUnshield,
      disabled: !isStrk20Network,
    },
    echo: {
      label: "DEMO echo invoke",
      value: "5",
      token: "STRK",
      hint: "Debug-only starter helper; not part of Feltproof",
      cta: "Run DEMO echo",
      onRun: handleEcho,
      result: resultEcho,
      disabled: !isStrk20Network || !hasEchoHelper,
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
        <div className={styles.degradeCard}>
          <strong>Privacy actions unavailable</strong>
          <p>
            This wallet did not declare Wallet API/spec support at version 0.10
            or newer. Install or connect Ready to shield STRK on Sepolia.
          </p>
          <a href="https://www.ready.co/" target="_blank" rel="noreferrer">
            Get Ready ↗
          </a>
        </div>
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
          <div className={styles.bigValue}>{active.value}</div>
          <span className={styles.tokenPill}>
            <span className={styles.tokenDot}>
              <StrkCoin size={22} />
            </span>
            {active.token}
          </span>
        </div>
        <div className={styles.subLine}>
          <span>{active.hint}</span>
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

      {!isStrk20Network ? (
        <div className={styles.warn}>
          STRK20 actions require Mainnet or Sepolia. Use Sepolia for Phase 1
          checks; do not test Feltproof on mainnet yet.
        </div>
      ) : null}

      {tab === "echo" && !hasEchoHelper ? (
        <div className={styles.warn}>
          DEMO echo is disabled because no optional helper is configured. Shield,
          self-transfer, unshield, and balances do not need it.
        </div>
      ) : null}

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
