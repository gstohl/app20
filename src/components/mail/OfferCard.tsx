import { canonicalizeStarknetAddress } from "@/lib/addresses";
import {
  formatBaseUnits,
  hasConsistentTokenMetadata,
  isCanonicalStrkToken,
  normalizeTokenRef,
  offerIsExpired,
  type DealStatus,
  type OfferPayload,
} from "@/lib/otc";
import { ProvingProgress } from "./OperationProgress";
import styles from "./mail.module.css";

type OfferCardProps = {
  offer: OfferPayload;
  alias?: string;
  status?: DealStatus;
  settlementVerified?: boolean;
  unverifiedClaim?: boolean;
  busy?: boolean;
  actionMessage?: string;
  actionStartedAt?: number;
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
  actionStartedAt,
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
  const claimedPaymentAddress = canonicalizeStarknetAddress(offer.offerer);

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
        This unsigned message offers to buy <strong>{giveAmount} STRK</strong>{" "}
        from you for <strong>{wantAmount} <bdi>{wantToken.symbol}</bdi></strong>.
      </p>

      <div className={styles.addressProof}>
        <strong>Claimed payment address</strong>
        <code>{claimedPaymentAddress}</code>
        {alias ? (
          <span>
            Local label: <bdi>{alias}</bdi> — not authenticated
          </span>
        ) : null}
        <span>verify this address out-of-band before accepting</span>
      </div>
      <p className={styles.authWarning}>
        Messages are not sender-authenticated in v1. The claimed payment
        address above came from the encrypted offer payload.
      </p>

      <p className={styles.riskCopy}>
        <strong>{giveAmount} STRK moves now, privately.</strong> The{" "}
        <bdi>{wantToken.symbol}</bdi> leg is NOT settled by Quietline — you are
        trusting the counterparty.
        Not an atomic swap.
      </p>
      <p className={styles.sheetMeta}>
        {expiryLabel(offer.expiresAt)} · Deal {offer.dealId.slice(0, 12)}…
      </p>
      {offer.note ? (
        <p className={styles.offerNote}>
          <bdi>{offer.note}</bdi>
        </p>
      ) : null}

      {unverifiedClaim ? (
        <p className={styles.actionWarning}>
          A decrypted memo or receipt is only an unverified counterparty claim.
          Its MessagePosted transaction does not prove that STRK moved.
        </p>
      ) : null}

      {metadataConsistent ? settlesStrk ? expired ? (
        <p className={styles.actionWarning}>This offer has expired locally.</p>
      ) : null : (
        <p className={styles.actionWarning}>
          Quietline refuses this offer: OTC v1 can settle only canonical STRK on
          the give leg.
        </p>
      ) : (
        <p className={styles.actionWarning}>
          Quietline refuses this offer: its STRK address has inconsistent token
          metadata.
        </p>
      )}

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
      <ProvingProgress
        active={busy}
        startedAt={actionStartedAt}
        label="Preparing private settlement action"
      />
      {actionMessage ? (
        <p className={styles.inlineStatus} role="status">
          {actionMessage}
        </p>
      ) : null}
    </article>
  );
}
