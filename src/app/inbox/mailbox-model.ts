"use client";

import { validateAndParseAddress } from "starknet";
import type { MailboxFilter } from "@/components/mail/ConversationList";
import type { LocalMailMessage } from "@/components/mail/Thread";
import { parseCompositePayload } from "@/lib/composite";
import type { CompositeDraft } from "@/lib/drafts";
import { decodeEnvelope, encodeEnvelope } from "@/lib/envelope";
import { inspectMailVault } from "@/lib/mail-vault";
import { isConfiguredMailHelper } from "@/lib/mail-actions";
import type { DecryptedMail, MailKeypair } from "@/lib/mail";
import { MAIL_SCAN_MAX_MESSAGES } from "@/lib/mail-scan";
import {
  parsePaymentRequestPayload,
  type OtcState,
  type PaymentRecord,
  type PaymentRequestPayload,
} from "@/lib/otc";
import type { PaymentLinkAuthenticity } from "@/lib/payment-link";
import type { StoredSentMail } from "@/lib/sent-mail";
import * as constants from "@/utils/constants";

export type ScanWorkerResponse =
  | { ok: true; decrypted: DecryptedMail[] }
  | { ok: false; message: string };

export type ActiveScanWorker = {
  worker: Worker;
  reject: (error: Error) => void;
};

export type ScanKind = "idle" | "scanning" | "ok" | "error";

export const TYPE_FILTERS: Array<{ id: MailboxFilter; label: string }> = [
  { id: "all", label: "All types" },
  { id: "letters", label: "Letters" },
  { id: "deals", label: "RFQs & deals" },
  { id: "invoices", label: "Invoices" },
  { id: "escrow", label: "Escrow" },
];

export type MailFolder = "inbox" | "sent" | "drafts";
export const MAIL_FOLDERS: Array<{ id: MailFolder; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "drafts", label: "Drafts" },
];

function configuredForLocalnet(
  providerIndex: number,
  localnet: string,
): string | null {
  if (
    providerIndex === constants.LOCALNET_PROVIDER_INDEX &&
    constants.localnetWalletEnabled
  ) {
    return localnet;
  }
  return null;
}

export function helperForNetwork(providerIndex: number): string | null {
  const configured = configuredForLocalnet(
    providerIndex,
    constants.mailHelperLocalnet,
  );
  if (!isConfiguredMailHelper(configured)) return null;

  try {
    return validateAndParseAddress(configured);
  } catch {
    return null;
  }
}

export function escrowForNetwork(providerIndex: number): string | null {
  const configured = configuredForLocalnet(
    providerIndex,
    constants.escrowHelperLocalnet,
  );
  if (!isConfiguredMailHelper(configured)) return null;
  try {
    return validateAndParseAddress(configured);
  } catch {
    return null;
  }
}

export function loadPersistedMailSeed(
  storage: Pick<Storage, "getItem">,
  chainId: string,
  address: string,
): Uint8Array | null {
  const vault = inspectMailVault(storage, chainId, address);
  return vault.kind === "plaintext" ? vault.seed : null;
}

export function mailKeyFingerprint(keypair: MailKeypair | null): string {
  if (!keypair) return "";
  return Array.from(keypair.publicKey, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function messageTime(message: LocalMailMessage): number | undefined {
  if (message.localCreatedAt !== undefined) return message.localCreatedAt;
  if (message.blockTimestamp === undefined) return undefined;
  return message.blockTimestamp * 1_000;
}

function compareMailMessages(
  left: LocalMailMessage,
  right: LocalMailMessage,
): number {
  const leftTime = messageTime(left);
  const rightTime = messageTime(right);
  if (leftTime !== undefined || rightTime !== undefined) {
    const timeDifference = (rightTime ?? -1) - (leftTime ?? -1);
    if (timeDifference) return timeDifference;
  }
  const blockDifference = (right.blockNumber ?? -1) - (left.blockNumber ?? -1);
  if (blockDifference) return blockDifference;
  return (right.eventIndex ?? -1) - (left.eventIndex ?? -1);
}

export function sortMailMessages(
  messages: LocalMailMessage[],
): LocalMailMessage[] {
  return messages.sort(compareMailMessages);
}

export function mergeMailMessages(
  current: LocalMailMessage[],
  incoming: LocalMailMessage[],
): LocalMailMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);

  // When the same invoice later arrives as sealed mail, prefer its real
  // MessagePosted evidence over the local payment-link projection.
  const actualRequestIds = new Set(
    [...byId.values()].flatMap((message) =>
      message.transport === "payment_link"
        ? []
        : messagePaymentRequestIds(message),
    ),
  );
  const deduplicated = [...byId.values()].filter(
    (message) =>
      message.transport !== "payment_link" ||
      !messagePaymentRequestIds(message).some((requestId) =>
        actualRequestIds.has(requestId),
      ),
  );
  return sortMailMessages(deduplicated).slice(0, MAIL_SCAN_MAX_MESSAGES);
}

