"use client";

import type { DecodedMail } from "@/lib/envelope";
import type { AliasRecord } from "@/lib/aliases";
import { findAliasByAddress } from "@/lib/aliases";
import { feltEquals } from "@/lib/addresses";
import {
  formatBaseUnits,
  parseAcceptPayload,
  parseDeclinePayload,
  parseOfferPayload,
  parsePaymentRequestPayload,
  parseReceiptPayload,
  type OfferPayload,
  type OtcState,
  type PaymentRequestPayload,
} from "@/lib/otc";
import InvoiceCard from "./InvoiceCard";
import OfferCard from "./OfferCard";
import ReceiptCard from "./ReceiptCard";
import styles from "./mail.module.css";

export type LocalMailMessage = {
  id: string;
  index: string;
  plaintext: string;
  envelope: DecodedMail;
  transactionHash: string;
  blockNumber?: number;
  eventIndex?: number;
};

export type ThreadActionState = {
  pending: boolean;
  message?: string;
};

type ThreadProps = {
  messages: LocalMailMessage[];
  canScan: boolean;
  scanning: boolean;
  scanMessage: string;
  selfAddress: string;
  aliases: AliasRecord[];
  otcState: OtcState;
  actionStates: Record<string, ThreadActionState>;
  onScan: () => void;
  onAccept: (offer: OfferPayload, offerIndex?: number) => void;
  onDecline: (offer: OfferPayload) => void;
  onPostReceipt: (offer: OfferPayload) => void;
  onPay: (request: PaymentRequestPayload) => void;
};

function safeOfferIndex(index: string): number | undefined {
  const value = Number(index);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function UnsupportedMessage() {
  return (
    <article className={styles.messageSheet}>
      <span className={styles.sheetType}>UNSUPPORTED</span>
      <p className={styles.termsSentence}>unsupported message</p>
    </article>
  );
}

export default function Thread({
  messages,
  canScan,
  scanning,
  scanMessage,
  selfAddress,
  aliases,
  otcState,
  actionStates,
  onScan,
  onAccept,
  onDecline,
  onPostReceipt,
  onPay,
}: ThreadProps) {
  function renderEnvelope(message: LocalMailMessage) {
    const { envelope } = message;
    if (envelope.type === "unsupported") return <UnsupportedMessage />;

    if (envelope.type === "text") {
      return (
        <article className={styles.messageSheet}>
          <span className={styles.sheetType}>
            {envelope.version === 0 ? "LEGACY LETTER" : "PRIVATE LETTER"}
          </span>
          <p className={styles.letterBody}>{message.plaintext}</p>
        </article>
      );
    }

    if (envelope.type === "offer") {
      const offer = parseOfferPayload(envelope.payload);
      if (!offer) return <UnsupportedMessage />;
      const deal = otcState.deals[offer.dealId];
      const action = actionStates[`deal:${offer.dealId}`];
      const ownOffer = feltEquals(selfAddress, offer.offerer);
      return (
        <OfferCard
          offer={offer}
          alias={findAliasByAddress(aliases, offer.offerer)?.label}
          status={deal?.status}
          busy={action?.pending}
          actionMessage={action?.message}
          onAccept={ownOffer ? undefined : () => onAccept(offer, safeOfferIndex(message.index))}
          onDecline={ownOffer ? undefined : () => onDecline(offer)}
          onPostReceipt={
            ownOffer || deal?.status !== "accepted"
              ? undefined
              : () => onPostReceipt(offer)
          }
        />
      );
    }

    if (envelope.type === "accept") {
      const accept = parseAcceptPayload(envelope.payload);
      if (!accept) return <UnsupportedMessage />;
      const isPayment = Boolean(otcState.payments[accept.dealId]);
      return (
        <article className={styles.messageSheet}>
          <div className={styles.sheetHeading}>
            <span className={styles.sheetType}>
              {isPayment ? "PAYMENT MEMO" : "OTC ACCEPT MEMO"}
            </span>
            <span className={styles.proofStamp}>
              {isPayment ? "Paid" : "Accepted"}
            </span>
          </div>
          <p className={styles.termsSentence}>
            {isPayment ? "Paid" : "Accepted"}{" "}
            {formatBaseUnits(accept.transfer.amount, accept.transfer.token.decimals)}{" "}
            {accept.transfer.token.symbol} for {isPayment ? "request" : "deal"}{" "}
            {accept.dealId.slice(0, 12)}…
          </p>
          <p className={styles.riskCopy}>
            This memo reports only the private STRK leg. It does not prove any
            quoted non-STRK consideration or counterparty identity.
          </p>
        </article>
      );
    }

    if (envelope.type === "decline") {
      const decline = parseDeclinePayload(envelope.payload);
      if (!decline) return <UnsupportedMessage />;
      return (
        <article className={styles.messageSheet}>
          <div className={styles.sheetHeading}>
            <span className={styles.sheetType}>OTC RESPONSE</span>
            <span className={styles.proofStamp}>Declined</span>
          </div>
          <p className={styles.termsSentence}>
            Deal {decline.dealId.slice(0, 12)}… was declined.
          </p>
          {decline.reason ? <p className={styles.offerNote}>{decline.reason}</p> : null}
        </article>
      );
    }

    if (envelope.type === "receipt") {
      const receipt = parseReceiptPayload(envelope.payload);
      if (!receipt) return <UnsupportedMessage />;
      return (
        <ReceiptCard
          receipt={receipt}
          wantSymbol={otcState.deals[receipt.dealId]?.offer.want.token.symbol}
        />
      );
    }

    const request = parsePaymentRequestPayload(envelope.payload);
    if (!request) return <UnsupportedMessage />;
    const payment = otcState.payments[request.requestId];
    const action = actionStates[`payment:${request.requestId}`];
    const ownRequest = feltEquals(selfAddress, request.requester);
    return (
      <InvoiceCard
        request={request}
        alias={findAliasByAddress(aliases, request.requester)?.label}
        status={payment?.status}
        busy={action?.pending}
        actionMessage={action?.message}
        onPay={ownRequest ? undefined : () => onPay(request)}
      />
    );
  }

  return (
    <section className={`${styles.card} ${styles.threadCard}`}>
      <div className={styles.threadHeading}>
        <div>
          <p className={styles.kicker}>LOCAL PLAINTEXT ONLY</p>
          <h2 className={styles.cardTitle}>Inbox</h2>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onScan}
          disabled={!canScan || scanning}
        >
          {scanning ? "Scanning…" : "Scan public events"}
        </button>
      </div>

      <p className={styles.copy}>
        Quietline downloads public ciphertext events and trial-decrypts them in
        this tab. Typed letters, offers, responses, receipts, and invoices are
        rendered as paper sheets. Aliases and deal state stay in this browser;
        clearing site data wipes them.
      </p>

      {scanMessage ? (
        <p className={styles.scanMessage} role="status">
          {scanMessage}
        </p>
      ) : null}

      {messages.length ? (
        <ol className={styles.threadList}>
          {messages.map((message) => (
            <li className={styles.message} key={message.id}>
              <div className={styles.messageMeta}>
                <span>Message #{message.index}</span>
                <span>
                  {message.blockNumber === undefined
                    ? "confirmed event"
                    : `block ${message.blockNumber}`}
                </span>
              </div>
              {renderEnvelope(message)}
              <span className={styles.localLabel}>decrypted on this device</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.emptyState}>
          <strong>No locally decrypted mail yet.</strong>
          <span>
            Load this device&apos;s key, then scan after someone sends to that
            registered public key.
          </span>
        </div>
      )}
    </section>
  );
}
