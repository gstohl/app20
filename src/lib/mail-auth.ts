import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

const AUTH_PRIVATE_INFO = new TextEncoder().encode("quietline/ed25519/auth/v1");
const AUTH_DOMAIN = "quietline/mail-auth/v1";
const HEX32 = /^[0-9a-f]{64}$/i;
const HEX64 = /^[0-9a-f]{128}$/i;

export type MailAuthKeypair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export type MailSenderAuth = {
  version: 1;
  mailboxPublicKey: string;
  authPublicKey: string;
  signature: string;
};

export type MailAuthSubject = {
  documentId: string;
  conversationId: string;
  inReplyTo: string;
  body: string;
  mailboxPublicKey: string;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string, label: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label} must be even-length hex.`);
  }
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

export function deriveMailAuthKeypair(seed32: Uint8Array): MailAuthKeypair {
  if (seed32.length !== 32) {
    throw new Error("Mail auth key requires the 32-byte mailbox seed.");
  }
  const privateKey = hkdf(
    sha256,
    seed32,
    new Uint8Array(),
    AUTH_PRIVATE_INFO,
    32,
  );
  return {
    privateKey,
    publicKey: ed25519.getPublicKey(privateKey),
  };
}

export function canonicalMailAuthBytes(subject: MailAuthSubject): Uint8Array {
  const payload = [
    AUTH_DOMAIN,
    subject.documentId,
    subject.conversationId,
    subject.inReplyTo,
    subject.body,
    subject.mailboxPublicKey,
  ].join("\n");
  return sha256(new TextEncoder().encode(payload));
}

export function createMailSenderAuth(
  seed32: Uint8Array,
  mailboxPublicKey: Uint8Array,
  subject: Omit<MailAuthSubject, "mailboxPublicKey">,
): MailSenderAuth {
  const mailboxHex = bytesToHex(mailboxPublicKey);
  const auth = deriveMailAuthKeypair(seed32);
  const signature = ed25519.sign(
    canonicalMailAuthBytes({ ...subject, mailboxPublicKey: mailboxHex }),
    auth.privateKey,
  );
  return {
    version: 1,
    mailboxPublicKey: mailboxHex,
    authPublicKey: bytesToHex(auth.publicKey),
    signature: bytesToHex(signature),
  };
}

export function parseMailSenderAuth(value: unknown): MailSenderAuth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.mailboxPublicKey !== "string" ||
    typeof record.authPublicKey !== "string" ||
    typeof record.signature !== "string" ||
    !HEX32.test(record.mailboxPublicKey) ||
    !HEX32.test(record.authPublicKey) ||
    !HEX64.test(record.signature)
  ) {
    return null;
  }
  return {
    version: 1,
    mailboxPublicKey: record.mailboxPublicKey.toLowerCase(),
    authPublicKey: record.authPublicKey.toLowerCase(),
    signature: record.signature.toLowerCase(),
  };
}

export function verifyMailSenderAuth(
  auth: MailSenderAuth,
  subject: Omit<MailAuthSubject, "mailboxPublicKey">,
): boolean {
  try {
    return ed25519.verify(
      hexToBytes(auth.signature, "signature"),
      canonicalMailAuthBytes({
        ...subject,
        mailboxPublicKey: auth.mailboxPublicKey,
      }),
      hexToBytes(auth.authPublicKey, "auth public key"),
    );
  } catch {
    return false;
  }
}

export function mailboxPublicKeyHex(publicKey: Uint8Array): string {
  return bytesToHex(publicKey);
}

export function mailboxKeysEqual(leftHex: string, right: Uint8Array): boolean {
  return leftHex.toLowerCase() === bytesToHex(right);
}
