import { useEffect, useState } from "react";
import EscrowCard from "@/components/mail/EscrowCard";
import InvoiceCard from "@/components/mail/InvoiceCard";
import OfferCard from "@/components/mail/OfferCard";
import ReceiptCard from "@/components/mail/ReceiptCard";
import type { ThreadActionState } from "@/components/mail/message";
import { feltEquals } from "@/lib/addresses";
import { findAliasByAddress, type AliasRecord } from "@/lib/aliases";
import type { EscrowFundPayload } from "@/lib/escrow";
import {
  invoicePaymentMaturity,
  type OfferPayload,
  type PaymentRequestPayload,
} from "@/lib/otc";
import type { PaymentLinkAuthenticity } from "@/lib/payment-link";
import type { ChatRecord } from "./chat-model";
import styles from "./chat.module.css";

/**
 * The value actions a record can offer, exactly as the mailbox desk exposes
 * them. A missing handler means the action does not exist on this rail; the
 * card decides from ownership and record state whether to show the rest.
 */
export type ChatRecordActions = Readonly<{
  selfAddress: string;
  actionStates: Readonly<Record<string, ThreadActionState>>;
  invoiceMaturityHeadBlock?: number;
  /** The mailbox index of the record an offer arrived in. */
  offerIndex?: number;
  onAccept?: (offer: OfferPayload, offerIndex?: number) => void;
  onDecline?: (offer: OfferPayload) => void;
  onPostReceipt?: (offer: OfferPayload) => void;
  onPay?: (request: PaymentRequestPayload) => void;
  onPayPrivatelyWithStrk?: (request: PaymentRequestPayload) => void;
  onEscrowFill?: (fund: EscrowFundPayload) => void;
  onEscrowClaim?: (fund: EscrowFundPayload) => void;
  onEscrowTimeout?: (fund: EscrowFundPayload) => void;
}>;

type RecordProps = {
  record: ChatRecord;
  aliases: readonly AliasRecord[];
  linkAuthenticity?: PaymentLinkAuthenticity;
  actions?: ChatRecordActions;
};

/**
 * The complete card for a record with every caveat and, when the desk offers
 * one, its action. Ownership comes from the payload, never from the sender.
 */
