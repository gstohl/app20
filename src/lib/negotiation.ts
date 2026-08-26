import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { deriveMailAuthKeypair } from "./mail-auth";
import { normalizeStarknetAddress } from "./address-book";
import {
  isVerifiedWalletMailBinding,
  type VerifiedWalletMailBinding,
} from "./relationship-channel";

export const NEGOTIATION_DOCUMENT_DOMAIN =
  "app20/negotiation-document/v1" as const;
export const NEGOTIATION_SIGNATURE_DOMAIN =
  "app20/negotiation-signature/v1" as const;
export const NEGOTIATION_HAS_SETTLEMENT_AUTHORITY = false as const;
export const MAX_NEGOTIATION_ATTACHMENTS = 4;
export const MAX_NEGOTIATION_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_NEGOTIATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

const HEX_32 = /^0x[0-9a-f]{64}$/;
const HEX_32_BARE = /^[0-9a-f]{64}$/;
const HEX_64_BARE = /^[0-9a-f]{128}$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const DECIMAL_UNITS = /^(?:0|[1-9][0-9]*)$/;
const U256_MAX = (1n << 256n) - 1n;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/json",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
]);
const encoder = new TextEncoder();

type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export type NegotiationRole = "taker" | "maker";
export type NegotiationKind = "offer" | "counter" | "accept" | "cancel";

export type NegotiationTermsV1 = {
  chainId: string;
  registryRevision: string;
  intentDigest: string;
  makerId: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  minBuyAmount: string;
  quoteExpiresAt: number;
  settlementDeadline: number;
};

export type EncryptedAttachmentManifestV1 = {
  version: 1;
  attachmentId: string;
  fileName: string;
  mediaType: string;
  byteLength: number;
  ciphertextDigest: string;
  encryption: "AES-256-GCM";
};

type NegotiationBaseV1 = {
  domain: typeof NEGOTIATION_DOCUMENT_DOMAIN;
  version: 1;
  documentId: string;
  conversationId: string;
  revision: number;
  parentDigest: string | null;
  authorRole: NegotiationRole;
  authorBindingDigest: string;
  createdAt: number;
  expiresAt: number;
  note: string;
};

export type NegotiationDocumentV1 =
  | (NegotiationBaseV1 & {
      kind: "offer";
      terms: NegotiationTermsV1;
      termsDigest: string;
      attachments: EncryptedAttachmentManifestV1[];
    })
  | (NegotiationBaseV1 & {
      kind: "counter";
      terms: NegotiationTermsV1;
      termsDigest: string;
      attachments: EncryptedAttachmentManifestV1[];
    })
  | (NegotiationBaseV1 & {
      kind: "accept";
      acceptedTermsDigest: string;
    })
  | (NegotiationBaseV1 & {
      kind: "cancel";
      cancelledTermsDigest: string;
      reason: "expired" | "terms_changed" | "user_cancelled" | "risk_policy";
    });

export type SignedNegotiationDocumentV1 = {
  version: 1;
  document: NegotiationDocumentV1;
  documentDigest: string;
  authPublicKey: string;
  signature: string;
};

export type NegotiationRoleBindings = Readonly<{
  taker: VerifiedWalletMailBinding;
  maker: VerifiedWalletMailBinding;
}>;

export interface NegotiationEquivocationStore {
  consume(input: {
    conversationId: string;
    authorRole: NegotiationRole;
    revision: number;
    documentDigest: string;
  }): "new" | "duplicate";
}

export function createMemoryNegotiationEquivocationStore(): NegotiationEquivocationStore {
  const digests = new Map<string, string>();
  return {
    consume(input) {
      const key = `${input.conversationId}:${input.authorRole}:${input.revision}`;
      const prior = digests.get(key);
      if (prior === undefined) {
        digests.set(key, input.documentDigest);
        return "new";
      }
      if (prior !== input.documentDigest) {
        throw new Error("Negotiation author equivocated at the same revision.");
      }
      return "duplicate";
    },
  };
}

