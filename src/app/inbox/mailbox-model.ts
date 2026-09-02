"use client";

import { validateAndParseAddress } from "starknet";
import type { LocalMailMessage } from "@/components/mail/Thread";
import { parseCompositePayload } from "@/lib/composite";
import type { CompositeDraft } from "@/lib/drafts";
import { decodeEnvelope, encodeEnvelope } from "@/lib/envelope";
import {
  backupBlobDigest,
  openBackupBlob,
  verifyBackupPointer,
  type BackupPointerV1,
} from "@/lib/backup-blob";
import {
  verifyBackupSnapshot,
  type BackupKind,
  type BackupSnapshotContext,
  type BackupSnapshotV1,
} from "@/lib/backup-snapshot";
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
import type { AliasRecord } from "@/lib/aliases";
import * as constants from "@/utils/constants";

export type ScanWorkerResponse =
  | { ok: true; decrypted: DecryptedMail[] }
  | { ok: false; message: string };

export type ActiveScanWorker = {
  worker: Worker;
  reject: (error: Error) => void;
};

export type ScanKind = "idle" | "scanning" | "ok" | "error";

export type MailboxFilter = "all" | "letters" | "deals" | "invoices" | "escrow";

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

export type MailboxFilterHits = Record<Exclude<MailboxFilter, "all">, boolean>;

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

export function mailMessageTimestampMs(
  message: LocalMailMessage,
): number | undefined {
  if (message.localCreatedAt !== undefined) return message.localCreatedAt;
  if (message.blockTimestamp === undefined) return undefined;
  return message.blockTimestamp * 1_000;
}

export function mailMessageDateTime(
  message: LocalMailMessage,
): string | undefined {
  const milliseconds = mailMessageTimestampMs(message);
  if (milliseconds === undefined) return undefined;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return undefined;
  }
}

function compareMailMessages(
  left: LocalMailMessage,
  right: LocalMailMessage,
): number {
  const leftTime = mailMessageTimestampMs(left);
  const rightTime = mailMessageTimestampMs(right);
  if (leftTime !== undefined || rightTime !== undefined) {
    const timeDifference = (rightTime ?? -1) - (leftTime ?? -1);
    if (timeDifference) return timeDifference;
  }
  const blockDifference = (right.blockNumber ?? -1) - (left.blockNumber ?? -1);
  if (blockDifference) return blockDifference;
  return (right.eventIndex ?? -1) - (left.eventIndex ?? -1);
}

export function sortMailMessages(
  messages: readonly LocalMailMessage[],
): LocalMailMessage[] {
  return messages.slice().sort(compareMailMessages);
}

export const BACKUP_CANDIDATES_PER_KIND = 3;

export type BackupMessageAuthenticationOptions = Readonly<{
  mailboxSeed: Uint8Array;
  context: BackupSnapshotContext;
  now?: number;
}>;

export type BackupCandidateFailure = Readonly<{
  messageId: string;
  seq: number;
  reason: string;
}>;

export type LoadedBackupSnapshot = Readonly<{
  message: LocalMailMessage;
  snapshot: BackupSnapshotV1;
  failures: readonly BackupCandidateFailure[];
}>;

type AuthenticatedBackupMessage = Readonly<{
  message: LocalMailMessage;
  kind: BackupKind;
  seq: number;
  content:
    | Readonly<{ type: "inline"; snapshot: BackupSnapshotV1 }>
    | Readonly<{ type: "pointer"; pointer: BackupPointerV1 }>;
}>;

function authenticateBackupMessage(
  message: LocalMailMessage,
  options: BackupMessageAuthenticationOptions,
): AuthenticatedBackupMessage | null {
  try {
    if (message.envelope.type === "backup_snapshot") {
      const snapshot = verifyBackupSnapshot(message.envelope.payload, {
        ...options.context,
        mailboxSeed: options.mailboxSeed,
        ...(options.now === undefined ? {} : { now: options.now }),
      });
      return {
        message,
        kind: snapshot.kind,
        seq: snapshot.seq,
        content: { type: "inline", snapshot },
      };
    }
    if (message.envelope.type === "backup_pointer") {
      const pointer = verifyBackupPointer(message.envelope.payload, {
        ...options.context,
        mailboxSeed: options.mailboxSeed,
      });
      return {
        message,
        kind: pointer.kind,
        seq: pointer.seq,
        content: { type: "pointer", pointer },
      };
    }
  } catch {
    // Invalid backup authentication is intentionally indistinguishable here.
  }
  return null;
}

