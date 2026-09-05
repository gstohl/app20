import { Link } from "@tanstack/react-router";
import EscrowCard from "@/components/mail/EscrowCard";
import InvoiceCard from "@/components/mail/InvoiceCard";
import OfferCard from "@/components/mail/OfferCard";
import ReceiptCard from "@/components/mail/ReceiptCard";
import { findAliasByAddress, type AliasRecord } from "@/lib/aliases";
import type { PaymentLinkAuthenticity } from "@/lib/payment-link";
import type { ChatRecord } from "./chat-model";
import styles from "./chat.module.css";

type RecordProps = {
  record: ChatRecord;
  /** This wallet issued the record. */
  own: boolean;
  aliases: readonly AliasRecord[];
  linkAuthenticity?: PaymentLinkAuthenticity;
};

/**
 * The complete Mailbox card for a record, read-only: every caveat Mailbox
 * prints is printed here, and no value action is offered from Chat.
 */
export function ChatRecordFull({
  record,
  own,
  aliases,
  linkAuthenticity,
}: RecordProps) {
  if (record.offer) {
    return (
      <OfferCard
        offer={record.offer}
        alias={findAliasByAddress(aliases, record.offer.offerer)?.label}
        status={record.deal?.status}
        settlementVerified={record.deal?.settlementVerified}
        unverifiedClaim={Boolean(
          record.deal?.counterpartyAcceptClaim ||
            record.deal?.counterpartyReceiptClaim,
        )}
      />
    );
  }
  if (record.request) {
    return (
      <InvoiceCard
        request={record.request}
        alias={findAliasByAddress(aliases, record.request.requester)?.label}
        status={record.payment?.status}
        paymentVerified={record.payment?.paymentVerified}
        unverifiedClaim={Boolean(record.payment?.counterpartyPaymentClaim)}
        showPaymentActions={false}
        showShareAction={false}
        linkAuthenticity={linkAuthenticity ?? record.payment?.linkAuthenticity}
      />
    );
  }
  if (record.fund) {
    return (
      <EscrowCard
        fund={record.fund}
        status={record.escrow?.chainStatus}
        termsVerified={record.escrowTermsVerified}
        ownDeal={own}
      />
    );
  }
  if (record.receipt) {
    return (
      <ReceiptCard
        receipt={record.receipt}
        standalonePayment={record.receiptKind === "payment"}
        locallySubmitted={own}
      />
    );
  }
  return null;
}

export default function ChatRecordCard({
  record,
  own,
  aliases,
  linkAuthenticity,
  defaultOpen = false,
}: RecordProps & { defaultOpen?: boolean }) {
  return (
    <article
      className={styles.recordCard}
      data-tone={record.facts.tone}
      aria-label={`${record.facts.title}: ${record.facts.terms}. ${record.facts.status}`}
    >
      <div className={styles.recordHead}>
        <span className={styles.recordTitle}>
          {record.facts.title} · {own ? "sent" : "received"}
        </span>
        <span className={styles.recordStatus}>{record.facts.status}</span>
      </div>
      <p className={styles.recordTerms}>{record.facts.terms}</p>
      {record.needsAction ? (
        <p className={styles.recordAction}>
          <span>{record.needsAction}</span>
          <Link to="/mail/inbox">Open Mailbox</Link>
        </p>
      ) : null}
      <details className={styles.recordDetails} open={defaultOpen || undefined}>
        <summary>Full record</summary>
        <div className={styles.recordFull}>
          <ChatRecordFull
            record={record}
            own={own}
            aliases={aliases}
            linkAuthenticity={linkAuthenticity}
          />
        </div>
      </details>
    </article>
  );
}
