"use client";

import { memo } from "react";
import type { AliasRecord } from "@/lib/aliases";
import { parseBackupPointer } from "@/lib/backup-blob";
import { decodeBackupSnapshot } from "@/lib/backup-snapshot";
import { parseCompositePayload } from "@/lib/composite";
import {
  formatBaseUnits,
  parseAcceptPayload,
  parseDeclinePayload,
  parseOfferPayload,
  parsePaymentRequestPayload,
  parseReceiptPayload,
} from "@/lib/otc";
import {
  parseEscrowClaimPayload,
  parseEscrowFillPayload,
  parseEscrowFundPayload,
  parseEscrowTimeoutPayload,
} from "@/lib/escrow";
import {
  conversationCorrespondent,
  correspondentHeadline,
  type ConversationCorrespondent,
} from "./correspondent";
import {
  mailMessageDateTime,
  mailboxMatchesFilter,
  mailMessageTimestampMs,
  type MailboxFilter,
} from "@/app/inbox/mailbox-model";
import type { LocalMailMessage } from "./Thread";
import styles from "./mail.module.css";

export type { MailboxFilter, ConversationCorrespondent };
export { mailboxMatchesFilter, conversationCorrespondent };

function backupKind(
  message: LocalMailMessage,
): "contacts" | "rfq-resume" | null {
  try {
    if (message.envelope.type === "backup_snapshot") {
      return decodeBackupSnapshot(message.envelope.payload).kind;
    }
    if (message.envelope.type === "backup_pointer") {
      return parseBackupPointer(message.envelope.payload).kind;
    }
  } catch {
    // Malformed backup-shaped records remain visibly unsupported.
  }
  return null;
}

function envelopeLabel(message: LocalMailMessage): string {
  switch (message.envelope.type) {
    case "text":
      return "Letter";
    case "offer":
      return "Deal";
    case "accept":
      return "Memo";
    case "decline":
      return "Declined";
    case "receipt":
      return "Receipt";
    case "payment_request":
      return "Invoice";
    case "escrow_fund":
      return "Escrow";
    case "escrow_fill":
      return "Escrow fill";
    case "escrow_claim":
      return "Escrow claim";
    case "escrow_timeout":
      return "Escrow timeout";
    case "contact_snapshot":
      return "Contact backup";
    case "backup_snapshot":
    case "backup_pointer": {
      const kind = backupKind(message);
      return kind === "contacts"
        ? "Contact backup"
        : kind === "rfq-resume"
          ? "RFQ history backup"
          : "Unsupported";
    }
    case "composite": {
      const composite = parseCompositePayload(message.envelope.payload);
      const count = composite?.attachments.length ?? 0;
      return count
        ? `Document · ${count} attachment${count === 1 ? "" : "s"}`
        : "Document";
    }
    default:
      return "Unsupported";
  }
}

/* The row already carries a type badge, so the preview line spends itself on
   the terms instead of repeating the word underneath it. */
const UNREADABLE_PAYLOAD = "Payload could not be read";

function amount(value: {
  token: { symbol: string; decimals: number };
  amount: string;
}): string {
  return `${formatBaseUnits(value.amount, value.token.decimals)} ${value.token.symbol}`;
}

function messagePreview(message: LocalMailMessage): string {
  const payload =
    message.envelope.type === "unsupported" ? null : message.envelope.payload;
  switch (message.envelope.type) {
    case "text": {
      const body = message.plaintext.replace(/\s+/g, " ").trim();
      return body || "Empty decrypted letter";
    }
    case "offer": {
      const offer = parseOfferPayload(payload);
      return offer
        ? `${amount(offer.give)} for ${amount(offer.want)}`
        : UNREADABLE_PAYLOAD;
    }
    case "accept": {
      const accept = parseAcceptPayload(payload);
      return accept
        ? `${amount(accept.transfer)} to settle`
        : UNREADABLE_PAYLOAD;
    }
    case "decline":
      return parseDeclinePayload(payload)?.reason || "No reason given";
    case "receipt":
      return parseReceiptPayload(payload)
        ? "Claims a transfer landed"
        : UNREADABLE_PAYLOAD;
    case "payment_request": {
      const request = parsePaymentRequestPayload(payload);
      return request ? `${amount(request)} requested` : UNREADABLE_PAYLOAD;
    }
    case "escrow_fund": {
      const fund = parseEscrowFundPayload(payload);
      return fund
        ? `${amount(fund.legA)} against ${amount(fund.legB)}`
        : UNREADABLE_PAYLOAD;
    }
    case "escrow_fill":
      return parseEscrowFillPayload(payload)
        ? "Counterparty filled the deal"
        : UNREADABLE_PAYLOAD;
    case "escrow_claim":
      return parseEscrowClaimPayload(payload)
        ? "Counterparty claimed the escrow"
        : UNREADABLE_PAYLOAD;
    case "escrow_timeout":
      return parseEscrowTimeoutPayload(payload)
        ? "Escrow timed out and was refunded"
        : UNREADABLE_PAYLOAD;
    case "contact_snapshot":
      return "Wallet + mailbox recovery phrase required";
    case "backup_snapshot":
    case "backup_pointer": {
      const kind = backupKind(message);
      return kind === "contacts"
        ? "Wallet + mailbox recovery phrase required"
        : kind === "rfq-resume"
          ? "Verification-only RFQ history"
          : "Unsupported decrypted record";
    }
    case "composite": {
      const composite = parseCompositePayload(payload);
      if (!composite) return "Unsupported composite document";
      const body = composite.body.replace(/\s+/g, " ").trim();
      if (body) return body;
      return composite.attachments
        .map((attachment) =>
          attachment.type === "payment_request"
            ? "Invoice"
            : attachment.type === "escrow_fund"
              ? "Escrow"
              : attachment.type === "offer"
                ? "Offer"
                : "Payment",
        )
        .join(" + ");
    }
    default:
      return "Unsupported decrypted record";
  }
}

