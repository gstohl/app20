"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseCompositePayload,
  type CompositeAttachment,
} from "@/lib/composite";
import type { DecodedMail } from "@/lib/envelope";
import { parseBackupPointer } from "@/lib/backup-blob";
import { decodeBackupSnapshot } from "@/lib/backup-snapshot";
import type { EncryptedMailRecord } from "@/lib/mail";
import { MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE } from "@/lib/mail-authority-copy";
import { publicRecipientCount } from "@/lib/mail-recipient-count";
import type { AliasRecord } from "@/lib/aliases";
import { findAliasByAddress } from "@/lib/aliases";
import { feltEquals } from "@/lib/addresses";
import type { PaymentLinkAuthenticity } from "@/lib/payment-link";
import {
  formatBaseUnits,
  invoicePaymentMaturity,
  parseAcceptPayload,
  parseDeclinePayload,
  parseOfferPayload,
  parsePaymentRequestPayload,
  parseReceiptPayload,
  receiptForTransfer,
  type OfferPayload,
  type OtcState,
  type PaymentRequestPayload,
} from "@/lib/otc";
import {
  contractDealMatchesFund,
  parseEscrowClaimPayload,
  parseEscrowFillPayload,
  parseEscrowFundPayload,
  parseEscrowTimeoutPayload,
  type EscrowFundPayload,
  type EscrowState,
} from "@/lib/escrow";
import AddressBookField from "@/components/address-book/AddressBookField";
import ContactSnapshotCard from "./ContactSnapshotCard";
import EscrowCard from "./EscrowCard";
import InvoiceCard from "./InvoiceCard";
import OfferCard from "./OfferCard";
import ReceiptCard from "./ReceiptCard";
import { replyAddressForConversation } from "@/lib/mail-correspondents";
import type { MailAssignment } from "@/lib/mail-assignments";
import {
  conversationFieldsFromPayload,
  conversationKeyForMessage,
} from "@/lib/mail-thread";
import { senderProofLabel, type SenderProof } from "@/lib/sender-proof";
import {
  conversationCorrespondent,
  correspondentHeadline,
} from "./correspondent";
import styles from "./mail.module.css";

export type LocalMailMessage = {
  id: string;
  index: string;
  plaintext: string;
  envelope: DecodedMail;
  record: EncryptedMailRecord;
  transactionHash: string;
  transactionHashes?: string[];
  deliveryState?: "confirmed" | "partially_confirmed";
  documentId?: string;
  blockNumber?: number;
  blockTimestamp?: number;
  eventIndex?: number;
  direction?: "incoming" | "outgoing";
  /** Request imported from /pay; it has no MessagePosted evidence. */
  transport?: "payment_link";
  /** Authenticity verified from the original payment-link fragment. */
  linkAuthenticity?: PaymentLinkAuthenticity;
  recipientCount?: number;
  /** Device-local Sent recipients. Never inferred from sealed incoming mail. */
  recipients?: string[];
  /** Set for locally sent mail so it sorts before the chain confirms a timestamp. */
  localCreatedAt?: number;
  localConversationId?: string;
  assignedAddress?: string;
  /** Thread-only merge of the local Sent projection and its decrypted event. */
  threadProvenance?: "device_sent_and_on_chain";
};

export type ThreadActionState = {
  pending: boolean;
  message?: string;
  startedAt?: number;
};

