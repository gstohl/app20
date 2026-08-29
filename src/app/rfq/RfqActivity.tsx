"use client";
import { useState } from "react";
import { rfqAuthorityPresentation } from "./rfq-authority";
import { rfqStateLabel } from "./rfq-state-label";
import { lifecycleMayForget, type RfqLifecycleRecord } from "./rfq-lifecycle";
import { RFQ_STORAGE_DISCLOSURE } from "./rfq-storage";
import { AuthorityStrip } from "./RfqAuthorityStrip";
import RfqRecoveryCard from "./RfqRecoveryCard";
import type { WorkspaceLoadState } from "./workspace-load-state";
import styles from "./rfq.module.css";

function shorten(value: string): string {
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function CopyableId({ value, label }: { value: string; label: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const short = shorten(value);
  return (
    <span className={styles.copyableId}>
      <code title={value} aria-label={`${label} ${value}`}>
        {short}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => setCopyState("copied"),
            () => setCopyState("failed"),
          );
        }}
      >
        Copy {label} {short}
      </button>
      <span aria-live="polite">
        {copyState === "copied"
          ? `${label} ${short} copied`
          : copyState === "failed"
            ? `${label} ${short} copy failed`
            : ""}
      </span>
    </span>
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
        records.map((row) => {
          const heading = row.terms
            ? `${row.terms.sellSymbol} → ${row.terms.buySymbol}`
            : "Quarantined legacy RFQ";
          return (
            <article
              key={row.rfqId}
              className={styles.activityRecord}
              aria-labelledby={`activity-${row.rfqId}-title`}
            >
              <h3 id={`activity-${row.rfqId}-title`}>
                {heading} · {rfqStateLabel(row.state)}
              </h3>
              {row.terms ? (
                <p className={styles.activityAmount}>
                  {row.terms.sellAmount} base units {row.terms.sellSymbol} →{" "}
                  {row.selectedQuote?.buyAmount ??
                    row.terms.buyAmount ??
                    "unselected"}{" "}
                  base units {row.terms.buySymbol}
                </p>
              ) : null}
              <AuthorityStrip presentation={rfqAuthorityPresentation(row)} />
              <p className={styles.activityIds}>
                <CopyableId value={row.rfqId} label="RFQ ID" />
                {row.settlement ? (
                  <>
                    {" "}
                    ·{" "}
                    <CopyableId value={row.settlement.dealId} label="deal ID" />
                  </>
                ) : null}
              </p>
              <small>
                Last local observation{" "}
                {row.latestObservation?.observedAt
                  ? new Date(
                      row.latestObservation.observedAt * 1_000,
                    ).toISOString()
                  : "never"}
              </small>
              {onRemove && lifecycleMayForget(row) ? (
                <button type="button" onClick={() => onRemove(row)}>
                  Forget browser history for {heading}
                </button>
              ) : null}
            </article>
          );
        })
      ) : loadState === "ready" ? (
        <p>No saved RFQ history for this wallet and chain yet.</p>
      ) : null}
      <p>{RFQ_STORAGE_DISCLOSURE}</p>
      {records.length && records.every(lifecycleMayForget) && onClearAll ? (
        <button type="button" onClick={onClearAll}>
          Forget all terminal browser history for this wallet and chain
        </button>
      ) : null}
    </section>
  );
}
