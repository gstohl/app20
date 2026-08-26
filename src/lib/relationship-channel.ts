import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { typedData, type TypedData } from "starknet";
import { normalizeStarknetAddress } from "./address-book";
import { deriveMailAuthKeypair } from "./mail-auth";

export const WALLET_MAIL_BINDING_DOMAIN =
  "app20/wallet-mail-binding/v1" as const;
export const CHANNEL_INVITATION_DOMAIN =
  "app20/relationship-channel-invitation/v1" as const;
export const CHANNEL_EPOCH_DOMAIN =
  "app20/relationship-channel-epoch/v1" as const;
export const CHANNEL_SIGNATURE_DOMAIN =
  "app20/relationship-channel-signature/v1" as const;
export const CHANNEL_EPOCH_SIGNATURE_DOMAIN =
  "app20/relationship-channel-epoch-signature/v1" as const;
export const CHANNEL_HAS_SETTLEMENT_AUTHORITY = false as const;
export const CHANNEL_MAX_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const CHANNEL_MAX_BINDING_LIFETIME_MS = 365 * 24 * 60 * 60 * 1_000;
export const CHANNEL_MAX_MESSAGES = 10_000;
export const CHANNEL_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const CHANNEL_MAX_MESSAGE_BYTES = 64 * 1024;

const HEX_32 = /^0x[0-9a-f]{64}$/;
const HEX_32_BARE = /^[0-9a-f]{64}$/;
const HEX_64_BARE = /^[0-9a-f]{128}$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const VERIFIED_BINDING = Symbol("app20.verified-wallet-mail-binding");
const VERIFIED_BINDINGS = new WeakSet<object>();
const encoder = new TextEncoder();

type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export type WalletMailBindingStatementV1 = {
  domain: typeof WALLET_MAIL_BINDING_DOMAIN;
  version: 1;
  account: string;
  chainId: string;
  mailboxPublicKey: string;
  authPublicKey: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  revocationId: string;
};

export type WalletMailBindingCertificateV1 = {
  version: 1;
  statement: WalletMailBindingStatementV1;
  statementDigest: string;
  messageHash: string;
  signature: string[];
};

export type VerifiedWalletMailBinding = Readonly<{
  [VERIFIED_BINDING]: true;
  certificate: WalletMailBindingCertificateV1;
  certificateDigest: string;
  verifiedAt: number;
  revocationSnapshotDigest: string;
}>;

export type RelationshipChannelInvitationV1 = {
  domain: typeof CHANNEL_INVITATION_DOMAIN;
  version: 1;
  invitationId: string;
  channelId: string;
  inviterBindingDigest: string;
  inviteeBindingDigest: string;
  inviterHandshakeKey: string;
  relayCapability: string;
  issuedAt: number;
  expiresAt: number;
  quota: {
    maxMessages: number;
    maxTotalBytes: number;
  };
};

export type SignedRelationshipChannelInvitationV1 = {
  version: 1;
  invitation: RelationshipChannelInvitationV1;
  invitationDigest: string;
  authPublicKey: string;
  signature: string;
};

export type RelationshipChannelEpochV1 = {
  domain: typeof CHANNEL_EPOCH_DOMAIN;
  version: 1;
  channelId: string;
  epoch: number;
  previousEpochDigest: string | null;
  initiatorKey: string;
  responderKey: string;
  rootKeyCommitment: string;
  suite: "Double-Ratchet/X25519/HKDF-SHA256/AES-256-GCM";
  createdAt: number;
  expiresAt: number;
};

export type SignedRelationshipChannelEpochV1 = Readonly<{
  version: 1;
  epoch: RelationshipChannelEpochV1;
  epochDigest: string;
  initiatorAuthPublicKey: string;
  initiatorSignature: string;
  responderAuthPublicKey: string;
  responderSignature: string;
}>;