function compareBackupCandidates(
  left: AuthenticatedBackupMessage,
  right: AuthenticatedBackupMessage,
): number {
  const sequenceDifference = right.seq - left.seq;
  if (sequenceDifference) return sequenceDifference;
  const kindDifference = left.kind.localeCompare(right.kind);
  if (kindDifference) return kindDifference;
  if (left.content.type !== right.content.type) {
    return left.content.type === "inline" ? -1 : 1;
  }
  return compareMailMessages(left.message, right.message);
}

function authenticatedBackupCandidates(
  messages: readonly LocalMailMessage[],
  options: BackupMessageAuthenticationOptions,
): AuthenticatedBackupMessage[] {
  const bestByKindAndSequence = new Map<string, AuthenticatedBackupMessage>();
  for (const message of messages) {
    const candidate = authenticateBackupMessage(message, options);
    if (!candidate) continue;
    const key = `${candidate.kind}:${candidate.seq}`;
    const current = bestByKindAndSequence.get(key);
    if (
      !current ||
      (candidate.content.type === "inline" &&
        current.content.type === "pointer") ||
      (candidate.content.type === current.content.type &&
        compareMailMessages(candidate.message, current.message) < 0)
    ) {
      bestByKindAndSequence.set(key, candidate);
    }
  }

  const retained: AuthenticatedBackupMessage[] = [];
  for (const kind of ["contacts", "rfq-resume"] as const) {
    retained.push(
      ...[...bestByKindAndSequence.values()]
        .filter((candidate) => candidate.kind === kind)
        .sort(compareBackupCandidates)
        .slice(0, BACKUP_CANDIDATES_PER_KIND),
    );
  }
  return retained.sort(compareBackupCandidates);
}

/** Returns authenticated backup messages, newest sequence first, capped per kind. */
export function newestBackupMessages(
  messages: readonly LocalMailMessage[],
  options: BackupMessageAuthenticationOptions,
): LocalMailMessage[] {
  return authenticatedBackupCandidates(messages, options).map(
    ({ message }) => message,
  );
}

