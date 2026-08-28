import { useEffect, useState } from "react";
import type { LocalnetResumeAction } from "./localnet-resume-controller";
import { lifecycleMayForget, type RfqLifecycleRecord } from "./rfq-lifecycle";
import { RFQ_STORAGE_DISCLOSURE } from "./rfq-storage";
import RfqActiveCard from "./RfqActiveCard";
import styles from "./rfq.module.css";

export default function RfqActiveList({ records, loadState = "ready", busyRfqId, actionsDisabled = false, onAction, onRemove, onClearAll }: {
  records: readonly RfqLifecycleRecord[];
  loadState?: "loading" | "ready" | "stale/offline" | "storage-unavailable" | "local-deal-read-failed" | "quarantined";
  busyRfqId?: string;
  actionsDisabled?: boolean;
  onAction?: (record: RfqLifecycleRecord, action: LocalnetResumeAction) => void;
  onRemove?: (record: RfqLifecycleRecord) => void;
  onClearAll?: () => void;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1_000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return <section className={styles.activeRecords} aria-labelledby="active-rfqs">
    <h2 id="active-rfqs">Active</h2>
    <p role={loadState === "storage-unavailable" || loadState === "local-deal-read-failed" ? "alert" : "status"}>Record state: {loadState}</p>
    {loadState === "loading" ? <p>Loading exact local resume records…</p> : null}
    {records.length ? records.map((row) => <RfqActiveCard key={row.rfqId} record={row} now={now} busy={busyRfqId === row.rfqId} actionsDisabled={actionsDisabled} onAction={onAction} onRemove={onRemove}/>) : loadState === "ready" ? <p>No saved active browser records for this wallet and chain.</p> : null}
    <p>{RFQ_STORAGE_DISCLOSURE}</p>
    <p>Restoring and reconciling never automatically resubmits fund, fill, claim, or refund.</p>
    {records.length && records.every(lifecycleMayForget) && onClearAll ? <button type="button" onClick={onClearAll}>Forget all terminal browser history for this wallet and chain</button> : null}
  </section>;
}
