import {
  settlementReceiptAuthority,
  type SettlementReceipt,
  type VerifiedChainSettlementReceipt,
} from "@/lib/settlement-receipt";
import { AuthorityStrip } from "./RfqAuthorityStrip";
import { rfqAuthorityPresentation } from "./rfq-authority";
import type { RfqLifecycleRecord } from "./rfq-lifecycle";
import { useRfqPresentationClock } from "./ui/rfq-presentation-clock";
import styles from "./rfq.module.css";

export default function SettlementEvidencePanel({
  receipt,
  transactionHashes = [],
  records = [],
}: {
  receipt?: SettlementReceipt | VerifiedChainSettlementReceipt;
  transactionHashes?: readonly string[];
  records?: readonly RfqLifecycleRecord[];
}) {
  const receiptAuthority = receipt
    ? settlementReceiptAuthority(receipt)
    : undefined;
  useRfqPresentationClock(
    records.some(
      (row) => rfqAuthorityPresentation(row).status === "authoritative",
    ),
  );
  const presented = records.map((row) => ({
    row,
    presentation: rfqAuthorityPresentation(row),
  }));
  const liveTerminal = presented.some(
    ({ row, presentation }) =>
      (row.state === "settled" || row.state === "refunded") &&
      presentation.status === "authoritative",
  );
  const unresolved = presented.filter(
    ({ presentation }) => presentation.needsReconciliation,
  );
  const heading = receiptAuthority?.authoritative
    ? "Authoritative receipt"
    : liveTerminal
      ? "Terminal lifecycle finalized locally"
      : "No exportable receipt";
  const reason = receiptAuthority
    ? receiptAuthority.reason
    : liveTerminal
      ? "Localnet-only modeled authority finalized the terminal lifecycle for this exact deal. No exportable receipt is available."
      : "No live terminal lifecycle projection or exportable settlement receipt is available.";

  return (
    <section className={styles.evidencePanel} aria-labelledby="evidence-title">
      <strong>LOCALNET DEMO EVIDENCE</strong>
      <h3 id="evidence-title">{heading}</h3>
      <p>{reason}</p>
      <p>
        This authority is localnet-only and modeled by same-devnet fixture
        readers. Sepolia/Mainnet production authority remains unavailable.
      </p>
      {unresolved.length ? (
        <div className={styles.evidenceUnresolved}>
          <h4>Needs reconciliation</h4>
          {unresolved.map(({ row, presentation }) => (
            <div key={row.rfqId}>
              <code>{row.rfqId}</code>
              <AuthorityStrip presentation={presentation} />
            </div>
          ))}
          <p>
            These records cannot drive a value action until they are reconciled.
            Nothing is resubmitted for you.
          </p>
        </div>
      ) : null}
      <details>
        <summary>Non-authoritative transaction references</summary>
        {transactionHashes.length ? (
          transactionHashes.map((hash) => <code key={hash}>{hash}</code>)
        ) : (
          <p>None observed.</p>
        )}
      </details>
      <p>
        Pending, stale, reorg-invalidated, or reader-disagreement evidence never
        enables execution.
      </p>
    </section>
  );
}
