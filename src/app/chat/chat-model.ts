import { mailMessageTimestampMs } from "@/app/inbox/mailbox-model";
import type {
  RfqLifecycleRecord,
  RfqLifecycleState,
} from "@/app/rfq/rfq-lifecycle";
import { rfqStateLabel } from "@/app/rfq/rfq-state-label";
import type { LocalMailMessage } from "@/components/mail/Thread";
import { shortenFelt } from "@/components/mail/correspondent";
import type { AddressBookEntry } from "@/lib/address-book";
import { canonicalizeStarknetAddress, feltEquals } from "@/lib/addresses";
import { findAliasByAddress, type AliasRecord } from "@/lib/aliases";
import { parseCompositePayload } from "@/lib/composite";
import {
  contractDealMatchesFund,
  parseEscrowClaimPayload,
  parseEscrowFillPayload,
  parseEscrowFundPayload,
  parseEscrowTimeoutPayload,
  type EscrowContractStatus,
  type EscrowDealRecord,
  type EscrowFundPayload,
  type EscrowState,
} from "@/lib/escrow";
import {
  formatBaseUnits,
  offerIsExpired,
  parseAcceptPayload,
  parseDeclinePayload,
  parseOfferPayload,
  parsePaymentRequestPayload,
  parseReceiptPayload,
  paymentRequestIsExpired,
  ONE_SIDED_WARNING,
  type DealRecord,
  type DealStatus,
  type OfferPayload,
  type OtcState,
  type PaymentRecord,
  type PaymentRequestPayload,
  type PaymentStatus,
  type ReceiptPayload,
} from "@/lib/otc";
import { sanitizeUntrustedText } from "@/lib/text";

/**
 * Chat is a per-counterparty reading of what this device already holds:
 * device-local Sent copies, imported payment links, and the OTC, payment and
 * escrow records Mailbox persisted while it read the chain. Nothing here is a
 * new store and nothing here is settlement authority; every record carries
 * the same caveats it carries in Mailbox.
 */

export type ChatContactNameSource = "address-book" | "alias" | "none";

export type ChatContact = Readonly<{
  address: string;
  label: string | null;
  nameSource: ChatContactNameSource;
  saved: boolean;
}>;

export type ChatRecordKind = "offer" | "invoice" | "escrow" | "payment";

export type ChatRecordTone = "accent" | "live" | "deal" | "muted" | "danger";

export type ChatRecordFacts = Readonly<{
  kind: ChatRecordKind;
  title: string;
  terms: string;
  status: string;
  tone: ChatRecordTone;
  /** Still awaiting a counterparty or this wallet. */
  open: boolean;
  expiresAt: number;
}>;

export type ChatRecord = Readonly<{
  id: string;
  facts: ChatRecordFacts;
  needsAction: string | null;
  offer?: OfferPayload;
  deal?: DealRecord;
  request?: PaymentRequestPayload;
  payment?: PaymentRecord;
  fund?: EscrowFundPayload;
  escrow?: EscrowDealRecord;
  /** Chain-read terms matched the encrypted announcement. */
  escrowTermsVerified?: boolean;
  receipt?: ReceiptPayload;
  /** A standalone private payment memo, or a claim about a deal leg. */
  receiptKind?: "payment" | "transfer";
}>;

export type ChatItemKind =
  | "letter"
  | "document"
  | "offer"
  | "invoice"
  | "escrow"
  | "receipt"
  | "memo"
  | "decline"
  | "unsupported";

export type ChatItemProvenance = "device-sent" | "payment-link" | "mailbox-record";

export type ChatItem = Readonly<{
  id: string;
  contact: string;
  direction: "incoming" | "outgoing";
  /** Milliseconds; undefined when no local or chain time is known. */
  at: number | undefined;
  kind: ChatItemKind;
  label: string;
  preview: string;
  body: string;
  provenance: ChatItemProvenance;
  needsAction: string | null;
  records: readonly ChatRecord[];
  message?: LocalMailMessage;
  /** Other recipients of the same device-local Sent copy. */
  otherRecipients: number;
}>;

