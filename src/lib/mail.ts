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
const EMPTY_BYTES = new Uint8Array();
const textEncoder = new TextEncoder();

const PRIVATE_KEY_INFO = textEncoder.encode("quietline/x25519/private/v1");
const MAIL_KEY_INFO = textEncoder.encode("key");
const VIEW_TAG_INFO = textEncoder.encode("tag");
const AAD_DOMAIN = textEncoder.encode("quietline/mail/aes-gcm/v1");

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
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(aesKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const plaintextBytes =
    typeof plaintext === "string" ? textEncoder.encode(plaintext) : plaintext;
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(mailAad(ephemeralPublicKey, nonce)),
      tagLength: AES_TAG_BITS,
    },
    key,
    toArrayBuffer(plaintextBytes),
  );

  const ciphertextFelts = packBytesToFelts(new Uint8Array(ciphertext));
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

export async function decryptMail(
  privateKey: Uint8Array,
  record: EncryptedMailRecord,
): Promise<Uint8Array> {
  assertLength(privateKey, X25519_KEY_BYTES, "x25519 private key");
  const ephemeralPublicKey = publicKeyFromFelts(record.ephemeralPub);
  const nonce = nonceFromFelts(record.nonce);
  const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPublicKey);
  const { aesKey, viewTag } = deriveMailSecrets(sharedSecret);
  if (record.viewTag !== viewTag) throw new Error("Mail view tag does not match.");

  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(aesKey),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(mailAad(ephemeralPublicKey, nonce)),
      tagLength: AES_TAG_BITS,
    },
    key,
    toArrayBuffer(unpackFeltsToBytes(record.ciphertextFelts)),
  );
  return new Uint8Array(plaintext);
}

/** Trial-decrypts only records whose one-byte view tag matches this recipient. */
export async function scanAndDecrypt(
  privateKey: Uint8Array,
  records: readonly EncryptedMailRecord[],
): Promise<DecryptedMail[]> {
  assertLength(privateKey, X25519_KEY_BYTES, "x25519 private key");
  const decrypted: DecryptedMail[] = [];

  for (const [index, record] of records.entries()) {
    try {
      const ephemeralPublicKey = publicKeyFromFelts(record.ephemeralPub);
      const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPublicKey);
      const { viewTag } = deriveMailSecrets(sharedSecret);
      if (record.viewTag !== viewTag) continue;

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
