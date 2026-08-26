import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  ADDRESS_BOOK_MAX_ENTRIES,
  ADDRESS_BOOK_MAX_LABEL_LENGTH,
  normalizeStarknetAddress,
  type AddressBookEntry,
} from "./address-book.js";

export const CONTACT_SNAPSHOT_VERSION = 1 as const;
export const CONTACT_SNAPSHOT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const SNAPSHOT_ID_BYTES = 32;
const MAILBOX_KEY_HEX = /^[0-9a-f]{64}$/i;
const DIGEST_HEX = /^[0-9a-f]{64}$/i;
const textEncoder = new TextEncoder();
const KEY_DOMAIN = "app20/address-book-backup/v1";

export type ContactSnapshotV1 = {
  version: 1;
  snapshotId: string;
  owner: string;
  chainId: string;
  helperAddress: string;
  mailboxFingerprint: string;
  createdAt: number;
  entries: AddressBookEntry[];
  digest: string;
  mac: string;
};

type SnapshotContext = {
  owner: string;
  chainId: string;
  helperAddress: string;
  mailboxFingerprint: string;
};

type CreateSnapshotInput = SnapshotContext & {
  mailboxSeed: Uint8Array;
  entries: readonly AddressBookEntry[];
  now?: number;
};

type VerifySnapshotInput = SnapshotContext & {
  mailboxSeed: Uint8Array;
  now?: number;
};

type SnapshotBody = Omit<ContactSnapshotV1, "digest" | "mac">;

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

function normalizeChainId(value: string): string {
  const unprefixed = value.trim().startsWith("starknet:")
    ? value.trim().slice("starknet:".length)
    : value.trim();
  let named = unprefixed;
  if (unprefixed === "SN_MAIN") {
    named = "0x534e5f4d41494e";
  } else if (unprefixed === "SN_SEPOLIA") {
    named = "0x534e5f5345504f4c4941";
  }
  try {
    const parsed = BigInt(named);
    if (parsed <= 0n) throw new Error();
    return `0x${parsed.toString(16)}`;
  } catch {
    throw new Error("The contact backup chain is invalid.");
  }
}

function normalizeFingerprint(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!MAILBOX_KEY_HEX.test(normalized)) {
    throw new Error("The contact backup mailbox fingerprint is invalid.");
  }
  return normalized;
}

function normalizeContext(input: SnapshotContext): SnapshotContext {
  return {
    owner: normalizeStarknetAddress(input.owner),
    chainId: normalizeChainId(input.chainId),
    helperAddress: normalizeStarknetAddress(input.helperAddress),
    mailboxFingerprint: normalizeFingerprint(input.mailboxFingerprint),
  };
}

function normalizeEntries(value: unknown, now: number): AddressBookEntry[] {
  if (!Array.isArray(value) || value.length > ADDRESS_BOOK_MAX_ENTRIES) {
    throw new Error("The contact backup has too many entries.");
  }
  const labels = new Set<string>();
  const entries = value.map((item) => {
    if (item === null || typeof item !== "object") {
      throw new Error("The contact backup contains an invalid entry.");
    }
    const keys = Object.keys(item).sort();
    if (keys.join(",") !== "address,label,updatedAt") {
      throw new Error("The contact backup entry schema is unsupported.");
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.label !== "string" ||
      typeof record.address !== "string" ||
      typeof record.updatedAt !== "number"
    ) {
      throw new Error("The contact backup contains an invalid entry.");
    }
    const label = record.label.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (
      !label ||
      label.length > ADDRESS_BOOK_MAX_LABEL_LENGTH ||
      /^0x/i.test(label)
    ) {
      throw new Error("The contact backup contains an invalid label.");
    }
    const labelKey = label.toLocaleLowerCase("en-US");
    if (labels.has(labelKey)) {
      throw new Error("The contact backup contains duplicate labels.");
    }
    labels.add(labelKey);
    if (
      !Number.isSafeInteger(record.updatedAt) ||
      record.updatedAt < 0 ||
      record.updatedAt > now + CONTACT_SNAPSHOT_MAX_CLOCK_SKEW_MS
    ) {
      throw new Error("The contact backup contains an invalid timestamp.");
    }
    return {
      label,
      address: normalizeStarknetAddress(record.address),
      updatedAt: record.updatedAt,
    };
  });
  return entries.sort((left, right) => {
    const leftFolded = left.label.toLowerCase();
    const rightFolded = right.label.toLowerCase();
    if (leftFolded < rightFolded) return -1;
    if (leftFolded > rightFolded) return 1;
    if (left.label < right.label) return -1;
    if (left.label > right.label) return 1;
    return 0;
  });
}

function canonicalBody(body: SnapshotBody): string {
  return JSON.stringify({
    version: body.version,
    snapshotId: body.snapshotId,
    owner: body.owner,
    chainId: body.chainId,
    helperAddress: body.helperAddress,
    mailboxFingerprint: body.mailboxFingerprint,
    createdAt: body.createdAt,
    entries: body.entries.map((entry) => ({
      label: entry.label,
      address: entry.address,
      updatedAt: entry.updatedAt,
    })),
  });
}

