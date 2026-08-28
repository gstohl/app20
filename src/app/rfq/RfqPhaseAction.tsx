import type { LocalnetResumeDecision } from "./localnet-resume-controller";
import styles from "./rfq.module.css";

export default function RfqPhaseAction({ decision, busy = false, onAction }: {
  decision: LocalnetResumeDecision;
  busy?: boolean;
  onAction?: () => void;
}) {
  if (decision.action === "none") return <p><strong>{decision.label}</strong> · {decision.reason}</p>;
  return <div className={styles.phaseAction}>
    <button type="button" disabled={busy || decision.disabled || !onAction} onClick={onAction}>
      {busy ? "Working…" : decision.label}
    </button>
    <small>{decision.reason}</small>
  </div>;
}