export function storedSentToLocal(message: StoredSentMail): LocalMailMessage {
  return {
    id: `sent:${message.documentId}`,
    documentId: message.documentId,
    index: "local",
    plaintext: message.plaintext,
    envelope: decodeEnvelope(encodeEnvelope(message.type, message.payload)),
    record: message.record,
    transactionHash: message.transactionHash,
    transactionHashes: message.transactionHashes,
    deliveryState: message.deliveryState,
    direction: "outgoing",
    recipientCount: message.recipientCount,
    recipients: message.recipients,
    localCreatedAt: message.createdAt,
  };
}

export function paymentLinkToLocal(
  request: PaymentRequestPayload,
  updatedAt = Math.floor(Date.now() / 1_000),
  linkAuthenticity: PaymentLinkAuthenticity = { kind: "unsigned" },
): LocalMailMessage {
  return {
    id: `payment-link:${request.requestId}`,
    index: "unsigned-link",
    plaintext: request.memo ?? "",
    envelope: decodeEnvelope(encodeEnvelope("payment_request", request)),
    // Link imports have no ciphertext. Thread deliberately suppresses the
    // public-evidence panel for this transport instead of inventing one.
    record: {
      ephemeralPub: ["0x0", "0x0"],
      viewTag: 0,
      nonce: ["0x0", "0x0"],
      ciphertextFelts: [],
    },
    transactionHash: "",
    direction: "incoming",
    transport: "payment_link",
    linkAuthenticity,
    localCreatedAt: updatedAt * 1_000,
  };
}

function messagePaymentRequestIds(message: LocalMailMessage): string[] {
  if (message.envelope.type === "payment_request") {
    const request = parsePaymentRequestPayload(message.envelope.payload);
    return request ? [request.requestId] : [];
  }
  if (message.envelope.type !== "composite") return [];
  const composite = parseCompositePayload(message.envelope.payload);
  return (composite?.attachments ?? []).flatMap((attachment) =>
    attachment.type === "payment_request" ? [attachment.payload.requestId] : [],
  );
}

export function paymentLinkRecords(state: OtcState): PaymentRecord[] {
  return Object.values(state.payments).filter(
    (payment) => payment.origin === "payment_link",
  );
}

export function draftMatchesFilter(
  draft: CompositeDraft,
  filter: MailboxFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "letters" && draft.body.trim()) return true;
  if (filter === "invoices") {
    return draft.attachments.some(
      (attachment) => attachment.type === "payment_request",
    );
  }
  if (filter === "escrow") {
    return draft.attachments.some(
      (attachment) => attachment.type === "escrow_fund",
    );
  }
  if (filter === "deals") {
    return draft.attachments.some(
      (attachment) =>
        attachment.type === "offer" || attachment.type === "payment",
    );
  }
  return false;
}

export function parseBlockTimestamp(value: unknown): number | undefined {
  try {
    let timestamp: bigint;
    if (typeof value === "bigint") {
      timestamp = value;
    } else if (typeof value === "number" && Number.isSafeInteger(value)) {
      timestamp = BigInt(value);
    } else if (
      typeof value === "string" &&
      /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)
    ) {
      timestamp = BigInt(value);
    } else {
      return undefined;
    }

    if (timestamp < 0n || timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined;
    }
    return Number(timestamp);
  } catch {
    return undefined;
  }
}