export async function loadBackupSnapshotWithFallback(
  messages: readonly LocalMailMessage[],
  options: BackupMessageAuthenticationOptions &
    Readonly<{
      kind: BackupKind;
      loadBlob: (cid: string) => Promise<Uint8Array>;
    }>,
): Promise<LoadedBackupSnapshot> {
  const candidates = authenticatedBackupCandidates(messages, options).filter(
    (candidate) => candidate.kind === options.kind,
  );
  if (candidates.length === 0) {
    throw new Error("No authenticated backup candidates are available.");
  }

  const failures: BackupCandidateFailure[] = [];
  for (const candidate of candidates) {
    try {
      let snapshot: BackupSnapshotV1;
      if (candidate.content.type === "inline") {
        snapshot = candidate.content.snapshot;
      } else {
        const pointer = candidate.content.pointer;
        const blob = await options.loadBlob(pointer.cid);
        if (
          blob.length !== pointer.bucketBytes ||
          backupBlobDigest(blob) !== pointer.blobDigest
        ) {
          throw new Error(
            "The fetched backup blob does not match its authenticated pointer.",
          );
        }
        const opened = await openBackupBlob({
          mailboxSeed: options.mailboxSeed,
          owner: options.context.owner,
          chainId: options.context.chainId,
          kind: pointer.kind,
          seq: pointer.seq,
          blob,
        });
        const decoded = decodeEnvelope(opened);
        if (decoded.type !== "backup_snapshot") {
          throw new Error(
            "The backup blob does not contain a versioned snapshot envelope.",
          );
        }
        snapshot = verifyBackupSnapshot(decoded.payload, {
          ...options.context,
          mailboxSeed: options.mailboxSeed,
          kind: pointer.kind,
          seq: pointer.seq,
          ...(options.now === undefined ? {} : { now: options.now }),
        });
      }
      return Object.freeze({
        message: candidate.message,
        snapshot,
        failures: Object.freeze(failures.slice()),
      });
    } catch (error: unknown) {
      failures.push(
        Object.freeze({
          messageId: candidate.message.id,
          seq: candidate.seq,
          reason:
            error instanceof Error
              ? error.message
              : "The backup candidate could not be opened.",
        }),
      );
    }
  }

  throw new Error(
    `None of the ${failures.length} authenticated backup candidates could be opened.`,
  );
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
    case "backup_snapshot":
    case "backup_pointer":
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
export function mailboxFilterHits(
  message: LocalMailMessage,
): MailboxFilterHits {
  if (message.envelope.type !== "composite") {
    const category = mailboxCategory(message);
    return {
      letters: category === "letters",
      deals: category === "deals",
      invoices: category === "invoices",
      escrow: category === "escrow",
    };
  }
  const composite = parseCompositePayload(message.envelope.payload);
  if (!composite) {
    return { letters: false, deals: false, invoices: false, escrow: false };
  }
  const hits: MailboxFilterHits = {
    letters: Boolean(composite.body.trim()),
    deals: false,
    invoices: false,
    escrow: false,
  };
  for (const attachment of composite.attachments) {
    hits[attachmentCategory(attachment.type)] = true;
  }
  return hits;
}

export function mailboxMatchesFilter(
  message: LocalMailMessage,
  filter: MailboxFilter,
): boolean {
  if (filter === "all") return true;
  return mailboxFilterHits(message)[filter];
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

export function partitionMailboxFolders(
  messages: readonly LocalMailMessage[],
): {
  inbox: LocalMailMessage[];
  sent: LocalMailMessage[];
} {
  const inbox: LocalMailMessage[] = [];
  const sent: LocalMailMessage[] = [];
  for (const message of messages) {
    if (message.direction === "outgoing") sent.push(message);
    else inbox.push(message);
  }
  return { inbox, sent };
}

export function countMailboxFilterHits(
  messages: readonly LocalMailMessage[],
): Record<MailboxFilter, number> {
  const counts: Record<MailboxFilter, number> = {
    all: messages.length,
    letters: 0,
    deals: 0,
    invoices: 0,
    escrow: 0,
  };
  for (const message of messages) {
    const hits = mailboxFilterHits(message);
    if (hits.letters) counts.letters += 1;
    if (hits.deals) counts.deals += 1;
    if (hits.invoices) counts.invoices += 1;
    if (hits.escrow) counts.escrow += 1;
  }
  return counts;
}

export function countDraftFilterHits(
  drafts: readonly CompositeDraft[],
): Record<MailboxFilter, number> {
  const counts: Record<MailboxFilter, number> = {
    all: drafts.length,
    letters: 0,
    deals: 0,
    invoices: 0,
    escrow: 0,
  };
  for (const draft of drafts) {
    if (draftMatchesFilter(draft, "letters")) counts.letters += 1;
    if (draftMatchesFilter(draft, "deals")) counts.deals += 1;
    if (draftMatchesFilter(draft, "invoices")) counts.invoices += 1;
    if (draftMatchesFilter(draft, "escrow")) counts.escrow += 1;
  }
  return counts;
}

function feltFingerprint(address: string): string | null {
  try {
    return BigInt(address).toString(16);
  } catch {
    return null;
  }
}

export function mergeDisplayAliases(
  bookEntries: readonly AliasRecord[],
  aliases: readonly AliasRecord[],
): AliasRecord[] {
  const seen = new Set<string>();
  const merged: AliasRecord[] = [];
  for (const entry of bookEntries) {
    const fingerprint = feltFingerprint(entry.address);
    if (fingerprint) seen.add(fingerprint);
    merged.push(entry);
  }
  for (const alias of aliases) {
    const fingerprint = feltFingerprint(alias.address);
    if (fingerprint && seen.has(fingerprint)) continue;
    merged.push(alias);
  }
  return merged;
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
