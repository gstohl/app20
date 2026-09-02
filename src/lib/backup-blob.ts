import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { normalizeStarknetAddress } from "./address-book.js";
import {
  BACKUP_SNAPSHOT_DOMAIN,
  normalizeBackupSnapshotContext,
  type BackupKind,
  type BackupSnapshotContext,
} from "./backup-snapshot.js";

export const BACKUP_BLOB_VERSION = 1 as const;
export const BACKUP_BLOB_DOMAIN = "app20/backup-blob/v1" as const;
export const BACKUP_BLOB_BUCKET_BYTES = 4_096;
export const BACKUP_BLOB_MAX_BYTES = 1_048_576;

export type BackupPointerV1 = Readonly<{
  kind: BackupKind;
  seq: number;
  cid: string;
  bucketBytes: number;
  blobDigest: string;
  mac: string;
}>;

export type CreateBackupPointerInput = Readonly<
  Omit<BackupPointerV1, "mac"> &
    BackupSnapshotContext & {
      mailboxSeed: Uint8Array;
    }
>;

export type VerifyBackupPointerInput = Readonly<
  BackupSnapshotContext & {
    mailboxSeed: Uint8Array;
    kind?: BackupKind;
    seq?: number;
  }
>;

export type SealBackupBlobInput = Readonly<{
  mailboxSeed: Uint8Array;
  owner: string;
  chainId: string;
  kind: BackupKind;
  seq: number;
  bytes: Uint8Array;
}>;

export type OpenBackupBlobInput = Readonly<{
  mailboxSeed: Uint8Array;
  owner: string;
  chainId: string;
  kind: BackupKind;
  seq: number;
  blob: Uint8Array;
}>;

const HEADER_BYTES = 6;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const LENGTH_BYTES = 4;
const AES_KEY_BYTES = 32;
const AES_TAG_BITS = TAG_BYTES * 8;
const MAX_SEQUENCE = 0xffff_ffff;
const CID_PATTERN = /^b[a-z2-7]{58}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/i;
const textEncoder = new TextEncoder();
const KIND_BYTES: Readonly<Record<BackupKind, number>> = Object.freeze({
  contacts: 1,
  "rfq-resume": 2,
});

function requireKind(value: unknown): BackupKind {
  if (value !== "contacts" && value !== "rfq-resume") {
    throw new Error("The backup blob kind is unsupported.");
  }
  return value;
}

function requireSequence(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SEQUENCE
  ) {
    throw new Error("The backup blob sequence is invalid.");
  }
  return value;
}

function normalizeChainId(value: string): string {
  const trimmed = value.trim();
  const unprefixed = trimmed.startsWith("starknet:")
    ? trimmed.slice("starknet:".length)
    : trimmed;
  const named =
    unprefixed === "SN_MAIN"
      ? "0x534e5f4d41494e"
      : unprefixed === "SN_SEPOLIA"
        ? "0x534e5f5345504f4c4941"
        : unprefixed;
  try {
    const parsed = BigInt(named);
    if (parsed <= 0n) throw new Error();
    return `0x${parsed.toString(16)}`;
  } catch {
    throw new Error("The backup blob chain is invalid.");
  }
}

function infoString(input: {
  owner: string;
  chainId: string;
  kind: BackupKind;
  seq: number;
}): string {
  return `${BACKUP_BLOB_DOMAIN}:${normalizeStarknetAddress(input.owner)}:${normalizeChainId(input.chainId)}:${requireKind(input.kind)}:${requireSequence(input.seq)}`;
}

