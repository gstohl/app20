import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { decodeEnvelope, type DecodedMail } from "./envelope.js";

const FELT_PAYLOAD_BYTES = 31;
export const MAX_CT_FELTS = 140;
const MAX_PACKED_BYTES = (MAX_CT_FELTS - 1) * FELT_PAYLOAD_BYTES;
const X25519_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AES_KEY_BYTES = 32;
const AES_TAG_BITS = 128;
const AES_TAG_BYTES = AES_TAG_BITS / 8;
const MULTI_MARKER_BYTES = 3;
const MULTI_HEADER_BYTES = MULTI_MARKER_BYTES + 2;
const MULTI_SLOT_TAG_BYTES = 16;
const WRAPPED_DEK_BYTES = AES_KEY_BYTES + AES_TAG_BYTES;
export const MULTI_RECIPIENT_SLOT_BYTES =
  MULTI_SLOT_TAG_BYTES + WRAPPED_DEK_BYTES;
const MULTI_FIXED_BYTES =
  MULTI_HEADER_BYTES + NONCE_BYTES + AES_TAG_BYTES;

/**
 * Multi-recipient ciphertexts use outer view_tag 0xff as a scan marker. Because
 * legacy one-byte tags can also equal 0xff, scanners inspect the QLM marker and
 * retain an authenticated legacy fallback rather than dropping old records.
 */
export const MULTI_RECIPIENT_VIEW_TAG = 0xff;
export const MULTI_RECIPIENT_VERSION = 1 as const;

/**
 * 140 felts carry one length felt plus 139 * 31 = 4,309 payload bytes.
 * An empty v1 multi-recipient record costs 33 fixed bytes and 64 bytes per slot,
 * so floor((4,309 - 33) / 64) = 66 recipients. Non-empty bodies can lower the
 * practical limit and are checked before encryption.
 */
export const MAX_MULTI_RECIPIENTS = Math.floor(
  (MAX_PACKED_BYTES - MULTI_FIXED_BYTES) / MULTI_RECIPIENT_SLOT_BYTES,
);

const EMPTY_BYTES = new Uint8Array();
const textEncoder = new TextEncoder();
const MULTI_RECIPIENT_MARKER = textEncoder.encode("QLM");

const PRIVATE_KEY_INFO = textEncoder.encode("quietline/x25519/private/v1");
const MAIL_KEY_INFO = textEncoder.encode("key");
const VIEW_TAG_INFO = textEncoder.encode("tag");
const AAD_DOMAIN = textEncoder.encode("quietline/mail/aes-gcm/v1");
const MULTI_WRAP_KEY_INFO = textEncoder.encode(
  "quietline/mail/multi/v1/wrap-key",
);
const MULTI_SLOT_TAG_INFO = textEncoder.encode(
  "quietline/mail/multi/v1/slot-tag",
);
const MULTI_AAD_DOMAIN = textEncoder.encode("quietline/mail/multi/aes-gcm");
const MULTI_SLOT_AAD_LABEL = textEncoder.encode("slot");
const MULTI_BODY_AAD_LABEL = textEncoder.encode("body");

export type Felt = string;
export type FeltPair = [Felt, Felt];

export type MailKeypair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

/** The seed source is injected so tests/devnet never need a wallet. */
export type MailSeedSource = () => Uint8Array | Promise<Uint8Array>;

export type EncryptedMailRecord = {
  ephemeralPub: FeltPair;
  viewTag: number;
  nonce: FeltPair;
  ciphertextFelts: Felt[];
};

export type DecryptedMail = {
  index: number;
  plaintext: string;
  plaintextBytes: Uint8Array;
  envelope: DecodedMail;
  record: EncryptedMailRecord;
};

type FeltInput = string | number | bigint;

type MultiRecipientMaterial = {
  slotTag: Uint8Array;
  wrappingKey: Uint8Array;
};

type ParsedMultiRecipientCiphertext = {
  slotCount: number;
  slots: Array<{
    index: number;
    tag: Uint8Array;
    wrappedDek: Uint8Array;
  }>;
  bodyNonce: Uint8Array;
  bodyCiphertext: Uint8Array;
};

