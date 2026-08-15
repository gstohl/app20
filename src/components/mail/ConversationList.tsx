"use client";

import { feltEquals } from "@/lib/addresses";
import { findAliasByAddress, type AliasRecord } from "@/lib/aliases";
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
import type { LocalMailMessage } from "./Thread";
import styles from "./mail.module.css";

export type MailboxFilter = "all" | "letters" | "deals" | "invoices" | "escrow";

export function mailboxCategory(message: LocalMailMessage): Exclude<MailboxFilter, "all"> {
  switch (message.envelope.type) {
    case "text":
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
    default:
      return "Unsupported";
  }
}

function shortAddress(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function displayAddress(
  address: string,
  aliases: AliasRecord[],
): string {
  return findAliasByAddress(aliases, address)?.label ?? shortAddress(address);
}

function correspondent(
  message: LocalMailMessage,
  aliases: AliasRecord[],
  selfAddress: string,
): string {
  const payload = message.envelope.type === "unsupported" ? null : message.envelope.payload;
  const address = (() => {
    switch (message.envelope.type) {
      case "offer":
        return parseOfferPayload(payload)?.offerer;
      case "payment_request":
        return parsePaymentRequestPayload(payload)?.requester;
      case "escrow_fund":
        return parseEscrowFundPayload(payload)?.maker;
      default:
        return undefined;
    }
  })();

  if (address && (!selfAddress || !feltEquals(address, selfAddress))) {
    return displayAddress(address, aliases);
  }
  if (message.envelope.type === "text") {
    return message.direction === "outgoing" ? "Private recipient" : "Sealed sender";
  }
  if (message.direction === "outgoing") return "Private recipient";
  return "Sealed counterparty";
}

function messagePreview(message: LocalMailMessage): string {
  const payload = message.envelope.type === "unsupported" ? null : message.envelope.payload;
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
      return parseReceiptPayload(payload) ? "Transfer receipt claim" : "Receipt";
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
      return parseEscrowFillPayload(payload) ? "Escrow fill notice" : "Escrow update";
    case "escrow_claim":
      return parseEscrowClaimPayload(payload) ? "Escrow claim notice" : "Escrow update";
    case "escrow_timeout":
      return parseEscrowTimeoutPayload(payload) ? "Escrow timeout notice" : "Escrow update";
    default:
      return "Unsupported decrypted record";
  }
}

function messageTime(message: LocalMailMessage): string {
  const milliseconds =
    message.localCreatedAt ??
    (message.blockTimestamp === undefined ? undefined : message.blockTimestamp * 1_000);
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
  filterLabel: string;
  onSelect: (messageId: string) => void;
};

export default function ConversationList({
  messages,
  selectedMessageId,
  readMessageIds,
  aliases,
  selfAddress,
  filterLabel,
  onSelect,
}: ConversationListProps) {
  return (
    <section className={styles.conversationRail} aria-label="Message list">
      <header className={styles.railHeading}>
        <div>
          <p className={styles.kicker}>SEALED CORRESPONDENCE</p>
          <h1>{filterLabel}</h1>
        </div>
        <span className={styles.messageTotal}>{messages.length}</span>
      </header>

      <div className={styles.railPrivacyNote}>
        <strong>Device-private index</strong>
        <span>
          Plaintext and aliases stay local. Unsigned letters cannot reveal a
          sender address, so Quietline labels them “Sealed sender.”
        </span>
      </div>

      {messages.length ? (
        <ol className={styles.conversationList}>
          {messages.map((message) => {
            const selected = selectedMessageId === message.id;
            const unread = message.direction !== "outgoing" && !readMessageIds.has(message.id);
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
                    <strong>{correspondent(message, aliases, selfAddress)}</strong>
                    <time>{messageTime(message)}</time>
                  </span>
                  <span className={styles.conversationPreview}>
                    {messagePreview(message)}
                  </span>
                  <span className={styles.conversationMeta}>
                    <em className={styles.typeBadge}>{envelopeLabel(message)}</em>
                    <span className={unread ? styles.unreadIndicator : styles.readIndicator}>
                      {unread ? "● UNREAD" : message.envelope.type === "unsupported" ? "UNSUPPORTED" : "OPENED"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={styles.railEmptyState}>
          <span className={styles.emptyEnvelope} aria-hidden="true">✉</span>
          <strong>No {filterLabel.toLowerCase()}</strong>
          <span>
            Check sealed envelopes, choose another mailbox, or compose a new
            document.
          </span>
        </div>
      )}
    </section>
  );
}