function deriveKey(mailboxSeed: Uint8Array, info: string): Uint8Array {
  if (mailboxSeed.length !== 32) {
    throw new Error("Unlock the mailbox with its 32-byte recovery seed first.");
  }
  return hkdf(
    sha256,
    mailboxSeed,
    textEncoder.encode(`${BACKUP_BLOB_DOMAIN}/salt`),
    textEncoder.encode(info),
    AES_KEY_BYTES,
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readU32(source: Uint8Array, offset: number): number {
  return (
    source[offset] * 0x1_000_000 +
    source[offset + 1] * 0x1_0000 +
    source[offset + 2] * 0x100 +
    source[offset + 3]
  );
}

function kindForByte(value: number): BackupKind | undefined {
  return (Object.entries(KIND_BYTES) as Array<[BackupKind, number]>).find(
    ([, byte]) => byte === value,
  )?.[0];
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function backupBlobDigest(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("The backup blob must be bytes.");
  }
  return bytesToHex(sha256(bytes));
}

type BackupPointerBody = Omit<BackupPointerV1, "mac">;

function parseBackupPointerBody(
  value: Record<string, unknown>,
): BackupPointerBody {
  if (
    typeof value.cid !== "string" ||
    !CID_PATTERN.test(value.cid) ||
    typeof value.bucketBytes !== "number" ||
    !Number.isSafeInteger(value.bucketBytes) ||
    value.bucketBytes < BACKUP_BLOB_BUCKET_BYTES ||
    value.bucketBytes > BACKUP_BLOB_MAX_BYTES ||
    value.bucketBytes % BACKUP_BLOB_BUCKET_BYTES !== 0 ||
    typeof value.blobDigest !== "string" ||
    !DIGEST_PATTERN.test(value.blobDigest)
  ) {
    throw new Error("The backup pointer payload is invalid.");
  }
  return Object.freeze({
    kind: requireKind(value.kind),
    seq: requireSequence(value.seq),
    cid: value.cid,
    bucketBytes: value.bucketBytes,
    blobDigest: value.blobDigest.toLowerCase(),
  });
}

function pointerMacInfo(
  pointer: BackupPointerBody,
  context: BackupSnapshotContext,
): string {
  return [
    BACKUP_SNAPSHOT_DOMAIN,
    "backup_pointer",
    pointer.kind,
    pointer.seq,
    pointer.cid,
    pointer.bucketBytes,
    pointer.blobDigest,
    context.owner,
    context.chainId,
    context.helperAddress,
    context.mailboxFingerprint,
  ].join(":");
}

function authenticatePointer(
  pointer: BackupPointerBody,
  mailboxSeed: Uint8Array,
  context: BackupSnapshotContext,
): string {
  if (mailboxSeed.length !== 32) {
    throw new Error("Unlock the mailbox with its 32-byte recovery seed first.");
  }
  const info = textEncoder.encode(pointerMacInfo(pointer, context));
  const key = hkdf(
    sha256,
    mailboxSeed,
    textEncoder.encode(`${BACKUP_SNAPSHOT_DOMAIN}/salt`),
    info,
    32,
  );
  try {
    return bytesToHex(hmac(sha256, key, sha256(info)));
  } finally {
    key.fill(0);
  }
}

export function createBackupPointer(
  input: CreateBackupPointerInput,
): BackupPointerV1 {
  const context = normalizeBackupSnapshotContext(input);
  const pointer = parseBackupPointerBody({
    kind: input.kind,
    seq: input.seq,
    cid: input.cid,
    bucketBytes: input.bucketBytes,
    blobDigest: input.blobDigest,
  });
  return Object.freeze({
    ...pointer,
    mac: authenticatePointer(pointer, input.mailboxSeed, context),
  });
}

export function parseBackupPointer(value: unknown): BackupPointerV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The backup pointer payload is invalid.");
  }
  const expected = [
    "blobDigest",
    "bucketBytes",
    "cid",
    "kind",
    "mac",
    "seq",
  ].sort();
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== expected.join(",")) {
    throw new Error("The backup pointer schema is unsupported.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.mac !== "string" || !DIGEST_PATTERN.test(record.mac)) {
    throw new Error("The backup pointer payload is invalid.");
  }
  return Object.freeze({
    ...parseBackupPointerBody(record),
    mac: record.mac.toLowerCase(),
  });
}

export function verifyBackupPointer(
  value: unknown,
  input: VerifyBackupPointerInput,
): BackupPointerV1 {
  const context = normalizeBackupSnapshotContext(input);
  const pointer = parseBackupPointer(value);
  if (
    (input.kind !== undefined && pointer.kind !== input.kind) ||
    (input.seq !== undefined && pointer.seq !== input.seq)
  ) {
    throw new Error(
      "This backup pointer belongs to a different kind or sequence.",
    );
  }
  const expectedMac = authenticatePointer(pointer, input.mailboxSeed, context);
  if (!equalBytes(hexToBytes(pointer.mac), hexToBytes(expectedMac))) {
    throw new Error("The backup pointer authentication failed.");
  }
  return pointer;
}