export type RelationshipChannelStateV1 = {
  version: 1;
  channelId: string;
  invitationDigest: string;
  inviterBindingDigest: string;
  inviteeBindingDigest: string;
  revocationSnapshotDigest: string;
  status: "invited" | "active" | "blocked" | "reported" | "revoked" | "expired";
  activeEpoch: number;
  activeEpochDigest: string | null;
  nextSequence: number;
  messagesUsed: number;
  bytesUsed: number;
  maxMessages: number;
  maxTotalBytes: number;
  expiresAt: number;
  reportDigest: string | null;
};

export type ChannelMessageUse = {
  sequence: number;
  ciphertextBytes: number;
  sentAt: number;
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

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

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${bytesToHex(sha256(bytes))}`;
}

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Canonical channel numbers must be safe integers.");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .join(",") !==
    [...expected].sort((left, right) => left.localeCompare(right)).join(",")
  ) {
    throw new Error(`${label} schema is unsupported.`);
  }
}

function hex32(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.toLowerCase();
  if (!HEX_32.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function bareHex32(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.toLowerCase();
  if (!HEX_32_BARE.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function sha256Digest(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.toLowerCase();
  if (!SHA256_DIGEST.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe-integer timestamp.`);
  }
  return Number(value);
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw new Error(`${label} is outside the reviewed limit.`);
  }
  return Number(value);
}

function splitHex32(value: string): { low: string; high: string } {
  const bytes = value.startsWith("0x") ? value.slice(2) : value;
  return {
    high: `0x${bytes.slice(0, 32)}`,
    low: `0x${bytes.slice(32)}`,
  };
}

export function normalizeWalletMailBindingStatement(
  value: unknown,
): WalletMailBindingStatementV1 {
  const statement = record(value, "Wallet-to-Mail binding statement");
  assertExactKeys(
    statement,
    [
      "domain",
      "version",
      "account",
      "chainId",
      "mailboxPublicKey",
      "authPublicKey",
      "issuedAt",
      "expiresAt",
      "nonce",
      "revocationId",
    ],
    "Wallet-to-Mail binding statement",
  );
  if (
    statement.domain !== WALLET_MAIL_BINDING_DOMAIN ||
    statement.version !== 1
  ) {
    throw new Error("Wallet-to-Mail binding domain or version is invalid.");
  }
  if (typeof statement.chainId !== "string" || !statement.chainId.trim()) {
    throw new Error("Wallet-to-Mail binding chain id is invalid.");
  }
  const issuedAt = timestamp(statement.issuedAt, "Binding issue time");
  const expiresAt = timestamp(statement.expiresAt, "Binding expiry");
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > CHANNEL_MAX_BINDING_LIFETIME_MS
  ) {
    throw new Error("Wallet-to-Mail binding lifetime is invalid.");
  }
  return {
    domain: WALLET_MAIL_BINDING_DOMAIN,
    version: 1,
    account: normalizeStarknetAddress(String(statement.account ?? "")),
    chainId: statement.chainId.trim(),
    mailboxPublicKey: bareHex32(
      statement.mailboxPublicKey,
      "Mailbox public key",
    ),
    authPublicKey: bareHex32(statement.authPublicKey, "Mail auth public key"),
    issuedAt,
    expiresAt,
    nonce: hex32(statement.nonce, "Binding nonce"),
    revocationId: hex32(statement.revocationId, "Binding revocation id"),
  };
}

export function canonicalWalletMailBindingStatement(
  statement: WalletMailBindingStatementV1,
): string {
  return canonicalJson({ ...normalizeWalletMailBindingStatement(statement) });
}

export function walletMailBindingStatementDigest(
  statement: WalletMailBindingStatementV1,
): string {
  return digestBytes(
    encoder.encode(canonicalWalletMailBindingStatement(statement)),
  );
}