export type NegotiationTranscript = {
  state: "open" | "accepted" | "cancelled" | "expired";
  conversationId: string;
  intentDigest: string;
  latestDocumentDigest: string;
  activeTermsDigest: string;
  revisions: number;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string, label: string): Uint8Array {
  if (!/^[0-9a-f]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label} must be lowercase even-length hex.`);
  }
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function digestBytes(value: Uint8Array): string {
  return `sha256:${bytesToHex(sha256(value))}`;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join(",") !== wanted.join(",")) {
    throw new Error(`${label} schema is unsupported.`);
  }
}

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Canonical negotiation numbers must be safe integers.");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function hex32(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.toLowerCase();
  if (!HEX_32.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function sha256Digest(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.toLowerCase();
  if (!SHA256_DIGEST.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe-integer timestamp.`);
  }
  return Number(value);
}

function positiveUnits(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL_UNITS.test(value)) {
    throw new Error(`${label} must be canonical decimal base units.`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > U256_MAX) {
    throw new Error(`${label} must fit a positive u256.`);
  }
  return value;
}

function normalizeTerms(value: unknown): NegotiationTermsV1 {
  const terms = record(value, "Negotiation terms");
  assertExactKeys(
    terms,
    [
      "chainId",
      "registryRevision",
      "intentDigest",
      "makerId",
      "sellToken",
      "buyToken",
      "sellAmount",
      "minBuyAmount",
      "quoteExpiresAt",
      "settlementDeadline",
    ],
    "Negotiation terms",
  );
  const sellToken = normalizeStarknetAddress(String(terms.sellToken ?? ""));
  const buyToken = normalizeStarknetAddress(String(terms.buyToken ?? ""));
  if (sellToken === buyToken) {
    throw new Error("Negotiation tokens must be different.");
  }
  const quoteExpiresAt = timestamp(terms.quoteExpiresAt, "Quote expiry");
  const settlementDeadline = timestamp(
    terms.settlementDeadline,
    "Settlement deadline",
  );
  if (settlementDeadline <= quoteExpiresAt) {
    throw new Error("Settlement deadline must follow quote expiry.");
  }
  return {
    chainId: stringValue(terms.chainId, "Chain id", 80),
    registryRevision: stringValue(
      terms.registryRevision,
      "Registry revision",
      128,
    ),
    intentDigest: sha256Digest(terms.intentDigest, "Intent digest"),
    makerId: stringValue(terms.makerId, "Maker id", 128),
    sellToken,
    buyToken,
    sellAmount: positiveUnits(terms.sellAmount, "Sell amount"),
    minBuyAmount: positiveUnits(terms.minBuyAmount, "Minimum buy amount"),
    quoteExpiresAt,
    settlementDeadline,
  };
}

export function canonicalNegotiationTerms(terms: NegotiationTermsV1): string {
  const normalized = normalizeTerms(terms);
  return canonicalJson(normalized);
}

export function negotiationTermsDigest(terms: NegotiationTermsV1): string {
  return digestBytes(encoder.encode(canonicalNegotiationTerms(terms)));
}

function normalizeAttachment(value: unknown): EncryptedAttachmentManifestV1 {
  const attachment = record(value, "Negotiation attachment");
  assertExactKeys(
    attachment,
    [
      "version",
      "attachmentId",
      "fileName",
      "mediaType",
      "byteLength",
      "ciphertextDigest",
      "encryption",
    ],
    "Negotiation attachment",
  );
  if (attachment.version !== 1 || attachment.encryption !== "AES-256-GCM") {
    throw new Error(
      "Negotiation attachment version or encryption is unsupported.",
    );
  }
  const mediaType = stringValue(
    attachment.mediaType,
    "Attachment media type",
    80,
  ).toLowerCase();
  if (!ALLOWED_ATTACHMENT_TYPES.has(mediaType)) {
    throw new Error("Attachment media type is not allowlisted.");
  }
  if (
    !Number.isSafeInteger(attachment.byteLength) ||
    Number(attachment.byteLength) <= 0 ||
    Number(attachment.byteLength) > MAX_NEGOTIATION_ATTACHMENT_BYTES
  ) {
    throw new Error("Attachment byte length is outside the reviewed limit.");
  }
  const fileName = stringValue(attachment.fileName, "Attachment filename", 120);
  if (/[\\/\u0000-\u001f\u007f]/.test(fileName)) {
    throw new Error(
      "Attachment filename contains a path or control character.",
    );
  }
  return {
    version: 1,
    attachmentId: hex32(attachment.attachmentId, "Attachment id"),
    fileName,
    mediaType,
    byteLength: Number(attachment.byteLength),
    ciphertextDigest: sha256Digest(
      attachment.ciphertextDigest,
      "Attachment ciphertext digest",
    ),
    encryption: "AES-256-GCM",
  };
}