export type ChatConversation = Readonly<{
  contact: ChatContact;
  /** Oldest first. */
  items: readonly ChatItem[];
  latest: ChatItem | null;
  unreadCount: number;
  needsAction: boolean;
}>;

export type ChatModelInput = Readonly<{
  selfAddress: string;
  /** Device-local Sent copies, already projected to mailbox messages. */
  sent: readonly LocalMailMessage[];
  /** Payment requests imported from /pay, projected the way Mailbox shows them. */
  paymentLinks: readonly LocalMailMessage[];
  otc: OtcState;
  escrow: EscrowState;
  addressBook: readonly AddressBookEntry[];
  aliases: readonly AliasRecord[];
  readIds: ReadonlySet<string>;
  /** Seconds. */
  now?: number;
}>;

export type ChatModel = Readonly<{
  /** Most recent activity first; contacts without records after that. */
  conversations: readonly ChatConversation[];
  /** Sent copies whose recipient this device never stored. */
  unattributedSent: number;
}>;

export type ChatContextSection = "rfq" | "payment" | "escrow";

export type ChatContextEntry = Readonly<{
  id: string;
  section: ChatContextSection;
  title: string;
  terms: string;
  status: string;
  tone: ChatRecordTone;
  open: boolean;
  direction: "incoming" | "outgoing" | "workspace";
  itemId?: string;
  record?: ChatRecord;
  rfq?: RfqLifecycleRecord;
}>;

export type ChatContactContext = Readonly<{
  rfqs: readonly ChatContextEntry[];
  payments: readonly ChatContextEntry[];
  escrows: readonly ChatContextEntry[];
}>;

export type ChatConversationFilter = Readonly<{
  search?: string;
  needsActionOnly?: boolean;
}>;

const DEAL_STATUS: Readonly<Record<DealStatus, string>> = Object.freeze({
  offered: "Open offer",
  accepted: "Accepted",
  closed: "Receipt posted",
  declined: "Declined",
  expired: "Expired",
});

const PAYMENT_STATUS: Readonly<Record<PaymentStatus, string>> = Object.freeze({
  requested: "Awaiting payment",
  paid: "Paid",
  expired: "Expired",
});

const ESCROW_STATUS: Readonly<Record<EscrowContractStatus, string>> =
  Object.freeze({
    empty: "Not funded on-chain",
    funded: "Funded · awaiting fill",
    filled: "Filled · claim pending",
    settled: "Settled on-chain",
    timed_out: "Refunded on-chain",
  });

const TERMINAL_RFQ_STATES: ReadonlySet<RfqLifecycleState> = new Set([
  "settled",
  "refunded",
  "cancelled",
  "refused",
  "quarantined",
  "reorged",
  "expired",
]);

const PREVIEW_MAX_CHARS = 160;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function canonical(address: string | undefined): string | null {
  if (!address) return null;
  try {
    return canonicalizeStarknetAddress(address);
  } catch {
    return null;
  }
}

function collapse(text: string): string {
  return sanitizeUntrustedText(text).replace(/\s+/g, " ").trim();
}

function amountLabel(value: {
  token: { symbol: string; decimals: number };
  amount: string;
}): string {
  const symbol = collapse(value.token.symbol) || "token";
  try {
    return `${formatBaseUnits(value.amount, value.token.decimals)} ${symbol}`;
  } catch {
    return `${value.amount} base units ${symbol}`;
  }
}

export function contactDisplayName(contact: ChatContact): string {
  return contact.label ?? shortenFelt(contact.address);
}