export function ChatRecordFull({
  record,
  aliases,
  linkAuthenticity,
  actions,
}: RecordProps) {
  const self = actions?.selfAddress ?? "";
  if (record.offer) {
    const { offer, deal } = record;
    const ownOffer = Boolean(self) && feltEquals(self, offer.offerer);
    const action = actions?.actionStates[`deal:${offer.dealId}`];
    return (
      <OfferCard
        offer={offer}
        alias={findAliasByAddress(aliases, offer.offerer)?.label}
        status={deal?.status}
        settlementVerified={deal?.settlementVerified}
        unverifiedClaim={Boolean(
          deal?.counterpartyAcceptClaim || deal?.counterpartyReceiptClaim,
        )}
        busy={action?.pending}
        actionMessage={action?.message}
        actionStartedAt={action?.startedAt}
        onAccept={
          ownOffer || !actions?.onAccept
            ? undefined
            : () => actions.onAccept?.(offer, actions.offerIndex)
        }
        onDecline={
          ownOffer || !actions?.onDecline
            ? undefined
            : () => actions.onDecline?.(offer)
        }
        onPostReceipt={
          ownOffer ||
          deal?.status !== "accepted" ||
          !deal.settlementVerified ||
          !actions?.onPostReceipt
            ? undefined
            : () => actions.onPostReceipt?.(offer)
        }
      />
    );
  }
  if (record.request) {
    const { request, payment } = record;
    const ownRequest = Boolean(self) && feltEquals(self, request.requester);
    const action = actions?.actionStates[`payment:${request.requestId}`];
    const awaitingInvoiceTake =
      payment?.paymentOperation?.state === "awaiting-note-maturity";
    const maturity =
      awaitingInvoiceTake && payment
        ? (invoicePaymentMaturity(
            payment,
            actions?.invoiceMaturityHeadBlock ?? 0,
          ) ?? undefined)
        : undefined;
    return (
      <InvoiceCard
        request={request}
        alias={findAliasByAddress(aliases, request.requester)?.label}
        status={payment?.status}
        paymentVerified={payment?.paymentVerified}
        unverifiedClaim={Boolean(payment?.counterpartyPaymentClaim)}
        busy={action?.pending}
        actionMessage={action?.message}
        actionStartedAt={action?.startedAt}
        maturity={maturity}
        linkAuthenticity={linkAuthenticity ?? payment?.linkAuthenticity}
        onPay={
          ownRequest || !actions?.onPay
            ? undefined
            : () => actions.onPay?.(request)
        }
        onPayPrivatelyWithStrk={
          ownRequest || awaitingInvoiceTake || !actions?.onPayPrivatelyWithStrk
            ? undefined
            : () => actions.onPayPrivatelyWithStrk?.(request)
        }
      />
    );
  }
  if (record.fund) {
    const { fund } = record;
    const ownDeal = Boolean(self) && feltEquals(self, fund.maker);
    const action = actions?.actionStates[`escrow:${fund.dealId}`];
    return (
      <EscrowCard
        fund={fund}
        status={record.escrow?.chainStatus}
        termsVerified={record.escrowTermsVerified}
        ownDeal={ownDeal}
        busy={action?.pending}
        actionMessage={action?.message}
        actionStartedAt={action?.startedAt}
        onFill={
          ownDeal || !actions?.onEscrowFill
            ? undefined
            : () => actions.onEscrowFill?.(fund)
        }
        onClaim={
          ownDeal && actions?.onEscrowClaim
            ? () => actions.onEscrowClaim?.(fund)
            : undefined
        }
        onTimeout={
          ownDeal && actions?.onEscrowTimeout
            ? () => actions.onEscrowTimeout?.(fund)
            : undefined
        }
      />
    );
  }
  if (record.receipt) {
    return (
      <ReceiptCard
        receipt={record.receipt}
        standalonePayment={record.receiptKind === "payment"}
        locallySubmitted={record.own}
      />
    );
  }
  return null;
}

export default function ChatRecordCard({
  record,
  aliases,
  linkAuthenticity,
  actions,
  defaultOpen,
}: RecordProps & { defaultOpen?: boolean }) {
  /* A record that needs action opens on its own, and so does one the desk
     is acting on or has just reported on: its progress and outcome live in
     the full card. Nothing closes a card behind the person's back, and a
     card rebuilt from a newer copy of the same record reopens the same way. */
  const actionKey = record.offer
    ? `deal:${record.offer.dealId}`
    : record.request
      ? `payment:${record.request.requestId}`
      : record.fund
        ? `escrow:${record.fund.dealId}`
        : null;
  const acting = Boolean(actionKey && actions?.actionStates[actionKey]);
  const wantsOpen = defaultOpen ?? (record.needsAction !== null || acting);
  const [open, setOpen] = useState(wantsOpen);
  useEffect(() => {
    if (wantsOpen) setOpen(true);
  }, [wantsOpen]);
  return (
    <article
      className={styles.recordCard}
      data-tone={record.facts.tone}
      aria-label={`${record.facts.title}: ${record.facts.terms}. ${record.facts.status}`}
    >
      <div className={styles.recordHead}>
        <span className={styles.recordTitle}>
          {record.facts.title} · {record.own ? "sent" : "received"}
        </span>
        <span className={styles.recordStatus}>{record.facts.status}</span>
      </div>
      <p className={styles.recordTerms}>{record.facts.terms}</p>
      {record.needsAction ? (
        <p className={styles.recordAction}>
          <span>{record.needsAction}</span>
        </p>
      ) : null}
      <details
        className={styles.recordDetails}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>Full record</summary>
        <div className={styles.recordFull}>
          <ChatRecordFull
            record={record}
            aliases={aliases}
            linkAuthenticity={linkAuthenticity}
            actions={actions}
          />
        </div>
      </details>
    </article>
  );
}
