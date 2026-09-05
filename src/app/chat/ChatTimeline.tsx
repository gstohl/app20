import { useState } from "react";
import AddressBookField from "@/components/address-book/AddressBookField";
import { ChainRecordPanel } from "@/components/mail/ChainRecordPanel";
import ContactSnapshotCard from "@/components/mail/ContactSnapshotCard";
import MemoCard, { type MemoCardProps } from "@/components/mail/MemoCard";
import type { LocalMailMessage } from "@/components/mail/message";
import type { AliasRecord } from "@/lib/aliases";
import { MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE } from "@/lib/mail-authority-copy";
import { publicRecipientCount } from "@/lib/mail-recipient-count";
import {
  parseEscrowClaimPayload,
  parseEscrowFillPayload,
  parseEscrowTimeoutPayload,
} from "@/lib/escrow";
import { conversationFieldsFromPayload } from "@/lib/mail-thread";
import { parseAcceptPayload, parseDeclinePayload } from "@/lib/otc";
import { senderProofLabel, type SenderProof } from "@/lib/sender-proof";
import ChatRecordCard, { type ChatRecordActions } from "./ChatRecordCard";
import {
  contactDisplayName,
  namingTarget,
  type ChatConversation,
  type ChatItem,
} from "./chat-model";
import styles from "./chat.module.css";

