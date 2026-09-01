import type { LocalnetResumeAction } from "./localnet-resume-controller";
import { lifecycleMayForget, type RfqLifecycleRecord } from "./rfq-lifecycle";
import { RFQ_STORAGE_DISCLOSURE } from "./rfq-storage";
import RfqActiveCard from "./RfqActiveCard";
import RfqRecoveryCard from "./RfqRecoveryCard";
import type { WorkspaceLoadState } from "./workspace-load-state";
import styles from "./rfq.module.css";

export default function RfqActiveList({
  records,
  loadState = "ready",
  loadDetail,
  busyRfqId,
  actionsDisabled = false,
  onAction,
  onRemove,
  onClearAll,
  onRetryLoad,
}: {
  records: readonly RfqLifecycleRecord[];
  loadState?: WorkspaceLoadState;
  loadDetail?: string;
  busyRfqId?: string;
  actionsDisabled?: boolean;
  onAction?: (record: RfqLifecycleRecord, action: LocalnetResumeAction) => void;
  onRemove?: (record: RfqLifecycleRecord) => void;
  onClearAll?: () => void;
  onRetryLoad?: () => void;
}) {
  return (
    <section
      className={styles.activeRecords}
      aria-labelledby="active-rfqs"
      aria-busy={loadState === "loading" || undefined}
    >
      <h2 id="active-rfqs" tabIndex={-1}>
        Active
      </h2>
      <RfqRecoveryCard
        loadState={loadState}
        detail={loadDetail}
        onRetry={onRetryLoad}
      />
      {loadState === "loading" ? (
        <p role="status">Loading your saved RFQ records…</p>
      ) : null}
      {records.length ? (
        records.map((row) => (
          <RfqActiveCard
            key={row.rfqId}
            record={row}
            busy={busyRfqId === row.rfqId}
            actionsDisabled={actionsDisabled}
            onAction={onAction}
            onRemove={onRemove}
          />
        ))
      ) : loadState === "ready" ? (
        <p>
          No active RFQ for this wallet and chain. Start one from{" "}
          <strong>New</strong>.
        </p>
      ) : null}
      <p>{RFQ_STORAGE_DISCLOSURE}</p>
      <p>
        Restoring and reconciling never automatically resubmits fund, fill,
        claim, or refund.
      </p>
      {records.length && records.every(lifecycleMayForget) && onClearAll ? (
        <button type="button" onClick={onClearAll}>
          Forget all terminal browser history for this wallet and chain
        </button>
      ) : null}
    </section>
  );
}