export function walletMailBindingTypedData(
  value: WalletMailBindingStatementV1,
): TypedData {
  const statement = normalizeWalletMailBindingStatement(value);
  const mailbox = splitHex32(statement.mailboxPublicKey);
  const auth = splitHex32(statement.authPublicKey);
  const nonce = splitHex32(statement.nonce);
  const revocation = splitHex32(statement.revocationId);
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      App20MailBinding: [
        { name: "account", type: "ContractAddress" },
        { name: "mailboxKeyLow", type: "u128" },
        { name: "mailboxKeyHigh", type: "u128" },
        { name: "authKeyLow", type: "u128" },
        { name: "authKeyHigh", type: "u128" },
        { name: "issuedAt", type: "u128" },
        { name: "expiresAt", type: "u128" },
        { name: "nonceLow", type: "u128" },
        { name: "nonceHigh", type: "u128" },
        { name: "revocationLow", type: "u128" },
        { name: "revocationHigh", type: "u128" },
      ],
    },
    primaryType: "App20MailBinding",
    domain: {
      name: "APP20 Mail",
      version: "1",
      chainId: statement.chainId,
      revision: "1",
    },
    message: {
      account: statement.account,
      mailboxKeyLow: mailbox.low,
      mailboxKeyHigh: mailbox.high,
      authKeyLow: auth.low,
      authKeyHigh: auth.high,
      issuedAt: statement.issuedAt,
      expiresAt: statement.expiresAt,
      nonceLow: nonce.low,
      nonceHigh: nonce.high,
      revocationLow: revocation.low,
      revocationHigh: revocation.high,
    },
  };
}

export function createWalletMailBindingCertificate(
  value: WalletMailBindingStatementV1,
  signature: readonly string[],
): WalletMailBindingCertificateV1 {
  const statement = normalizeWalletMailBindingStatement(value);
  if (signature.length === 0 || signature.length > 8) {
    throw new Error("Wallet-to-Mail binding signature is invalid.");
  }
  const normalizedSignature = signature.map((felt) => {
    try {
      const parsed = BigInt(felt);
      if (parsed < 0n || parsed >= 1n << 252n) throw new Error();
      return `0x${parsed.toString(16)}`;
    } catch {
      throw new Error("Wallet-to-Mail binding signature felt is invalid.");
    }
  });
  return {
    version: 1,
    statement,
    statementDigest: walletMailBindingStatementDigest(statement),
    messageHash: typedData.getMessageHash(
      walletMailBindingTypedData(statement),
      statement.account,
    ),
    signature: normalizedSignature,
  };
}

function normalizeBindingCertificate(
  value: unknown,
): WalletMailBindingCertificateV1 {
  const certificate = record(value, "Wallet-to-Mail binding certificate");
  assertExactKeys(
    certificate,
    ["version", "statement", "statementDigest", "messageHash", "signature"],
    "Wallet-to-Mail binding certificate",
  );
  if (certificate.version !== 1 || !Array.isArray(certificate.signature)) {
    throw new Error("Wallet-to-Mail binding certificate is invalid.");
  }
  const rebuilt = createWalletMailBindingCertificate(
    normalizeWalletMailBindingStatement(certificate.statement),
    certificate.signature.map(String),
  );
  if (
    sha256Digest(certificate.statementDigest, "Binding statement digest") !==
      rebuilt.statementDigest ||
    String(certificate.messageHash).toLowerCase() !==
      rebuilt.messageHash.toLowerCase()
  ) {
    throw new Error("Wallet-to-Mail binding certificate digest is invalid.");
  }
  return rebuilt;
}

export async function verifyWalletMailBindingCertificate(
  value: unknown,
  input: {
    now: number;
    revokedIds: ReadonlySet<string>;
    revocationSnapshotDigest: string;
    verifySignature: (
      typed: TypedData,
      account: string,
      signature: readonly string[],
    ) => Promise<boolean>;
  },
): Promise<VerifiedWalletMailBinding> {
  const certificate = normalizeBindingCertificate(value);
  const now = timestamp(input.now, "Binding verification time");
  if (
    now < certificate.statement.issuedAt ||
    now > certificate.statement.expiresAt ||
    input.revokedIds.has(certificate.statement.revocationId)
  ) {
    throw new Error("Wallet-to-Mail binding is not currently valid.");
  }
  if (
    !(await input.verifySignature(
      walletMailBindingTypedData(certificate.statement),
      certificate.statement.account,
      certificate.signature,
    ))
  ) {
    throw new Error("Wallet-to-Mail binding signature is invalid.");
  }
  const verified = deepFreeze({
    [VERIFIED_BINDING]: true as const,
    certificate: deepFreeze(certificate),
    certificateDigest: digestBytes(
      encoder.encode(
        canonicalJson({
          version: 1,
          statementDigest: certificate.statementDigest,
          messageHash: certificate.messageHash.toLowerCase(),
          signature: certificate.signature,
        }),
      ),
    ),
    verifiedAt: now,
    revocationSnapshotDigest: sha256Digest(
      input.revocationSnapshotDigest,
      "Revocation snapshot digest",
    ),
  });
  VERIFIED_BINDINGS.add(verified);
  return verified;
}

