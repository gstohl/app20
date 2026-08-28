"use client";
import { useState } from "react";
import { lifecycleMayForget, type RfqLifecycleRecord } from "./rfq-lifecycle";
import { RFQ_STORAGE_DISCLOSURE } from "./rfq-storage";

function CopyableId({ value, label }: { value: string; label: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const short = value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
  return <span><code title={value} aria-label={`${label} ${value}`}>{short}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(value).then(() => setCopyState("copied"), () => setCopyState("failed")); }}>Copy {label}</button><span aria-live="polite">{copyState === "copied" ? `${label} copied` : copyState === "failed" ? `${label} copy failed` : ""}</span></span>;
}

export default function RfqActivity({ records, onRemove, onClearAll }: {
  records: readonly RfqLifecycleRecord[];
  onRemove?: (record: RfqLifecycleRecord) => void;
  onClearAll?: () => void;
}) {
  return <section aria-labelledby="rfq-activity">
    <h2 id="rfq-activity">Activity</h2>
    <p>Requested · Browser record<br/>Quoted · Maker-signed {records.some((row) => row.selectedQuote?.version === "Quote V2") ? "Quote V1/V2" : "Quote V1"} terms<br/>Funded · Exact local deal observation<br/>Settled/refunded · Local observation, separate from evidence authority</p>
    {records.length ? records.map((row) => <article key={row.rfqId}>
      <CopyableId value={row.rfqId} label="RFQ ID"/> · {row.state}
      {row.settlement ? <> · <CopyableId value={row.settlement.dealId} label="deal ID"/></> : null}
      <small>{row.evidenceAuthority.label} · observed {row.latestObservation?.observedAt ? new Date(row.latestObservation.observedAt * 1_000).toISOString() : "never"}</small>
      {onRemove && lifecycleMayForget(row) ? <button type="button" onClick={() => onRemove(row)}>Forget browser history</button> : null}
    </article>) : <p>No local activity records.</p>}
    <p>{RFQ_STORAGE_DISCLOSURE}</p>
    {records.length && records.every(lifecycleMayForget) && onClearAll ? <button type="button" onClick={onClearAll}>Forget all terminal browser history for this wallet and chain</button> : null}
  </section>;
}
