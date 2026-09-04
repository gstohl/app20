"use client";
import { formatSizeBucketLabel } from "@app20/private-intents";
import CopyableId, {
  LOCALNET_VERIFIED_IDENTIFIER_AUTHORITY,
  LOCAL_IDENTIFIER_AUTHORITY,
} from "./CopyableId";
import { rfqStateLabel } from "./rfq-state-label";
import { lifecycleMayForget, type RfqLifecycleRecord } from "./rfq-lifecycle";
import { RFQ_STORAGE_DISCLOSURE } from "./rfq-storage";
import { AuthorityStrip } from "./RfqAuthorityStrip";
import RfqRecoveryCard from "./RfqRecoveryCard";
import { useRfqAuthorityPresentation } from "./ui/use-rfq-authority-presentation";
import type { WorkspaceLoadState } from "./workspace-load-state";
import { humanUnits } from "./human-units";
import styles from "./rfq.module.css";

/** The received leg in human units, or why there is not one yet. */
function receivedLabel(record: RfqLifecycleRecord): string {
  const raw = record.selectedQuote?.buyAmount ?? record.terms?.buyAmount;
  if (!record.terms || raw === undefined) return "unselected";
  try {
    return `${humanUnits(BigInt(raw), record.terms.buyDecimals)} ${record.terms.buySymbol}`;
  } catch {
    return "unselected";
  }
}

function activityBucket(record: RfqLifecycleRecord): string | undefined {
  if (record.mode !== "v3" || !record.bucket || !record.terms) return undefined;
  if (record.terms.sellSymbol !== "STRK" && record.terms.sellSymbol !== "USDC") {
    return `${record.bucket.min}–${record.bucket.max} base units`;
  }
  try {
    return formatSizeBucketLabel(record.terms.sellSymbol, {
      min: BigInt(record.bucket.min),
      max: BigInt(record.bucket.max),
    });
  } catch {
    return "invalid reviewed bucket · read-only record";
  }
}

function RfqActivityRecord({
  record,
  onRemove,
}: {
  record: RfqLifecycleRecord;
  onRemove?: (record: RfqLifecycleRecord) => void;
}) {
  const heading = record.terms
    ? `${record.terms.sellSymbol} → ${record.terms.buySymbol}`
    : "Quarantined legacy RFQ";
  const authority = useRfqAuthorityPresentation(record);
  const dealAuthority =
    authority.status === "authoritative"
      ? LOCALNET_VERIFIED_IDENTIFIER_AUTHORITY
      : LOCAL_IDENTIFIER_AUTHORITY;
  return (
    <article
      className={styles.activityRecord}
      aria-labelledby={`activity-${record.rfqId}-title`}
    >
      <h3 id={`activity-${record.rfqId}-title`}>
        {heading} · {rfqStateLabel(record.state, record.mode)}
      </h3>
      {record.terms ? (
        <p className={styles.recordAmountHuman}>
          {humanUnits(BigInt(record.terms.sellAmount), record.terms.sellDecimals)}{" "}
          {record.terms.sellSymbol} → {receivedLabel(record)}
        </p>
      ) : null}
      {record.mode === "v3" ? (
        <div className={styles.v3RecordSummary}>
          <p><strong>RFQ v3 · bucket {activityBucket(record) ?? "unavailable"}</strong></p>
          {record.fills?.length ? (
            <ol aria-label="RFQ v3 fills">
              {record.fills.map((fill) => (
                <li key={fill.lockId}>
                  {fill.makerId} · lock <code>{fill.lockId}</code> · {fill.amountA} → {fill.amountB} base units
                </li>
              ))}
            </ol>
          ) : null}
          <p>Take hash: <code>{record.takeTransactionHash ?? record.attempts.take?.transactionHash ?? "not submitted"}</code></p>
        </div>
      ) : null}
      <AuthorityStrip presentation={authority} />
      <p className={styles.activityIds}>
        <CopyableId value={record.rfqId} label="RFQ ID" />
        {record.selectedQuote ? (
          <>
            {" "}
            · <CopyableId value={record.selectedQuote.nonce} label="Quote ID" />{" "}
            ·{" "}
            <CopyableId
              value={record.selectedQuote.reservationId}
              label="Reservation ID"
            />
          </>
        ) : null}
        {record.settlement ? (
          <>
            {" "}
            ·{" "}
            <CopyableId
              value={record.settlement.dealId}
              label="Deal ID"
              authority={dealAuthority}
            />
          </>
        ) : null}
      </p>
      <small>
        Last local observation{" "}
        {record.latestObservation?.observedAt
          ? new Date(record.latestObservation.observedAt * 1_000).toISOString()
          : "never"}
      </small>
      {onRemove && lifecycleMayForget(record) ? (
        <button type="button" onClick={() => onRemove(record)}>
          Forget browser history for {heading}
        </button>
      ) : null}
    </article>
  );
}

export default function RfqActivity({
  records,
  loadState = "ready",
  loadDetail,
  onRemove,
  onClearAll,
  onRetryLoad,
}: {
  records: readonly RfqLifecycleRecord[];
  loadState?: WorkspaceLoadState;
  loadDetail?: string;
  onRemove?: (record: RfqLifecycleRecord) => void;
  onClearAll?: () => void;
  onRetryLoad?: () => void;
}) {
  return (
    <section
      className={styles.activityView}
      aria-labelledby="rfq-activity"
      aria-busy={loadState === "loading" || undefined}
    >
      <h2 id="rfq-activity" tabIndex={-1}>
        Activity
      </h2>
      <p>
        Every RFQ this browser saved for the connected wallet and chain.
        Outcomes here are what this device watched happen, not a settlement
        proof.
      </p>
      <RfqRecoveryCard
        loadState={loadState}
        detail={loadDetail}
        onRetry={onRetryLoad}
      />
      {loadState === "loading" ? (
        <p role="status">Loading your saved RFQ history…</p>
      ) : null}
      {records.length ? (
        records.map((row) => (
          <RfqActivityRecord key={row.rfqId} record={row} onRemove={onRemove} />
        ))
      ) : loadState === "ready" ? (
        <p className={styles.recordsEmpty}>
          No RFQ history for this wallet and chain yet.{" "}
          <a href="#new">Start a request</a>
        </p>
      ) : null}
      <details className={styles.storageDisclosure}>
        <summary>What this browser stores</summary>
        <p>{RFQ_STORAGE_DISCLOSURE}</p>
        <p>
          Restoring and reconciling never automatically resubmits fund, fill,
          claim, or refund.
        </p>
      </details>
      {records.length && records.every(lifecycleMayForget) && onClearAll ? (
        <button type="button" onClick={onClearAll}>
          Forget all terminal browser history for this wallet and chain
        </button>
      ) : null}
    </section>
  );
}
