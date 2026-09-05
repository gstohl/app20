import { mailMessageTimestampMs } from "@/app/chat/mailbox-model";
import type {
  RfqLifecycleRecord,
  RfqLifecycleState,
} from "@/app/rfq/rfq-lifecycle";
import { rfqStateLabel } from "@/app/rfq/rfq-state-label";
import type { LocalMailMessage } from "@/components/mail/message";
import { shortenFelt } from "@/components/mail/correspondent";
import type { AddressBookEntry } from "@/lib/address-book";
import { canonicalizeStarknetAddress, feltEquals } from "@/lib/addresses";
import { findAliasByAddress, type AliasRecord } from "@/lib/aliases";
import { parseBackupPointer } from "@/lib/backup-blob";
import { decodeBackupSnapshot } from "@/lib/backup-snapshot";
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
import { claimedFinancialAddress } from "@/lib/mail-correspondents";
import {
  conversationFieldsFromPayload,
  conversationKeyForMessage,
} from "@/lib/mail-thread";
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
 * Chat is the mailbox read one counterparty at a time. Every record here is
 * a mailbox record: a decrypted letter, a device-local Sent copy, an imported
 * payment link, or the OTC, payment and escrow state saved while reading the
 * chain. Nothing here is settlement authority, and every record carries the
 * same caveats it always carried.
 *
 * MessagePosted has no sender, so a decrypted record joins a counterparty's
 * conversation only through evidence this device holds: a name assigned on
 * this device, an address claimed inside the payload (never authenticated),
 * or the thread it replies to. Anything else stays a sealed thread until it
 * is named.
 */

export type ChatContactKind = "counterparty" | "self" | "sealed";

export type ChatContactNameSource = "address-book" | "alias" | "none";

export type ChatContact = Readonly<{
  /** Canonical address for a counterparty, "self", or the sealed thread key. */
  key: string;
  kind: ChatContactKind;
  address: string | null;
  label: string | null;
  nameSource: ChatContactNameSource;
  saved: boolean;
  /** The mailbox conversation a sealed thread is keyed under. */
  threadKey?: string;
}>;

export const SELF_CONVERSATION_KEY = "self";
const SEALED_KEY_PREFIX = "sealed:";

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
  /** This wallet issued the record. */
  own: boolean;
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
  | "backup"
  | "unsupported";

export type ChatItemProvenance =
  | "device-sent"
  | "decrypted"
  | "payment-link"
  | "mailbox-record";

export type ChatItem = Readonly<{
  id: string;
  conversationKey: string;
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
  /** For backup self-mail: what the snapshot restores. */
  backupKind?: "contacts" | "rfq-resume";
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
  /** Every visible mailbox record, decrypted or device-local, any direction. */
  messages: readonly LocalMailMessage[];
  otc: OtcState;
  escrow: EscrowState;
  addressBook: readonly AddressBookEntry[];
  aliases: readonly AliasRecord[];
  readIds: ReadonlySet<string>;
  /** Addresses opened as conversations this session without any record yet. */
  extraContacts?: readonly string[];
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

export function sealedConversationKey(threadKey: string): string {
  return `${SEALED_KEY_PREFIX}${threadKey}`;
}

export function contactDisplayName(contact: ChatContact): string {
  if (contact.kind === "self") return "This mailbox";
  if (contact.kind === "sealed") return "Sealed sender";
  return contact.label ?? shortenFelt(contact.address ?? "");
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
    needsAction = "Accept or decline this offer.";
  } else if (
    !own &&
    status === "accepted" &&
    deal?.settlementVerified &&
    !deal.receipt
  ) {
    needsAction = "Post the receipt for this accepted offer.";
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
      status:
        unverifiedClaim && !deal?.settlementVerified
          ? `${label} · unverified claim`
          : label,
      tone,
      open,
      expiresAt: offer.expiresAt,
    },
    needsAction,
    own,
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
    needsAction = "Pay this request after verifying the requester.";
  } else if (!own && open && operation === "awaiting-note-maturity") {
    needsAction = `Complete the payment once the ${collapse(request.token.symbol) || "token"} note matures.`;
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
    own,
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
  const open =
    status === undefined || status === "funded" || status === "filled";
  let needsAction: string | null = null;
  if (!own && status === "funded" && termsVerified && !expired) {
    needsAction = "Deposit leg B to receive leg A.";
  } else if (own && status === "filled") {
    needsAction = "Claim leg B.";
  } else if (own && status === "funded" && expired) {
    needsAction = "The fill deadline passed. Refund leg A.";
  }
  return {
    id: `escrow:${fund.dealId}`,
    facts: {
      kind: "escrow",
      title: "Escrow",
      terms: `${amountLabel(fund.legA)} against ${amountLabel(fund.legB)}`,
      status:
        expired && status === "funded" ? `${label} · deadline passed` : label,
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
    own,
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
      status: own
        ? "Submitted from this device"
        : "Unverified counterparty claim",
      tone: own ? "live" : "deal",
      open: false,
      expiresAt: 0,
    },
    needsAction: null,
    own,
    receipt,
    receiptKind: standalonePayment ? "payment" : "transfer",
  };
}

