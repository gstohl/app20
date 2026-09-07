import { pendingValueLabel } from "@/lib/value-operation-presentation";
import { CHAT_ONE_SIDED_ACCEPT_ENABLED } from "@app20/domain";
import type { ValueOperationState } from "@/lib/otc";
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
import styles from "./chat.module.css";

type OfferCardProps = {
  offer: OfferPayload;
  own?: boolean;
  alias?: string;
  status?: DealStatus;
  settlementVerified?: boolean;
  unverifiedClaim?: boolean;
  operationState?: ValueOperationState;
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
  own = false,
  alias,
  status = "offered",
  settlementVerified = false,
  unverifiedClaim = false,
  operationState,
  busy = false,
  actionMessage,
  actionStartedAt,
  onAccept,
  onDecline,
  onPostReceipt,
}: OfferCardProps) {
  const pendingLabel = pendingValueLabel(operationState, "Transfer");
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
  const headingId = `offer-${offer.dealId.slice(2)}`;

  return (
    <article
      className={`${styles.messageSheet} ${styles.dealSheet}`}
      aria-labelledby={headingId}
    >
      <div className={styles.sheetHeading}>
        <h3 id={headingId} className={styles.sheetType}>
          <span aria-hidden="true">SWAP OFFER</span>
          <span className={styles.srOnly}>
            OTC offer: send {giveAmount} STRK
          </span>
        </h3>
        {pendingLabel ? (
          <span className={styles.proofStamp} role="status">{pendingLabel}</span>
        ) : unverifiedClaim ||
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

      <dl className={styles.tradeSummary}>
        <div><dt>{own ? "Counterparty sends" : settlementVerified ? "You sent" : "You send"}</dt>
          <dd>{giveAmount} STRK</dd></div>
        <div><dt>{own ? "You offer" : "You’re offered"}</dt>
          <dd>{wantAmount} <bdi>{wantToken.symbol}</bdi></dd>
          <small>Both assets require confidential escrow settlement</small></div>
      </dl>
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
      <details className={styles.explanation}>
        <summary>Address verification &amp; receipt details</summary>
        <p>Messages are not sender-authenticated in v1. The claimed payment address
          above came from the encrypted offer payload.</p>
        <p>New swaps require the confidential escrow and approval from both sides.
          For an earlier payment whose receipt is missing, “Post receipt” only sends
          the encrypted receipt and never repeats the payment.</p>
      </details>
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

      {metadataConsistent ? (
        settlesStrk ? (
          expired ? (
            <p className={styles.actionWarning}>
              This offer has expired locally.
            </p>
          ) : null
        ) : (
          <p className={styles.actionWarning}>
            Chat refuses this offer: OTC v1 can settle only canonical STRK
            on the give leg.
          </p>
        )
      ) : (
        <p className={styles.actionWarning}>
          Chat refuses this offer: its STRK address has inconsistent token
          metadata.
        </p>
      )}

      <p className={styles.riskCopy}>
        {settlementVerified ? "An earlier one-sided STRK payment was verified locally; it does not prove that both assets were exchanged." : "This offer is for review. Settlement requires a confidential atomic swap; compatible wallet support is still pending."}
      </p>
      {active ? <p className={styles.actionWarning}>
        <a href="/rfq/confidential">Confidential swap availability →</a>
      </p> : null}

      {active && (onAccept || onDecline) ? (
        <div className={styles.sheetActions}>
          {onAccept && CHAT_ONE_SIDED_ACCEPT_ENABLED ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={onAccept}
              disabled={busy || !settlesStrk || !metadataConsistent}
            >
              {busy
                ? "Waiting for wallet…"
                : `Accept & send ${giveAmount} STRK`}
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
        <div>
        <p className={styles.actionWarning} role="status">
          Payment complete. Only the receipt remains. Posting it will not send the payment again.
        </p>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onPostReceipt}
          disabled={busy}
        >
          {busy ? "Posting receipt…" : "Post receipt"}
        </button>
        </div>
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
