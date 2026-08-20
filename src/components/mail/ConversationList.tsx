"use client";

import { feltEquals } from "@/lib/addresses";
import { findAliasByAddress, type AliasRecord } from "@/lib/aliases";
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
import { formatDeviceSentRecipients } from "@/lib/mail-correspondents";
import type { LocalMailMessage } from "./Thread";
import styles from "./mail.module.css";

export type MailboxFilter = "all" | "letters" | "deals" | "invoices" | "escrow";

function attachmentCategory(
  type: "payment" | "offer" | "payment_request" | "escrow_fund",
): Exclude<MailboxFilter, "all"> {
  if (type === "payment_request") return "invoices";
  if (type === "escrow_fund") return "escrow";
  return "deals";
}

function mailboxCategory(
  message: LocalMailMessage,
): Exclude<MailboxFilter, "all"> {
  if (message.envelope.type === "composite") {
    const composite = parseCompositePayload(message.envelope.payload);
    if (composite?.body.trim()) return "letters";
    const first = composite?.attachments[0];
    return first ? attachmentCategory(first.type) : "letters";
  }
  switch (message.envelope.type) {
    case "text":
    case "contact_snapshot":
      return "letters";
    case "payment_request":
      return "invoices";
    case "escrow_fund":
    case "escrow_fill":
    case "escrow_claim":
    case "escrow_timeout":
      return "escrow";
    default:
      return "deals";
  }
}

/** Composite documents can appear under every matching secondary label. */
export function mailboxMatchesFilter(
  message: LocalMailMessage,
  filter: MailboxFilter,
): boolean {
  if (filter === "all") return true;
  if (message.envelope.type !== "composite") {
    return mailboxCategory(message) === filter;
  }
  const composite = parseCompositePayload(message.envelope.payload);
  if (!composite) return false;
  if (filter === "letters" && composite.body.trim()) return true;
  return composite.attachments.some(
    (attachment) => attachmentCategory(attachment.type) === filter,
  );
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

export type ConversationCorrespondent = {
  primary: string;
  detail?: string;
  fullAddress?: string;
};

export function conversationCorrespondent(
  message: LocalMailMessage,
  aliases: AliasRecord[],
  selfAddress: string,
): ConversationCorrespondent {
  const payload =
    message.envelope.type === "unsupported" ? null : message.envelope.payload;
  const address = (() => {
    switch (message.envelope.type) {
      case "offer":
        return parseOfferPayload(payload)?.offerer;
      case "payment_request":
        return parsePaymentRequestPayload(payload)?.requester;
      case "escrow_fund":
        return parseEscrowFundPayload(payload)?.maker;
      case "composite": {
        const composite = parseCompositePayload(payload);
        for (const attachment of composite?.attachments ?? []) {
          if (attachment.type === "offer") return attachment.payload.offerer;
          if (attachment.type === "payment_request") {
            return attachment.payload.requester;
          }
          if (attachment.type === "escrow_fund")
            return attachment.payload.maker;
        }
        return undefined;
      }
      default:
        return undefined;
    }
  })();

  if (address && (!selfAddress || !feltEquals(address, selfAddress))) {
    const alias = findAliasByAddress(aliases, address)?.label;
    return {
      primary: `Claimed address: ${address}`,
      detail: alias
        ? `Unauthenticated payload claim · local alias “${alias}”`
        : "Unauthenticated payload claim · verify out-of-band",
      fullAddress: address,
    };
  }
  if (
    message.direction === "outgoing" &&
    (message.recipients?.length ?? 0) > 0
  ) {
    return formatDeviceSentRecipients(message.recipients ?? [], aliases);
  }
  if (message.envelope.type === "contact_snapshot") {
    return {
      primary: "This mailbox",
      detail: "Encrypted self-backup · verify before restore",
    };
  }
  if (message.envelope.type === "text") {
    return {
      primary:
        message.direction === "outgoing"
          ? "Private recipient"
          : "Sealed sender",
      detail:
        message.direction === "outgoing"
          ? "Device-local Sent copy · recipient was not stored"
          : "Sealed letter · no public sender",
    };
  }
  if (message.direction === "outgoing") {
    return {
      primary: "Private recipient",
      detail: "Device-local Sent copy · recipient was not stored",
    };
  }
  return { primary: "Sealed counterparty" };
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
        ? `Offer ${formatBaseUnits(offer.give.amount, offer.give.token.decimals)} ${offer.give.token.symbol}`
        : "Deal offer";
    }
    case "accept": {
      const accept = parseAcceptPayload(payload);
      return accept
        ? `Settlement memo · ${formatBaseUnits(accept.transfer.amount, accept.transfer.token.decimals)} ${accept.transfer.token.symbol}`
        : "Settlement memo";
    }
    case "decline":
      return parseDeclinePayload(payload)?.reason || "Deal declined";
    case "receipt":
      return parseReceiptPayload(payload)
        ? "Transfer receipt claim"
        : "Receipt";
    case "payment_request": {
      const request = parsePaymentRequestPayload(payload);
      return request
        ? `Invoice · ${formatBaseUnits(request.amount, request.token.decimals)} ${request.token.symbol}`
        : "Invoice";
    }
    case "escrow_fund": {
      const fund = parseEscrowFundPayload(payload);
      return fund
        ? `Escrow deal · ${formatBaseUnits(fund.legA.amount, fund.legA.token.decimals)} ${fund.legA.token.symbol}`
        : "Escrow deal";
    }
    case "escrow_fill":
      return parseEscrowFillPayload(payload)
        ? "Escrow fill notice"
        : "Escrow update";
    case "escrow_claim":
      return parseEscrowClaimPayload(payload)
        ? "Escrow claim notice"
        : "Escrow update";
    case "escrow_timeout":
      return parseEscrowTimeoutPayload(payload)
        ? "Escrow timeout notice"
        : "Escrow update";
    case "contact_snapshot":
      return "Wallet + mailbox recovery phrase required";
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

function messageTime(message: LocalMailMessage): string {
  const milliseconds =
    message.localCreatedAt ??
    (message.blockTimestamp === undefined
      ? undefined
      : message.blockTimestamp * 1_000);
  if (milliseconds === undefined) return "—";
  const date = new Date(milliseconds);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
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

export default function ConversationList({
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
          “Unread/opened” is session-only and changes only after you activate a
          message while its reading pane is visible. Unsigned letters cannot
          reveal a sender address, so Mail labels them “Sealed sender.”
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
            return (
              <li key={message.id}>
                <button
                  className={`${styles.conversationItem} ${
                    selected ? styles.conversationItemActive : ""
                  }`}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(message.id)}
                >
                  <span className={styles.conversationTopline}>
                    <span className={styles.correspondentIdentity}>
                      <strong title={correspondent.fullAddress}>
                        <bdi>{correspondent.primary}</bdi>
                      </strong>
                      {correspondent.detail ? (
                        <small>{correspondent.detail}</small>
                      ) : null}
                    </span>
                    <time>{messageTime(message)}</time>
                  </span>
                  <span className={styles.conversationPreview}>
                    {messagePreview(message)}
                  </span>
                  <span className={styles.conversationMeta}>
                    <em className={styles.typeBadge}>
                      {envelopeLabel(message)}
                    </em>
                    <span
                      className={
                        unread ? styles.unreadIndicator : styles.readIndicator
                      }
                    >
                      {message.direction === "outgoing"
                        ? "POSTED ON-CHAIN"
                        : unread
                          ? "● UNREAD"
                          : message.envelope.type === "unsupported"
                            ? "UNSUPPORTED"
                            : "OPENED"}
                    </span>
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