type PartialItem = Omit<ChatItem, "conversationKey" | "otherRecipients">;

/** The document id a record carries, in its payload or on its local copy. */
function stableDocumentId(message: LocalMailMessage): string | undefined {
  const fields = conversationFieldsFromPayload(
    message.envelope.type,
    message.envelope.type === "unsupported" ? null : message.envelope.payload,
  );
  return fields.documentId ?? message.documentId;
}

function compositeAttachments(
  payload: unknown,
): Array<{ type: string; payload: unknown }> {
  const composite = parseCompositePayload(payload);
  return composite ? composite.attachments : [];
}

function idList(...ids: Array<string | undefined>): string[] {
  return ids.filter((id): id is string => typeof id === "string" && id !== "");
}

/** The deals, requests and escrows a record opens: its author owns them. */
function openedDealIds(message: LocalMailMessage): string[] {
  const payload =
    message.envelope.type === "unsupported" ? null : message.envelope.payload;
  switch (message.envelope.type) {
    case "offer":
      return idList(parseOfferPayload(payload)?.dealId);
    case "payment_request":
      return idList(parsePaymentRequestPayload(payload)?.requestId);
    case "escrow_fund":
      return idList(parseEscrowFundPayload(payload)?.dealId);
    case "composite":
      return compositeAttachments(payload).flatMap((attachment) => {
        const fields = attachment.payload as {
          dealId?: string;
          requestId?: string;
        };
        if (attachment.type === "payment_request") return idList(fields.requestId);
        return idList(fields.dealId);
      });
    default:
      return [];
  }
}

/** The deal, request or escrow a memo answers: the other side sent it. */
function answeredDealIds(message: LocalMailMessage): string[] {
  const payload =
    message.envelope.type === "unsupported" ? null : message.envelope.payload;
  switch (message.envelope.type) {
    case "accept":
      return idList(parseAcceptPayload(payload)?.dealId);
    case "decline":
      return idList(parseDeclinePayload(payload)?.dealId);
    case "receipt":
      return idList(parseReceiptPayload(payload)?.dealId);
    case "escrow_fill":
      return idList(parseEscrowFillPayload(payload)?.dealId);
    case "escrow_claim":
      return idList(parseEscrowClaimPayload(payload)?.dealId);
    case "escrow_timeout":
      return idList(parseEscrowTimeoutPayload(payload)?.dealId);
    default:
      return [];
  }
}

function messageDirection(message: LocalMailMessage): "incoming" | "outgoing" {
  return message.direction === "outgoing" ? "outgoing" : "incoming";
}

function messageProvenance(message: LocalMailMessage): ChatItemProvenance {
  if (message.transport === "payment_link") return "payment-link";
  return messageDirection(message) === "outgoing" ? "device-sent" : "decrypted";
}