export function offerRecord(
  offer: OfferPayload,
  deal: DealRecord | undefined,
  own: boolean,
  now = nowSeconds(),
): ChatRecord {
  const status = deal?.status ?? "offered";
  const expired = status === "expired" || offerIsExpired(offer, now);
  const label =
    status === "offered" && expired ? DEAL_STATUS.expired : DEAL_STATUS[status];
  const open = !expired && (status === "offered" || status === "accepted");
  const unverifiedClaim = Boolean(
    deal?.counterpartyAcceptClaim || deal?.counterpartyReceiptClaim,
  );
  let needsAction: string | null = null;
  if (!own && status === "offered" && !expired) {
    needsAction = "Accept or decline this offer in Mailbox.";
  } else if (
    !own &&
    status === "accepted" &&
    deal?.settlementVerified &&
    !deal.receipt
  ) {
    needsAction = "Post the receipt for this accepted offer in Mailbox.";
  } else if (own && unverifiedClaim && !deal?.settlementVerified) {
    needsAction =
      "A counterparty claims to have settled this offer. Verify the transfer before releasing anything.";
  }
  const tone: ChatRecordTone =
    status === "offered" && !expired
      ? "accent"
      : status === "accepted" || status === "closed"
        ? "live"
        : "muted";
  return {
    id: `deal:${offer.dealId}`,
    facts: {
      kind: "offer",
      title: "Offer",
      terms: `${amountLabel(offer.give)} for ${amountLabel(offer.want)}`,
      status: unverifiedClaim && !deal?.settlementVerified
        ? `${label} · unverified claim`
        : label,
      tone,
      open,
      expiresAt: offer.expiresAt,
    },
    needsAction,
    offer,
    ...(deal ? { deal } : {}),
  };
}

export function invoiceRecord(
  request: PaymentRequestPayload,
  payment: PaymentRecord | undefined,
  own: boolean,
  now = nowSeconds(),
): ChatRecord {
  const status = payment?.status ?? "requested";
  const expired =
    status === "expired" || paymentRequestIsExpired(request, now);
  const operation = payment?.paymentOperation?.state;
  const inProgress =
    operation === "awaiting-note-maturity" ||
    operation === "reserved" ||
    operation === "submitted";
  const label =
    status === "paid"
      ? payment?.paymentVerified
        ? "Paid · verified locally"
        : "Paid · unverified claim"
      : expired
        ? PAYMENT_STATUS.expired
        : operation === "awaiting-note-maturity"
          ? "Paying · awaiting note maturity"
          : inProgress
            ? "Payment in progress"
            : own
              ? PAYMENT_STATUS.requested
              : "Payment requested from you";
  const open = !expired && status === "requested";
  let needsAction: string | null = null;
  if (!own && open && !inProgress) {
    needsAction = "Pay this request in Mailbox after verifying the requester.";
  } else if (
    own &&
    payment?.counterpartyPaymentClaim &&
    !payment.paymentVerified
  ) {
    needsAction =
      "A counterparty claims to have paid this request. Verify the transfer before treating it as settled.";
  }
  const memo = request.memo ? collapse(request.memo).slice(0, 80) : "";
  return {
    id: `payment:${request.requestId}`,
    facts: {
      kind: "invoice",
      title: "Invoice",
      terms: memo ? `${amountLabel(request)} · ${memo}` : amountLabel(request),
      status: label,
      tone:
        status === "paid"
          ? payment?.paymentVerified
            ? "live"
            : "deal"
          : open
            ? "accent"
            : "muted",
      open,
      expiresAt: request.expiresAt,
    },
    needsAction,
    request,
    ...(payment ? { payment } : {}),
  };
}

