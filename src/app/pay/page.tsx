"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import Strk20CapabilityDiagnostic from "@/app/components/client/WalletHandle/Strk20CapabilityDiagnostic";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import InvoiceCard from "@/components/mail/InvoiceCard";
import styles from "@/components/mail/mail.module.css";
import { inspectMailVault } from "@/lib/mail-vault";
import {
  DEFAULT_PAYMENT_LINK_EXPIRY_HOURS,
  MAX_PAYMENT_LINK_EXPIRY_HOURS,
  createPaymentLinkRequest,
  decodePaymentLinkFragment,
  encodePaymentLinkFragment,
  paymentLinkChainIdsEqual,
  paymentLinkNetworkLabel,
} from "@/lib/payment-link";
import { loadPendingPayment, storePendingPayment } from "@/lib/pending-payment";
import { paymentRequestIsExpired, type PaymentRequestPayload } from "@/lib/otc";

export default function PayPage() {
  const navigate = useNavigate();
  const isConnected = useStoreWallet((state) => state.isConnected);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const strk20Capability = useStoreWallet((state) => state.strk20Capability);
  const address = useStoreWallet((state) => state.address);
  const chainId = useStoreWallet((state) => state.chain);
  const [hasFragment, setHasFragment] = useState(
    () => typeof window !== "undefined" && window.location.hash.length > 0,
  );
  const [request, setRequest] = useState<PaymentRequestPayload | null>(null);
  const [decodeError, setDecodeError] = useState("");
  const [hasLocalMailSeed, setHasLocalMailSeed] = useState(false);
  const [handoffError, setHandoffError] = useState("");
  const [pendingConflict, setPendingConflict] = useState(false);
  const [amount, setAmount] = useState("0.1");
  const [memo, setMemo] = useState("");
  const [expiryHours, setExpiryHours] = useState(
    DEFAULT_PAYMENT_LINK_EXPIRY_HOURS,
  );
  const [createError, setCreateError] = useState("");
  const [generatedRequest, setGeneratedRequest] =
    useState<PaymentRequestPayload | null>(null);

  useEffect(() => {
    function decodeCurrentFragment() {
      const fragment = window.location.hash;
      const reviewing = fragment.length > 0;
      setHasFragment(reviewing);
      setPendingConflict(false);
      setHandoffError("");

      if (!reviewing) {
        setRequest(null);
        setDecodeError("");
        return;
      }

      try {
        setRequest(decodePaymentLinkFragment(fragment));
        setDecodeError("");
      } catch (error: unknown) {
        setRequest(null);
        setDecodeError(
          error instanceof Error
            ? error.message
            : "This payment link is malformed.",
        );
      }
    }

    decodeCurrentFragment();
    window.addEventListener("hashchange", decodeCurrentFragment);
    return () =>
      window.removeEventListener("hashchange", decodeCurrentFragment);
  }, []);

  useEffect(() => {
    if (!address || !chainId) {
      setHasLocalMailSeed(false);
      return;
    }

    try {
      setHasLocalMailSeed(
        inspectMailVault(window.localStorage, chainId, address).kind !==
          "missing",
      );
    } catch {
      setHasLocalMailSeed(false);
    }
  }, [address, chainId]);

  useEffect(() => {
    setGeneratedRequest(null);
    setCreateError("");
  }, [address, chainId, isStrk20Capable]);

  let readinessMessage: string;
  if (!isConnected || !address || !chainId) {
    readinessMessage =
      "No wallet is connected. Continue to the inbox, connect a privacy-enabled wallet, and load or register its device mail key before paying.";
  } else if (!isStrk20Capable) {
    readinessMessage =
      "The connected wallet does not expose the dapp-facing STRK20 API VLT20 requires. No private payment can be submitted.";
  } else if (hasLocalMailSeed) {
    readinessMessage =
      "A mailbox vault exists in this browser profile. If it is passphrase-wrapped, unlock it in the inbox before paying. Clear the local mailbox when using a shared machine.";
  } else {
    readinessMessage =
      "This account is not onboarded in this browser. Continue to the inbox to create or restore and register its device mail key before paying.";
  }

  let creatorReadiness: string;
  if (!isConnected || !address || !chainId) {
    creatorReadiness =
      "Connect the privacy-enabled wallet and network that should receive the private STRK payment.";
  } else if (isStrk20Capable) {
    creatorReadiness =
      "Ready to create an unsigned request for the connected wallet. Generating and copying the link submits no transaction and costs no pool fee.";
  } else {
    creatorReadiness =
      "This wallet does not expose VLT20's required dapp-facing STRK20 API. Link creation is disabled because the receiving account may not be ready for private STRK.";
  }

  function continueToInbox(replaceExisting = false) {
    if (!request) return;

    try {
      const existing = loadPendingPayment(window.sessionStorage);
      const conflicts =
        existing !== null &&
        encodePaymentLinkFragment(existing) !==
          encodePaymentLinkFragment(request);
      if (conflicts && !replaceExisting) {
        setPendingConflict(true);
        setHandoffError("");
        return;
      }

      storePendingPayment(window.sessionStorage, request);
      setPendingConflict(false);
      void navigate({ to: "/mail/inbox" });
    } catch (error: unknown) {
      setHandoffError(
        error instanceof Error
          ? error.message
          : "VLT20 could not save this request in the current tab.",
      );
    }
  }

  function generatePaymentLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");

    if (!isConnected || !address || !chainId) {
      setGeneratedRequest(null);
      setCreateError(
        "Connect the wallet and network that should receive this payment.",
      );
      return;
    }
    if (!isStrk20Capable) {
      setGeneratedRequest(null);
      setCreateError(
        "The connected wallet is not exposing the STRK20 API VLT20 requires.",
      );
      return;
    }

    try {
      setGeneratedRequest(
        createPaymentLinkRequest({
          amount,
          memo,
          expiryHours,
          requester: address,
          chainId,
        }),
      );
    } catch (error: unknown) {
      setGeneratedRequest(null);
      setCreateError(
        error instanceof Error
          ? error.message
          : "VLT20 could not create this payment request.",
      );
    }
  }

  function updateCreatorField(setter: (value: string) => void, value: string) {
    setter(value);
    setGeneratedRequest(null);
    setCreateError("");
  }

  const expired = request ? paymentRequestIsExpired(request) : false;
  const wrongNetwork = Boolean(
    request?.chainId &&
      chainId &&
      !paymentLinkChainIdsEqual(request.chainId, chainId),
  );
  const requestedNetwork = request?.chainId
    ? paymentLinkNetworkLabel(request.chainId)
    : null;

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>
            {hasFragment
              ? "VLT20 / PAYMENT REVIEW"
              : "VLT20 / REQUEST PRIVATE STRK"}
          </p>
          <h1>
            {hasFragment
              ? "Review before anything moves."
              : "Create a link. Move nothing yet."}
          </h1>
          <p>
            {hasFragment
              ? "Payment links are unauthenticated instructions. VLT20 decodes this invoice only from the URL fragment in your browser; the fragment is not sent in an HTTP request."
              : "Create an unsigned STRK request without sending mail or touching the pool. The requester address, amount, memo, and expiry live in the URL fragment and are visible to anyone who receives the link."}
          </p>
        </header>

        {hasFragment ? (
          request ? (
            <section
              className={styles.card}
              aria-labelledby="payment-link-title"
            >
              <h2 id="payment-link-title" className={styles.cardTitle}>
                Unsigned invoice
              </h2>
              <p className={styles.notice} role="status">
                {readinessMessage}
              </p>
              {isConnected && !isStrk20Capable && strk20Capability ? (
                <Strk20CapabilityDiagnostic capability={strk20Capability} />
              ) : null}
              <InvoiceCard request={request} showPaymentActions={false} />
              <p className={styles.actionWarning}>
                Continuing stores this decoded request in this tab. It does not
                submit a payment. In the inbox, review it again and explicitly
                confirm through the normal wallet flow. Shield separately before
                paying; bundling a public shield with the transfer would
                correlate them.
              </p>
              {pendingConflict ? (
                <div className={styles.restoreWarning} role="alert">
                  <strong>Replace another pending payment link?</strong>
                  <p>
                    This tab already holds a different reviewed request.
                    Replacing it does not pay either request, but the earlier
                    handoff will no longer open automatically.
                  </p>
                  <button
                    className={styles.warningButton}
                    type="button"
                    onClick={() => continueToInbox(true)}
                  >
                    Replace pending request and continue
                  </button>
                </div>
              ) : (
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => continueToInbox(false)}
                  disabled={expired || wrongNetwork}
                >
                  {expired
                    ? "Expired request — payment disabled"
                    : wrongNetwork
                      ? `Switch wallet to ${requestedNetwork}`
                      : "Continue to inbox to review & pay"}
                </button>
              )}
              {handoffError ? (
                <p className={styles.actionWarning} role="alert">
                  {handoffError} No payment was sent.
                </p>
              ) : null}
            </section>
          ) : (
            <section
              className={styles.card}
              aria-labelledby="invalid-link-title"
            >
              <p className={styles.kicker}>LINK REJECTED</p>
              <h2 id="invalid-link-title" className={styles.cardTitle}>
                This invoice cannot be opened
              </h2>
              <p className={styles.actionWarning} role="alert">
                {decodeError || "Checking the payment-link fragment…"}
              </p>
              <p className={styles.copy}>
                Ask the requester for a fresh VLT20 payment link and verify
                their full Starknet address through another channel.
              </p>
            </section>
          )
        ) : (
          <section
            className={styles.card}
            aria-labelledby="payment-link-create-title"
          >
            <p className={styles.kicker}>UNSIGNED REQUEST / NO TRANSACTION</p>
            <h2 id="payment-link-create-title" className={styles.cardTitle}>
              Request private STRK
            </h2>
            <p className={styles.notice} role="status">
              {creatorReadiness}
            </p>
            {isConnected && !isStrk20Capable && strk20Capability ? (
              <Strk20CapabilityDiagnostic capability={strk20Capability} />
            ) : null}

            <form
              className={styles.paymentLinkForm}
              onSubmit={generatePaymentLink}
            >
              <div className={styles.paymentLinkAddress}>
                <strong>Requester address embedded in the link</strong>
                <code>{address || "Connect a wallet"}</code>
                <span>
                  The link is not signed. The payer must verify this full
                  address through another channel.
                </span>
              </div>
              <label className={styles.field}>
                STRK requested
                <input
                  value={amount}
                  onChange={(event) =>
                    updateCreatorField(setAmount, event.target.value)
                  }
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.1"
                  required
                />
                <small>Exact decimal amount; STRK has 18 decimal places.</small>
              </label>
              <label className={styles.field}>
                Expiry in hours
                <input
                  value={expiryHours}
                  onChange={(event) =>
                    updateCreatorField(setExpiryHours, event.target.value)
                  }
                  inputMode="numeric"
                  autoComplete="off"
                  required
                />
                <small>
                  0 means no expiry; maximum {MAX_PAYMENT_LINK_EXPIRY_HOURS}{" "}
                  hours.
                </small>
              </label>
              <label className={`${styles.field} ${styles.paymentLinkWide}`}>
                Memo (optional)
                <textarea
                  rows={3}
                  value={memo}
                  onChange={(event) =>
                    updateCreatorField(setMemo, event.target.value)
                  }
                  maxLength={512}
                  placeholder="What is this payment for?"
                />
                <small>
                  This memo is in the link, not encrypted. Do not put secrets
                  here.
                </small>
              </label>
              <p
                className={`${styles.actionWarning} ${styles.paymentLinkWide}`}
              >
                Shared links are reusable. VLT20 cannot globally mark an
                unsigned link paid, so another browser or device can explicitly
                approve it again. Prefer an expiry and stop sharing fulfilled
                links.
              </p>
              <button
                className={`${styles.primaryButton} ${styles.paymentLinkWide}`}
                type="submit"
                disabled={
                  !isConnected || !address || !chainId || !isStrk20Capable
                }
              >
                {generatedRequest
                  ? "Generate a fresh payment link"
                  : "Generate payment link"}
              </button>
            </form>

            {createError ? (
              <p className={styles.actionWarning} role="alert">
                {createError} No request was created.
              </p>
            ) : null}
            {generatedRequest ? (
              <section
                className={styles.paymentLinkPreview}
                aria-labelledby="payment-link-preview-title"
              >
                <div className={styles.paymentLinkPreviewHeading}>
                  <div>
                    <p className={styles.kicker}>
                      READY TO SHARE / STILL UNSIGNED
                    </p>
                    <h2 id="payment-link-preview-title">Review your link</h2>
                  </div>
                  <span>No transaction submitted</span>
                </div>
                <InvoiceCard
                  key={generatedRequest.requestId}
                  request={generatedRequest}
                  showPaymentActions={false}
                  shareInitiallyOpen
                />
              </section>
            ) : null}
          </section>
        )}
      </main>

      <footer className={styles.footer}>
        <Link to="/mail/inbox">Open Privacy Mail Vault</Link>
        <span>
          {hasFragment
            ? "No link can authorize or auto-submit a payment."
            : "Creating a link submits no transaction and spends no funds."}
        </span>
      </footer>
    </div>
  );
}
