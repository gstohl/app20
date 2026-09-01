import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { normalizeStarknetAddress } from "./address-book.js";

export const BACKUP_SNAPSHOT_VERSION = 1 as const;
export const BACKUP_SNAPSHOT_DOMAIN = "app20/backup/v1" as const;
export const BACKUP_SNAPSHOT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
export const BACKUP_SEQUENCE_STORAGE_PREFIX = "app20/backup-sequence/v1";

export type BackupKind = "contacts" | "rfq-resume";
export type BackupJsonValue =
  | null
  | boolean
  | number
  | string
  | BackupJsonValue[]
  | { [key: string]: BackupJsonValue };

export type BackupSnapshotV1<
  Payload extends BackupJsonValue = BackupJsonValue,
> = {
  version: 1;
  kind: BackupKind;
  seq: number;
  owner: string;
  chainId: string;
  helperAddress: string;
  mailboxFingerprint: string;
  createdAt: number;
  payload: Payload;
  digest: string;
  mac: string;
};

export type BackupSnapshotContext = {
  owner: string;
  chainId: string;
  helperAddress: string;
  mailboxFingerprint: string;
};

type CreateBackupSnapshotInput = BackupSnapshotContext & {
  mailboxSeed: Uint8Array;
  kind: BackupKind;
  seq: number;
  payload: unknown;
  now?: number;
};

type VerifyBackupSnapshotInput = BackupSnapshotContext & {
  mailboxSeed: Uint8Array;
  kind?: BackupKind;
  seq?: number;
  now?: number;
};

type BackupSnapshotBody<Payload extends BackupJsonValue = BackupJsonValue> =
  Omit<BackupSnapshotV1<Payload>, "digest" | "mac">;

const DIGEST_HEX = /^[0-9a-f]{64}$/i;
const MAILBOX_FINGERPRINT_HEX = /^[0-9a-f]{64}$/i;
const MAX_SEQUENCE = 0xffff_ffff;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;
const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string, label: string): Uint8Array {
  if (!DIGEST_HEX.test(value)) throw new Error(`${label} is invalid.`);
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
    throw new Error("The backup chain is invalid.");
  }
}

function normalizeFingerprint(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!MAILBOX_FINGERPRINT_HEX.test(normalized)) {
    throw new Error("The backup mailbox fingerprint is invalid.");
  }
  return normalized;
}

export function normalizeBackupSnapshotContext(
  input: BackupSnapshotContext,
): BackupSnapshotContext {
  return {
    owner: normalizeStarknetAddress(input.owner),
    chainId: normalizeChainId(input.chainId),
    helperAddress: normalizeStarknetAddress(input.helperAddress),
    mailboxFingerprint: normalizeFingerprint(input.mailboxFingerprint),
  };
}

function requireKind(value: unknown): BackupKind {
  if (value !== "contacts" && value !== "rfq-resume") {
    throw new Error("The backup kind is unsupported.");
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
    throw new Error("The backup sequence is invalid.");
  }
  return value;
}

function requireCreatedAt(value: unknown, now: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > now + BACKUP_SNAPSHOT_MAX_CLOCK_SKEW_MS
  ) {
    throw new Error("The backup creation time is invalid.");
  }
  return value;
}

function normalizeJson(
  value: unknown,
  state = { nodes: 0 },
  depth = 0,
  ancestors = new Set<object>(),
  path = "payload",
): BackupJsonValue {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new Error("The backup payload is too complex.");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} contains a value that JSON cannot represent.`);
  }
  if (ancestors.has(value)) {
    throw new Error(`${path} contains a circular reference.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child, index) => {
        if (!(index in value)) {
          throw new Error(`${path}[${index}] is an array hole.`);
        }
        return normalizeJson(
          child,
          state,
          depth + 1,
          ancestors,
          `${path}[${index}]`,
        );
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain JSON objects.`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${path} contains a symbol key.`);
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [
          key,
          normalizeJson(child, state, depth + 1, ancestors, `${path}.${key}`),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function canonicalBody(body: BackupSnapshotBody): string {
  return JSON.stringify({
    version: body.version,
    kind: body.kind,
    seq: body.seq,
    owner: body.owner,
    chainId: body.chainId,
    helperAddress: body.helperAddress,
    mailboxFingerprint: body.mailboxFingerprint,
    createdAt: body.createdAt,
    payload: normalizeJson(body.payload),
  });
}

function deriveMacKey(
  mailboxSeed: Uint8Array,
  context: BackupSnapshotContext,
  kind: BackupKind,
  seq: number,
): Uint8Array {
  if (mailboxSeed.length !== 32) {
    throw new Error("Unlock the mailbox with its 32-byte recovery seed first.");
  }
  return hkdf(
    sha256,
    mailboxSeed,
    textEncoder.encode(`${BACKUP_SNAPSHOT_DOMAIN}/salt`),
    textEncoder.encode(
      `${BACKUP_SNAPSHOT_DOMAIN}:${context.owner}:${context.chainId}:${context.helperAddress}:${context.mailboxFingerprint}:${kind}:${seq}`,
    ),
    32,
  );
}

function authenticateBody(
  body: BackupSnapshotBody,
  mailboxSeed: Uint8Array,
  context: BackupSnapshotContext,
): { digest: string; mac: string } {
  const digestBytes = sha256(textEncoder.encode(canonicalBody(body)));
  const key = deriveMacKey(mailboxSeed, context, body.kind, body.seq);
  try {
    return {
      digest: bytesToHex(digestBytes),
      mac: bytesToHex(hmac(sha256, key, digestBytes)),
    };
  } finally {
    key.fill(0);
  }
}

export function decodeBackupSnapshot(
  value: unknown,
  options: { now?: number } = {},
): BackupSnapshotV1 {
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("The backup verification time is invalid.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The backup payload is invalid.");
  }
  const expected = [
    "chainId",
    "createdAt",
    "digest",
    "helperAddress",
    "kind",
    "mac",
    "mailboxFingerprint",
    "owner",
    "payload",
    "seq",
    "version",
  ].sort();
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== expected.join(",")) {
    throw new Error("The backup schema is unsupported.");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== BACKUP_SNAPSHOT_VERSION) {
    throw new Error("This backup version is unsupported.");
  }
  if (
    typeof record.owner !== "string" ||
    typeof record.chainId !== "string" ||
    typeof record.helperAddress !== "string" ||
    typeof record.mailboxFingerprint !== "string" ||
    typeof record.digest !== "string" ||
    !DIGEST_HEX.test(record.digest) ||
    typeof record.mac !== "string" ||
    !DIGEST_HEX.test(record.mac)
  ) {
    throw new Error("The backup payload is invalid.");
  }
  const context = normalizeBackupSnapshotContext({
    owner: record.owner,
    chainId: record.chainId,
    helperAddress: record.helperAddress,
    mailboxFingerprint: record.mailboxFingerprint,
  });
  return {
    version: BACKUP_SNAPSHOT_VERSION,
    kind: requireKind(record.kind),
    seq: requireSequence(record.seq),
    ...context,
    createdAt: requireCreatedAt(record.createdAt, now),
    payload: normalizeJson(record.payload),
    digest: record.digest.toLowerCase(),
    mac: record.mac.toLowerCase(),
  };
}