export function isVerifiedWalletMailBinding(
  value: unknown,
): value is VerifiedWalletMailBinding {
  return (
    value !== null &&
    typeof value === "object" &&
    VERIFIED_BINDINGS.has(value) &&
    (value as VerifiedWalletMailBinding)[VERIFIED_BINDING] === true
  );
}

export function normalizeRelationshipChannelInvitation(
  value: unknown,
): RelationshipChannelInvitationV1 {
  const invitation = record(value, "Relationship-channel invitation");
  assertExactKeys(
    invitation,
    [
      "domain",
      "version",
      "invitationId",
      "channelId",
      "inviterBindingDigest",
      "inviteeBindingDigest",
      "inviterHandshakeKey",
      "relayCapability",
      "issuedAt",
      "expiresAt",
      "quota",
    ],
    "Relationship-channel invitation",
  );
  if (
    invitation.domain !== CHANNEL_INVITATION_DOMAIN ||
    invitation.version !== 1
  ) {
    throw new Error(
      "Relationship-channel invitation domain or version is invalid.",
    );
  }
  const issuedAt = timestamp(invitation.issuedAt, "Invitation issue time");
  const expiresAt = timestamp(invitation.expiresAt, "Invitation expiry");
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > CHANNEL_MAX_INVITATION_LIFETIME_MS
  ) {
    throw new Error("Relationship-channel invitation lifetime is invalid.");
  }
  const quota = record(invitation.quota, "Relationship-channel quota");
  assertExactKeys(
    quota,
    ["maxMessages", "maxTotalBytes"],
    "Relationship-channel quota",
  );
  return {
    domain: CHANNEL_INVITATION_DOMAIN,
    version: 1,
    invitationId: hex32(invitation.invitationId, "Invitation id"),
    channelId: hex32(invitation.channelId, "Channel id"),
    inviterBindingDigest: sha256Digest(
      invitation.inviterBindingDigest,
      "Inviter binding digest",
    ),
    inviteeBindingDigest: sha256Digest(
      invitation.inviteeBindingDigest,
      "Invitee binding digest",
    ),
    inviterHandshakeKey: bareHex32(
      invitation.inviterHandshakeKey,
      "Inviter handshake key",
    ),
    relayCapability: hex32(invitation.relayCapability, "Relay capability"),
    issuedAt,
    expiresAt,
    quota: {
      maxMessages: boundedInteger(
        quota.maxMessages,
        "Channel message quota",
        1,
        CHANNEL_MAX_MESSAGES,
      ),
      maxTotalBytes: boundedInteger(
        quota.maxTotalBytes,
        "Channel byte quota",
        1,
        CHANNEL_MAX_TOTAL_BYTES,
      ),
    },
  };
}

export function canonicalRelationshipChannelInvitation(
  invitation: RelationshipChannelInvitationV1,
): string {
  return canonicalJson({
    ...normalizeRelationshipChannelInvitation(invitation),
  });
}

export function relationshipChannelInvitationDigest(
  invitation: RelationshipChannelInvitationV1,
): string {
  return digestBytes(
    encoder.encode(canonicalRelationshipChannelInvitation(invitation)),
  );
}

function channelSignatureMessage(
  invitationDigest: string,
  authPublicKey: string,
): Uint8Array {
  return sha256(
    encoder.encode(
      canonicalJson({
        domain: CHANNEL_SIGNATURE_DOMAIN,
        version: 1,
        invitationDigest,
        authPublicKey,
      }),
    ),
  );
}