export async function sealBackupBlob(
  input: SealBackupBlobInput,
): Promise<Uint8Array> {
  if (!(input.bytes instanceof Uint8Array)) {
    throw new Error("The backup blob plaintext must be bytes.");
  }
  const info = infoString(input);
  const minimumBytes =
    HEADER_BYTES + NONCE_BYTES + TAG_BYTES + LENGTH_BYTES + input.bytes.length;
  const bucketBytes =
    Math.ceil(minimumBytes / BACKUP_BLOB_BUCKET_BYTES) *
    BACKUP_BLOB_BUCKET_BYTES;
  if (bucketBytes > BACKUP_BLOB_MAX_BYTES) {
    throw new Error("The encrypted backup exceeds the 1 MiB blob limit.");
  }
  const plaintextLength = bucketBytes - HEADER_BYTES - NONCE_BYTES - TAG_BYTES;
  const plaintext = new Uint8Array(plaintextLength);
  writeU32(plaintext, 0, input.bytes.length);
  plaintext.set(input.bytes, LENGTH_BYTES);

  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const keyBytes = deriveKey(input.mailboxSeed, info);
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      toArrayBuffer(keyBytes),
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const encrypted = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(nonce),
          additionalData: toArrayBuffer(textEncoder.encode(info)),
          tagLength: AES_TAG_BITS,
        },
        key,
        toArrayBuffer(plaintext),
      ),
    );
    const blob = new Uint8Array(bucketBytes);
    blob[0] = BACKUP_BLOB_VERSION;
    blob[1] = KIND_BYTES[input.kind];
    writeU32(blob, 2, input.seq);
    blob.set(nonce, HEADER_BYTES);
    blob.set(encrypted, HEADER_BYTES + NONCE_BYTES);
    return blob;
  } finally {
    keyBytes.fill(0);
    plaintext.fill(0);
  }
}

export async function openBackupBlob(
  input: OpenBackupBlobInput,
): Promise<Uint8Array> {
  if (!(input.blob instanceof Uint8Array)) {
    throw new Error("The encrypted backup blob must be bytes.");
  }
  if (
    input.blob.length < BACKUP_BLOB_BUCKET_BYTES ||
    input.blob.length > BACKUP_BLOB_MAX_BYTES ||
    input.blob.length % BACKUP_BLOB_BUCKET_BYTES !== 0
  ) {
    throw new Error("The encrypted backup blob has an invalid bucket size.");
  }
  const expectedKind = requireKind(input.kind);
  const expectedSequence = requireSequence(input.seq);
  const headerKind = kindForByte(input.blob[1]);
  const headerSequence = readU32(input.blob, 2);
  if (
    input.blob[0] !== BACKUP_BLOB_VERSION ||
    headerKind !== expectedKind ||
    headerSequence !== expectedSequence
  ) {
    throw new Error(
      "The backup blob header does not match its expected version, kind, or sequence.",
    );
  }
  const info = infoString(input);
  const nonce = input.blob.slice(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  const ciphertext = input.blob.slice(HEADER_BYTES + NONCE_BYTES);
  const keyBytes = deriveKey(input.mailboxSeed, info);
  let plaintext: Uint8Array;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      toArrayBuffer(keyBytes),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(nonce),
          additionalData: toArrayBuffer(textEncoder.encode(info)),
          tagLength: AES_TAG_BITS,
        },
        key,
        toArrayBuffer(ciphertext),
      ),
    );
  } catch (error: unknown) {
    throw new Error("The backup blob authentication failed.", { cause: error });
  } finally {
    keyBytes.fill(0);
  }

  try {
    if (plaintext.length < LENGTH_BYTES) {
      throw new Error("The backup blob plaintext is truncated.");
    }
    const byteLength = readU32(plaintext, 0);
    if (byteLength > plaintext.length - LENGTH_BYTES) {
      throw new Error("The backup blob plaintext length is invalid.");
    }
    for (
      let index = LENGTH_BYTES + byteLength;
      index < plaintext.length;
      index += 1
    ) {
      if (plaintext[index] !== 0) {
        throw new Error("The backup blob padding is invalid.");
      }
    }
    return plaintext.slice(LENGTH_BYTES, LENGTH_BYTES + byteLength);
  } finally {
    plaintext.fill(0);
  }
}