function assertLength(bytes: Uint8Array, length: number, label: string): void {
  if (bytes.length !== length) {
    throw new Error(`${label} must be exactly ${length} bytes.`);
  }
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function bytesToFingerprint(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function parseFelt(value: FeltInput, label = "felt"): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not an integer felt.`);
  }
  if (parsed < 0n) throw new Error(`${label} cannot be negative.`);
  return parsed;
}

function bigIntToFixedBytes(
  value: FeltInput,
  length: number,
  label = "felt",
): Uint8Array {
  let remaining = parseFelt(value, label);
  const limit = 1n << BigInt(length * 8);
  if (remaining >= limit) {
    throw new Error(`${label} does not fit in ${length} bytes.`);
  }

  const result = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function toHex(value: bigint): Felt {
  return `0x${value.toString(16)}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/**
 * Packs bytes into 31-byte felt payloads. The first felt stores the byte length,
 * which makes leading zeroes and the final short chunk fully reversible.
 */
export function packBytesToFelts(bytes: Uint8Array): Felt[] {
  const felts = [toHex(BigInt(bytes.length))];
  for (let offset = 0; offset < bytes.length; offset += FELT_PAYLOAD_BYTES) {
    felts.push(toHex(bytesToBigInt(bytes.subarray(offset, offset + FELT_PAYLOAD_BYTES))));
  }
  return felts;
}

export function unpackFeltsToBytes(felts: readonly FeltInput[]): Uint8Array {
  if (felts.length === 0) throw new Error("Packed felts are missing a byte length.");
  if (felts.length > MAX_CT_FELTS) {
    throw new Error(`Packed ciphertext exceeds ${MAX_CT_FELTS} felts.`);
  }

  const byteLengthValue = parseFelt(felts[0], "packed byte length");
  if (byteLengthValue > BigInt(MAX_PACKED_BYTES)) {
    throw new Error("Packed byte length exceeds the mail payload limit.");
  }
  const byteLength = Number(byteLengthValue);
  const payloadCount = Math.ceil(byteLength / FELT_PAYLOAD_BYTES);
  if (felts.length !== payloadCount + 1) {
    throw new Error(
      `Packed felt count does not match byte length (${payloadCount + 1} expected).`,
    );
  }

  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < payloadCount; index += 1) {
    const offset = index * FELT_PAYLOAD_BYTES;
    const chunkLength = Math.min(FELT_PAYLOAD_BYTES, byteLength - offset);
    bytes.set(
      bigIntToFixedBytes(felts[index + 1], chunkLength, `packed felt ${index}`),
      offset,
    );
  }
  return bytes;
}

/** Two 128-bit limbs keep every x25519 key representable as Starknet felts. */
export function publicKeyToFelts(publicKey: Uint8Array): FeltPair {
  assertLength(publicKey, X25519_KEY_BYTES, "x25519 public key");
  return [
    toHex(bytesToBigInt(publicKey.subarray(0, 16))),
    toHex(bytesToBigInt(publicKey.subarray(16, 32))),
  ];
}

export function publicKeyFromFelts(pair: readonly FeltInput[]): Uint8Array {
  if (pair.length !== 2) throw new Error("x25519 public key requires two felts.");
  return concatBytes(
    bigIntToFixedBytes(pair[0], 16, "public key limb 0"),
    bigIntToFixedBytes(pair[1], 16, "public key limb 1"),
  );
}

function nonceToFelts(nonce: Uint8Array): FeltPair {
  assertLength(nonce, NONCE_BYTES, "AES-GCM nonce");
  return [
    toHex(bytesToBigInt(nonce.subarray(0, 6))),
    toHex(bytesToBigInt(nonce.subarray(6, 12))),
  ];
}

function nonceFromFelts(pair: readonly FeltInput[]): Uint8Array {
  if (pair.length !== 2) throw new Error("AES-GCM nonce requires two felts.");
  return concatBytes(
    bigIntToFixedBytes(pair[0], 6, "nonce limb 0"),
    bigIntToFixedBytes(pair[1], 6, "nonce limb 1"),
  );
}

function deriveMailSecrets(sharedSecret: Uint8Array): {
  aesKey: Uint8Array;
  viewTag: number;
} {
  const aesKey = hkdf(sha256, sharedSecret, EMPTY_BYTES, MAIL_KEY_INFO, AES_KEY_BYTES);
  const viewTag = hkdf(sha256, sharedSecret, EMPTY_BYTES, VIEW_TAG_INFO, 1)[0];
  return { aesKey, viewTag };
}

function mailAad(ephemeralPublicKey: Uint8Array, nonce: Uint8Array): Uint8Array {
  return concatBytes(AAD_DOMAIN, ephemeralPublicKey, nonce);
}

function deriveMultiRecipientMaterial(
  sharedSecret: Uint8Array,
  nonce: Uint8Array,
  slotCount: number,
): MultiRecipientMaterial {
  const context = Uint8Array.of(MULTI_RECIPIENT_VERSION, slotCount);
  return {
    wrappingKey: hkdf(
      sha256,
      sharedSecret,
      nonce,
      concatBytes(MULTI_WRAP_KEY_INFO, context),
      AES_KEY_BYTES,
    ),
    slotTag: hkdf(
      sha256,
      sharedSecret,
      nonce,
      concatBytes(MULTI_SLOT_TAG_INFO, context),
      MULTI_SLOT_TAG_BYTES,
    ),
  };
}

function multiAadPrefix(
  ephemeralPublicKey: Uint8Array,
  nonce: Uint8Array,
  slotCount: number,
): Uint8Array {
  return concatBytes(
    MULTI_AAD_DOMAIN,
    MULTI_RECIPIENT_MARKER,
    Uint8Array.of(MULTI_RECIPIENT_VERSION, slotCount),
    ephemeralPublicKey,
    nonce,
  );
}

function multiSlotAad(
  aadPrefix: Uint8Array,
  slotIndex: number,
  slotTag: Uint8Array,
): Uint8Array {
  return concatBytes(
    aadPrefix,
    MULTI_SLOT_AAD_LABEL,
    Uint8Array.of(slotIndex),
    slotTag,
  );
}

function multiBodyAad(
  aadPrefix: Uint8Array,
  bodyNonce: Uint8Array,
): Uint8Array {
  return concatBytes(aadPrefix, MULTI_BODY_AAD_LABEL, bodyNonce);
}

/** Derives a distinct wrapping IV from the record nonce and sorted slot index. */
function multiSlotNonce(nonce: Uint8Array, slotIndex: number): Uint8Array {
  const derived = nonce.slice();
  const counter = slotIndex + 1;
  for (let byte = 0; byte < 4; byte += 1) {
    derived[derived.length - 1 - byte] ^= (counter >>> (byte * 8)) & 0xff;
  }
  return derived;
}

async function aesGcmEncrypt(
  rawKey: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad),
      tagLength: AES_TAG_BITS,
    },
    key,
    toArrayBuffer(plaintext),
  );
  return new Uint8Array(ciphertext);
}

