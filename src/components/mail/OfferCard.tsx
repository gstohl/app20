import { addrSTRK } from "@/utils/constants";
import { feltEquals } from "@/lib/addresses";
import {
  formatBaseUnits,
  offerIsExpired,
  type DealStatus,
  type OfferPayload,
} from "@/lib/otc";
import styles from "./mail.module.css";

type OfferCardProps = {
  offer: OfferPayload;
  alias?: string;
  status?: DealStatus;
  busy?: boolean;
  actionMessage?: string;
  onAccept?: () => void;
  onDecline?: () => void;
  onPostReceipt?: () => void;
};

function expiryLabel(expiresAt: number): string {
  if (expiresAt === 0) return "No expiry";
  return `Expires ${new Date(expiresAt * 1_000).toLocaleString()}`;
}

export default function OfferCard({
  offer,
  alias,
  status = "offered",
  busy = false,
  actionMessage,
  onAccept,
  onDecline,
  onPostReceipt,
}: OfferCardProps) {
  const giveAmount = formatBaseUnits(offer.give.amount, offer.give.token.decimals);
  const wantAmount = formatBaseUnits(offer.want.amount, offer.want.token.decimals);
  const expired = status === "expired" || offerIsExpired(offer);
  const settlesStrk = feltEquals(offer.give.token.address, addrSTRK);
  const active = status === "offered" && !expired;
  const displayOfferer = alias ?? "The offerer";

  return (
    <article className={`${styles.messageSheet} ${styles.dealSheet}`}>
      <div className={styles.sheetHeading}>
        <span className={styles.sheetType}>OTC OFFER / ONE-SIDED V1</span>
        {status === "accepted" ? (
          <span className={styles.proofStamp}>Accepted</span>
        ) : status === "declined" ? (
          <span className={styles.proofStamp}>Declined</span>
        ) : status === "closed" ? (
          <span className={styles.proofStamp}>Paid</span>
        ) : null}
      </div>

      <p className={styles.termsSentence}>
        {displayOfferer} offers to buy <strong>{giveAmount} STRK</strong> from
        you for <strong>{wantAmount} {offer.want.token.symbol}</strong>.
      </p>

      <div className={styles.addressProof}>
        {alias ? <strong>{alias}</strong> : null}
        <code>{offer.offerer}</code>
        <span>verify this address out-of-band before accepting</span>
      </div>
      <p className={styles.authWarning}>
        Messages are not sender-authenticated in v1. The address above came
        from the encrypted offer payload.
      </p>

      <p className={styles.riskCopy}>
        <strong>{giveAmount} STRK moves now, privately.</strong> The {offer.want.token.symbol}
        {" "}leg is NOT settled by Quietline — you are trusting the counterparty.
        Not an atomic swap.
      </p>
      <p className={styles.sheetMeta}>
        {expiryLabel(offer.expiresAt)} · Deal {offer.dealId.slice(0, 12)}…
      </p>
      {offer.note ? <p className={styles.offerNote}>{offer.note}</p> : null}

      {!settlesStrk ? (
        <p className={styles.actionWarning}>
          Quietline refuses this offer: OTC v1 can settle only STRK on the give
          leg.
        </p>
      ) : expired ? (
        <p className={styles.actionWarning}>This offer has expired locally.</p>
      ) : null}

      {active && (onAccept || onDecline) ? (
        <div className={styles.sheetActions}>
          {onAccept ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={onAccept}
              disabled={busy || !settlesStrk}
            >
              {busy ? "Waiting for Ready…" : `Accept & send ${giveAmount} STRK`}
            </button>
          ) : null}
          {onDecline ? (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={onDecline}
              disabled={busy}
            >
              Decline
            </button>
          ) : null}
        </div>
      ) : null}

      {status === "accepted" && onPostReceipt ? (
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onPostReceipt}
          disabled={busy}
        >
          {busy ? "Posting receipt…" : "Post receipt"}
        </button>
      ) : null}
      {actionMessage ? (
        <p className={styles.inlineStatus} role="status">
          {actionMessage}
        </p>
      ) : null}
    </article>
  );
}
