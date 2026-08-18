import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
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
import {
  createPaymentLink,
  normalizePaymentLinkChainId,
  paymentLinkChainIdsEqual,
  paymentLinkNetworkLabel,
} from "@/lib/payment-link";
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
  shareInitiallyOpen?: boolean;
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
  shareInitiallyOpen = false,
  onPay,
}: InvoiceCardProps) {
  const connectedChainId = useStoreWallet((state) => state.chain);
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
  let shareChainId: string | null = null;
  try {
    const candidate = request.chainId ?? connectedChainId;
    shareChainId = candidate ? normalizePaymentLinkChainId(candidate) : null;
  } catch {
    // A link is never created for an unsupported or unknown network.
  }
  let requestNetwork: string | null = null;
  try {
    const candidate = request.chainId ?? shareChainId;
    requestNetwork = candidate ? paymentLinkNetworkLabel(candidate) : null;
  } catch {
    // Hostile mailbox metadata stays display-only and cannot be shared or paid.
  }
  const networkMismatch = Boolean(
    request.chainId &&
      connectedChainId &&
      !paymentLinkChainIdsEqual(request.chainId, connectedChainId),
  );
  const canPay =
    status === "requested" &&
    !expired &&
    !networkMismatch &&
    isStrk &&
    claimedPaymentAddress !== null &&
    !ignored &&
    Boolean(onPay);
  const canShare =
    isStrk && claimedPaymentAddress !== null && shareChainId !== null;

  function requestForLink(): PaymentRequestPayload {
    if (!shareChainId) {
      throw new Error("Connect a supported Starknet network before sharing.");
    }
    return { ...request, chainId: shareChainId };
  }

  useEffect(() => {
    setShareLink("");
    setShareOpen(false);
    setShareMessage("");
  }, [
    request.amount,
    request.expiresAt,
    request.memo,
    request.requestId,
    request.requester,
    shareChainId,
  ]);

  useEffect(() => {
    if (!shareInitiallyOpen || !canShare) return;
    try {
      setShareLink(createPaymentLink(requestForLink(), window.location.origin));
      setShareMessage("");
      setShareOpen(true);
    } catch (error: unknown) {
      setShareMessage(
        error instanceof Error
          ? error.message
          : "Quietline could not create this payment link.",
      );
    }
  }, [canShare, request, shareChainId, shareInitiallyOpen]);

  function toggleShareLink() {
    if (shareOpen) {
      setShareOpen(false);
      return;
    }

    try {
      const link =
        shareLink ||
        createPaymentLink(requestForLink(), window.location.origin);
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

  const headingId = `invoice-${request.requestId.slice(2)}`;

  return (
    <article
      className={`${styles.messageSheet} ${styles.dealSheet}`}
      aria-labelledby={headingId}
    >
      <div className={styles.sheetHeading}>
        <h3 id={headingId} className={styles.sheetType}>
          <span aria-hidden="true">PAYMENT REQUEST / ONE-SIDED V1</span>
          <span className={styles.srOnly}>
            Payment request: {amount} {token.symbol}
          </span>
        </h3>
        {unverifiedClaim || (status === "paid" && !paymentVerified) ? (
          <span className={styles.proofStamp}>
            Unverified counterparty claim
          </span>
        ) : status === "paid" ? (
          <span className={styles.proofStamp}>Payment verified locally</span>
        ) : null}
      </div>
      <p className={styles.termsSentence}>
        This unsigned message requests{" "}
        <strong>
          {amount} <bdi>{token.symbol}</bdi>
        </strong>
        {memo ? (
          <>
            {" "}
            for “<bdi>{memo}</bdi>”.
          </>
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
        <strong>
          {amount} <bdi>{token.symbol}</bdi> moves now, privately.
        </strong>{" "}
        Anything else quoted is NOT settled by Quietline — you are trusting the
        counterparty. Not an atomic swap.
      </p>
      <p className={styles.sheetMeta}>
        {request.expiresAt === 0
          ? "No expiry"
          : `Expires ${new Date(request.expiresAt * 1_000).toLocaleString()}`}
        {requestNetwork ? ` · ${requestNetwork}` : " · Network unavailable"}
        {" · "}Request {request.requestId.slice(0, 12)}…
      </p>
      {networkMismatch ? (
        <p className={styles.actionWarning}>
          This request is for {requestNetwork}. Switch the connected wallet to
          that network before paying. Quietline will not submit it on the wrong
          chain.
        </p>
      ) : null}
      {canShare ? (
        <p className={styles.actionWarning}>
          Quietline does not globally mark an unsigned link paid. Local status
          blocks a repeat only for this account in this browser profile; another
          device can explicitly approve the same link again.
        </p>
      ) : null}

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
            This link contains only the invoice fields shown here and is bound
            to {requestNetwork}. It is not authenticated; verify the full
            requester address out-of-band.
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

      {claimedPaymentAddress ? (
        metadataConsistent ? (
          isStrk ? (
            expired ? (
              <p className={styles.actionWarning}>
                This payment request has expired.
              </p>
            ) : null
          ) : (
            <p className={styles.actionWarning}>
              Non-STRK requests are display-only. Quietline v1 will not send
              this token.
            </p>
          )
        ) : (
          <p className={styles.actionWarning}>
            Quietline refuses this request: its STRK address has inconsistent
            token metadata.
          </p>
        )
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
              {busy ? "Waiting for wallet…" : `Pay ${amount} STRK privately`}
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
        <p className={styles.inlineStatus}>
          Ignored in this view; no transfer was sent.
        </p>
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