async function aesGcmDecrypt(
  rawKey: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad),
      tagLength: AES_TAG_BITS,
    },
    key,
    toArrayBuffer(ciphertext),
  );
  return new Uint8Array(plaintext);
}

function hasMultiRecipientMarker(bytes: Uint8Array): boolean {
  return (
    bytes.length >= MULTI_MARKER_BYTES &&
    MULTI_RECIPIENT_MARKER.every((byte, index) => bytes[index] === byte)
  );
}

/**
 * Multi-recipient v1 wire bytes inside the existing packed ct field:
 *   ["QLM" (3)][version=0x01 (1)][slot count (1)]
 *   [sorted slots: tag (16) || AES-GCM-wrapped 32-byte DEK (48)]...
 *   [body nonce (12)][AES-GCM body ciphertext || tag (plaintext + 16)]
 *
 * The record's 12-byte outer nonce seeds HKDF and derives per-slot wrapping IVs.
 * Slot and body AAD both bind the format version, slot count, ephemeral public
 * key, and outer nonce; slot AAD additionally binds its sorted index and tag.
 * Sorting pseudorandom tags removes caller-provided recipient ordering.
 *
 * Public leakage is the number of recipients, ciphertext-size range, timing,
 * and the fact that a pool transaction occurred. Tags are ECDH-derived and do
 * not reveal recipient identities or let recipients identify one another; a
 * passive observer sees no recipient set beyond the explicit count.
 */
