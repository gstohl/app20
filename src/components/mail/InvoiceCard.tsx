import { useState } from "react";
import { feltEquals } from "@/lib/addresses";
import {
  formatBaseUnits,
  paymentRequestIsExpired,
  type PaymentRequestPayload,
  type PaymentStatus,
} from "@/lib/otc";
import { addrSTRK } from "@/utils/constants";
import styles from "./mail.module.css";

type InvoiceCardProps = {
  request: PaymentRequestPayload;
  alias?: string;
  status?: PaymentStatus;
  busy?: boolean;
  actionMessage?: string;
  onPay?: () => void;
};

export default function InvoiceCard({
  request,
  alias,
  status = "requested",
  busy = false,
  actionMessage,
  onPay,
}: InvoiceCardProps) {
  const [ignored, setIgnored] = useState(false);
  const amount = formatBaseUnits(request.amount, request.token.decimals);
  const isStrk = feltEquals(request.token.address, addrSTRK);
  const expired = status === "expired" || paymentRequestIsExpired(request);
  const canPay =
    status === "requested" && !expired && isStrk && !ignored && Boolean(onPay);

  return (
    <article className={`${styles.messageSheet} ${styles.dealSheet}`}>
      <div className={styles.sheetHeading}>
        <span className={styles.sheetType}>PAYMENT REQUEST / ONE-SIDED V1</span>
        {status === "paid" ? (
          <span className={styles.proofStamp}>Paid</span>
        ) : null}
      </div>
      <p className={styles.termsSentence}>
        {alias ?? "The requester"} requests <strong>{amount} {request.token.symbol}</strong>
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
        <strong>{amount} {request.token.symbol} moves now, privately.</strong>{" "}
        Anything else quoted is NOT settled by Quietline — you are trusting the
        counterparty. Not an atomic swap.
      </p>
      <p className={styles.sheetMeta}>
        {request.expiresAt === 0
          ? "No expiry"
          : `Expires ${new Date(request.expiresAt * 1_000).toLocaleString()}`}
        {" · "}Request {request.requestId.slice(0, 12)}…
      </p>

      {!isStrk ? (
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
