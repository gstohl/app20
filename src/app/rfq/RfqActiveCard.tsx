import { localnetResumeDecision, type LocalnetResumeAction } from "./localnet-resume-controller";
import { RFQ_RESUME_AUTHORITY_LABEL, lifecycleMayForget, type RfqAttemptPhase, type RfqLifecycleRecord } from "./rfq-lifecycle";
import RfqPhaseAction from "./RfqPhaseAction";
import styles from "./rfq.module.css";

const PHASES: readonly RfqAttemptPhase[] = ["funding", "fill", "claim", "refund", "reservation-release"];

function age(observedAt: number | undefined, now: number): string {
  if (!observedAt) return "not observed";
  const seconds = Math.max(0, now - observedAt);
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}

export default function RfqActiveCard({ record, now, busy = false, actionsDisabled = false, onAction, onRemove }: {
  record: RfqLifecycleRecord;
  now: number;
  busy?: boolean;
  actionsDisabled?: boolean;
  onAction?: (record: RfqLifecycleRecord, action: LocalnetResumeAction) => void;
  onRemove?: (record: RfqLifecycleRecord) => void;
}) {
  const selected = localnetResumeDecision(record, now);
  const next = actionsDisabled && selected.action !== "none"
    ? Object.freeze({
        ...selected,
        disabled: true,
        reason:
          "Actions are disabled until records reload successfully for the current account, chain, and LOCAL provider.",
      })
    : selected;
  return <article className={styles.activeCard} aria-labelledby={`rfq-${record.rfqId}-title`}>
    <header>
      <h3 id={`rfq-${record.rfqId}-title`}>{record.terms ? `${record.terms.sellSymbol} → ${record.terms.buySymbol}` : "Quarantined legacy RFQ"}</h3>
      <strong>{record.state}</strong>
    </header>
    {record.terms ? <p>{record.terms.sellAmount} base units {record.terms.sellSymbol} → {record.selectedQuote?.buyAmount ?? record.terms.buyAmount ?? "unselected"} base units {record.terms.buySymbol}</p> : null}
    <dl>
      <div><dt>RFQ</dt><dd><code>{record.rfqId}</code></dd></div>
      <div><dt>Quote</dt><dd>{record.selectedQuote ? `${record.selectedQuote.version} · ${record.selectedQuote.spreadBps} bps` : "not selected"}</dd></div>
      <div><dt>Reservation</dt><dd><code>{record.selectedQuote?.reservationId ?? "unavailable"}</code></dd></div>
      <div><dt>Deal</dt><dd><code>{record.settlement?.dealId ?? "not funded"}</code></dd></div>
      <div><dt>Settlement deadline</dt><dd>{record.settlement ? `${new Date(record.settlement.deadline * 1_000).toISOString()} · ${Math.max(0, record.settlement.deadline - now)}s remaining` : "not funded"}</dd></div>
      <div><dt>Observation</dt><dd>{record.latestObservation?.stage ?? "none"} · {age(record.latestObservation?.observedAt, now)}</dd></div>
      <div><dt>Evidence authority</dt><dd>{record.evidenceAuthority.label} · revision {record.evidenceAuthority.revision}</dd></div>
    </dl>
    <ul aria-label="Per-phase attempts">
      {PHASES.map((phase) => <li key={phase}>{phase}: {record.attempts[phase]?.state ?? "not-started"}{record.attempts[phase]?.transactionHash ? ` · ${record.attempts[phase]?.transactionHash}` : ""}</li>)}
    </ul>
    {record.reason ? <p role={record.state === "quarantined" ? "alert" : undefined}>{record.reason}</p> : null}
    <RfqPhaseAction decision={next} busy={busy} onAction={onAction ? () => onAction(record, next.action) : undefined}/>
    <small>{RFQ_RESUME_AUTHORITY_LABEL}</small>
    {onRemove && lifecycleMayForget(record) ? <button type="button" onClick={() => onRemove(record)}>Forget browser history</button> : null}
  </article>;
}