function baseItem(
  message: LocalMailMessage,
): Pick<ChatItem, "id" | "at" | "provenance" | "direction" | "message"> {
  return {
    id: message.id,
    at: mailMessageTimestampMs(message),
    provenance: messageProvenance(message),
    direction: messageDirection(message),
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

function unsupportedItem(message: LocalMailMessage): PartialItem {
  return {
    ...baseItem(message),
    kind: "unsupported",
    label: "Unsupported",
    preview: "This record could not be read",
    body: "",
    needsAction: null,
    records: [],
  };
}

function backupKindOf(
  message: LocalMailMessage,
): "contacts" | "rfq-resume" | null {
  try {
    if (message.envelope.type === "contact_snapshot") return "contacts";
    if (message.envelope.type === "backup_snapshot") {
      return decodeBackupSnapshot(message.envelope.payload).kind;
    }
    if (message.envelope.type === "backup_pointer") {
      return parseBackupPointer(message.envelope.payload).kind;
    }
  } catch {
    // A malformed backup-shaped record stays visibly unsupported.
  }
  return null;
}

function isBackupEnvelope(message: LocalMailMessage): boolean {
  return (
    message.envelope.type === "contact_snapshot" ||
    message.envelope.type === "backup_snapshot" ||
    message.envelope.type === "backup_pointer"
  );
}

/** One mailbox record, read as a chat item. The wallet decides ownership per payload. */
export function messageItemFor(
  message: LocalMailMessage,
  input: Pick<ChatModelInput, "otc" | "escrow" | "selfAddress">,
  now = nowSeconds(),
): PartialItem {
  const { envelope } = message;
  const base = baseItem(message);
  const self = canonical(input.selfAddress);
  const outgoing = base.direction === "outgoing";
  const ownsAddress = (claimed: string): boolean =>
    self ? feltEquals(claimed, self) : outgoing;
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
      if (!composite) return unsupportedItem(message);
      const records = composite.attachments.map((attachment) => {
        switch (attachment.type) {
          case "offer":
            return offerRecord(
              attachment.payload,
              input.otc.deals[attachment.payload.dealId],
              ownsAddress(attachment.payload.offerer),
              now,
            );
          case "payment_request":
            return invoiceRecord(
              attachment.payload,
              input.otc.payments[attachment.payload.requestId],
              ownsAddress(attachment.payload.requester),
              now,
            );
          case "escrow_fund":
            return escrowRecord(
              attachment.payload,
              input.escrow.deals[attachment.payload.dealId],
              ownsAddress(attachment.payload.maker),
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
              outgoing,
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
      if (!offer) return unsupportedItem(message);
      const record = offerRecord(
        offer,
        input.otc.deals[offer.dealId],
        ownsAddress(offer.offerer),
        now,
      );
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
      if (!request) return unsupportedItem(message);
      const record = invoiceRecord(
        request,
        input.otc.payments[request.requestId],
        ownsAddress(request.requester),
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
      if (!fund) return unsupportedItem(message);
      const record = escrowRecord(
        fund,
        input.escrow.deals[fund.dealId],
        ownsAddress(fund.maker),
        now,
      );
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
      if (!accept) return unsupportedItem(message);
      const isPayment = Boolean(input.otc.payments[accept.dealId]);
      return {
        ...base,
        kind: "memo",
        label: isPayment ? "Payment memo" : "Accept memo",
        preview: outgoing
          ? `${amountLabel(accept.transfer)} sent to settle ${accept.dealId.slice(0, 10)}…`
          : `Claims ${amountLabel(accept.transfer)} was sent to settle ${accept.dealId.slice(0, 10)}…`,
        body: "",
        needsAction: null,
        records: [],
      };
    }
    case "receipt": {
      const receipt = parseReceiptPayload(payload);
      if (!receipt) return unsupportedItem(message);
      const record = receiptRecord(receipt, outgoing, false);
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
      if (!decline) return unsupportedItem(message);
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
      if (!update) return unsupportedItem(message);
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
    case "contact_snapshot":
    case "backup_snapshot":
    case "backup_pointer": {
      const kind = backupKindOf(message);
      if (!kind) return unsupportedItem(message);
      return {
        ...base,
        kind: "backup",
        label: kind === "contacts" ? "Contact backup" : "RFQ history backup",
        preview:
          kind === "contacts"
            ? "Encrypted contact backup · wallet + mailbox recovery phrase required"
            : "Encrypted RFQ history backup · verification-only",
        body: "",
        needsAction: null,
        records: [],
        backupKind: kind,
      };
    }
    default:
      return unsupportedItem(message);
  }
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
      key: address,
      kind: "counterparty",
      address,
      label: entry.label,
      nameSource: "address-book",
      saved: true,
    };
  }
  const alias = findAliasByAddress(aliases, address);
  if (alias) {
    return {
      key: address,
      kind: "counterparty",
      address,
      label: alias.label,
      nameSource: "alias",
      saved: false,
    };
  }
  return {
    key: address,
    kind: "counterparty",
    address,
    label: null,
    nameSource: "none",
    saved: false,
  };
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

type Placement =
  | { key: string; kind: "counterparty"; address: string }
  | { key: typeof SELF_CONVERSATION_KEY; kind: "self" }
  | { key: string; kind: "sealed"; threadKey: string };

export function buildChatModel(input: ChatModelInput): ChatModel {
  const self = canonical(input.selfAddress);
  const now = input.now ?? nowSeconds();
  const isSelf = (address: string) => Boolean(self && feltEquals(address, self));
  const itemsByKey = new Map<string, ChatItem[]>();
  const placements = new Map<string, Placement>();
  const push = (placement: Placement, item: ChatItem) => {
    placements.set(placement.key, placement);
    const existing = itemsByKey.get(placement.key);
    if (existing) existing.push(item);
    else itemsByKey.set(placement.key, [item]);
  };

  const sentDocumentIds = new Set<string>();
  /* Which counterparty a mailbox thread belongs to: a Sent copy with one
     stored recipient, or a decrypted record with a name or a payload claim. */
  const threadOwners = new Map<string, string>();
  /* Which counterparty a deal, request or escrow is with. Accept, receipt
     and escrow memos name only the deal, so this is how a counterparty's
     answer lands in their conversation. The ids are 32-byte secrets shared
     by the two parties; a memo naming one is still an unverified claim, and
     the cards say so. */
  const dealOwners = new Map<string, string>();
  const recipientsOf = (message: LocalMailMessage): string[] =>
    [
      ...new Set(
        (message.recipients ?? [])
          .map(canonical)
          .filter((address): address is string => address !== null),
      ),
    ].filter((address) => !isSelf(address));
  const claimOwner = (ids: readonly string[], owner: string) => {
    for (const id of ids) dealOwners.set(id, owner);
  };

  for (const deal of Object.values(input.otc.deals)) {
    const offerer = canonical(deal.offer.offerer);
    if (offerer && !isSelf(offerer)) dealOwners.set(deal.dealId, offerer);
  }
  for (const payment of Object.values(input.otc.payments)) {
    const requester = canonical(payment.request.requester);
    if (requester && !isSelf(requester)) {
      dealOwners.set(payment.requestId, requester);
    }
  }
  for (const deal of Object.values(input.escrow.deals)) {
    const maker = canonical(deal.fund.maker);
    if (maker && !isSelf(maker)) dealOwners.set(deal.dealId, maker);
  }

  for (const message of input.messages) {
    if (messageDirection(message) === "outgoing") {
      const documentId = stableDocumentId(message);
      if (documentId) sentDocumentIds.add(documentId);
      const recipients = recipientsOf(message);
      if (recipients.length === 1) {
        threadOwners.set(conversationKeyForMessage(message), recipients[0]);
        claimOwner(
          [...openedDealIds(message), ...answeredDealIds(message)],
          recipients[0],
        );
      }
      continue;
    }
    const attributed =
      canonical(message.assignedAddress) ??
      claimedFinancialAddress(message, input.selfAddress);
    if (attributed && !isSelf(attributed)) {
      const thread = conversationKeyForMessage(message);
      if (!threadOwners.has(thread)) threadOwners.set(thread, attributed);
      claimOwner(openedDealIds(message), attributed);
    }
  }
  const dealOwnerOf = (message: LocalMailMessage): string | null => {
    for (const id of answeredDealIds(message)) {
      const owner = dealOwners.get(id);
      if (owner) return owner;
    }
    return null;
  };

  const coveredDeals = new Set<string>();
  const coveredRequests = new Set<string>();
  const coveredEscrows = new Set<string>();
  let unattributedSent = 0;

  for (const message of input.messages) {
    const partial = messageItemFor(message, input, now);
    for (const record of partial.records) {
      if (record.offer) coveredDeals.add(record.offer.dealId);
      if (record.request) coveredRequests.add(record.request.requestId);
      if (record.fund) coveredEscrows.add(record.fund.dealId);
    }
    if (partial.direction === "outgoing") {
      const stored = message.recipients ?? [];
      const recipients = recipientsOf(message);
      if (!recipients.length) {
        // A copy addressed only to this wallet is self-mail (backups, tests);
        // one with no stored recipient at all is counted so the rail can say so.
        if (stored.length === 0) unattributedSent += 1;
        else {
          push(
            { key: SELF_CONVERSATION_KEY, kind: "self" },
            {
              ...partial,
              conversationKey: SELF_CONVERSATION_KEY,
              otherRecipients: 0,
            },
          );
        }
        continue;
      }
      for (const recipient of recipients) {
        push(
          { key: recipient, kind: "counterparty", address: recipient },
          {
            ...partial,
            conversationKey: recipient,
            otherRecipients: recipients.length - 1,
          },
        );
      }
      continue;
    }

    // A letter this wallet sent to several recipients comes back to it as a
    // decrypted record too; the Sent copy already tells that story.
    const documentId = stableDocumentId(message);
    if (documentId && sentDocumentIds.has(documentId)) continue;

    if (isBackupEnvelope(message)) {
      push(
        { key: SELF_CONVERSATION_KEY, kind: "self" },
        { ...partial, conversationKey: SELF_CONVERSATION_KEY, otherRecipients: 0 },
      );
      continue;
    }

    const thread = conversationKeyForMessage(message);
    const address =
      canonical(message.assignedAddress) ??
      claimedFinancialAddress(message, input.selfAddress) ??
      threadOwners.get(thread) ??
      dealOwnerOf(message);
    if (address && !isSelf(address)) {
      push(
        { key: address, kind: "counterparty", address },
        { ...partial, conversationKey: address, otherRecipients: 0 },
      );
      continue;
    }
    const key = sealedConversationKey(thread);
    push(
      { key, kind: "sealed", threadKey: thread },
      { ...partial, conversationKey: key, otherRecipients: 0 },
    );
  }

  /* Deal state Mailbox saved earlier still shows when its message is not
     decrypted in this session; a decrypted record always wins over it. */
  for (const deal of Object.values(input.otc.deals)) {
    if (coveredDeals.has(deal.dealId)) continue;
    const offerer = canonical(deal.offer.offerer);
    if (!offerer || isSelf(offerer)) continue;
    const record = offerRecord(deal.offer, deal, false, now);
    push(
      { key: offerer, kind: "counterparty", address: offerer },
      {
        ...recordItem(
          `record:${record.id}`,
          record,
          "offer",
          "Offer",
          deal.updatedAt * 1_000,
        ),
        conversationKey: offerer,
        otherRecipients: 0,
      },
    );
  }
  for (const payment of Object.values(input.otc.payments)) {
    if (coveredRequests.has(payment.requestId)) continue;
    const requester = canonical(payment.request.requester);
    if (!requester || isSelf(requester)) continue;
    const record = invoiceRecord(payment.request, payment, false, now);
    push(
      { key: requester, kind: "counterparty", address: requester },
      {
        ...recordItem(
          `record:${record.id}`,
          record,
          "invoice",
          "Invoice",
          payment.updatedAt * 1_000,
        ),
        conversationKey: requester,
        otherRecipients: 0,
      },
    );
  }
  for (const escrow of Object.values(input.escrow.deals)) {
    if (coveredEscrows.has(escrow.dealId)) continue;
    const maker = canonical(escrow.fund.maker);
    if (!maker || isSelf(maker)) continue;
    const record = escrowRecord(escrow.fund, escrow, false, now);
    push(
      { key: maker, kind: "counterparty", address: maker },
      {
        ...recordItem(
          `record:${record.id}`,
          record,
          "escrow",
          "Escrow",
          escrow.updatedAt * 1_000,
        ),
        conversationKey: maker,
        otherRecipients: 0,
      },
    );
  }

  for (const entry of input.addressBook) {
    const address = canonical(entry.address);
    if (address && !isSelf(address) && !placements.has(address)) {
      placements.set(address, { key: address, kind: "counterparty", address });
    }
  }
  for (const raw of input.extraContacts ?? []) {
    const address = canonical(raw);
    if (address && !isSelf(address) && !placements.has(address)) {
      placements.set(address, { key: address, kind: "counterparty", address });
    }
  }

  const conversations: ChatConversation[] = [];
  for (const placement of placements.values()) {
    const items = (itemsByKey.get(placement.key) ?? [])
      .slice()
      .sort(compareItems);
    const contact: ChatContact =
      placement.kind === "counterparty"
        ? contactFor(placement.address, input.addressBook, input.aliases)
        : placement.kind === "self"
          ? {
              key: SELF_CONVERSATION_KEY,
              kind: "self",
              address: self,
              label: "This mailbox",
              nameSource: "none",
              saved: false,
            }
          : {
              key: placement.key,
              kind: "sealed",
              address: null,
              label: null,
              nameSource: "none",
              saved: false,
              threadKey: placement.threadKey,
            };
    const unreadCount = items.filter(
      (item) => item.direction === "incoming" && !input.readIds.has(item.id),
    ).length;
    conversations.push({
      contact,
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
    contactDisplayName(conversation.contact),
    conversation.contact.label ?? "",
    conversation.contact.address ?? "",
    ...conversation.items.flatMap((item) => [
      item.label,
      item.preview,
      item.body,
      ...item.records.map(
        (record) =>
          `${record.facts.title} ${record.facts.terms} ${record.facts.status}`,
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
  if (!contact.address) return false;
  const address = contact.address;
  const makerIds = [
    record.selectedQuote?.solverId,
    ...(record.fills ?? []).map((fill) => fill.makerId),
  ].filter(
    (value): value is string => typeof value === "string" && value !== "",
  );
  if (!makerIds.length) return false;
  const label = contact.label?.trim().toLowerCase();
  return makerIds.some(
    (makerId) =>
      (label !== undefined &&
        label !== "" &&
        makerId.toLowerCase() === label) ||
      feltEquals(makerId, address),
  );
}

function rfqEntry(record: RfqLifecycleRecord): ChatContextEntry {
  const terms = record.terms
    ? `${amountLabel({
        token: {
          symbol: record.terms.sellSymbol,
          decimals: record.terms.sellDecimals,
        },
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
    direction: record.own ? "outgoing" : "incoming",
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
          record.payment?.paymentOperation?.state ===
            "awaiting-note-maturity" ||
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

/** The decrypted record a sealed thread can be named through. */
export function namingTarget(
  conversation: ChatConversation,
): LocalMailMessage | null {
  for (const item of conversation.items) {
    if (item.direction === "incoming" && item.message) return item.message;
  }
  return null;
}