function messageTime(message: LocalMailMessage): {
  label: string;
  dateTime?: string;
} {
  const dateTime = mailMessageDateTime(message);
  const milliseconds = mailMessageTimestampMs(message);
  if (milliseconds === undefined) return { label: "—" };
  const date = new Date(milliseconds);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return {
      label: new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date),
      dateTime,
    };
  }
  return {
    label: new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(date),
    dateTime,
  };
}

type ConversationListProps = {
  messages: LocalMailMessage[];
  selectedMessageId: string | null;
  readMessageIds: ReadonlySet<string>;
  aliases: AliasRecord[];
  selfAddress: string;
  folderLabel: string;
  filterLabel: string;
  onSelect: (messageId: string) => void;
};

function ConversationList({
  messages,
  selectedMessageId,
  readMessageIds,
  aliases,
  selfAddress,
  folderLabel,
  filterLabel,
  onSelect,
}: ConversationListProps) {
  return (
    <section className={styles.conversationRail} aria-label="Message list">
      <header className={styles.railHeading}>
        <div>
          <p className={styles.kicker}>{filterLabel.toUpperCase()}</p>
          <h1>{folderLabel}</h1>
        </div>
        <span className={styles.messageTotal}>{messages.length}</span>
      </header>

      <div className={styles.railPrivacyNote}>
        <strong>Local browser index—not encrypted at rest</strong>
        <span>
          “Unread/opened” is session-only. Sealed rows carry no public sender.
        </span>
      </div>

      {messages.length ? (
        <ol className={styles.conversationList}>
          {messages.map((message) => {
            const selected = selectedMessageId === message.id;
            const correspondent = conversationCorrespondent(
              message,
              aliases,
              selfAddress,
            );
            const unread =
              message.direction !== "outgoing" &&
              !readMessageIds.has(message.id);
            const posted = messageTime(message);
            const preview = messagePreview(message);
            const kind = envelopeLabel(message);
            return (
              <li key={message.id}>
                <button
                  className={`${styles.conversationItem} ${
                    selected ? styles.conversationItemActive : ""
                  }`}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  aria-label={`${unread ? "Unread. " : ""}${correspondent.primary}. ${kind}. ${preview}`}
                  onClick={() => onSelect(message.id)}
                >
                  <span className={styles.conversationTopline}>
                    <span className={styles.correspondentIdentity}>
                      <strong title={correspondent.fullAddress}>
                        <bdi>{correspondentHeadline(correspondent)}</bdi>
                      </strong>
                      {correspondent.detail ? (
                        <small>{correspondent.detail}</small>
                      ) : null}
                    </span>
                    <time dateTime={posted.dateTime}>{posted.label}</time>
                  </span>
                  <span className={styles.conversationPreview}>{preview}</span>
                  <span className={styles.conversationMeta}>
                    <em className={styles.typeBadge}>{kind}</em>
                    {message.direction === "outgoing" ? (
                      <em className={styles.provenanceBadge}>Sent</em>
                    ) : null}
                    {message.direction === "outgoing" ? null : (
                      <span
                        className={
                          unread ? styles.unreadIndicator : styles.readIndicator
                        }
                      >
                        {unread ? "● UNREAD" : "OPENED"}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={styles.railEmptyState}>
          <span className={styles.emptyEnvelope} aria-hidden="true">
            ✉
          </span>
          <strong>
            {filterLabel === "All" || filterLabel === "All types"
              ? "Nothing here yet"
              : `No ${filterLabel.toLowerCase()} yet`}
          </strong>
          <span>
            {folderLabel === "Sent"
              ? "Sent copies live only on this device. Write a message to create one."
              : folderLabel === "Inbox"
                ? "Check for new mail, or write a message."
                : "Choose another mailbox, or write a message."}
          </span>
        </div>
      )}
    </section>
  );
}

export default memo(ConversationList);
