"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import Strk20CapabilityDiagnostic from "@/app/components/client/WalletHandle/Strk20CapabilityDiagnostic";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import InvoiceCard from "@/components/mail/InvoiceCard";
import styles from "@/components/mail/mail.module.css";
import { deriveKeypair } from "@/lib/mail";
import {
  inspectMailVault,
  unwrapMailSeed,
  type MailVaultKind,
} from "@/lib/mail-vault";
import {
  DEFAULT_PAYMENT_LINK_EXPIRY_HOURS,
  MAX_PAYMENT_LINK_EXPIRY_HOURS,
  createPaymentLinkRequest,
  createSignedPaymentLink,
  decodePaymentLink,
  encodePaymentLinkFragment,
  paymentLinkChainIdsEqual,
  paymentLinkNetworkLabel,
  type PaymentLinkAuthenticity,
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
  const [linkAuthenticity, setLinkAuthenticity] =
    useState<PaymentLinkAuthenticity>({ kind: "unsigned" });
  const [decodeError, setDecodeError] = useState("");
  const [mailVaultKind, setMailVaultKind] = useState<MailVaultKind>("missing");
  const [mailPassphrase, setMailPassphrase] = useState("");
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
  const [generatedLink, setGeneratedLink] = useState("");

  useEffect(() => {
    function decodeCurrentFragment() {
      const fragment = window.location.hash;
      const reviewing = fragment.length > 0;
      setHasFragment(reviewing);
      setPendingConflict(false);
      setHandoffError("");

      if (!reviewing) {
        setRequest(null);
        setLinkAuthenticity({ kind: "unsigned" });
        setDecodeError("");
        return;
      }

      try {
        const decoded = decodePaymentLink(fragment);
        setRequest(decoded.request);
        setLinkAuthenticity(decoded.authenticity);
        setDecodeError("");
      } catch (error: unknown) {
        setRequest(null);
        setLinkAuthenticity({ kind: "unsigned" });
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
      setMailVaultKind("missing");
      setMailPassphrase("");
      return;
    }

    try {
      setMailVaultKind(
        inspectMailVault(window.localStorage, chainId, address).kind,
      );
    } catch {
      setMailVaultKind("missing");
    }
  }, [address, chainId]);

  useEffect(() => {
    setGeneratedRequest(null);
    setGeneratedLink("");
    setCreateError("");
  }, [address, chainId, isStrk20Capable]);

  let readinessMessage: string;
  if (!isConnected || !address || !chainId) {
    readinessMessage =
      "No wallet is connected. Continue to the inbox, connect a privacy-enabled wallet, and load or register its device mail key before paying.";
  } else if (!isStrk20Capable) {
    readinessMessage =
      "The connected wallet does not expose the dapp-facing STRK20 API APP20 requires. No private payment can be submitted.";
  } else if (mailVaultKind === "missing") {
    readinessMessage =
      "This account is not onboarded in this browser. Continue to the inbox to create or restore and register its device mail key before paying.";
  } else {
    readinessMessage =
      "A mailbox vault exists in this browser profile. If it is passphrase-wrapped, unlock it in the inbox before paying. Clear the local mailbox when using a shared machine.";
  }

  let creatorReadiness: string;
  if (!isConnected || !address || !chainId) {
    creatorReadiness =
      "Connect the privacy-enabled wallet and network that should receive the private STRK payment.";
  } else if (isStrk20Capable && mailVaultKind === "missing") {
    creatorReadiness =
      "Create or restore this wallet's Mail identity in the inbox first. APP20 will not present a newly generated payment request as trustworthy without a Mail signature.";
  } else if (isStrk20Capable) {
    creatorReadiness =
      "Ready to create a Mail-signed request for the connected wallet. Generating and copying the link submits no transaction and costs no pool fee.";
  } else {
    creatorReadiness =
      "This wallet does not expose APP20's required dapp-facing STRK20 API. Link creation is disabled because the receiving account may not be ready for private STRK.";
  }

  function continueToInbox(replaceExisting = false) {
    if (!request) return;

    try {
      const existing = loadPendingPayment(window.sessionStorage);
      const conflicts =
        existing !== null &&
        encodePaymentLinkFragment(existing.request) !==
          encodePaymentLinkFragment(request);
      if (conflicts && !replaceExisting) {
        setPendingConflict(true);
        setHandoffError("");
        return;
      }

      storePendingPayment(window.sessionStorage, window.location.hash);
      setPendingConflict(false);
      void navigate({ to: "/mail/inbox" });
    } catch (error: unknown) {
      setHandoffError(
        error instanceof Error
          ? error.message
          : "APP20 could not save this request in the current tab.",
      );
    }
  }

  async function generatePaymentLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");

    if (!isConnected || !address || !chainId) {
      setGeneratedRequest(null);
      setGeneratedLink("");
      setCreateError(
        "Connect the wallet and network that should receive this payment.",
      );
      return;
    }
    if (!isStrk20Capable) {
      setGeneratedRequest(null);
      setGeneratedLink("");
      setCreateError(
        "The connected wallet is not exposing the STRK20 API APP20 requires.",
      );
      return;
    }

    let seed: Uint8Array | null = null;
    let mailbox: ReturnType<typeof deriveKeypair> | null = null;
    try {
      const vault = inspectMailVault(window.localStorage, chainId, address);
      if (vault.kind === "missing") {
        throw new Error(
          "Create or restore this wallet's Mail identity in the inbox before generating a signed link.",
        );
      }
      if (vault.kind === "passphrase" && !mailPassphrase) {
        throw new Error(
          "Enter the mailbox vault passphrase to sign this link.",
        );
      }
      seed =
        vault.kind === "plaintext"
          ? vault.seed
          : await unwrapMailSeed(vault.record, mailPassphrase);
      mailbox = deriveKeypair(seed);
      const created = createPaymentLinkRequest({
        amount,
        memo,
        expiryHours,
        requester: address,
        chainId,
      });
      const link = createSignedPaymentLink(
        created,
        window.location.origin,
        seed,
        mailbox.publicKey,
      );
      setGeneratedRequest(created);
      setGeneratedLink(link);
      setMailPassphrase("");
    } catch (error: unknown) {
      setGeneratedRequest(null);
      setGeneratedLink("");
      setCreateError(
        error instanceof Error
          ? error.message
          : "APP20 could not create this payment request.",
      );
    } finally {
      seed?.fill(0);
      mailbox?.privateKey.fill(0);
    }
  }

  function updateCreatorField(setter: (value: string) => void, value: string) {
    setter(value);
    setGeneratedRequest(null);
    setGeneratedLink("");
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
    <div className={`${styles.page} ${styles.payPage}`}>
      <main className={styles.shell}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>
            {hasFragment
              ? "APP20 / PAY / REVIEW"
              : "APP20 / PAY / REQUEST PRIVATE STRK"}
          </p>
          <h1>
            {hasFragment
              ? "Review before anything moves."
              : "Create a link. Move nothing yet."}
          </h1>
          <p>
            {hasFragment
              ? "APP20 verifies signed request terms in your browser. Legacy unsigned links remain visibly unverified. The URL fragment is not sent in an HTTP request."
              : "Create a Mail-signed STRK request without sending mail or touching the pool. The recipient address, amount, memo, expiry, and signer identity are visible to anyone who receives the link."}
          </p>
        </header>

        {hasFragment ? (
          request ? (
            <section
              className={styles.card}
              aria-labelledby="payment-link-title"
            >
              <p className={styles.kicker}>
                {linkAuthenticity.kind === "verified"
                  ? "MAIL SIGNATURE VERIFIED"
                  : "UNVERIFIED LEGACY LINK"}
              </p>
              <h2 id="payment-link-title" className={styles.cardTitle}>
                {linkAuthenticity.kind === "verified"
                  ? "Verified signed invoice"
                  : "Unsigned invoice — requester not verified"}
              </h2>
              <p
                className={
                  linkAuthenticity.kind === "verified"
                    ? styles.notice
                    : styles.actionWarning
                }
                role="status"
              >
                {linkAuthenticity.kind === "verified"
                  ? "The request's Mail signature is valid and covers its asset, exact amount, recipient, memo, expiry, and network. Confirm the displayed Mail identity belongs to the requester if you do not already know it."
                  : "Unverified legacy link: its checksum detects accidental damage but does not stop anyone from rewriting the terms. Verify every term with the requester through another channel."}
              </p>
              <p className={styles.notice} role="status">
                {readinessMessage}
              </p>
              {isConnected && !isStrk20Capable && strk20Capability ? (
                <Strk20CapabilityDiagnostic capability={strk20Capability} />
              ) : null}
              <InvoiceCard
                request={request}
                showPaymentActions={false}
                showShareAction={false}
                linkAuthenticity={linkAuthenticity}
              />
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
                Ask the requester for a fresh APP20 payment link and verify
                their full Starknet address through another channel.
              </p>
            </section>
          )
        ) : (
          <section
            className={styles.card}
            aria-labelledby="payment-link-create-title"
          >
            <p className={styles.kicker}>
              MAIL-SIGNED REQUEST / NO TRANSACTION
            </p>
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
                  The Mail signature will cover this full address and every
                  request term. It does not by itself prove that the Mail key
                  controls this wallet.
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
              {mailVaultKind === "passphrase" ? (
                <label className={`${styles.field} ${styles.paymentLinkWide}`}>
                  Mail vault passphrase
                  <input
                    value={mailPassphrase}
                    onChange={(event) => {
                      setMailPassphrase(event.target.value);
                      setGeneratedRequest(null);
                      setGeneratedLink("");
                      setCreateError("");
                    }}
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                  <small>
                    Used only in this browser to unlock the Mail signing key;
                    never included in the link.
                  </small>
                </label>
              ) : null}
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
                Shared links are reusable. APP20 cannot globally mark a signed
                link paid, so another browser or device can explicitly approve
                it again. Prefer an expiry and stop sharing fulfilled links.
              </p>
              <button
                className={`${styles.primaryButton} ${styles.paymentLinkWide}`}
                type="submit"
                disabled={
                  !isConnected ||
                  !address ||
                  !chainId ||
                  !isStrk20Capable ||
                  mailVaultKind === "missing"
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
                      READY TO SHARE / MAIL SIGNATURE VERIFIED
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
                  shareLinkOverride={generatedLink}
                  linkAuthenticity={
                    decodePaymentLink(new URL(generatedLink).hash).authenticity
                  }
                />
              </section>
            ) : null}
          </section>
        )}
      </main>

      <footer className={styles.footer}>
        <Link to="/mail/inbox">Open APP20 Mail</Link>
        <span>
          {hasFragment
            ? "No link can authorize or auto-submit a payment."
            : "Creating a link submits no transaction and spends no funds."}
        </span>
      </footer>
    </div>
  );
}
