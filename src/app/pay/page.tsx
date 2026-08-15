"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import SelectWallet from "@/app/components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import InvoiceCard from "@/components/mail/InvoiceCard";
import styles from "@/components/mail/mail.module.css";
import { MAIL_SEED_STORAGE_PREFIX } from "@/lib/local-mailbox-storage";
import {
  decodePaymentLinkFragment,
} from "@/lib/payment-link";
import { storePendingPayment } from "@/lib/pending-payment";
import {
  paymentRequestIsExpired,
  type PaymentRequestPayload,
} from "@/lib/otc";

export default function PayPage() {
  const navigate = useNavigate();
  const isConnected = useStoreWallet((state) => state.isConnected);
  const isStrk20Capable = useStoreWallet((state) => state.isStrk20Capable);
  const address = useStoreWallet((state) => state.address);
  const chainId = useStoreWallet((state) => state.chain);
  const [request, setRequest] = useState<PaymentRequestPayload | null>(null);
  const [decodeError, setDecodeError] = useState("");
  const [hasLocalMailSeed, setHasLocalMailSeed] = useState(false);
  const [handoffError, setHandoffError] = useState("");

  useEffect(() => {
    function decodeCurrentFragment() {
      try {
        setRequest(decodePaymentLinkFragment(window.location.hash));
        setDecodeError("");
        setHandoffError("");
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
    return () => window.removeEventListener("hashchange", decodeCurrentFragment);
  }, []);

  useEffect(() => {
    if (!address || !chainId) {
      setHasLocalMailSeed(false);
      return;
    }

    try {
      setHasLocalMailSeed(
        window.localStorage.getItem(
          `${MAIL_SEED_STORAGE_PREFIX}/${chainId}/${address}`,
        ) !== null,
      );
    } catch {
      setHasLocalMailSeed(false);
    }
  }, [address, chainId]);

  let readinessMessage: string;
  if (!isConnected || !address || !chainId) {
    readinessMessage =
      "Ready is not connected. Continue to the inbox, connect a STRK20-capable wallet, and load or register its device mail key before paying.";
  } else if (!isStrk20Capable) {
    readinessMessage =
      "The connected wallet does not declare STRK20 Wallet API 0.10 support. Quietline cannot make this private payment with it.";
  } else if (hasLocalMailSeed) {
    readinessMessage =
      "A raw, unencrypted mailbox seed exists in this browser profile. The inbox will still require it to match the public registration before payment. Clear the local mailbox when using a shared machine.";
  } else {
    readinessMessage =
      "This account is not onboarded in this browser. Continue to the inbox to create or restore and register its device mail key before paying.";
  }

  function continueToInbox() {
    if (!request) return;

    try {
      storePendingPayment(window.sessionStorage, request);
      void navigate({ to: "/inbox" });
    } catch (error: unknown) {
      setHandoffError(
        error instanceof Error
          ? error.message
          : "Quietline could not save this request in the current tab.",
      );
    }
  }

  const expired = request ? paymentRequestIsExpired(request) : false;

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Link className={styles.brand} to="/" aria-label="Quietline home">
          <span className={styles.brandMark}>Q</span>
          <span>Quietline</span>
        </Link>
        <div className={styles.navRight}>
          <span className={styles.network}>PAYMENT LINK / UNSIGNED</span>
          <SelectWallet variant="nav" />
        </div>
      </nav>

      <main className={styles.shell}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>QUIETLINE / PAYMENT REVIEW</p>
          <h1>Review before anything moves.</h1>
          <p>
            Payment links are unauthenticated instructions. Quietline decodes
            this invoice only from the URL fragment in your browser; the
            fragment is not sent in an HTTP request.
          </p>
        </header>

        {request ? (
          <section className={styles.card} aria-labelledby="payment-link-title">
            <h2 id="payment-link-title" className={styles.cardTitle}>
              Unsigned invoice
            </h2>
            <p className={styles.notice} role="status">
              {readinessMessage}
            </p>
            <InvoiceCard request={request} showPaymentActions={false} />
            <p className={styles.actionWarning}>
              Continuing stores this decoded request in this tab. It does not
              submit a payment. In the inbox, review it again and explicitly
              confirm through the normal wallet flow.
            </p>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={continueToInbox}
              disabled={expired}
            >
              {expired
                ? "Expired request — payment disabled"
                : "Continue to inbox to review & pay"}
            </button>
            {handoffError ? (
              <p className={styles.actionWarning} role="alert">
                {handoffError} No payment was sent.
              </p>
            ) : null}
          </section>
        ) : (
          <section className={styles.card} aria-labelledby="invalid-link-title">
            <p className={styles.kicker}>LINK REJECTED</p>
            <h2 id="invalid-link-title" className={styles.cardTitle}>
              This invoice cannot be opened
            </h2>
            <p className={styles.actionWarning} role="alert">
              {decodeError || "Checking the payment-link fragment…"}
            </p>
            <p className={styles.copy}>
              Ask the requester for a fresh Quietline payment link and verify
              their full Starknet address through another channel.
            </p>
          </section>
        )}
      </main>

      <footer className={styles.footer}>
        <Link to="/inbox">Open inbox without this request</Link>
        <span>No link can authorize or auto-submit a payment.</span>
      </footer>
    </div>
  );
}