function parseMultiRecipientCiphertext(
  bytes: Uint8Array,
): ParsedMultiRecipientCiphertext {
  if (!hasMultiRecipientMarker(bytes)) {
    throw new Error("Multi-recipient mail marker is missing.");
  }
  if (bytes.length < MULTI_HEADER_BYTES) {
    throw new Error("Multi-recipient mail header is truncated.");
  }
  if (bytes[MULTI_MARKER_BYTES] !== MULTI_RECIPIENT_VERSION) {
    throw new Error("Unsupported multi-recipient mail version.");
  }

  const slotCount = bytes[MULTI_MARKER_BYTES + 1];
  if (slotCount < 2 || slotCount > MAX_MULTI_RECIPIENTS) {
    throw new Error("Multi-recipient mail has an invalid slot count.");
  }

  const bodyNonceOffset =
    MULTI_HEADER_BYTES + slotCount * MULTI_RECIPIENT_SLOT_BYTES;
  const minimumLength = bodyNonceOffset + NONCE_BYTES + AES_TAG_BYTES;
  if (bytes.length < minimumLength) {
    throw new Error("Multi-recipient mail ciphertext is truncated.");
  }

  const slots: ParsedMultiRecipientCiphertext["slots"] = [];
  for (let index = 0; index < slotCount; index += 1) {
    const offset = MULTI_HEADER_BYTES + index * MULTI_RECIPIENT_SLOT_BYTES;
    slots.push({
      index,
      tag: bytes.slice(offset, offset + MULTI_SLOT_TAG_BYTES),
      wrappedDek: bytes.slice(
        offset + MULTI_SLOT_TAG_BYTES,
        offset + MULTI_RECIPIENT_SLOT_BYTES,
      ),
    });
  }

  return {
    slotCount,
    slots,
    bodyNonce: bytes.slice(bodyNonceOffset, bodyNonceOffset + NONCE_BYTES),
    bodyCiphertext: bytes.slice(bodyNonceOffset + NONCE_BYTES),
  };
}

export function deriveKeypair(seed32: Uint8Array): MailKeypair {
  assertLength(seed32, X25519_KEY_BYTES, "mail seed");
  const privateKey = hkdf(
    sha256,
    seed32,
    EMPTY_BYTES,
    PRIVATE_KEY_INFO,
    X25519_KEY_BYTES,
  );
  return {
    privateKey,
    publicKey: x25519.getPublicKey(privateKey),
  };
}

export async function deriveKeypairFromSource(
  seedSource: MailSeedSource,
): Promise<MailKeypair> {
  return deriveKeypair(await seedSource());
}

export async function encryptMail(
  recipientPublicKey: Uint8Array,
  plaintext: string | Uint8Array,
): Promise<EncryptedMailRecord> {
  assertLength(recipientPublicKey, X25519_KEY_BYTES, "recipient public key");

  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sharedSecret = x25519.getSharedSecret(
    ephemeralPrivateKey,
    recipientPublicKey,
  );
  const { aesKey, viewTag } = deriveMailSecrets(sharedSecret);
  const plaintextBytes =
    typeof plaintext === "string" ? textEncoder.encode(plaintext) : plaintext;
  const ciphertext = await aesGcmEncrypt(
    aesKey,
    nonce,
    mailAad(ephemeralPublicKey, nonce),
    plaintextBytes,
  );

  const ciphertextFelts = packBytesToFelts(ciphertext);
  if (ciphertextFelts.length > MAX_CT_FELTS) {
    throw new Error(`Encrypted mail exceeds ${MAX_CT_FELTS} ciphertext felts.`);
  }

  return {
    ephemeralPub: publicKeyToFelts(ephemeralPublicKey),
    viewTag,
    nonce: nonceToFelts(nonce),
    ciphertextFelts,
  };
}

/**
 * Encrypts one record for one or more public keys. A one-key call deliberately
 * delegates to encryptMail so the deployed single-recipient wire format stays
 * byte-compatible; calls with two or more keys use the hybrid QLM format.
 */