function normalizeBase(value: Record<string, unknown>): NegotiationBaseV1 {
  if (
    value.domain !== NEGOTIATION_DOCUMENT_DOMAIN ||
    value.version !== 1 ||
    !["taker", "maker"].includes(String(value.authorRole))
  ) {
    throw new Error(
      "Negotiation document version, domain, or role is invalid.",
    );
  }
  const createdAt = timestamp(value.createdAt, "Negotiation creation time");
  const expiresAt = timestamp(value.expiresAt, "Negotiation expiry");
  if (
    expiresAt <= createdAt ||
    expiresAt - createdAt > MAX_NEGOTIATION_LIFETIME_MS
  ) {
    throw new Error("Negotiation expiry is outside the reviewed lifetime.");
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) <= 0) {
    throw new Error("Negotiation revision must be a positive safe integer.");
  }
  return {
    domain: NEGOTIATION_DOCUMENT_DOMAIN,
    version: 1,
    documentId: hex32(value.documentId, "Negotiation document id"),
    conversationId: hex32(value.conversationId, "Negotiation conversation id"),
    revision: Number(value.revision),
    parentDigest:
      value.parentDigest === null
        ? null
        : sha256Digest(value.parentDigest, "Negotiation parent digest"),
    authorRole: value.authorRole as NegotiationRole,
    authorBindingDigest: sha256Digest(
      value.authorBindingDigest,
      "Author binding digest",
    ),
    createdAt,
    expiresAt,
    note: (() => {
      if (typeof value.note !== "string") {
        throw new Error("Negotiation note must be text.");
      }
      const note = value.note.normalize("NFKC").trim();
      if (note.length > 1_000) {
        throw new Error("Negotiation note exceeds the reviewed limit.");
      }
      return note;
    })(),
  };
}

export function normalizeNegotiationDocument(
  value: unknown,
): NegotiationDocumentV1 {
  const document = record(value, "Negotiation document");
  const kind = document.kind;
  const baseKeys = [
    "domain",
    "version",
    "documentId",
    "conversationId",
    "revision",
    "parentDigest",
    "authorRole",
    "authorBindingDigest",
    "createdAt",
    "expiresAt",
    "note",
    "kind",
  ];
  const base = normalizeBase(document);
  if (kind === "offer" || kind === "counter") {
    assertExactKeys(
      document,
      [...baseKeys, "terms", "termsDigest", "attachments"],
      "Negotiation document",
    );
    if (!Array.isArray(document.attachments)) {
      throw new Error("Negotiation attachments must be an array.");
    }
    if (document.attachments.length > MAX_NEGOTIATION_ATTACHMENTS) {
      throw new Error(
        "Negotiation attachment count exceeds the reviewed limit.",
      );
    }
    const terms = normalizeTerms(document.terms);
    const termsDigest = negotiationTermsDigest(terms);
    if (sha256Digest(document.termsDigest, "Terms digest") !== termsDigest) {
      throw new Error("Negotiation terms digest does not match the terms.");
    }
    const attachments = document.attachments.map(normalizeAttachment);
    const attachmentIds = new Set(attachments.map((item) => item.attachmentId));
    if (attachmentIds.size !== attachments.length) {
      throw new Error("Negotiation attachments must have unique ids.");
    }
    return { ...base, kind, terms, termsDigest, attachments };
  }
  if (kind === "accept") {
    assertExactKeys(
      document,
      [...baseKeys, "acceptedTermsDigest"],
      "Negotiation document",
    );
    return {
      ...base,
      kind,
      acceptedTermsDigest: sha256Digest(
        document.acceptedTermsDigest,
        "Accepted terms digest",
      ),
    };
  }
  if (kind === "cancel") {
    assertExactKeys(
      document,
      [...baseKeys, "cancelledTermsDigest", "reason"],
      "Negotiation document",
    );
    if (
      !["expired", "terms_changed", "user_cancelled", "risk_policy"].includes(
        String(document.reason),
      )
    ) {
      throw new Error("Negotiation cancellation reason is invalid.");
    }
    return {
      ...base,
      kind,
      cancelledTermsDigest: sha256Digest(
        document.cancelledTermsDigest,
        "Cancelled terms digest",
      ),
      reason: document.reason as Extract<
        NegotiationDocumentV1,
        { kind: "cancel" }
      >["reason"],
    };
  }
  throw new Error("Negotiation document kind is unsupported.");
}

