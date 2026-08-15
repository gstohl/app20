import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { canonicalizeStarknetAddress } from "@/lib/addresses";
import {
  formatBaseUnits,
  hasConsistentTokenMetadata,
  isCanonicalStrkToken,
  normalizeTokenRef,
  paymentRequestIsExpired,
  type PaymentRequestPayload,
  type PaymentStatus,
} from "@/lib/otc";
import { createPaymentLink } from "@/lib/payment-link";
import { sanitizeUntrustedText } from "@/lib/text";
import { ProvingProgress } from "./OperationProgress";
import styles from "./mail.module.css";

type InvoiceCardProps = {
  request: PaymentRequestPayload;
  alias?: string;
  status?: PaymentStatus;
  paymentVerified?: boolean;
  unverifiedClaim?: boolean;
  busy?: boolean;
  actionMessage?: string;
  actionStartedAt?: number;
  showPaymentActions?: boolean;
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
  actionStartedAt,
  showPaymentActions = true,
  onPay,
}: InvoiceCardProps) {
  const [ignored, setIgnored] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  let token = request.token;
  try {
    token = normalizeTokenRef(request.token);
  } catch {
    // Keep hostile metadata display-only; the warnings below disable actions.
  }
  const amount = formatBaseUnits(request.amount, token.decimals);
  const metadataConsistent = hasConsistentTokenMetadata(request.token);
  const isStrk = isCanonicalStrkToken(request.token);
  const expired = status === "expired" || paymentRequestIsExpired(request);
  const memo =
    request.memo === undefined
      ? undefined
      : sanitizeUntrustedText(request.memo).slice(0, 512);
  let claimedPaymentAddress: string | null = null;
  try {
    claimedPaymentAddress = canonicalizeStarknetAddress(request.requester);
  } catch {
    // An invalid requester is shown as invalid and can never reach an action.
  }
  const canPay =
    status === "requested" &&
    !expired &&
    isStrk &&
    claimedPaymentAddress !== null &&
    !ignored &&
    Boolean(onPay);
  const canShare = isStrk && claimedPaymentAddress !== null;

  function toggleShareLink() {
    if (shareOpen) {
      setShareOpen(false);
      return;
    }

    try {
      const link =
        shareLink || createPaymentLink(request, window.location.origin);
      setShareLink(link);
      setShareMessage("");
      setShareOpen(true);
    } catch (error: unknown) {
      setShareMessage(
        error instanceof Error
          ? error.message
          : "Quietline could not create this payment link.",
      );
    }
  }

  async function copyPaymentLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setShareMessage("Payment link copied.");
    } catch {
      setShareMessage("Clipboard access failed. Copy the full link below.");
    }
  }

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
        This unsigned message requests <strong>{amount} <bdi>{token.symbol}</bdi></strong>
        {memo ? (
          <> for “<bdi>{memo}</bdi>”.</>
        ) : (
          "."
        )}
      </p>

      <div className={styles.addressProof}>
        <strong>Claimed payment address</strong>
        <code>{claimedPaymentAddress ?? "Invalid Starknet address"}</code>
        {alias ? (
          <span>
            Local label: <bdi>{alias}</bdi> — not authenticated
          </span>
        ) : null}
        <span>
          verify this address out-of-band before paying — requests are not
          sender-authenticated
        </span>
      </div>
      <p className={styles.riskCopy}>
        <strong>{amount} <bdi>{token.symbol}</bdi> moves now, privately.</strong>{" "}
        Anything else quoted is NOT settled by Quietline — you are trusting the
        counterparty. Not an atomic swap.
      </p>
      <p className={styles.sheetMeta}>
        {request.expiresAt === 0
          ? "No expiry"
          : `Expires ${new Date(request.expiresAt * 1_000).toLocaleString()}`}
        {" · "}Request {request.requestId.slice(0, 12)}…
      </p>

      <div className={styles.sheetActions}>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={toggleShareLink}
          disabled={!canShare}
          aria-expanded={shareOpen}
        >
          {shareOpen ? "Hide payment link" : "Share payment link"}
        </button>
      </div>
      {shareOpen && shareLink ? (
        <div className={styles.addressProof}>
          <strong>Unsigned payment link</strong>
          <QRCodeSVG
            value={shareLink}
            size={220}
            level="L"
            boostLevel
            marginSize={4}
            title="QR code for this Quietline payment link"
            aria-label="QR code for this Quietline payment link"
            style={{ alignSelf: "center", maxWidth: "100%", height: "auto" }}
          />
          <code>{shareLink}</code>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void copyPaymentLink()}
          >
            Copy payment link
          </button>
          <span>
            This link contains only the invoice fields shown here. It is not
            authenticated; verify the full requester address out-of-band.
          </span>
        </div>
      ) : null}
      {shareMessage ? (
        <p className={styles.inlineStatus} role="status">
          {shareMessage}
        </p>
      ) : null}

      {unverifiedClaim ? (
        <p className={styles.actionWarning}>
          The decrypted payment memo is an unverified counterparty claim. Its
          MessagePosted transaction does not prove that STRK moved.
        </p>
      ) : null}

      {claimedPaymentAddress ? metadataConsistent ? isStrk ? expired ? (
        <p className={styles.actionWarning}>This payment request has expired.</p>
      ) : null : (
        <p className={styles.actionWarning}>
          Non-STRK requests are display-only. Quietline v1 will not send this
          token.
        </p>
      ) : (
        <p className={styles.actionWarning}>
          Quietline refuses this request: its STRK address has inconsistent
          token metadata.
        </p>
      ) : (
        <p className={styles.actionWarning}>
          Quietline refuses this request: its requester is not a bounded
          Starknet address.
        </p>
      )}

      {showPaymentActions && status === "requested" && !expired && !ignored ? (
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
      <ProvingProgress
        active={busy}
        startedAt={actionStartedAt}
        label="Preparing private payment action"
      />
      {actionMessage ? (
        <p className={styles.inlineStatus} role="status">
          {actionMessage}
        </p>
      ) : null}
    </article>
  );
}