export function signRelationshipChannelInvitation(
  value: RelationshipChannelInvitationV1,
  mailboxSeed: Uint8Array,
): SignedRelationshipChannelInvitationV1 {
  if (mailboxSeed.length !== 32) {
    throw new Error(
      "Channel invitation signing requires the 32-byte mailbox seed.",
    );
  }
  const invitation = normalizeRelationshipChannelInvitation(value);
  const invitationDigest = relationshipChannelInvitationDigest(invitation);
  const keypair = deriveMailAuthKeypair(mailboxSeed);
  try {
    const authPublicKey = bytesToHex(keypair.publicKey);
    return {
      version: 1,
      invitation,
      invitationDigest,
      authPublicKey,
      signature: bytesToHex(
        ed25519.sign(
          channelSignatureMessage(invitationDigest, authPublicKey),
          keypair.privateKey,
        ),
      ),
    };
  } finally {
    keypair.privateKey.fill(0);
  }
}

export function verifyRelationshipChannelInvitation(
  value: unknown,
  expectedBindings: {
    inviter: VerifiedWalletMailBinding;
    invitee: VerifiedWalletMailBinding;
  },
): SignedRelationshipChannelInvitationV1 | null {
  try {
    if (
      !isVerifiedWalletMailBinding(expectedBindings.inviter) ||
      !isVerifiedWalletMailBinding(expectedBindings.invitee)
    ) {
      return null;
    }
    const signed = record(value, "Signed relationship-channel invitation");
    assertExactKeys(
      signed,
      [
        "version",
        "invitation",
        "invitationDigest",
        "authPublicKey",
        "signature",
      ],
      "Signed relationship-channel invitation",
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
    const invitation = normalizeRelationshipChannelInvitation(
      signed.invitation,
    );
    const invitationDigest = relationshipChannelInvitationDigest(invitation);
    if (
      sha256Digest(signed.invitationDigest, "Invitation digest") !==
        invitationDigest ||
      invitation.inviterBindingDigest !==
        expectedBindings.inviter.certificateDigest ||
      invitation.inviteeBindingDigest !==
        expectedBindings.invitee.certificateDigest ||
      authPublicKey !==
        expectedBindings.inviter.certificate.statement.authPublicKey ||
      !ed25519.verify(
        hexToBytes(signature, "Channel invitation signature"),
        channelSignatureMessage(invitationDigest, authPublicKey),
        hexToBytes(authPublicKey, "Channel invitation auth public key"),
      )
    ) {
      return null;
    }
    return deepFreeze({
      version: 1 as const,
      invitation: deepFreeze(invitation),
      invitationDigest,
      authPublicKey,
      signature,
    });
  } catch {
    return null;
  }
}

export function relationshipChannelEpochDigest(
  value: RelationshipChannelEpochV1,
): string {
  const epoch = normalizeRelationshipChannelEpoch(value);
  return digestBytes(encoder.encode(canonicalJson({ ...epoch })));
}

export function normalizeRelationshipChannelEpoch(
  value: unknown,
): RelationshipChannelEpochV1 {
  const epoch = record(value, "Relationship-channel epoch");
  assertExactKeys(
    epoch,
    [
      "domain",
      "version",
      "channelId",
      "epoch",
      "previousEpochDigest",
      "initiatorKey",
      "responderKey",
      "rootKeyCommitment",
      "suite",
      "createdAt",
      "expiresAt",
    ],
    "Relationship-channel epoch",
  );
  if (
    epoch.domain !== CHANNEL_EPOCH_DOMAIN ||
    epoch.version !== 1 ||
    epoch.suite !== "Double-Ratchet/X25519/HKDF-SHA256/AES-256-GCM"
  ) {
    throw new Error(
      "Relationship-channel epoch suite, domain, or version is invalid.",
    );
  }
  const createdAt = timestamp(epoch.createdAt, "Channel epoch creation time");
  const expiresAt = timestamp(epoch.expiresAt, "Channel epoch expiry");
  if (expiresAt <= createdAt) {
    throw new Error("Relationship-channel epoch expiry is invalid.");
  }
  return {
    domain: CHANNEL_EPOCH_DOMAIN,
    version: 1,
    channelId: hex32(epoch.channelId, "Channel id"),
    epoch: boundedInteger(
      epoch.epoch,
      "Channel epoch",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    previousEpochDigest:
      epoch.previousEpochDigest === null
        ? null
        : sha256Digest(
            epoch.previousEpochDigest,
            "Previous channel epoch digest",
          ),
    initiatorKey: bareHex32(epoch.initiatorKey, "Channel initiator key"),
    responderKey: bareHex32(epoch.responderKey, "Channel responder key"),
    rootKeyCommitment: sha256Digest(
      epoch.rootKeyCommitment,
      "Channel root-key commitment",
    ),
    suite: "Double-Ratchet/X25519/HKDF-SHA256/AES-256-GCM",
    createdAt,
    expiresAt,
  };
}

function channelEpochSignatureMessage(
  epochDigest: string,
  authPublicKey: string,
  role: "initiator" | "responder",
): Uint8Array {
  return sha256(
    encoder.encode(
      canonicalJson({
        domain: CHANNEL_EPOCH_SIGNATURE_DOMAIN,
        version: 1,
        epochDigest,
        authPublicKey,
        role,
      }),
    ),
  );
}

export function signRelationshipChannelEpoch(
  value: RelationshipChannelEpochV1,
  input: { initiatorSeed: Uint8Array; responderSeed: Uint8Array },
): SignedRelationshipChannelEpochV1 {
  if (input.initiatorSeed.length !== 32 || input.responderSeed.length !== 32) {
    throw new Error(
      "Channel epoch signing requires two 32-byte mailbox seeds.",
    );
  }
  const epoch = normalizeRelationshipChannelEpoch(value);
  const epochDigest = relationshipChannelEpochDigest(epoch);
  const initiator = deriveMailAuthKeypair(input.initiatorSeed);
  const responder = deriveMailAuthKeypair(input.responderSeed);
  try {
    const initiatorAuthPublicKey = bytesToHex(initiator.publicKey);
    const responderAuthPublicKey = bytesToHex(responder.publicKey);
    return deepFreeze({
      version: 1 as const,
      epoch: deepFreeze(epoch),
      epochDigest,
      initiatorAuthPublicKey,
      initiatorSignature: bytesToHex(
        ed25519.sign(
          channelEpochSignatureMessage(
            epochDigest,
            initiatorAuthPublicKey,
            "initiator",
          ),
          initiator.privateKey,
        ),
      ),
      responderAuthPublicKey,
      responderSignature: bytesToHex(
        ed25519.sign(
          channelEpochSignatureMessage(
            epochDigest,
            responderAuthPublicKey,
            "responder",
          ),
          responder.privateKey,
        ),
      ),
    });
  } finally {
    initiator.privateKey.fill(0);
    responder.privateKey.fill(0);
  }
}

export function verifyRelationshipChannelEpoch(
  value: unknown,
  bindings: {
    inviter: VerifiedWalletMailBinding;
    invitee: VerifiedWalletMailBinding;
  },
): SignedRelationshipChannelEpochV1 | null {
  try {
    if (
      !isVerifiedWalletMailBinding(bindings.inviter) ||
      !isVerifiedWalletMailBinding(bindings.invitee)
    ) {
      return null;
    }
    const signed = record(value, "Signed relationship-channel epoch");
    assertExactKeys(
      signed,
      [
        "version",
        "epoch",
        "epochDigest",
        "initiatorAuthPublicKey",
        "initiatorSignature",
        "responderAuthPublicKey",
        "responderSignature",
      ],
      "Signed relationship-channel epoch",
    );
    if (
      signed.version !== 1 ||
      typeof signed.initiatorAuthPublicKey !== "string" ||
      typeof signed.responderAuthPublicKey !== "string" ||
      typeof signed.initiatorSignature !== "string" ||
      typeof signed.responderSignature !== "string"
    ) {
      return null;
    }
    const epoch = normalizeRelationshipChannelEpoch(signed.epoch);
    const epochDigest = relationshipChannelEpochDigest(epoch);
    const initiatorAuthPublicKey = signed.initiatorAuthPublicKey.toLowerCase();
    const responderAuthPublicKey = signed.responderAuthPublicKey.toLowerCase();
    const initiatorSignature = signed.initiatorSignature.toLowerCase();
    const responderSignature = signed.responderSignature.toLowerCase();
    if (
      sha256Digest(signed.epochDigest, "Channel epoch digest") !==
        epochDigest ||
      initiatorAuthPublicKey !==
        bindings.inviter.certificate.statement.authPublicKey ||
      responderAuthPublicKey !==
        bindings.invitee.certificate.statement.authPublicKey ||
      !HEX_64_BARE.test(initiatorSignature) ||
      !HEX_64_BARE.test(responderSignature) ||
      !ed25519.verify(
        hexToBytes(initiatorSignature, "Channel initiator signature"),
        channelEpochSignatureMessage(
          epochDigest,
          initiatorAuthPublicKey,
          "initiator",
        ),
        hexToBytes(initiatorAuthPublicKey, "Channel initiator auth key"),
      ) ||
      !ed25519.verify(
        hexToBytes(responderSignature, "Channel responder signature"),
        channelEpochSignatureMessage(
          epochDigest,
          responderAuthPublicKey,
          "responder",
        ),
        hexToBytes(responderAuthPublicKey, "Channel responder auth key"),
      )
    ) {
      return null;
    }
    return deepFreeze({
      version: 1 as const,
      epoch: deepFreeze(epoch),
      epochDigest,
      initiatorAuthPublicKey,
      initiatorSignature,
      responderAuthPublicKey,
      responderSignature,
    });
  } catch {
    return null;
  }
}

export function openRelationshipChannel(
  value: SignedRelationshipChannelInvitationV1,
  acceptedAt: number,
  bindings: {
    inviter: VerifiedWalletMailBinding;
    invitee: VerifiedWalletMailBinding;
  },
  currentRevocations: {
    revokedIds: ReadonlySet<string>;
    snapshotDigest: string;
  },
): RelationshipChannelStateV1 {
  if (
    !isVerifiedWalletMailBinding(bindings.inviter) ||
    !isVerifiedWalletMailBinding(bindings.invitee) ||
    bindings.inviter.revocationSnapshotDigest !==
      bindings.invitee.revocationSnapshotDigest
  ) {
    throw new Error("Relationship-channel bindings are not jointly verified.");
  }
  const signed = verifyRelationshipChannelInvitation(value, bindings);
  if (!signed) throw new Error("Relationship-channel invitation is invalid.");
  const now = timestamp(acceptedAt, "Channel acceptance time");
  const revocationSnapshotDigest = sha256Digest(
    currentRevocations.snapshotDigest,
    "Current revocation snapshot digest",
  );
  for (const binding of [bindings.inviter, bindings.invitee]) {
    if (
      now < binding.certificate.statement.issuedAt ||
      now > binding.certificate.statement.expiresAt ||
      currentRevocations.revokedIds.has(
        binding.certificate.statement.revocationId,
      )
    ) {
      throw new Error("Relationship-channel binding is expired or revoked.");
    }
  }
  if (now < signed.invitation.issuedAt || now > signed.invitation.expiresAt) {
    throw new Error("Relationship-channel invitation is not currently valid.");
  }
  return {
    version: 1,
    channelId: signed.invitation.channelId,
    invitationDigest: signed.invitationDigest,
    inviterBindingDigest: bindings.inviter.certificateDigest,
    inviteeBindingDigest: bindings.invitee.certificateDigest,
    revocationSnapshotDigest,
    status: "invited",
    activeEpoch: 0,
    activeEpochDigest: null,
    nextSequence: 0,
    messagesUsed: 0,
    bytesUsed: 0,
    maxMessages: signed.invitation.quota.maxMessages,
    maxTotalBytes: signed.invitation.quota.maxTotalBytes,
    expiresAt: signed.invitation.expiresAt,
    reportDigest: null,
  };
}

export function activateRelationshipChannelEpoch(
  state: RelationshipChannelStateV1,
  value: SignedRelationshipChannelEpochV1,
  bindings: {
    inviter: VerifiedWalletMailBinding;
    invitee: VerifiedWalletMailBinding;
  },
  currentRevocations: {
    revokedIds: ReadonlySet<string>;
    snapshotDigest: string;
  },
): RelationshipChannelStateV1 {
  if (
    state.status !== "active" &&
    !(state.status === "invited" && state.activeEpoch === 0)
  ) {
    throw new Error(
      "Only an invited or active relationship channel can rotate keys.",
    );
  }
  if (
    state.inviterBindingDigest !== bindings.inviter.certificateDigest ||
    state.inviteeBindingDigest !== bindings.invitee.certificateDigest
  ) {
    throw new Error("Relationship-channel epoch bindings changed.");
  }
  const signed = verifyRelationshipChannelEpoch(value, bindings);
  if (!signed) {
    throw new Error("Relationship-channel epoch signatures are invalid.");
  }
  const epoch = signed.epoch;
  const revocationSnapshotDigest = sha256Digest(
    currentRevocations.snapshotDigest,
    "Current revocation snapshot digest",
  );
  for (const binding of [bindings.inviter, bindings.invitee]) {
    if (
      epoch.createdAt < binding.certificate.statement.issuedAt ||
      epoch.createdAt > binding.certificate.statement.expiresAt ||
      currentRevocations.revokedIds.has(
        binding.certificate.statement.revocationId,
      )
    ) {
      throw new Error(
        "Relationship-channel epoch uses an expired or revoked binding.",
      );
    }
  }
  if (
    epoch.channelId !== state.channelId ||
    epoch.epoch !== state.activeEpoch + 1 ||
    epoch.previousEpochDigest !== state.activeEpochDigest ||
    epoch.expiresAt > state.expiresAt
  ) {
    throw new Error("Relationship-channel epoch continuity is invalid.");
  }
  return {
    ...state,
    status: "active",
    revocationSnapshotDigest,
    activeEpoch: epoch.epoch,
    activeEpochDigest: signed.epochDigest,
  };
}

export function consumeRelationshipChannelQuota(
  state: RelationshipChannelStateV1,
  use: ChannelMessageUse,
): RelationshipChannelStateV1 {
  if (state.status !== "active" || state.activeEpoch === 0) {
    throw new Error("Relationship channel is not active with a key epoch.");
  }
  const sentAt = timestamp(use.sentAt, "Channel message time");
  const ciphertextBytes = boundedInteger(
    use.ciphertextBytes,
    "Channel ciphertext size",
    1,
    CHANNEL_MAX_MESSAGE_BYTES,
  );
  if (sentAt > state.expiresAt) {
    return { ...state, status: "expired" };
  }
  if (use.sequence !== state.nextSequence) {
    throw new Error(
      "Relationship-channel message sequence is invalid or replayed.",
    );
  }
  if (
    state.messagesUsed + 1 > state.maxMessages ||
    state.bytesUsed + ciphertextBytes > state.maxTotalBytes
  ) {
    throw new Error("Relationship-channel invitation quota is exhausted.");
  }
  return {
    ...state,
    nextSequence: state.nextSequence + 1,
    messagesUsed: state.messagesUsed + 1,
    bytesUsed: state.bytesUsed + ciphertextBytes,
  };
}

export function terminateRelationshipChannel(
  state: RelationshipChannelStateV1,
  action:
    | { kind: "block" }
    | { kind: "revoke" }
    | { kind: "report"; evidenceDigest: string },
): RelationshipChannelStateV1 {
  if (state.status !== "active") {
    throw new Error("Relationship channel is already terminal.");
  }
  if (action.kind === "report") {
    return {
      ...state,
      status: "reported",
      reportDigest: sha256Digest(
        action.evidenceDigest,
        "Report evidence digest",
      ),
    };
  }
  return {
    ...state,
    status: action.kind === "block" ? "blocked" : "revoked",
  };
}