export function escrowRecord(
  fund: EscrowFundPayload,
  escrow: EscrowDealRecord | undefined,
  own: boolean,
  now = nowSeconds(),
): ChatRecord {
  const status = escrow?.chainStatus;
  const expired = fund.deadline <= now;
  const termsVerified = Boolean(
    escrow?.chainDeal &&
      escrow.chainDeal.status !== "empty" &&
      contractDealMatchesFund(escrow.chainDeal, fund),
  );
  const label = status ? ESCROW_STATUS[status] : "Contract state not read yet";
  const open = status === undefined || status === "funded" || status === "filled";
  let needsAction: string | null = null;
  if (!own && status === "funded" && termsVerified && !expired) {
    needsAction = "Deposit leg B in Mailbox to receive leg A.";
  } else if (own && status === "filled") {
    needsAction = "Claim leg B in Mailbox.";
  } else if (own && status === "funded" && expired) {
    needsAction = "The fill deadline passed. Refund leg A in Mailbox.";
  }
  return {
    id: `escrow:${fund.dealId}`,
    facts: {
      kind: "escrow",
      title: "Escrow",
      terms: `${amountLabel(fund.legA)} against ${amountLabel(fund.legB)}`,
      status: expired && status === "funded" ? `${label} · deadline passed` : label,
      tone:
        status === "settled"
          ? "live"
          : status === "funded" || status === "filled"
            ? "accent"
            : status === undefined
              ? "deal"
              : "muted",
      open,
      expiresAt: fund.deadline,
    },
    needsAction,
    fund,
    ...(escrow ? { escrow } : {}),
    escrowTermsVerified: termsVerified,
  };
}

function receiptRecord(
  receipt: ReceiptPayload,
  own: boolean,
  standalonePayment: boolean,
): ChatRecord {
  return {
    id: `receipt:${receipt.dealId}:${receipt.txHash}`,
    facts: {
      kind: "payment",
      title: standalonePayment ? "Private payment" : "Transfer claim",
      terms: amountLabel(receipt.transfer),
      status: own ? "Submitted from this device" : "Unverified counterparty claim",
      tone: own ? "live" : "deal",
      open: false,
      expiresAt: 0,
    },
    needsAction: null,
    receipt,
    receiptKind: standalonePayment ? "payment" : "transfer",
  };
}

type PartialItem = Omit<ChatItem, "contact" | "otherRecipients">;

function baseItem(
  message: LocalMailMessage,
  provenance: ChatItemProvenance,
  direction: "incoming" | "outgoing",
): Pick<ChatItem, "id" | "at" | "provenance" | "direction" | "message"> {
  return {
    id: message.id,
    at: mailMessageTimestampMs(message),
    provenance,
    direction,
    message,
  };
}

function recordsPreview(records: readonly ChatRecord[]): string {
  return records
    .map((record) => `${record.facts.title}: ${record.facts.terms}`)
    .join(" · ");
}

function firstAction(records: readonly ChatRecord[]): string | null {
  return records.find((record) => record.needsAction)?.needsAction ?? null;
}

function unsupportedItem(
  message: LocalMailMessage,
  direction: "incoming" | "outgoing",
): PartialItem {
  return {
    ...baseItem(message, "device-sent", direction),
    kind: "unsupported",
    label: "Unsupported",
    preview: "This record could not be read",
    body: "",
    needsAction: null,
    records: [],
  };
}