function canonicalDocumentValue(
  document: NegotiationDocumentV1,
): CanonicalValue {
  if (document.kind === "offer" || document.kind === "counter") {
    return {
      ...document,
      attachments: document.attachments.map((attachment) => ({
        ...attachment,
      })),
      terms: { ...document.terms },
    };
  }
  return { ...document };
}

export function canonicalNegotiationDocument(
  document: NegotiationDocumentV1,
): string {
  return canonicalJson(
    canonicalDocumentValue(normalizeNegotiationDocument(document)),
  );
}

export function negotiationDocumentDigest(
  document: NegotiationDocumentV1,
): string {
  return digestBytes(encoder.encode(canonicalNegotiationDocument(document)));
}

function signatureMessage(
  documentDigest: string,
  authPublicKey: string,
): Uint8Array {
  return sha256(
    encoder.encode(
      canonicalJson({
        domain: NEGOTIATION_SIGNATURE_DOMAIN,
        version: 1,
        documentDigest,
        authPublicKey,
      }),
    ),
  );
}

export function signNegotiationDocument(
  document: NegotiationDocumentV1,
  mailboxSeed: Uint8Array,
): SignedNegotiationDocumentV1 {
  if (mailboxSeed.length !== 32) {
    throw new Error("Negotiation signing requires the 32-byte mailbox seed.");
  }
  const normalized = normalizeNegotiationDocument(document);
  const documentDigest = negotiationDocumentDigest(normalized);
  const keypair = deriveMailAuthKeypair(mailboxSeed);
  try {
    const authPublicKey = bytesToHex(keypair.publicKey);
    return {
      version: 1,
      document: normalized,
      documentDigest,
      authPublicKey,
      signature: bytesToHex(
        ed25519.sign(
          signatureMessage(documentDigest, authPublicKey),
          keypair.privateKey,
        ),
      ),
    };
  } finally {
    keypair.privateKey.fill(0);
  }
}

export function verifySignedNegotiationDocument(
  value: unknown,
): SignedNegotiationDocumentV1 | null {
  try {
    const signed = record(value, "Signed negotiation document");
    assertExactKeys(
      signed,
      ["version", "document", "documentDigest", "authPublicKey", "signature"],
      "Signed negotiation document",
    );
    if (
      signed.version !== 1 ||
      typeof signed.authPublicKey !== "string" ||
      typeof signed.signature !== "string"
    ) {
      return null;
    }
    const authPublicKey = signed.authPublicKey.toLowerCase();
    const signature = signed.signature.toLowerCase();
    if (!HEX_32_BARE.test(authPublicKey) || !HEX_64_BARE.test(signature)) {
      return null;
    }
    const document = normalizeNegotiationDocument(signed.document);
    const documentDigest = negotiationDocumentDigest(document);
    if (
      sha256Digest(signed.documentDigest, "Document digest") !==
        documentDigest ||
      !ed25519.verify(
        hexToBytes(signature, "Negotiation signature"),
        signatureMessage(documentDigest, authPublicKey),
        hexToBytes(authPublicKey, "Negotiation auth public key"),
      )
    ) {
      return null;
    }
    return {
      version: 1,
      document,
      documentDigest,
      authPublicKey,
      signature,
    };
  } catch {
    return null;
  }
}

