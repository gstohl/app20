import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import styles from "./rfq.module.css";
import type { WorkspaceLoadState } from "./workspace-load-state";

type Recovery = Readonly<{
  headline: string;
  detail: string;
  context: string;
  retryLabel?: string;
}>;

const RECOVERY: Readonly<Partial<Record<WorkspaceLoadState, Recovery>>> =
  Object.freeze({
    "storage-unavailable": {
      headline: "Saved RFQ history could not be opened",
      detail:
        "This browser refused the local database, so past requests cannot be listed. Nothing on the local chain changed and no maker reservation was touched.",
      context:
        "Private windows, cleared site data, and blocked storage all cause this. New requests stay blocked until saved-history and unresolved-deal checks succeed. Allow site data, then retry the read or reload this page.",
      retryLabel: "Retry read",
    },
    "local-deal-read-failed": {
      headline: "The local deal could not be re-read",
      detail:
        "A saved RFQ or the account-bound unresolved-deal discovery query could not be checked against the local chain. Affected outcomes remain unverified. Nothing was resubmitted.",
      context:
        "Healthy saved records remain actionable. Confirm the localnet services are still running, then retry. Reading only verifies; it never funds, fills, claims, or refunds.",
      retryLabel: "Retry read",
    },
    "stale/offline": {
      headline: "Connect the wallet bound to these records",
      detail:
        "Saved RFQs are tied to one account, chain, and local runtime. Nothing is shown until that exact context is connected again.",
      context:
        "Reconnect the same wallet account on the LOCAL provider. A restarted local chain rotates the runtime and intentionally isolates earlier records.",
      retryLabel: "Review wallet connection",
    },
    quarantined: {
      headline: "A saved record is held for reconciliation",
      detail:
        "One or more records could not be trusted as written, so they are quarantined instead of acted on. They cannot fund, fill, claim, refund, or be forgotten.",
      context:
        "Open the record below to inspect what was stored. Reconciliation is manual on purpose; nothing is retried for you.",
    },
  });

export default function RfqRecoveryCard({
  loadState,
  detail,
  busy = false,
  onRetry,
}: {
  loadState: WorkspaceLoadState;
  detail?: string;
  busy?: boolean;
  onRetry?: () => void;
}) {
  const address = useStoreWallet((state) => state.address);
  const recovery = RECOVERY[loadState];
  if (!recovery) return null;
  /* Offline with no wallet at all, the honest control is the wallet itself:
     "Review wallet connection" only re-read storage that cannot answer yet. */
  const askForWallet = loadState === "stale/offline" && !address;
  return (
    <section
      className={styles.recoveryCard}
      aria-labelledby="rfq-recovery-title"
      aria-busy={busy || undefined}
      data-load-state={loadState}
    >
      <h3 id="rfq-recovery-title">{recovery.headline}</h3>
      <p>{recovery.detail}</p>
      <p>{recovery.context}</p>
      {detail ? (
        <p>
          <small>Reported: {detail}</small>
        </p>
      ) : null}
      {askForWallet ? (
        <div className={styles.recoveryConnect}>
          <SelectWallet />
        </div>
      ) : recovery.retryLabel && onRetry ? (
        <button type="button" disabled={busy} onClick={onRetry}>
          {busy ? "Checking…" : recovery.retryLabel}
        </button>
      ) : null}
    </section>
  );
}