type ThreadProps = {
  messages: LocalMailMessage[];
  focusVersion?: number;
  selfAddress: string;
  aliases: AliasRecord[];
  otcState: OtcState;
  escrowState: EscrowState;
  actionStates: Record<string, ThreadActionState>;
  onAccept: (offer: OfferPayload, offerIndex?: number) => void;
  onDecline: (offer: OfferPayload) => void;
  onPostReceipt: (offer: OfferPayload) => void;
  onPay: (request: PaymentRequestPayload) => void;
  onPayPrivatelyWithStrk?: (request: PaymentRequestPayload) => void;
  invoiceMaturityHeadBlock?: number;
  onEscrowFill: (fund: EscrowFundPayload) => void;
  onEscrowClaim?: (fund: EscrowFundPayload) => void;
  onEscrowTimeout?: (fund: EscrowFundPayload) => void;
  onRestoreContacts?: (payload: unknown, message: LocalMailMessage) => void;
  onRestoreBackup?: (payload: unknown, message: LocalMailMessage) => void;
  contactRestorePending?: boolean;
  backupRestorePending?: boolean;
  onReply?: (input: {
    address?: string;
    conversationId: string;
    inReplyTo: string;
  }) => void;
  onAssign?: (messageId: string, address: string) => void;
  onProve?: (messageId: string, address: string) => void;
  assignments?: Record<string, MailAssignment>;
  proofs?: Record<string, SenderProof>;
};

function safeOfferIndex(index: string): number | undefined {
  const value = Number(index);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function UnsupportedMessage() {
  return (
    <article className={styles.messageSheet} aria-label="Unsupported message">
      <h3 className={styles.sheetType}>UNSUPPORTED</h3>
      <p className={styles.termsSentence}>unsupported message</p>
    </article>
  );
}

const CIPHERTEXT_PREVIEW_FELTS = 4;

type CopyState = "idle" | "copied" | "error";

function isoBlockTimestamp(timestamp: number | undefined): string | null {
  if (timestamp === undefined) return null;
  try {
    const value = new Date(timestamp * 1_000).toISOString();
    return value;
  } catch {
    return null;
  }
}

export function ChainRecordPanel({ message }: { message: LocalMailMessage }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const { record } = message;
  const timestamp = isoBlockTimestamp(message.blockTimestamp);
  const recipientCount =
    message.recipientCount ?? publicRecipientCount(message.record);
  const preview = record.ciphertextFelts.slice(0, CIPHERTEXT_PREVIEW_FELTS);
  const hiddenFeltCount = record.ciphertextFelts.length - preview.length;

  async function copyAllCiphertext() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(record.ciphertextFelts),
      );
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <details className={styles.chainDisclosure}>
      <summary>
        <span>What the chain sees</span>
        <span className={styles.chainToggleHint}>PUBLIC EVIDENCE</span>
      </summary>
      <aside
        className={styles.chainRecord}
        aria-label={`Public on-chain record for message ${message.index}`}
      >
        <div className={styles.chainRecordHeading}>
          <div>
            <span className={styles.chainEyebrow}>MESSAGEPOSTED / PUBLIC</span>
            <h3>Opaque event data</h3>
          </div>
          <span className={styles.chainEvidenceBadge}>ON-CHAIN EVIDENCE</span>
        </div>

        <dl className={styles.chainFields}>
          <div className={styles.chainField}>
            <dt>Message index</dt>
            <dd>
              <code>{message.index}</code>
            </dd>
          </div>
          <div className={styles.chainField}>
            <dt>Recipient count</dt>
            <dd>
              <code>{recipientCount}</code>
              <small>PUBLIC FORMAT METADATA</small>
            </dd>
          </div>
          <div className={`${styles.chainField} ${styles.chainFieldWide}`}>
            <dt>Transaction hash</dt>
            <dd>
              <code>{message.transactionHash}</code>
            </dd>
          </div>
          <div className={`${styles.chainField} ${styles.chainFieldWide}`}>
            <dt>Block timestamp</dt>
            <dd>
              {timestamp && message.blockTimestamp !== undefined ? (
                <>
                  <time dateTime={timestamp}>{timestamp}</time>
                  <small>UNIX {message.blockTimestamp}</small>
                </>
              ) : (
                <span className={styles.sealedValue}>NOT AVAILABLE</span>
              )}
            </dd>
          </div>
          <div className={`${styles.chainField} ${styles.chainFieldWide}`}>
            <dt>Ephemeral public key</dt>
            <dd className={styles.feltPair}>
              {record.ephemeralPub.map((felt, index) => (
                <code key={`${index}:${felt}`}>{felt}</code>
              ))}
            </dd>
          </div>
          <div className={styles.chainField}>
            <dt>View tag</dt>
            <dd>
              <code>
                {record.viewTag} / 0x
                {record.viewTag.toString(16).padStart(2, "0")}
              </code>
            </dd>
          </div>
          <div className={styles.chainField}>
            <dt>Nonce</dt>
            <dd className={styles.feltPair}>
              {record.nonce.map((felt, index) => (
                <code key={`${index}:${felt}`}>{felt}</code>
              ))}
            </dd>
          </div>
          <div className={`${styles.chainField} ${styles.chainFieldWide}`}>
            <dt>Ciphertext felts</dt>
            <dd>
              <ol className={styles.ciphertextPreview}>
                {preview.map((felt, index) => (
                  <li key={`${index}:${felt}`}>
                    <span>{index.toString().padStart(2, "0")}</span>
                    <code>{felt}</code>
                  </li>
                ))}
                {hiddenFeltCount > 0 ? (
                  <li className={styles.truncatedFelts}>
                    … {hiddenFeltCount} more felt
                    {hiddenFeltCount === 1 ? "" : "s"} in the public record
                  </li>
                ) : null}
              </ol>
              <div className={styles.ciphertextActions}>
                <span>
                  {record.ciphertextFelts.length} FELT
                  {record.ciphertextFelts.length === 1 ? "" : "S"} TOTAL
                </span>
                <button
                  className={styles.chainCopyButton}
                  type="button"
                  onClick={copyAllCiphertext}
                >
                  {copyState === "copied"
                    ? "Copied all"
                    : copyState === "error"
                      ? "Copy failed"
                      : `Copy all ${record.ciphertextFelts.length}`}
                </button>
              </div>
              <span className={styles.copyStatus} aria-live="polite">
                {copyState === "copied"
                  ? "Complete ciphertext JSON copied."
                  : copyState === "error"
                    ? "Clipboard access was denied."
                    : ""}
              </span>
            </dd>
          </div>
        </dl>

        <div className={styles.absentFields}>
          <span>
            <b>Sender address</b>
            <code>ABSENT</code>
          </span>
          <span>
            <b>Recipient identities</b>
            <code>ABSENT</code>
          </span>
        </div>
        <p className={styles.addressAbsence}>
          Recipient count is public in the ciphertext format. No sender or
          recipient address appears anywhere in this MessagePosted record.
        </p>
      </aside>
    </details>
  );
}