export async function encryptMailForRecipients(
  recipientPublicKeys: readonly Uint8Array[],
  plaintext: string | Uint8Array,
): Promise<EncryptedMailRecord> {
  if (recipientPublicKeys.length === 0) {
    throw new Error("Multi-recipient mail requires at least one recipient.");
  }
  if (recipientPublicKeys.length > MAX_MULTI_RECIPIENTS) {
    throw new Error(
      `Multi-recipient mail supports at most ${MAX_MULTI_RECIPIENTS} ` +
        `recipients within the ${MAX_CT_FELTS}-felt ciphertext cap.`,
    );
  }

  const recipientKeys = recipientPublicKeys.map((publicKey, index) => {
    assertLength(publicKey, X25519_KEY_BYTES, `recipient public key ${index}`);
    return publicKey.slice();
  });
  const fingerprints = new Set<string>();
  for (const publicKey of recipientKeys) {
    const fingerprint = bytesToFingerprint(publicKey);
    if (fingerprints.has(fingerprint)) {
      throw new Error("Multi-recipient public keys must be unique.");
    }
    fingerprints.add(fingerprint);
  }

  if (recipientKeys.length === 1) {
    return encryptMail(recipientKeys[0], plaintext);
  }

  const plaintextBytes =
    typeof plaintext === "string" ? textEncoder.encode(plaintext) : plaintext;
  const projectedBytes =
    MULTI_FIXED_BYTES +
    recipientKeys.length * MULTI_RECIPIENT_SLOT_BYTES +
    plaintextBytes.length;
  if (projectedBytes > MAX_PACKED_BYTES) {
    throw new Error(
      `Encrypted mail for ${recipientKeys.length} recipients and ` +
        `${plaintextBytes.length} plaintext bytes exceeds the ` +
        `${MAX_CT_FELTS}-felt ciphertext cap.`,
    );
  }

  // Every invocation gets a fresh ephemeral key, DEK, outer nonce, and body IV.
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const bodyNonce = globalThis.crypto.getRandomValues(
    new Uint8Array(NONCE_BYTES),
  );
  const dek = globalThis.crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES));

  const materials = recipientKeys.map((recipientPublicKey) => {
    const sharedSecret = x25519.getSharedSecret(
      ephemeralPrivateKey,
      recipientPublicKey,
    );
    return deriveMultiRecipientMaterial(
      sharedSecret,
      nonce,
      recipientKeys.length,
    );
  });
  materials.sort((left, right) => compareBytes(left.slotTag, right.slotTag));
  for (let index = 1; index < materials.length; index += 1) {
    if (equalBytes(materials[index - 1].slotTag, materials[index].slotTag)) {
      throw new Error("Multi-recipient slot tag collision; retry encryption.");
    }
  }

  const aadPrefix = multiAadPrefix(
    ephemeralPublicKey,
    nonce,
    materials.length,
  );
  const slots = await Promise.all(
    materials.map(async (material, index) => {
      const wrappedDek = await aesGcmEncrypt(
        material.wrappingKey,
        multiSlotNonce(nonce, index),
        multiSlotAad(aadPrefix, index, material.slotTag),
        dek,
      );
      return concatBytes(material.slotTag, wrappedDek);
    }),
  );
  const bodyCiphertext = await aesGcmEncrypt(
    dek,
    bodyNonce,
    multiBodyAad(aadPrefix, bodyNonce),
    plaintextBytes,
  );

  const wireBytes = concatBytes(
    MULTI_RECIPIENT_MARKER,
    Uint8Array.of(MULTI_RECIPIENT_VERSION, materials.length),
    ...slots,
    bodyNonce,
    bodyCiphertext,
  );
  const ciphertextFelts = packBytesToFelts(wireBytes);
  if (ciphertextFelts.length > MAX_CT_FELTS) {
    throw new Error(
      `Encrypted multi-recipient mail exceeds ${MAX_CT_FELTS} ciphertext felts.`,
    );
  }

  return {
    ephemeralPub: publicKeyToFelts(ephemeralPublicKey),
    viewTag: MULTI_RECIPIENT_VIEW_TAG,
    nonce: nonceToFelts(nonce),
    ciphertextFelts,
  };
}

