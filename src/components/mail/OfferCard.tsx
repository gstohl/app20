import {
  formatBaseUnits,
  hasConsistentTokenMetadata,
  isCanonicalStrkToken,
  normalizeTokenRef,
  offerIsExpired,
  type DealStatus,
  type OfferPayload,
} from "@/lib/otc";
import styles from "./mail.module.css";

type OfferCardProps = {
  offer: OfferPayload;
  alias?: string;
  status?: DealStatus;
  settlementVerified?: boolean;
  unverifiedClaim?: boolean;
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
  settlementVerified = false,
  unverifiedClaim = false,
  busy = false,
  actionMessage,
  onAccept,
  onDecline,
  onPostReceipt,
}: OfferCardProps) {
  const giveToken = normalizeTokenRef(offer.give.token);
  const wantToken = normalizeTokenRef(offer.want.token);
  const giveAmount = formatBaseUnits(offer.give.amount, giveToken.decimals);
  const wantAmount = formatBaseUnits(offer.want.amount, wantToken.decimals);
  const expired = status === "expired" || offerIsExpired(offer);
  const metadataConsistent =
    hasConsistentTokenMetadata(offer.give.token) &&
    hasConsistentTokenMetadata(offer.want.token);
  const settlesStrk = isCanonicalStrkToken(offer.give.token);
  const active = status === "offered" && !expired;
  const displayOfferer = alias ?? "The offerer";

  return (
    <article className={`${styles.messageSheet} ${styles.dealSheet}`}>
      <div className={styles.sheetHeading}>
        <span className={styles.sheetType}>OTC OFFER / ONE-SIDED V1</span>
        {unverifiedClaim ||
        ((status === "accepted" || status === "closed") &&
          !settlementVerified) ? (
          <span className={styles.proofStamp}>
            Unverified counterparty claim
          </span>
        ) : status === "accepted" ? (
          <span className={styles.proofStamp}>Transfer verified locally</span>
        ) : status === "declined" ? (
          <span className={styles.proofStamp}>Declined</span>
        ) : status === "closed" ? (
          <span className={styles.proofStamp}>Receipt posted</span>
        ) : null}
      </div>

      <p className={styles.termsSentence}>
        {displayOfferer} offers to buy <strong>{giveAmount} STRK</strong> from
        you for <strong>{wantAmount} {wantToken.symbol}</strong>.
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
        <strong>{giveAmount} STRK moves now, privately.</strong> The {wantToken.symbol}
        {" "}leg is NOT settled by Quietline — you are trusting the counterparty.
        Not an atomic swap.
      </p>
      <p className={styles.sheetMeta}>
        {expiryLabel(offer.expiresAt)} · Deal {offer.dealId.slice(0, 12)}…
      </p>
      {offer.note ? <p className={styles.offerNote}>{offer.note}</p> : null}

      {unverifiedClaim ? (
        <p className={styles.actionWarning}>
          A decrypted memo or receipt is only an unverified counterparty claim.
          Its MessagePosted transaction does not prove that STRK moved.
        </p>
      ) : null}

      {!metadataConsistent ? (
        <p className={styles.actionWarning}>
          Quietline refuses this offer: its STRK address has inconsistent token
          metadata.
        </p>
      ) : !settlesStrk ? (
        <p className={styles.actionWarning}>
          Quietline refuses this offer: OTC v1 can settle only canonical STRK on
          the give leg.
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
              disabled={busy || !settlesStrk || !metadataConsistent}
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

      {status === "accepted" && settlementVerified && onPostReceipt ? (
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