export function chatEntryDomId(itemId: string): string {
  return `chat-item-${itemId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function fullTime(at: number | undefined): { label: string; dateTime?: string } {
  if (at === undefined) return { label: "Time not recorded" };
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return { label: "Time not recorded" };
  return {
    label: new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date),
    dateTime: date.toISOString(),
  };
}

function safeOfferIndex(index: string | undefined): number | undefined {
  const value = Number(index);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** A counterparty's answer to a deal, rendered with the same caveats Mail gave it. */
function memoCardProps(item: ChatItem): MemoCardProps | null {
  const message = item.message;
  if (!message || message.envelope.type === "unsupported") return null;
  const { payload } = message.envelope;
  switch (message.envelope.type) {
    case "accept": {
      const accept = parseAcceptPayload(payload);
      return accept
        ? { kind: "accept", accept, isPayment: item.label === "Payment memo" }
        : null;
    }
    case "decline": {
      const decline = parseDeclinePayload(payload);
      return decline ? { kind: "decline", decline } : null;
    }
    case "escrow_fill": {
      const update = parseEscrowFillPayload(payload);
      return update ? { kind: "escrow", operation: "fill", update } : null;
    }
    case "escrow_claim": {
      const update = parseEscrowClaimPayload(payload);
      return update ? { kind: "escrow", operation: "claim", update } : null;
    }
    case "escrow_timeout": {
      const update = parseEscrowTimeoutPayload(payload);
      return update ? { kind: "escrow", operation: "timeout", update } : null;
    }
    default:
      return null;
  }
}

function provenanceLabel(item: ChatItem): string {
  const { message } = item;
  switch (item.provenance) {
    case "device-sent":
      return message?.threadProvenance === "device_sent_and_on_chain"
        ? "Sent copy · opened from on-chain evidence"
        : "Sent copy on this device";
    case "payment-link":
      return message?.linkAuthenticity?.kind === "verified"
        ? "Imported link · Mail-key signature verified"
        : "Imported link · unverified";
    case "decrypted":
      return message
        ? `Opened · record ${message.index}${
            message.blockNumber === undefined
              ? ""
              : ` · block ${message.blockNumber}`
          }`
        : "Opened on this device";
    default:
      return "Saved deal state from an earlier session";
  }
}

/** Naming a sealed thread's sender: a device-local label, never authentication. */
function SenderNaming({
  target,
  selfAddress,
  onAssign,
}: {
  target: LocalMailMessage;
  selfAddress: string;
  onAssign: (messageId: string, address: string) => void;
}) {
  const [value, setValue] = useState(target.assignedAddress ?? "");
  return (
    <form
      className={styles.naming}
      aria-label="Name this sender"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onAssign(target.id, value);
      }}
    >
      <p className={styles.namingNote}>
        MessagePosted carries no sender. Name this thread on this device to
        file it under a counterparty; the name applies to every record in the
        thread and is never authentication.
      </p>
      <AddressBookField
        selfAddress={selfAddress}
        inputAriaLabel="Name this sender"
        label="Name this sender"
        value={value}
        onChange={setValue}
        placeholder="0x… or saved label"
      />
      <button type="submit" className={styles.namingSave}>
        Save name
      </button>
    </form>
  );
}

function RecordProvenance({
  message,
  proof,
  onProve,
}: {
  message: LocalMailMessage;
  proof?: SenderProof;
  onProve?: (messageId: string, address: string) => void;
}) {
  const fields = conversationFieldsFromPayload(
    message.envelope.type,
    message.envelope.type === "unsupported" ? null : message.envelope.payload,
  );
  const assigned = message.assignedAddress;
  if (!proof && !fields.conversationId && !(assigned && onProve)) return null;
  return (
    <div className={styles.entryProof}>
      {proof ? <p>{senderProofLabel(proof)}</p> : null}
      {fields.conversationId ? (
        <span>Thread {fields.conversationId.slice(0, 18)}…</span>
      ) : null}
      {assigned && onProve ? (
        <button type="button" onClick={() => onProve(message.id, assigned)}>
          Inspect auth claim
        </button>
      ) : null}
    </div>
  );
}

export type ChatTimelineHandlers = Readonly<{
  actions: ChatRecordActions;
  proofs: Readonly<Record<string, SenderProof>>;
  onAssign: (messageId: string, address: string) => void;
  onProve: (messageId: string, address: string) => void;
  onRestoreContacts?: (payload: unknown, message: LocalMailMessage) => void;
  onRestoreBackup?: (payload: unknown, message: LocalMailMessage) => void;
  contactRestorePending: boolean;
  backupRestorePending: boolean;
}>;

type ChatTimelineProps = {
  conversation: ChatConversation;
  aliases: readonly AliasRecord[];
  highlightId: string | null;
  handlers: ChatTimelineHandlers;
};

export default function ChatTimeline({
  conversation,
  aliases,
  highlightId,
  handlers,
}: ChatTimelineProps) {
  const name = contactDisplayName(conversation.contact);
  const sealedTarget =
    conversation.contact.kind === "sealed" ? namingTarget(conversation) : null;

  if (!conversation.items.length) {
    return (
      <div className={styles.timelineEmpty}>
        <strong>No records with {name} on this device yet.</strong>
        <p>
          A letter sent from here is sealed to their registered mailbox key and
          kept as a Sent copy in this browser profile. Records they send you
          appear after you check for new mail.
        </p>
      </div>
    );
  }

  function renderBackup(item: ChatItem) {
    const message = item.message;
    if (!message || !item.backupKind) return null;
    const pointer = message.envelope.type === "backup_pointer";
    const legacy = message.envelope.type === "contact_snapshot";
    const payload =
      message.envelope.type === "unsupported" ? null : message.envelope.payload;
    const restore = legacy
      ? handlers.onRestoreContacts
      : handlers.onRestoreBackup;
    return (
      <ContactSnapshotCard
        kind={item.backupKind}
        pointer={pointer}
        busy={
          legacy ? handlers.contactRestorePending : handlers.backupRestorePending
        }
        onMerge={restore ? () => restore(payload, message) : undefined}
      />
    );
  }

  function renderContent(item: ChatItem) {
    if (item.kind === "backup") return renderBackup(item);
    if (item.kind === "memo" || item.kind === "decline") {
      const memo = memoCardProps(item);
      if (memo) {
        return (
          <div className={styles.cardStack}>
            <MemoCard {...memo} />
          </div>
        );
      }
    }
    const actions: ChatRecordActions = {
      ...handlers.actions,
      offerIndex: safeOfferIndex(item.message?.index),
    };
    const cards = item.records.length ? (
      <div className={styles.cardStack}>
        {item.records.map((record) => (
          <ChatRecordCard
            key={record.id}
            record={record}
            aliases={aliases}
            linkAuthenticity={item.message?.linkAuthenticity}
            actions={actions}
          />
        ))}
      </div>
    ) : null;
    if (item.kind === "letter" || item.kind === "document") {
      return (
        <div className={styles.bubble}>
          {item.body.trim() ? (
            <p className={styles.letterBody}>{item.body}</p>
          ) : (
            <p className={styles.memo}>No message body</p>
          )}
          {cards}
        </div>
      );
    }
    if (cards) return cards;
    return (
      <div className={styles.bubble}>
        <p className={styles.memo}>{item.preview}</p>
        {item.body.trim() ? (
          <p className={styles.letterBody}>{item.body}</p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {sealedTarget ? (
        <SenderNaming
          target={sealedTarget}
          selfAddress={handlers.actions.selfAddress}
          onAssign={handlers.onAssign}
        />
      ) : null}
      <ol className={styles.timeline} aria-label={`Conversation with ${name}`}>
        {conversation.items.map((item) => {
          const time = fullTime(item.at);
          const message = item.message;
          const paymentLink = item.provenance === "payment-link";
          const recipientCount = message
            ? (message.recipientCount ?? publicRecipientCount(message.record))
            : undefined;
          return (
            <li
              key={item.id}
              id={chatEntryDomId(item.id)}
              className={styles.entry}
              data-direction={item.direction}
              data-highlight={highlightId === item.id ? "true" : undefined}
            >
              <div className={styles.entryMeta}>
                <b>{item.direction === "outgoing" ? "You" : name}</b>
                <span>{item.label}</span>
                <time dateTime={time.dateTime}>{time.label}</time>
                <span>{provenanceLabel(item)}</span>
                {recipientCount !== undefined && !paymentLink ? (
                  <span>
                    {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
                  </span>
                ) : null}
                {item.otherRecipients ? (
                  <span>
                    +{item.otherRecipients} other recipient
                    {item.otherRecipients === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              {paymentLink ? (
                <p className={styles.entryNotice} role="status">
                  {message?.linkAuthenticity?.kind === "verified"
                    ? `${MAIL_SIGNATURE_VERIFICATION_LIMIT_NOTICE} This request came from a URL fragment, not a MessagePosted event, and opening or importing it did not submit a payment.`
                    : "This unverified legacy request was imported from a URL fragment for local review. It is not a MessagePosted event, cannot authenticate the requester, and opening or importing it did not submit a payment."}
                </p>
              ) : null}
              {message && !paymentLink ? (
                <RecordProvenance
                  message={message}
                  proof={handlers.proofs[message.id]}
                  onProve={handlers.onProve}
                />
              ) : null}
              {renderContent(item)}
              {message &&
              message.transactionHashes &&
              message.transactionHashes.length > 1 ? (
                <aside className={styles.entrySubmissions}>
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
              {message && !paymentLink && item.provenance !== "mailbox-record" ? (
                <div className={styles.entryChain}>
                  <ChainRecordPanel message={message} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}