export function evaluateNegotiationTranscript(
  values: readonly unknown[],
  now: number,
  bindings: NegotiationRoleBindings,
  equivocationStore?: NegotiationEquivocationStore,
): NegotiationTranscript {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Negotiation evaluation time is invalid.");
  }
  if (values.length === 0) {
    throw new Error("Negotiation transcript cannot be empty.");
  }
  if (
    !isVerifiedWalletMailBinding(bindings.taker) ||
    !isVerifiedWalletMailBinding(bindings.maker)
  ) {
    throw new Error("Negotiation role bindings must be wallet-verified.");
  }
  const documents = values.map((value) => {
    const signed = verifySignedNegotiationDocument(value);
    if (!signed)
      throw new Error("Negotiation transcript signature is invalid.");
    const binding = bindings[signed.document.authorRole];
    if (
      signed.document.authorBindingDigest !== binding.certificateDigest ||
      signed.authPublicKey !== binding.certificate.statement.authPublicKey
    ) {
      throw new Error(
        "Negotiation signer does not match the wallet-bound role.",
      );
    }
    equivocationStore?.consume({
      conversationId: signed.document.conversationId,
      authorRole: signed.document.authorRole,
      revision: signed.document.revision,
      documentDigest: signed.documentDigest,
    });
    return signed;
  });
  const [first] = documents;
  if (
    first.document.kind !== "offer" ||
    first.document.revision !== 1 ||
    first.document.parentDigest !== null
  ) {
    throw new Error("Negotiation transcript must start with a root offer.");
  }
  let state: NegotiationTranscript["state"] = "open";
  let activeTermsDigest = first.document.termsDigest;
  for (let index = 1; index < documents.length; index += 1) {
    const previous = documents[index - 1];
    const current = documents[index];
    if (state !== "open") {
      throw new Error(
        "Negotiation transcript cannot continue after a terminal document.",
      );
    }
    if (
      current.document.conversationId !== first.document.conversationId ||
      current.document.revision !== previous.document.revision + 1 ||
      current.document.parentDigest !== previous.documentDigest ||
      current.document.createdAt < previous.document.createdAt ||
      current.document.createdAt > previous.document.expiresAt
    ) {
      throw new Error("Negotiation transcript revision chain is invalid.");
    }
    const previousIntent =
      previous.document.kind === "offer" || previous.document.kind === "counter"
        ? previous.document.terms.intentDigest
        : first.document.terms.intentDigest;
    if (
      (current.document.kind === "offer" ||
        current.document.kind === "counter") &&
      current.document.terms.intentDigest !== previousIntent
    ) {
      throw new Error("Negotiation transcript cannot change the bound intent.");
    }
    if (
      current.document.kind === "counter" &&
      current.document.authorRole === previous.document.authorRole
    ) {
      throw new Error("A negotiation counter must come from the other party.");
    }
    if (current.document.kind === "counter") {
      activeTermsDigest = current.document.termsDigest;
      continue;
    }
    if (current.document.kind === "accept") {
      if (
        current.document.authorRole === previous.document.authorRole ||
        current.document.acceptedTermsDigest !== activeTermsDigest
      ) {
        throw new Error(
          "Negotiation acceptance does not bind the active terms.",
        );
      }
      state = "accepted";
      continue;
    }
    if (current.document.kind === "cancel") {
      if (current.document.cancelledTermsDigest !== activeTermsDigest) {
        throw new Error(
          "Negotiation cancellation does not bind the active terms.",
        );
      }
      state = "cancelled";
      continue;
    }
    throw new Error(
      "Only a counter, acceptance, or cancellation may follow an offer.",
    );
  }
  const latest = documents[documents.length - 1];
  if (state === "open" && now > latest.document.expiresAt) state = "expired";
  return {
    state,
    conversationId: first.document.conversationId,
    intentDigest: first.document.terms.intentDigest,
    latestDocumentDigest: latest.documentDigest,
    activeTermsDigest,
    revisions: documents.length,
  };
}
