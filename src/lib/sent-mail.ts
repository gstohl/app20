import { decodeEnvelope, encodeEnvelope, type EnvelopeType } from "./envelope";
import type { EncryptedMailRecord } from "./mail";

export const SENT_MAIL_STORAGE_PREFIX = "quietline/sent/v1";

export type SentDeliveryState = "confirmed" | "partially_confirmed";

export type StoredSentMail = {
  version: 1;
  documentId: string;
  type: EnvelopeType;
  payload: unknown;
  plaintext: string;
  record: EncryptedMailRecord;
  transactionHash: string;
  transactionHashes: string[];
  recipientCount: number;
  deliveryState: SentDeliveryState;
  createdAt: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function key(chainId: string, address: string): string {
  return `${SENT_MAIL_STORAGE_PREFIX}/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStringPair(value: unknown): [string, string] | null {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === "string")
    ? [value[0], value[1]]
    : null;
}

function parseStoredSentMail(value: unknown): StoredSentMail | null {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    typeof value.documentId !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.documentId) ||
    typeof value.type !== "string" ||
    typeof value.plaintext !== "string" ||
    value.plaintext.length > 4_096 ||
    typeof value.transactionHash !== "string" ||
    !Array.isArray(value.transactionHashes) ||
    value.transactionHashes.some((hash) => typeof hash !== "string") ||
    !Number.isSafeInteger(value.recipientCount) ||
    (value.recipientCount as number) < 1 ||
    (value.deliveryState !== "confirmed" &&
      value.deliveryState !== "partially_confirmed") ||
    !Number.isSafeInteger(value.createdAt) ||
    !isObject(value.record)
  ) {
    return null;
  }
  const ephemeralPub = parseStringPair(value.record.ephemeralPub);
  const nonce = parseStringPair(value.record.nonce);
  if (
    !ephemeralPub ||
    !nonce ||
    !Number.isSafeInteger(value.record.viewTag) ||
    !Array.isArray(value.record.ciphertextFelts) ||
    value.record.ciphertextFelts.some((felt) => typeof felt !== "string")
  ) {
    return null;
  }
  const type = value.type as EnvelopeType;
  try {
    const envelope = decodeEnvelope(encodeEnvelope(type, value.payload));
    if (envelope.type !== type) return null;
  } catch {
    return null;
  }
  return {
    version: 1,
    documentId: value.documentId,
    type,
    payload: value.payload,
    plaintext: value.plaintext,
    record: {
      ephemeralPub,
      viewTag: value.record.viewTag as number,
      nonce,
      ciphertextFelts: value.record.ciphertextFelts as string[],
    },
    transactionHash: value.transactionHash,
    transactionHashes: value.transactionHashes as string[],
    recipientCount: value.recipientCount as number,
    deliveryState: value.deliveryState,
    createdAt: value.createdAt as number,
  };
}

export function loadSentMail(
  storage: Pick<Storage, "getItem">,
  chainId: string,
  address: string,
): StoredSentMail[] {
  try {
    const raw = storage.getItem(key(chainId, address));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseStoredSentMail)
      .filter((item): item is StoredSentMail => item !== null)
      .sort((left, right) => right.createdAt - left.createdAt);
  } catch {
    return [];
  }
}

export function saveSentMail(
  storage: StorageLike,
  chainId: string,
  address: string,
  message: StoredSentMail,
): StoredSentMail[] {
  const parsed = parseStoredSentMail(message);
  if (!parsed) throw new Error("Confirmed sent mail could not be indexed locally.");
  const messages = loadSentMail(storage, chainId, address).filter(
    (item) => item.documentId !== parsed.documentId,
  );
  messages.unshift(parsed);
  storage.setItem(key(chainId, address), JSON.stringify(messages));
  return messages;
}