/** A device-local Sent copy, read as one outgoing chat item. */
export function sentItemFor(
  message: LocalMailMessage,
  input: Pick<ChatModelInput, "otc" | "escrow">,
  now = nowSeconds(),
): PartialItem {
  const { envelope } = message;
  const base = baseItem(message, "device-sent", "outgoing");
  const payload = envelope.type === "unsupported" ? null : envelope.payload;
  switch (envelope.type) {
    case "text": {
      const body = sanitizeUntrustedText(message.plaintext);
      return {
        ...base,
        kind: "letter",
        label: "Letter",
        preview: collapse(body).slice(0, PREVIEW_MAX_CHARS) || "Empty letter",
        body,
        needsAction: null,
        records: [],
      };
    }
    case "composite": {
      const composite = parseCompositePayload(payload);
      if (!composite) return unsupportedItem(message, "outgoing");
      const records = composite.attachments.map((attachment) => {
        switch (attachment.type) {
          case "offer":
            return offerRecord(
              attachment.payload,
              input.otc.deals[attachment.payload.dealId],
              true,
              now,
            );
          case "payment_request":
            return invoiceRecord(
              attachment.payload,
              input.otc.payments[attachment.payload.requestId],
              true,
              now,
            );
          case "escrow_fund":
            return escrowRecord(
              attachment.payload,
              input.escrow.deals[attachment.payload.dealId],
              true,
              now,
            );
          default:
            return receiptRecord(
              {
                dealId: attachment.payload.dealId,
                txHash: message.transactionHash,
                transfer: attachment.payload.transfer,
                warning: ONE_SIDED_WARNING,
              },
              true,
              true,
            );
        }
      });
      const body = composite.body;
      const preview = collapse(body).slice(0, PREVIEW_MAX_CHARS);
      return {
        ...base,
        kind: records.length ? "document" : "letter",
        label: records.length ? "Document" : "Letter",
        preview: preview || recordsPreview(records) || "Empty letter",
        body,
        needsAction: firstAction(records),
        records,
      };
    }
    case "offer": {
      const offer = parseOfferPayload(payload);
      if (!offer) return unsupportedItem(message, "outgoing");
      const record = offerRecord(offer, input.otc.deals[offer.dealId], true, now);
      return {
        ...base,
        kind: "offer",
        label: "Offer",
        preview: record.facts.terms,
        body: "",
        needsAction: record.needsAction,
        records: [record],
      };
    }
    case "payment_request": {
      const request = parsePaymentRequestPayload(payload);
      if (!request) return unsupportedItem(message, "outgoing");
      const record = invoiceRecord(
        request,
        input.otc.payments[request.requestId],
        true,
        now,
      );
      return {
        ...base,
        kind: "invoice",
        label: "Invoice",
        preview: record.facts.terms,
        body: "",
        needsAction: record.needsAction,
        records: [record],
      };
    }
    case "escrow_fund": {
      const fund = parseEscrowFundPayload(payload);
      if (!fund) return unsupportedItem(message, "outgoing");
      const record = escrowRecord(fund, input.escrow.deals[fund.dealId], true, now);
      return {
        ...base,
        kind: "escrow",
        label: "Escrow",
        preview: record.facts.terms,
        body: "",
        needsAction: record.needsAction,
        records: [record],
      };
    }
    case "accept": {
      const accept = parseAcceptPayload(payload);
      if (!accept) return unsupportedItem(message, "outgoing");
      return {
        ...base,
        kind: "memo",
        label: "Memo",
        preview: `${amountLabel(accept.transfer)} sent to settle ${accept.dealId.slice(0, 10)}…`,
        body: "",
        needsAction: null,
        records: [],
      };
    }
    case "receipt": {
      const receipt = parseReceiptPayload(payload);
      if (!receipt) return unsupportedItem(message, "outgoing");
      const record = receiptRecord(receipt, true, false);
      return {
        ...base,
        kind: "receipt",
        label: "Receipt",
        preview: `Receipt for ${record.facts.terms}`,
        body: "",
        needsAction: null,
        records: [record],
      };
    }
    case "decline": {
      const decline = parseDeclinePayload(payload);
      if (!decline) return unsupportedItem(message, "outgoing");
      return {
        ...base,
        kind: "decline",
        label: "Declined",
        preview: decline.reason ? collapse(decline.reason) : "Offer declined",
        body: decline.reason ? sanitizeUntrustedText(decline.reason) : "",
        needsAction: null,
        records: [],
      };
    }
    case "escrow_fill":
    case "escrow_claim":
    case "escrow_timeout": {
      const update =
        envelope.type === "escrow_fill"
          ? parseEscrowFillPayload(payload)
          : envelope.type === "escrow_claim"
            ? parseEscrowClaimPayload(payload)
            : parseEscrowTimeoutPayload(payload);
      if (!update) return unsupportedItem(message, "outgoing");
      const operation = envelope.type.slice("escrow_".length);
      return {
        ...base,
        kind: "memo",
        label: "Escrow notice",
        preview: `Escrow ${operation} notice for deal ${update.dealId.slice(0, 10)}…`,
        body: "",
        needsAction: null,
        records: [],
      };
    }
    default:
      return unsupportedItem(message, "outgoing");
  }
}

