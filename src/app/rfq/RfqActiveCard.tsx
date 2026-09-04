import { formatSizeBucketLabel } from "@app20/private-intents";
import {
  localnetResumeDecision,
  type LocalnetResumeAction,
} from "./localnet-resume-controller";
import { rfqAuthorityPresentation } from "./rfq-authority";
import { rfqStateLabel } from "./rfq-state-label";
import {
  RFQ_RESUME_AUTHORITY_LABEL,
  lifecycleMayForget,
  type RfqLifecycleAttemptPhase,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";
import { AuthorityStrip } from "./RfqAuthorityStrip";
import CopyableId, {
  LOCALNET_VERIFIED_IDENTIFIER_AUTHORITY,
  LOCAL_IDENTIFIER_AUTHORITY,
} from "./CopyableId";
import RfqPhaseAction from "./RfqPhaseAction";
import { useRfqPresentationClock } from "./ui/rfq-presentation-clock";
import { humanUnits } from "./human-units";
import styles from "./rfq.module.css";

function safeBigInt(value: string): bigint | undefined {
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

const LEGACY_PHASES: readonly RfqLifecycleAttemptPhase[] = [
  "funding",
  "fill",
  "claim",
  "refund",
  "reservation-release",
];

const PHASE_LABELS: Readonly<Record<RfqLifecycleAttemptPhase, string>> = {
  funding: "Funding",
  fill: "Maker fill",
  claim: "Claim",
  refund: "Refund",
  "reservation-release": "Reservation release",
  take: "Atomic Take",
};

const ATTEMPT_LABELS: Readonly<Record<string, string>> = {
  "not-started": "not started",
  preparing: "preparing",
  "wallet-boundary-unknown": "unknown at the wallet boundary",
  "submitted-unknown": "submitted · outcome unknown",
  confirmed: "confirmed locally",
  reverted: "reverted",
};

function age(observedAt: number | undefined, now: number): string {
  if (!observedAt) return "not observed";
  const seconds = Math.max(0, now - observedAt);
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}

function bucketLabel(record: RfqLifecycleRecord): string | undefined {
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
    return "invalid reviewed bucket · record remains read-only";
  }
}

export default function RfqActiveCard({
  record,
  now,
  busy = false,
  actionsDisabled = false,
  onAction,
  onRemove,
}: {
  record: RfqLifecycleRecord;
  now?: number;
  busy?: boolean;
  actionsDisabled?: boolean;
  onAction?: (record: RfqLifecycleRecord, action: LocalnetResumeAction) => void;
  onRemove?: (record: RfqLifecycleRecord) => void;
}) {
  const clock = useRfqPresentationClock(now === undefined);
  const t = now ?? clock;
  const authority = rfqAuthorityPresentation(record);
  const dealAuthority =
    authority.status === "authoritative"
      ? LOCALNET_VERIFIED_IDENTIFIER_AUTHORITY
      : LOCAL_IDENTIFIER_AUTHORITY;
  const selectedDecision = localnetResumeDecision(record, t);
  const selected =
    record.mode === "v3" && selectedDecision.action === "take"
      ? Object.freeze({
          ...selectedDecision,
          label: "Review atomic Take",
          reason:
            "Open a fresh balance-bound final review before any wallet submission.",
        })
      : selectedDecision;
  const blocked = actionsDisabled || authority.blocksValueActions;
  const next =
    blocked && selected.action !== "none"
      ? Object.freeze({
          ...selected,
          disabled: true,
          reason: authority.blocksValueActions
            ? `${authority.label}. Reconcile this record before any further action; nothing is retried automatically.`
            : "Actions are disabled until records reload successfully for the current account, chain, and LOCAL provider.",
        })
      : selected;
  const receivedRaw =
    record.selectedQuote?.buyAmount ?? record.terms?.buyAmount;
  const receivedAmount =
    receivedRaw === undefined ? undefined : safeBigInt(receivedRaw);
  return (
    <article
      className={styles.activeCard}
      aria-labelledby={`rfq-${record.rfqId}-title`}
    >
      <header>
        <h3 id={`rfq-${record.rfqId}-title`}>
          {record.terms
            ? `${record.terms.sellSymbol} → ${record.terms.buySymbol}`
            : "Quarantined legacy RFQ"}
        </h3>
        <strong>{rfqStateLabel(record.state, record.mode)}</strong>
      </header>
      {record.terms ? (
        <div className={styles.recordAmounts}>
          {/* A 23-digit integer is the exact record, not something a person
              can read at a glance; it stays, one rank below the human units. */}
          <p className={styles.recordAmountHuman}>
            {humanUnits(
              BigInt(record.terms.sellAmount),
              record.terms.sellDecimals,
            )}{" "}
            {record.terms.sellSymbol} →{" "}
            {receivedAmount === undefined
              ? "unselected"
              : `${humanUnits(receivedAmount, record.terms.buyDecimals)} ${record.terms.buySymbol}`}
          </p>
          <p className={styles.activeCardAmount}>
            exactly {record.terms.sellAmount} →{" "}
            {receivedAmount?.toString() ?? "unselected"} base units
          </p>
        </div>
      ) : null}
      {record.mode === "v3" ? (
        <div className={styles.v3RecordSummary}>
          <p><strong>RFQ v3 · atomic Take</strong></p>
          <p>Size bucket: {bucketLabel(record) ?? "unavailable"}</p>
          {record.fills?.length ? (
            <ol aria-label="Exact v3 fills">
              {record.fills.map((fill) => (
                <li key={fill.lockId}>
                  {fill.makerId} · lock <code>{fill.lockId}</code> · sell {fill.amountA} · receive {fill.amountB} base units
                </li>
              ))}
            </ol>
          ) : <p>No exact fills selected yet.</p>}
          <p>
            Take transaction: <code>{record.takeTransactionHash ?? record.attempts.take?.transactionHash ?? "not submitted"}</code>
          </p>
        </div>
      ) : null}
      <AuthorityStrip presentation={authority} />
      {record.recoverySource === "server-derived" ? (
        <p>
          <strong>
            Server-derived resume record · not chain-verified authority
          </strong>
        </p>
      ) : null}
      {record.recoveryReadFailure ? (
        <p role="alert">
          Latest deal verification failed for this record:{" "}
          {record.recoveryReadFailure.detail}
        </p>
      ) : null}
      <RfqPhaseAction
        decision={next}
        busy={busy}
        onAction={onAction ? () => onAction(record, next.action) : undefined}
      />
      {record.reason ? (
        <p
          role={
            record.state === "quarantined" ||
            record.reason === "take-reverted"
              ? "alert"
              : undefined
          }
        >
          {record.reason === "take-reverted"
            ? "Take reverted on chain. This RFQ is terminal and cannot be resubmitted; start a new RFQ."
            : record.reason}
        </p>
      ) : null}
      <details className={styles.activeCardDetails}>
        <summary>Record details</summary>
        <dl>
          <div>
            <dt>RFQ</dt>
            <dd>
              <CopyableId value={record.rfqId} label="RFQ ID" />
            </dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{record.mode === "v3" ? "RFQ v3 · collateralized atomic Take" : "Legacy RFQ v2 · read-only recovery remains available"}</dd>
          </div>
          <div>
            <dt>Quote</dt>
            <dd>
              {record.selectedQuote ? (
                <>
                  <CopyableId
                    value={record.selectedQuote.nonce}
                    label="Quote ID"
                  />{" "}
                  · {record.selectedQuote.version} ·{" "}
                  {record.selectedQuote.spreadBps} bps
                </>
              ) : (
                "not selected"
              )}
            </dd>
          </div>
          <div>
            <dt>Reservation</dt>
            <dd>
              {record.selectedQuote ? (
                <CopyableId
                  value={record.selectedQuote.reservationId}
                  label="Reservation ID"
                />
              ) : (
                "unavailable"
              )}
            </dd>
          </div>
          <div>
            <dt>Deal</dt>
            <dd>
              {record.settlement ? (
                <CopyableId
                  value={record.settlement.dealId}
                  label="Deal ID"
                  authority={dealAuthority}
                />
              ) : (
                "not funded"
              )}
            </dd>
          </div>
          <div>
            <dt>Settlement deadline</dt>
            <dd>
              {record.settlement
                ? `${new Date(record.settlement.deadline * 1_000).toISOString()} · ${Math.max(0, record.settlement.deadline - t)}s remaining`
                : "not funded"}
            </dd>
          </div>
          <div>
            <dt>Observation</dt>
            <dd>
              {record.latestObservation?.stage ?? "none"} ·{" "}
              {age(record.latestObservation?.observedAt, t)}
            </dd>
          </div>
          <div>
            <dt>Lifecycle state</dt>
            <dd>
              <code>{record.state}</code>
            </dd>
          </div>
        </dl>
        <ul aria-label="Per-phase attempts">
          {(record.mode === "v3" ? (["take"] as const) : LEGACY_PHASES).map((phase) => (
            <li key={phase}>
              {PHASE_LABELS[phase]}:{" "}
              {ATTEMPT_LABELS[record.attempts[phase]?.state ?? "not-started"]}
              {record.attempts[phase]?.transactionHash
                ? ` · ${record.attempts[phase]?.transactionHash}`
                : ""}
            </li>
          ))}
        </ul>
      </details>
      <small>{RFQ_RESUME_AUTHORITY_LABEL}</small>
      {onRemove && lifecycleMayForget(record) ? (
        <button type="button" onClick={() => onRemove(record)}>
          Forget browser history
        </button>
      ) : null}
    </article>
  );
}
