"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseCompositePayload,
  type CompositeAttachment,
} from "@/lib/composite";
import type { DecodedMail } from "@/lib/envelope";
import type { EncryptedMailRecord } from "@/lib/mail";
import { publicRecipientCount } from "@/lib/mail-recipient-count";
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
import { replyAddressForMessage } from "@/lib/mail-correspondents";
import type { MailAssignment } from "@/lib/mail-assignments";
import {
  conversationFieldsFromPayload,
  conversationKeyForMessage,
} from "@/lib/mail-thread";
import { senderProofLabel, type SenderProof } from "@/lib/sender-proof";
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
  /** Unsigned request imported from /pay; it has no MessagePosted evidence. */
  transport?: "payment_link";
  recipientCount?: number;
  /** Device-local Sent recipients. Never inferred from sealed incoming mail. */
  recipients?: string[];
  /** Set for locally sent mail so it sorts before the chain confirms a timestamp. */
  localCreatedAt?: number;
  localConversationId?: string;
  assignedAddress?: string;
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
  onEscrowFill: (fund: EscrowFundPayload) => void;
  onEscrowClaim?: (fund: EscrowFundPayload) => void;
  onEscrowTimeout?: (fund: EscrowFundPayload) => void;
  onRestoreContacts?: (payload: unknown, message: LocalMailMessage) => void;
  contactRestorePending?: boolean;
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

function ConversationControls({
  message,
  selfAddress,
  proof,
  onReply,
  onAssign,
  onProve,
}: {
  message: LocalMailMessage;
  selfAddress: string;
  proof?: SenderProof;
  onReply?: ThreadProps["onReply"];
  onAssign?: ThreadProps["onAssign"];
  onProve?: ThreadProps["onProve"];
}) {
  const fields = conversationFieldsFromPayload(
    message.envelope.type,
    message.envelope.type === "unsupported" ? null : message.envelope.payload,
  );
  const conversationId = conversationKeyForMessage(message);
  const claimed = replyAddressForMessage(message, selfAddress);
  const assigned = message.assignedAddress;
  const canContinue = Boolean(onReply);
  const [assignInput, setAssignInput] = useState(assigned ?? "");
  return (
    <div className={styles.replyRow}>
      {proof ? <p>{senderProofLabel(proof)}</p> : null}
      {fields.conversationId ? (
        <span>Conversation tag {fields.conversationId.slice(0, 18)}…</span>
      ) : (
        <span>
          This letter has no conversation tag. A reply can start one locally and
          in the next ciphertext.
        </span>
      )}
      {canContinue ? (
        <button
          type="button"
          onClick={() =>
            onReply?.({
              address: claimed ?? assigned,
              conversationId,
              inReplyTo: fields.documentId ?? message.documentId ?? "",
            })
          }
        >
          Continue conversation
        </button>
      ) : null}
      {message.direction !== "outgoing" && onAssign ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (assignInput.trim()) onAssign(message.id, assignInput);
          }}
        >
          <AddressBookField
            selfAddress={selfAddress ?? ""}
            inputAriaLabel="Assign on this device"
            label="Assign on this device"
            value={assignInput}
            onChange={setAssignInput}
            placeholder="0x… or saved label"
          />
          <button type="submit">Save local assignment</button>
        </form>
      ) : null}
      {assigned && onProve ? (
        <button type="button" onClick={() => onProve(message.id, assigned)}>
          Check directory for this address
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
  onEscrowFill,
  onEscrowClaim,
  onEscrowTimeout,
  onRestoreContacts,
  contactRestorePending = false,
  onReply,
  onAssign,
  onProve,
  proofs = {},
}: ThreadProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusKey = messages.map((message) => message.id).join("|");

  useEffect(() => {
    if (!messages.length) return;
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusKey, focusVersion, messages.length]);

  function renderEnvelope(message: LocalMailMessage) {
    const { envelope } = message;
    const headingId = `message-${message.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${envelope.type}`;
    if (envelope.type === "unsupported") return <UnsupportedMessage />;

    if (envelope.type === "composite") {
      const composite = parseCompositePayload(envelope.payload);
      if (!composite) return <UnsupportedMessage />;
      const recipientCount =
        message.recipientCount ?? publicRecipientCount(message.record);
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
          <p className={styles.recipientDisclosure}>
            {recipientCount} recipient{recipientCount === 1 ? "" : "s"}; the
            count is public ciphertext metadata while identities are absent from
            MessagePosted.
          </p>
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
      const recipientCount =
        message.recipientCount ?? publicRecipientCount(message.record);
      return (
        <article className={styles.messageSheet} aria-labelledby={headingId}>
          <div className={styles.sheetHeading}>
            <h3 id={headingId} className={styles.sheetType}>
              {envelope.version === 0 ? "LEGACY LETTER" : "PRIVATE LETTER"}
            </h3>
            <span className={styles.proofStamp}>
              {recipientCount} recipient{recipientCount === 1 ? "" : "s"} ·
              count public
            </span>
          </div>
          <p className={styles.recipientDisclosure}>
            Recipient identities are sealed and absent from MessagePosted. The
            count above is public ciphertext-format metadata.
          </p>
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
        onPay={ownRequest ? undefined : () => onPay(request)}
      />
    );
  }

  return (
    <section className={styles.threadPanel} aria-labelledby="thread-title">
      <div className={styles.threadHeading}>
        <div>
          <p className={styles.kicker}>LOCAL PLAINTEXT / CARBON COPY</p>
          <h2 ref={headingRef} id="thread-title" tabIndex={-1}>
            Correspondence
          </h2>
        </div>
        <span className={styles.sheetClip} aria-hidden="true">
          CLIP / 01
        </span>
      </div>

      {messages.length ? (
        <ol className={styles.threadList}>
          {messages.map((message) => {
            const paymentLink = message.transport === "payment_link";
            const recipientCount = paymentLink
              ? 0
              : (message.recipientCount ??
                publicRecipientCount(message.record));
            return (
              <li className={styles.message} key={message.id}>
                <div className={styles.messageMeta}>
                  {paymentLink ? (
                    <>
                      <span>Imported from unsigned payment link</span>
                      <span>No transaction submitted</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {message.direction === "outgoing" ? "Sent" : "Opened"} ·
                        record {message.index}
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
                    This unsigned request was imported from a URL fragment for
                    local review. It is not a MessagePosted event, cannot
                    authenticate the requester, and opening or importing it did
                    not submit a payment.
                  </p>
                ) : null}
                <ConversationControls
                  message={message}
                  selfAddress={selfAddress}
                  proof={proofs[message.id]}
                  onReply={onReply}
                  onAssign={onAssign}
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
                <span className={styles.localLabel}>
                  {paymentLink
                    ? "decoded from this tab's URL fragment"
                    : message.direction === "outgoing"
                      ? "sealed on this device"
                      : "decrypted on this device"}
                </span>
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