function deriveMacKey(
  mailboxSeed: Uint8Array,
  context: SnapshotContext,
): Uint8Array {
  if (mailboxSeed.length !== 32) {
    throw new Error("Unlock the mailbox with its 32-byte recovery seed first.");
  }
  return hkdf(
    sha256,
    mailboxSeed,
    textEncoder.encode(`${KEY_DOMAIN}/salt`),
    textEncoder.encode(
      `${KEY_DOMAIN}:${context.owner}:${context.chainId}:${context.helperAddress}:${context.mailboxFingerprint}`,
    ),
    32,
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

function authenticateBody(
  body: SnapshotBody,
  mailboxSeed: Uint8Array,
  context: SnapshotContext,
): { digest: string; mac: string } {
  const digestBytes = sha256(textEncoder.encode(canonicalBody(body)));
  const key = deriveMacKey(mailboxSeed, context);
  try {
    return {
      digest: bytesToHex(digestBytes),
      mac: bytesToHex(hmac(sha256, key, digestBytes)),
    };
  } finally {
    key.fill(0);
  }
}

function parseSnapshot(
  value: unknown,
  now: number,
): SnapshotBody & {
  digest: string;
  mac: string;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The contact backup payload is invalid.");
  }
  const keys = Object.keys(value).sort();
  const expected = [
    "chainId",
    "createdAt",
    "digest",
    "entries",
    "helperAddress",
    "mac",
    "mailboxFingerprint",
    "owner",
    "snapshotId",
    "version",
  ].sort();
  if (keys.join(",") !== expected.join(",")) {
    throw new Error("The contact backup schema is unsupported.");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== CONTACT_SNAPSHOT_VERSION) {
    throw new Error("This contact backup version is unsupported.");
  }
  if (
    typeof record.snapshotId !== "string" ||
    !DIGEST_HEX.test(record.snapshotId) ||
    typeof record.owner !== "string" ||
    typeof record.chainId !== "string" ||
    typeof record.helperAddress !== "string" ||
    typeof record.mailboxFingerprint !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.digest !== "string" ||
    !DIGEST_HEX.test(record.digest) ||
    typeof record.mac !== "string" ||
    !DIGEST_HEX.test(record.mac)
  ) {
    throw new Error("The contact backup payload is invalid.");
  }
  if (
    !Number.isSafeInteger(record.createdAt) ||
    record.createdAt < 0 ||
    record.createdAt > now + CONTACT_SNAPSHOT_MAX_CLOCK_SKEW_MS
  ) {
    throw new Error("The contact backup creation time is invalid.");
  }
  const context = normalizeContext({
    owner: record.owner,
    chainId: record.chainId,
    helperAddress: record.helperAddress,
    mailboxFingerprint: record.mailboxFingerprint,
  });
  return {
    version: 1,
    snapshotId: record.snapshotId.toLowerCase(),
    ...context,
    createdAt: record.createdAt,
    entries: normalizeEntries(record.entries, now),
    digest: record.digest.toLowerCase(),
    mac: record.mac.toLowerCase(),
  };
}

export function createContactSnapshot(
  input: CreateSnapshotInput,
): ContactSnapshotV1 {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("The contact backup creation time is invalid.");
  }
  const context = normalizeContext(input);
  const body: SnapshotBody = {
    version: CONTACT_SNAPSHOT_VERSION,
    snapshotId: bytesToHex(
      globalThis.crypto.getRandomValues(new Uint8Array(SNAPSHOT_ID_BYTES)),
    ),
    ...context,
    createdAt: now,
    entries: normalizeEntries(input.entries, now),
  };
  return { ...body, ...authenticateBody(body, input.mailboxSeed, context) };
}

export function verifyContactSnapshot(
  value: unknown,
  input: VerifySnapshotInput,
): ContactSnapshotV1 {
  const now = input.now ?? Date.now();
  const expectedContext = normalizeContext(input);
  const parsed = parseSnapshot(value, now);
  if (
    parsed.owner !== expectedContext.owner ||
    parsed.chainId !== expectedContext.chainId ||
    parsed.helperAddress !== expectedContext.helperAddress ||
    parsed.mailboxFingerprint !== expectedContext.mailboxFingerprint
  ) {
    throw new Error(
      "This contact backup belongs to a different wallet, network, helper, or mailbox key.",
    );
  }
  const body: SnapshotBody = {
    version: parsed.version,
    snapshotId: parsed.snapshotId,
    owner: parsed.owner,
    chainId: parsed.chainId,
    helperAddress: parsed.helperAddress,
    mailboxFingerprint: parsed.mailboxFingerprint,
    createdAt: parsed.createdAt,
    entries: parsed.entries,
  };
  const authenticated = authenticateBody(
    body,
    input.mailboxSeed,
    expectedContext,
  );
  if (
    !equalBytes(
      hexToBytes(parsed.digest, "Contact backup digest"),
      hexToBytes(authenticated.digest, "Contact backup digest"),
    ) ||
    !equalBytes(
      hexToBytes(parsed.mac, "Contact backup MAC"),
      hexToBytes(authenticated.mac, "Contact backup MAC"),
    )
  ) {
    throw new Error("The contact backup authentication failed.");
  }
  return parsed;
}