export function createBackupSnapshot(
  input: CreateBackupSnapshotInput,
): BackupSnapshotV1 {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("The backup creation time is invalid.");
  }
  const context = normalizeBackupSnapshotContext(input);
  const body: BackupSnapshotBody = {
    version: BACKUP_SNAPSHOT_VERSION,
    kind: requireKind(input.kind),
    seq: requireSequence(input.seq),
    ...context,
    createdAt: now,
    payload: normalizeJson(input.payload),
  };
  return {
    ...body,
    ...authenticateBody(body, input.mailboxSeed, context),
  };
}

export function verifyBackupSnapshot(
  value: unknown,
  input: VerifyBackupSnapshotInput,
): BackupSnapshotV1 {
  const now = input.now ?? Date.now();
  const expectedContext = normalizeBackupSnapshotContext(input);
  const parsed = decodeBackupSnapshot(value, { now });
  if (
    parsed.owner !== expectedContext.owner ||
    parsed.chainId !== expectedContext.chainId ||
    parsed.helperAddress !== expectedContext.helperAddress ||
    parsed.mailboxFingerprint !== expectedContext.mailboxFingerprint ||
    (input.kind !== undefined && parsed.kind !== input.kind) ||
    (input.seq !== undefined && parsed.seq !== input.seq)
  ) {
    throw new Error(
      "This backup belongs to a different wallet, network, helper, mailbox key, kind, or sequence.",
    );
  }
  const body: BackupSnapshotBody = {
    version: parsed.version,
    kind: parsed.kind,
    seq: parsed.seq,
    owner: parsed.owner,
    chainId: parsed.chainId,
    helperAddress: parsed.helperAddress,
    mailboxFingerprint: parsed.mailboxFingerprint,
    createdAt: parsed.createdAt,
    payload: parsed.payload,
  };
  const authenticated = authenticateBody(
    body,
    input.mailboxSeed,
    expectedContext,
  );
  if (
    !equalBytes(
      hexToBytes(parsed.digest, "Backup digest"),
      hexToBytes(authenticated.digest, "Backup digest"),
    ) ||
    !equalBytes(
      hexToBytes(parsed.mac, "Backup MAC"),
      hexToBytes(authenticated.mac, "Backup MAC"),
    )
  ) {
    throw new Error("The backup authentication failed.");
  }
  return parsed;
}

export function nextBackupSequence(
  storage: Pick<Storage, "getItem" | "setItem">,
  context: BackupSnapshotContext & { kind: BackupKind },
  now = Date.now(),
): number {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("The backup sequence time is invalid.");
  }
  const normalized = normalizeBackupSnapshotContext(context);
  const key = [
    BACKUP_SEQUENCE_STORAGE_PREFIX,
    normalized.chainId,
    normalized.owner,
    normalized.helperAddress,
    normalized.mailboxFingerprint,
    requireKind(context.kind),
  ].join("/");
  const raw = storage.getItem(key);
  let prior = -1;
  if (raw !== null && /^(?:0|[1-9][0-9]*)$/.test(raw)) {
    const parsed = Number(raw);
    if (Number.isSafeInteger(parsed) && parsed <= MAX_SEQUENCE) prior = parsed;
  }
  const wallClock = Math.floor(now / 1_000);
  const next = Math.max(prior + 1, wallClock);
  if (next > MAX_SEQUENCE) {
    throw new Error("The backup sequence space is exhausted.");
  }
  storage.setItem(key, String(next));
  return next;
}