/**
 * What belongs to the conversation rather than to one envelope: naming its
 * sender, and the reason a reply cannot prefill a recipient. Both used to
 * render once per record, so a five-record thread carried five naming forms.
 */
function ConversationNaming({
  messages,
  selfAddress,
  responseAddress,
  canReply,
  onAssign,
}: {
  messages: LocalMailMessage[];
  selfAddress: string;
  responseAddress?: string;
  canReply: boolean;
  onAssign?: ThreadProps["onAssign"];
}) {
  const target = messages.find((message) => message.direction !== "outgoing");
  const assigned = target?.assignedAddress;
  const [assignInput, setAssignInput] = useState(assigned ?? "");
  if (!target || !onAssign) return null;
  return (
    <div className={styles.conversationActions}>
      {canReply && !responseAddress ? (
        <p className={styles.conversationActionsNote}>
          A reply cannot prefill a recipient: the sender is sealed and this
          conversation has no device-local recipient or name yet. Name the
          sender below, or supply the address in the draft.
        </p>
      ) : null}
      <details className={styles.assignDisclosure}>
        <summary>Name this sender on this device</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (assignInput.trim()) onAssign(target.id, assignInput);
          }}
        >
          <AddressBookField
            selfAddress={selfAddress ?? ""}
            inputAriaLabel="Name this sender"
            label="Name this sender"
            value={assignInput}
            onChange={setAssignInput}
            placeholder="0x… or saved label"
            hint="Applies to every record in this conversation on this device. A saved counterparty shows its label; the name is never authentication."
          />
          <button type="submit">Save name</button>
        </form>
      </details>
    </div>
  );
}