function paymentLinkItem(
  message: LocalMailMessage,
  request: PaymentRequestPayload,
  payment: PaymentRecord | undefined,
  now: number,
): PartialItem {
  const record = invoiceRecord(request, payment, false, now);
  return {
    ...baseItem(message, "payment-link", "incoming"),
    kind: "invoice",
    label: "Invoice",
    preview: record.facts.terms,
    body: "",
    needsAction: record.needsAction,
    records: [record],
  };
}

function recordItem(
  id: string,
  record: ChatRecord,
  kind: ChatItemKind,
  label: string,
  at: number | undefined,
): PartialItem {
  return {
    id,
    at,
    provenance: "mailbox-record",
    direction: "incoming",
    kind,
    label,
    preview: record.facts.terms,
    body: "",
    needsAction: record.needsAction,
    records: [record],
  };
}

function compareItems(left: ChatItem, right: ChatItem): number {
  const difference = (left.at ?? 0) - (right.at ?? 0);
  if (difference) return difference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function contactFor(
  address: string,
  addressBook: readonly AddressBookEntry[],
  aliases: readonly AliasRecord[],
): ChatContact {
  const entry = addressBook.find((candidate) =>
    feltEquals(candidate.address, address),
  );
  if (entry) {
    return {
      address,
      label: entry.label,
      nameSource: "address-book",
      saved: true,
    };
  }
  const alias = findAliasByAddress(aliases, address);
  if (alias) {
    return { address, label: alias.label, nameSource: "alias", saved: false };
  }
  return { address, label: null, nameSource: "none", saved: false };
}

function compareConversations(
  left: ChatConversation,
  right: ChatConversation,
): number {
  const leftAt = left.latest?.at ?? -1;
  const rightAt = right.latest?.at ?? -1;
  if (leftAt !== rightAt) return rightAt - leftAt;
  const leftName = contactDisplayName(left.contact).toLowerCase();
  const rightName = contactDisplayName(right.contact).toLowerCase();
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
}

export function buildChatModel(input: ChatModelInput): ChatModel {
  const self = canonical(input.selfAddress);
  const now = input.now ?? nowSeconds();
  const itemsByContact = new Map<string, ChatItem[]>();
  const push = (contact: string, item: ChatItem) => {
    const existing = itemsByContact.get(contact);
    if (existing) existing.push(item);
    else itemsByContact.set(contact, [item]);
  };

  const sentDealIds = new Set<string>();
  const sentRequestIds = new Set<string>();
  const sentEscrowIds = new Set<string>();
  let unattributedSent = 0;

  for (const message of input.sent) {
    const partial = sentItemFor(message, input, now);
    for (const record of partial.records) {
      if (record.offer) sentDealIds.add(record.offer.dealId);
      if (record.request) sentRequestIds.add(record.request.requestId);
      if (record.fund) sentEscrowIds.add(record.fund.dealId);
    }
    const stored = message.recipients ?? [];
    const recipients = [
      ...new Set(
        stored
          .map(canonical)
          .filter((address): address is string => address !== null),
      ),
    ].filter((address) => !self || !feltEquals(address, self));
    if (!recipients.length) {
      // Self-mail (backups, self-tests) is Mailbox's business; a copy with no
      // stored recipient at all is counted so the rail can say so.
      if (stored.length === 0) unattributedSent += 1;
      continue;
    }
    for (const recipient of recipients) {
      push(recipient, {
        ...partial,
        contact: recipient,
        otherRecipients: recipients.length - 1,
      });
    }
  }

  for (const message of input.paymentLinks) {
    if (message.envelope.type !== "payment_request") continue;
    const request = parsePaymentRequestPayload(message.envelope.payload);
    if (!request) continue;
    const requester = canonical(request.requester);
    if (!requester || (self && feltEquals(requester, self))) continue;
    push(requester, {
      ...paymentLinkItem(
        message,
        request,
        input.otc.payments[request.requestId],
        now,
      ),
      contact: requester,
      otherRecipients: 0,
    });
  }

  for (const deal of Object.values(input.otc.deals)) {
    if (sentDealIds.has(deal.dealId)) continue;
    const offerer = canonical(deal.offer.offerer);
    if (!offerer || (self && feltEquals(offerer, self))) continue;
    const record = offerRecord(deal.offer, deal, false, now);
    push(offerer, {
      ...recordItem(
        `record:${record.id}`,
        record,
        "offer",
        "Offer",
        deal.updatedAt * 1_000,
      ),
      contact: offerer,
      otherRecipients: 0,
    });
  }

  for (const payment of Object.values(input.otc.payments)) {
    if (sentRequestIds.has(payment.requestId)) continue;
    if (payment.origin === "payment_link") continue;
    const requester = canonical(payment.request.requester);
    if (!requester || (self && feltEquals(requester, self))) continue;
    const record = invoiceRecord(payment.request, payment, false, now);
    push(requester, {
      ...recordItem(
        `record:${record.id}`,
        record,
        "invoice",
        "Invoice",
        payment.updatedAt * 1_000,
      ),
      contact: requester,
      otherRecipients: 0,
    });
  }

  for (const escrow of Object.values(input.escrow.deals)) {
    if (sentEscrowIds.has(escrow.dealId)) continue;
    const maker = canonical(escrow.fund.maker);
    if (!maker || (self && feltEquals(maker, self))) continue;
    const record = escrowRecord(escrow.fund, escrow, false, now);
    push(maker, {
      ...recordItem(
        `record:${record.id}`,
        record,
        "escrow",
        "Escrow",
        escrow.updatedAt * 1_000,
      ),
      contact: maker,
      otherRecipients: 0,
    });
  }

  const contacts = new Set(itemsByContact.keys());
  for (const entry of input.addressBook) {
    const address = canonical(entry.address);
    if (address && (!self || !feltEquals(address, self))) contacts.add(address);
  }

  const conversations: ChatConversation[] = [];
  for (const address of contacts) {
    const items = (itemsByContact.get(address) ?? []).slice().sort(compareItems);
    const unreadCount = items.filter(
      (item) => item.direction === "incoming" && !input.readIds.has(item.id),
    ).length;
    conversations.push({
      contact: contactFor(address, input.addressBook, input.aliases),
      items,
      latest: items.length ? items[items.length - 1] : null,
      unreadCount,
      needsAction: items.some((item) => item.needsAction !== null),
    });
  }
  conversations.sort(compareConversations);
  return { conversations, unattributedSent };
}

function conversationHaystack(conversation: ChatConversation): string {
  return [
    conversation.contact.label ?? "",
    conversation.contact.address,
    ...conversation.items.flatMap((item) => [
      item.label,
      item.preview,
      ...item.records.map(
        (record) => `${record.facts.title} ${record.facts.status}`,
      ),
    ]),
  ]
    .join("\n")
    .toLowerCase();
}

/** Search reads only what this device already holds; nothing leaves the browser. */
export function filterConversations(
  conversations: readonly ChatConversation[],
  filter: ChatConversationFilter,
): ChatConversation[] {
  const needle = filter.search?.trim().toLowerCase() ?? "";
  return conversations.filter((conversation) => {
    if (filter.needsActionOnly && !conversation.needsAction) return false;
    if (!needle) return true;
    return conversationHaystack(conversation).includes(needle);
  });
}

/** Whether a workspace RFQ names this contact as one of its makers. */
export function rfqNamesContact(
  record: Pick<RfqLifecycleRecord, "selectedQuote" | "fills">,
  contact: ChatContact,
): boolean {
  const makerIds = [
    record.selectedQuote?.solverId,
    ...(record.fills ?? []).map((fill) => fill.makerId),
  ].filter((value): value is string => typeof value === "string" && value !== "");
  if (!makerIds.length) return false;
  const label = contact.label?.trim().toLowerCase();
  return makerIds.some(
    (makerId) =>
      (label !== undefined && label !== "" && makerId.toLowerCase() === label) ||
      feltEquals(makerId, contact.address),
  );
}

function rfqEntry(record: RfqLifecycleRecord): ChatContextEntry {
  const terms = record.terms
    ? `${amountLabel({
        token: { symbol: record.terms.sellSymbol, decimals: record.terms.sellDecimals },
        amount: record.terms.sellAmount,
      })} → ${collapse(record.terms.buySymbol)}`
    : "Terms not stored";
  const open = !TERMINAL_RFQ_STATES.has(record.state);
  return {
    id: `rfq:${record.rfqId}`,
    section: "rfq",
    title: record.mode === "v3" ? "Workspace RFQ v3" : "Workspace RFQ",
    terms,
    status: rfqStateLabel(record.state, record.mode),
    tone: open ? "accent" : "muted",
    open,
    direction: "workspace",
    rfq: record,
  };
}

function recordEntry(
  section: ChatContextSection,
  item: ChatItem,
  record: ChatRecord,
): ChatContextEntry {
  return {
    id: `${item.id}/${record.id}`,
    section,
    title: record.facts.title,
    terms: record.facts.terms,
    status: record.facts.status,
    tone: record.facts.tone,
    open: record.facts.open,
    direction: item.direction,
    itemId: item.id,
    record,
  };
}

function openFirst(entries: ChatContextEntry[]): ChatContextEntry[] {
  return entries.sort((left, right) => Number(right.open) - Number(left.open));
}

/**
 * What the right rail says about one contact: open bilateral offers and any
 * workspace RFQ that names them, payments still pending, and every escrow.
 * Workspace RFQs are multi-maker requests; they stay in the RFQ workspace and
 * are only mirrored here when a maker id matches this contact.
 */
export function buildContactContext(
  conversation: ChatConversation,
  rfqRecords: readonly RfqLifecycleRecord[] = [],
): ChatContactContext {
  const rfqs: ChatContextEntry[] = [];
  const payments: ChatContextEntry[] = [];
  const escrows: ChatContextEntry[] = [];
  for (const item of conversation.items.slice().reverse()) {
    for (const record of item.records) {
      if (record.facts.kind === "offer" && record.facts.open) {
        rfqs.push(recordEntry("rfq", item, record));
      } else if (
        record.facts.kind === "invoice" &&
        (record.facts.open ||
          record.payment?.paymentOperation?.state === "awaiting-note-maturity" ||
          record.payment?.paymentOperation?.state === "submitted" ||
          record.payment?.paymentOperation?.state === "reserved")
      ) {
        payments.push(recordEntry("payment", item, record));
      } else if (record.facts.kind === "escrow") {
        escrows.push(recordEntry("escrow", item, record));
      }
    }
  }
  for (const record of rfqRecords) {
    if (!rfqNamesContact(record, conversation.contact)) continue;
    if (TERMINAL_RFQ_STATES.has(record.state)) continue;
    rfqs.push(rfqEntry(record));
  }
  return {
    rfqs,
    payments,
    escrows: openFirst(escrows),
  };
}

/** Incoming items in a conversation this device has not opened in Chat yet. */
export function unreadItemIds(conversation: ChatConversation): string[] {
  return conversation.items
    .filter((item) => item.direction === "incoming")
    .map((item) => item.id);
}
