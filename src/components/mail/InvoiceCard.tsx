import { useState } from "react";
import {
  formatBaseUnits,
  hasConsistentTokenMetadata,
  isCanonicalStrkToken,
  normalizeTokenRef,
  paymentRequestIsExpired,
  type PaymentRequestPayload,
  type PaymentStatus,
} from "@/lib/otc";
import styles from "./mail.module.css";

type InvoiceCardProps = {
  request: PaymentRequestPayload;
  alias?: string;
  status?: PaymentStatus;
  paymentVerified?: boolean;
  unverifiedClaim?: boolean;
  busy?: boolean;
  actionMessage?: string;
  onPay?: () => void;
};

export default function InvoiceCard({
  request,
  alias,
  status = "requested",
  paymentVerified = false,
  unverifiedClaim = false,
  busy = false,
  actionMessage,
  onPay,
}: InvoiceCardProps) {
  const [ignored, setIgnored] = useState(false);
  const token = normalizeTokenRef(request.token);
  const amount = formatBaseUnits(request.amount, token.decimals);
  const metadataConsistent = hasConsistentTokenMetadata(request.token);
  const isStrk = isCanonicalStrkToken(request.token);
  const expired = status === "expired" || paymentRequestIsExpired(request);
  const canPay =
    status === "requested" && !expired && isStrk && !ignored && Boolean(onPay);

  return (
    <article className={`${styles.messageSheet} ${styles.dealSheet}`}>
      <div className={styles.sheetHeading}>
        <span className={styles.sheetType}>PAYMENT REQUEST / ONE-SIDED V1</span>
        {unverifiedClaim || (status === "paid" && !paymentVerified) ? (
          <span className={styles.proofStamp}>
            Unverified counterparty claim
          </span>
        ) : status === "paid" ? (
          <span className={styles.proofStamp}>Payment verified locally</span>
        ) : null}
      </div>
      <p className={styles.termsSentence}>
        {alias ?? "The requester"} requests <strong>{amount} {token.symbol}</strong>
        {request.memo ? ` for “${request.memo}”.` : "."}
      </p>

      <div className={styles.addressProof}>
        {alias ? <strong>{alias}</strong> : null}
        <code>{request.requester}</code>
        <span>
          verify this address out-of-band before paying — requests are not
          sender-authenticated
        </span>
      </div>
      <p className={styles.riskCopy}>
        <strong>{amount} {token.symbol} moves now, privately.</strong>{" "}
        Anything else quoted is NOT settled by Quietline — you are trusting the
        counterparty. Not an atomic swap.
      </p>
      <p className={styles.sheetMeta}>
        {request.expiresAt === 0
          ? "No expiry"
          : `Expires ${new Date(request.expiresAt * 1_000).toLocaleString()}`}
        {" · "}Request {request.requestId.slice(0, 12)}…
      </p>

      {unverifiedClaim ? (
        <p className={styles.actionWarning}>
          The decrypted payment memo is an unverified counterparty claim. Its
          MessagePosted transaction does not prove that STRK moved.
        </p>
      ) : null}

      {!metadataConsistent ? (
        <p className={styles.actionWarning}>
          Quietline refuses this request: its STRK address has inconsistent
          token metadata.
        </p>
      ) : !isStrk ? (
        <p className={styles.actionWarning}>
          Non-STRK requests are display-only. Quietline v1 will not send this
          token.
        </p>
      ) : expired ? (
        <p className={styles.actionWarning}>This payment request has expired.</p>
      ) : null}

      {status === "requested" && !expired && !ignored ? (
        <div className={styles.sheetActions}>
          {canPay ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={onPay}
              disabled={busy}
            >
              {busy ? "Waiting for Ready…" : `Pay ${amount} STRK privately`}
            </button>
          ) : null}
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => setIgnored(true)}
            disabled={busy}
          >
            Ignore
          </button>
        </div>
      ) : null}
      {ignored ? (
        <p className={styles.inlineStatus}>Ignored in this view; no transfer was sent.</p>
      ) : null}
      {actionMessage ? (
        <p className={styles.inlineStatus} role="status">
          {actionMessage}
        </p>
      ) : null}
    </article>
  );
}