/** What belongs to one record: how it identifies itself, and its own claim. */
function RecordControls({
  message,
  proof,
  onProve,
}: {
  message: LocalMailMessage;
  proof?: SenderProof;
  onProve?: ThreadProps["onProve"];
}) {
  const fields = conversationFieldsFromPayload(
    message.envelope.type,
    message.envelope.type === "unsupported" ? null : message.envelope.payload,
  );
  const assigned = message.assignedAddress;
  if (!proof && !fields.conversationId && !(assigned && onProve)) return null;
  return (
    <div className={styles.replyRow}>
      {proof ? <p>{senderProofLabel(proof)}</p> : null}
      {fields.conversationId ? (
        <span>Conversation tag {fields.conversationId.slice(0, 18)}…</span>
      ) : null}
      {assigned && onProve ? (
        <button type="button" onClick={() => onProve(message.id, assigned)}>
          Inspect unbound auth claim
        </button>
      ) : null}
    </div>
  );
}

export default function Thread({
  messages,
  focusVersion = 0,
  selfAddress,
  aliases,
  otcState,
  escrowState,
  actionStates,
  onAccept,
  onDecline,
  onPostReceipt,
  onPay,
  onPayPrivatelyWithStrk,
  invoiceMaturityHeadBlock,
  onEscrowFill,
  onEscrowClaim,
  onEscrowTimeout,
  onRestoreContacts,
  onRestoreBackup,
  contactRestorePending = false,
  backupRestorePending = false,
  onReply,
  onAssign,
  onProve,
  proofs = {},
}: ThreadProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const conversationAddress =
    replyAddressForConversation(messages, selfAddress) ?? undefined;

  /* The head names what is open. "Correspondence" was a constant, so the pane
     never said which record you were reading; the rail's identity is reused
     verbatim so both panes call the same counterparty the same thing. */
  const head = messages.length
    ? conversationCorrespondent(messages[0], aliases, selfAddress)
    : null;
  const headDetail = head
    ? [
        head.detail,
        `${messages.length} record${messages.length === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  useEffect(() => {
    if (!messages.length || focusVersion === 0) return;
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusVersion, messages.length]);

  function renderEnvelope(message: LocalMailMessage) {
    const { envelope } = message;
    const headingId = `message-${message.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${envelope.type}`;
    if (envelope.type === "unsupported") return <UnsupportedMessage />;

    if (envelope.type === "composite") {
      const composite = parseCompositePayload(envelope.payload);
      if (!composite) return <UnsupportedMessage />;
      function renderAttachment(
        attachment: CompositeAttachment,
        attachmentIndex: number,
      ) {
        if (attachment.type === "payment") {
          return (
            <ReceiptCard
              key={`${attachment.type}:${attachmentIndex}`}
              receipt={receiptForTransfer(
                attachment.payload.dealId,
                attachment.payload.transfer,
                message.transactionHash,
              )}
              standalonePayment
              locallySubmitted={message.direction === "outgoing"}
            />
          );
        }
        const type = attachment.type;
        return (
          <div key={`${type}:${attachmentIndex}`}>
            {renderEnvelope({
              ...message,
              plaintext: "",
              envelope: {
                version: 1,
                type,
                payload: attachment.payload,
                bytes: envelope.bytes,
              },
            })}
          </div>
        );
      }
      return (
        <article
          className={styles.compositeDocument}
          aria-labelledby={headingId}
        >
          <div className={styles.sheetHeading}>
            <h3 id={headingId} className={styles.sheetType}>
              COMPOSITE DOCUMENT
            </h3>
            <span className={styles.proofStamp}>
              {composite.attachments.length} attachment
              {composite.attachments.length === 1 ? "" : "s"}
            </span>
          </div>
          {composite.body ? (
            <p className={styles.letterBody}>{composite.body}</p>
          ) : (
            <p className={styles.emptyDocumentBody}>No message body</p>
          )}
          <div className={styles.compositeCardStack}>
            {composite.attachments.map(renderAttachment)}
          </div>
        </article>
      );
    }

    if (envelope.type === "text") {
      /* Recipient count and the sealed-identity caveat are not repeated here:
         the message meta row above carries the count, and "What the chain sees"
         below states the absence once, where the public record is shown. */
      return (
        <article className={styles.messageSheet} aria-labelledby={headingId}>
          <div className={styles.sheetHeading}>
            <h3 id={headingId} className={styles.sheetType}>
              {envelope.version === 0 ? "LEGACY LETTER" : "PRIVATE LETTER"}
            </h3>
          </div>
          <p className={styles.letterBody}>{message.plaintext}</p>
        </article>
      );
    }

    if (envelope.type === "contact_snapshot") {
      return (
        <ContactSnapshotCard
          busy={contactRestorePending}
          onMerge={
            onRestoreContacts
              ? () => onRestoreContacts(envelope.payload, message)
              : undefined
          }
        />
      );
    }

    if (
      envelope.type === "backup_snapshot" ||
      envelope.type === "backup_pointer"
    ) {
      let kind: "contacts" | "rfq-resume";
      try {
        kind =
          envelope.type === "backup_snapshot"
            ? decodeBackupSnapshot(envelope.payload).kind
            : parseBackupPointer(envelope.payload).kind;
      } catch {
        return <UnsupportedMessage />;
      }
      return (
        <ContactSnapshotCard
          kind={kind}
          pointer={envelope.type === "backup_pointer"}
          busy={backupRestorePending}
          onMerge={
            onRestoreBackup
              ? () => onRestoreBackup(envelope.payload, message)
              : undefined
          }
        />
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
          settlementVerified={deal?.settlementVerified}
          unverifiedClaim={Boolean(
            deal?.counterpartyAcceptClaim || deal?.counterpartyReceiptClaim,
          )}
          busy={action?.pending}
          actionMessage={action?.message}
          actionStartedAt={action?.startedAt}
          onAccept={
            ownOffer
              ? undefined
              : () => onAccept(offer, safeOfferIndex(message.index))
          }
          onDecline={ownOffer ? undefined : () => onDecline(offer)}
          onPostReceipt={
            ownOffer || deal?.status !== "accepted" || !deal.settlementVerified
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
        <article className={styles.messageSheet} aria-labelledby={headingId}>
          <div className={styles.sheetHeading}>
            <h3 id={headingId} className={styles.sheetType}>
              {isPayment ? "PAYMENT MEMO" : "OTC ACCEPT MEMO"}
            </h3>
            <span className={styles.proofStamp}>
              Unverified counterparty claim
            </span>
          </div>
          <p className={styles.termsSentence}>
            A counterparty claims they sent{" "}
            {formatBaseUnits(
              accept.transfer.amount,
              accept.transfer.token.decimals,
            )}{" "}
            <bdi>{accept.transfer.token.symbol}</bdi> for{" "}
            {isPayment ? "request" : "deal"} {accept.dealId.slice(0, 12)}…
          </p>
          <p className={styles.riskCopy}>
            This decrypted memo and its MessagePosted transaction do not prove
            that STRK moved. Verify settlement independently before releasing
            any quoted consideration.
          </p>
        </article>
      );
    }

    if (envelope.type === "decline") {
      const decline = parseDeclinePayload(envelope.payload);
      if (!decline) return <UnsupportedMessage />;
      return (
        <article className={styles.messageSheet} aria-labelledby={headingId}>
          <div className={styles.sheetHeading}>
            <h3 id={headingId} className={styles.sheetType}>
              OTC RESPONSE
            </h3>
            <span className={styles.proofStamp}>Declined</span>
          </div>
          <p className={styles.termsSentence}>
            Deal {decline.dealId.slice(0, 12)}… was declined.
          </p>
          {decline.reason ? (
            <p className={styles.offerNote}>
              <bdi>{decline.reason}</bdi>
            </p>
          ) : null}
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

    if (envelope.type === "escrow_fund") {
      const fund = parseEscrowFundPayload(envelope.payload);
      if (!fund) return <UnsupportedMessage />;
      const deal = escrowState.deals[fund.dealId];
      const action = actionStates[`escrow:${fund.dealId}`];
      const ownDeal = feltEquals(selfAddress, fund.maker);
      return (
        <EscrowCard
          fund={fund}
          status={deal?.chainStatus}
          termsVerified={Boolean(
            deal?.chainDeal &&
            deal.chainDeal.status !== "empty" &&
            contractDealMatchesFund(deal.chainDeal, fund),
          )}
          ownDeal={ownDeal}
          busy={action?.pending}
          actionMessage={action?.message}
          actionStartedAt={action?.startedAt}
          onFill={ownDeal ? undefined : () => onEscrowFill(fund)}
          onClaim={
            ownDeal && onEscrowClaim ? () => onEscrowClaim(fund) : undefined
          }
          onTimeout={
            ownDeal && onEscrowTimeout ? () => onEscrowTimeout(fund) : undefined
          }
        />
      );
    }

    if (
      envelope.type === "escrow_fill" ||
      envelope.type === "escrow_claim" ||
      envelope.type === "escrow_timeout"
    ) {
      const update =
        envelope.type === "escrow_fill"
          ? parseEscrowFillPayload(envelope.payload)
          : envelope.type === "escrow_claim"
            ? parseEscrowClaimPayload(envelope.payload)
            : parseEscrowTimeoutPayload(envelope.payload);
      if (!update) return <UnsupportedMessage />;
      const operation = envelope.type.slice("escrow_".length).toUpperCase();
      return (
        <article className={styles.messageSheet} aria-labelledby={headingId}>
          <div className={styles.sheetHeading}>
            <h3 id={headingId} className={styles.sheetType}>
              ESCROW {operation} NOTICE
            </h3>
            <span className={styles.proofStamp}>
              Unverified coordination memo
            </span>
          </div>
          <p className={styles.termsSentence}>
            A counterparty posted an encrypted {operation.toLowerCase()} notice
            for deal {update.dealId.slice(0, 12)}…
          </p>
          <p className={styles.riskCopy}>
            This message does not prove a state transition. Mail reads the
            escrow contract before enabling another asset action.
          </p>
        </article>
      );
    }

    const request = parsePaymentRequestPayload(envelope.payload);
    if (!request) return <UnsupportedMessage />;
    const payment = otcState.payments[request.requestId];
    const action = actionStates[`payment:${request.requestId}`];
    const ownRequest = feltEquals(selfAddress, request.requester);
    const awaitingInvoiceTake =
      payment?.paymentOperation?.state === "awaiting-note-maturity";
    const maturity = awaitingInvoiceTake
      ? (invoicePaymentMaturity(payment, invoiceMaturityHeadBlock ?? 0) ??
        undefined)
      : undefined;
    return (
      <InvoiceCard
        request={request}
        alias={findAliasByAddress(aliases, request.requester)?.label}
        linkAuthenticity={message.linkAuthenticity}
        status={payment?.status}
        paymentVerified={payment?.paymentVerified}
        unverifiedClaim={Boolean(payment?.counterpartyPaymentClaim)}
        busy={action?.pending}
        actionMessage={action?.message}
        actionStartedAt={action?.startedAt}
        maturity={maturity}
        onPay={ownRequest ? undefined : () => onPay(request)}
        onPayPrivatelyWithStrk={
          ownRequest || awaitingInvoiceTake || !onPayPrivatelyWithStrk
            ? undefined
            : () => onPayPrivatelyWithStrk(request)
        }
      />
    );
  }

  return (
    <section className={styles.threadPanel} aria-label="Correspondence">
      <div className={styles.threadHeading}>
        <div>
          <h2
            ref={headingRef}
            id="thread-title"
            tabIndex={-1}
            title={head?.fullAddress}
          >
            {head ? correspondentHeadline(head) : "Correspondence"}
          </h2>
          {headDetail ? (
            <p className={styles.threadHeadDetail}>{headDetail}</p>
          ) : null}
        </div>
      </div>

      <ConversationNaming
        messages={messages}
        selfAddress={selfAddress}
        responseAddress={conversationAddress}
        canReply={Boolean(onReply)}
        onAssign={onAssign}
      />

      {messages.length ? (
        <ol className={styles.threadList}>
          {messages.map((message) => {
            const paymentLink = message.transport === "payment_link";
            const recipientCount =
              message.recipientCount ?? publicRecipientCount(message.record);
            return (
              <li className={styles.message} key={message.id}>
                <div className={styles.messageMeta}>
                  {paymentLink ? (
                    <>
                      <span>
                        {message.linkAuthenticity?.kind === "verified"
                          ? "Imported from verified Mail-signed payment link"
                          : "Imported from unverified legacy payment link"}
                      </span>
                      <span>No transaction submitted</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {message.threadProvenance === "device_sent_and_on_chain"
                          ? "Sent locally · opened from on-chain evidence"
                          : message.direction === "outgoing"
                            ? "Sent"
                            : "Opened"}
                        {" · record "}
                        {message.index}
                      </span>
                      <span>
                        {recipientCount} recipient
                        {recipientCount === 1 ? "" : "s"}
                        {message.blockNumber === undefined
                          ? " · posted"
                          : ` · block ${message.blockNumber}`}
                      </span>
                    </>
                  )}
                </div>
                {paymentLink ? (
                  <p className={styles.actionWarning} role="status">
                    {message.linkAuthenticity?.kind === "verified"
                      ? `${MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE} This request came from a URL fragment, not a MessagePosted event, and opening or importing it did not submit a payment.`
                      : "This unverified legacy request was imported from a URL fragment for local review. It is not a MessagePosted event, cannot authenticate the requester, and opening or importing it did not submit a payment."}
                  </p>
                ) : null}
                <RecordControls
                  message={message}
                  proof={proofs[message.id]}
                  onProve={onProve}
                />
                {renderEnvelope(message)}
                {message.transactionHashes &&
                message.transactionHashes.length > 1 ? (
                  <aside className={styles.submissionTransactions}>
                    <strong>Submission transactions</strong>
                    {message.transactionHashes.map((transactionHash, index) => (
                      <code key={`${index}:${transactionHash}`}>
                        {index + 1}. {transactionHash}
                      </code>
                    ))}
                    <span>
                      Escrow funding and document delivery are separate because
                      the pool permits one external invoke per transaction.
                    </span>
                  </aside>
                ) : null}
                {paymentLink ? null : <ChainRecordPanel message={message} />}
                {/* Only the two provenances a reader cannot infer from the
                    pane's own head are worth a line under every record. */}
                {paymentLink ||
                message.threadProvenance === "device_sent_and_on_chain" ? (
                  <span className={styles.localLabel}>
                    {paymentLink
                      ? "decoded from this tab's URL fragment"
                      : "device-local Sent copy matched to decrypted on-chain evidence"}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={styles.emptyState}>
          <strong>Select an envelope or start a new letter.</strong>
          <span>
            Opened plaintext stays on this device. The proof-teal rail below
            each sheet shows the public event without inventing a sender.
          </span>
        </div>
      )}
    </section>
  );
}