async function decryptLegacyMail(
  sharedSecret: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  nonce: Uint8Array,
  record: EncryptedMailRecord,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const { aesKey, viewTag } = deriveMailSecrets(sharedSecret);
  if (record.viewTag !== viewTag) throw new Error("Mail view tag does not match.");
  return aesGcmDecrypt(
    aesKey,
    nonce,
    mailAad(ephemeralPublicKey, nonce),
    ciphertext,
  );
}

async function decryptMultiRecipientMail(
  sharedSecret: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const parsed = parseMultiRecipientCiphertext(ciphertext);
  const material = deriveMultiRecipientMaterial(
    sharedSecret,
    nonce,
    parsed.slotCount,
  );
  const aadPrefix = multiAadPrefix(
    ephemeralPublicKey,
    nonce,
    parsed.slotCount,
  );
  let foundCandidate = false;

  for (const slot of parsed.slots) {
    if (!equalBytes(slot.tag, material.slotTag)) continue;
    foundCandidate = true;
    try {
      const dek = await aesGcmDecrypt(
        material.wrappingKey,
        multiSlotNonce(nonce, slot.index),
        multiSlotAad(aadPrefix, slot.index, slot.tag),
        slot.wrappedDek,
      );
      assertLength(dek, AES_KEY_BYTES, "unwrapped content key");
      return await aesGcmDecrypt(
        dek,
        parsed.bodyNonce,
        multiBodyAad(aadPrefix, parsed.bodyNonce),
        parsed.bodyCiphertext,
      );
    } catch {
      // Another colliding/corrupted slot must not hide a later valid candidate.
    }
  }

  throw new Error(
    foundCandidate
      ? "Mail recipient slot authentication failed."
      : "Mail recipient slot was not found.",
  );
}

export async function decryptMail(
  privateKey: Uint8Array,
  record: EncryptedMailRecord,
): Promise<Uint8Array> {
  assertLength(privateKey, X25519_KEY_BYTES, "x25519 private key");
  const ephemeralPublicKey = publicKeyFromFelts(record.ephemeralPub);
  const nonce = nonceFromFelts(record.nonce);
  const possibleMultiCiphertext =
    record.viewTag === MULTI_RECIPIENT_VIEW_TAG
      ? unpackFeltsToBytes(record.ciphertextFelts)
      : undefined;
  const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPublicKey);

  if (
    possibleMultiCiphertext &&
    hasMultiRecipientMarker(possibleMultiCiphertext)
  ) {
    try {
      return await decryptMultiRecipientMail(
        sharedSecret,
        ephemeralPublicKey,
        nonce,
        possibleMultiCiphertext,
      );
    } catch (multiRecipientError) {
      // A deployed legacy tag can be 0xff and its random ciphertext can begin QLM.
      // Authenticated legacy fallback preserves every such historical record.
      try {
        return await decryptLegacyMail(
          sharedSecret,
          ephemeralPublicKey,
          nonce,
          record,
          possibleMultiCiphertext,
        );
      } catch {
        throw multiRecipientError;
      }
    }
  }

  return decryptLegacyMail(
    sharedSecret,
    ephemeralPublicKey,
    nonce,
    record,
    possibleMultiCiphertext ?? unpackFeltsToBytes(record.ciphertextFelts),
  );
}

/**
 * Uses the legacy view tag or the reserved 0xff multi marker, then performs one
 * ECDH per candidate record. Invalid and non-recipient records yield nothing.
 */
export async function scanAndDecrypt(
  privateKey: Uint8Array,
  records: readonly EncryptedMailRecord[],
): Promise<DecryptedMail[]> {
  assertLength(privateKey, X25519_KEY_BYTES, "x25519 private key");
  const decrypted: DecryptedMail[] = [];

  for (const [index, record] of records.entries()) {
    try {
      const plaintextBytes = await decryptMail(privateKey, record);
      const envelope = decodeEnvelope(plaintextBytes);
      const plaintext =
        envelope.type === "text" &&
        typeof (envelope.payload as { body?: unknown }).body === "string"
          ? (envelope.payload as { body: string }).body
          : "";
      decrypted.push({
        index,
        plaintext,
        plaintextBytes,
        envelope,
        record,
      });
    } catch {
      // Public event streams are untrusted. Invalid/non-recipient records are skipped.
    }
  }

  return decrypted;
}
