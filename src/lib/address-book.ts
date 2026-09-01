import { validateAndParseAddress } from "starknet";

export const ADDRESS_BOOK_STORAGE_PREFIX = "app20/address-book/v1";
export const ADDRESS_BOOK_CHANGED_EVENT = "app20:address-book-changed";
export const ADDRESS_BOOK_MAX_ENTRIES = 200;
export const ADDRESS_BOOK_MAX_LABEL_LENGTH = 40;
const ADDRESS_BOOK_MAX_TOMBSTONES = ADDRESS_BOOK_MAX_ENTRIES;
const ADDRESS_BOOK_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AES_TAG_BITS = 128;
const HEX_KEY = /^[0-9a-f]{64}$/i;

export type AddressBookEntry = {
  label: string;
  address: string;
  updatedAt: number;
};

/** Device-local deletion evidence. Never included in on-chain snapshots. */
type AddressBookTombstone = {
  label: string;
  deletedAt: number;
};

type AddressBookState = {
  entries: AddressBookEntry[];
  tombstones: AddressBookTombstone[];
};

export type ResolvedAddressInput = {
  address: string;
  entry?: AddressBookEntry;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type AddressBookPayload = {
  version: 1;
  nonce: string;
  ciphertext: string;
};

export function normalizeStarknetAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a Starknet address.");
  try {
    return validateAndParseAddress(trimmed);
  } catch {
    throw new Error("Enter a valid Starknet address.");
  }
}

function requireScope(selfAddress: string): string {
  if (!selfAddress.trim()) {
    throw new Error("Connect a wallet before using the address book.");
  }
  return normalizeStarknetAddress(selfAddress);
}

export function addressBookStorageKey(selfAddress: string): string {
  return `${ADDRESS_BOOK_STORAGE_PREFIX}/${requireScope(selfAddress)}`;
}

function bookKeyStorageKey(selfAddress: string): string {
  return `${ADDRESS_BOOK_STORAGE_PREFIX}/key/${requireScope(selfAddress)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string, label: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label} is not valid hex.`);
  }
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function corruptBookError(): Error {
  return new Error(
    "The encrypted address book on this device could not be opened. It was left untouched.",
  );
}

async function importBookKey(
  storage: StorageLike,
  selfAddress: string,
  create: boolean,
): Promise<CryptoKey | null> {
  const keyKey = bookKeyStorageKey(selfAddress);
  const stored = storage.getItem(keyKey);
  let raw: Uint8Array;
  if (stored === null) {
    if (!create) return null;
    raw = globalThis.crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    storage.setItem(keyKey, bytesToHex(raw));
    if (storage.getItem(keyKey) !== bytesToHex(raw)) {
      throw new Error("The address-book key could not be persisted.");
    }
  } else {
    if (!HEX_KEY.test(stored)) throw corruptBookError();
    raw = hexToBytes(stored, "address-book key");
  }
  return globalThis.crypto.subtle.importKey(
    "raw",
    toBuffer(raw),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

function parsePayload(raw: string): AddressBookPayload {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw corruptBookError();
  }
  if (
    value === null ||
    typeof value !== "object" ||
    (value as { version?: unknown }).version !== 1 ||
    typeof (value as { nonce?: unknown }).nonce !== "string" ||
    typeof (value as { ciphertext?: unknown }).ciphertext !== "string"
  ) {
    throw corruptBookError();
  }
  return value as AddressBookPayload;
}

function sanitizeEntries(value: unknown): AddressBookEntry[] {
  if (!Array.isArray(value) || value.length > ADDRESS_BOOK_MAX_ENTRIES) {
    throw corruptBookError();
  }
  const entries: AddressBookEntry[] = [];
  const labels = new Set<string>();
  for (const item of value) {
    if (item === null || typeof item !== "object") throw corruptBookError();
    const record = item as Record<string, unknown>;
    if (
      typeof record.label !== "string" ||
      typeof record.address !== "string" ||
      typeof record.updatedAt !== "number" ||
      !Number.isSafeInteger(record.updatedAt) ||
      record.updatedAt < 0 ||
      record.updatedAt > Date.now() + ADDRESS_BOOK_CLOCK_SKEW_MS
    ) {
      throw corruptBookError();
    }
    const label = validateLabel(record.label);
    const labelKey = label.toLocaleLowerCase("en-US");
    if (labels.has(labelKey)) throw corruptBookError();
    labels.add(labelKey);
    entries.push({
      label,
      address: normalizeStarknetAddress(record.address),
      updatedAt: record.updatedAt,
    });
  }
  return sortEntries(entries);
}

function sortEntries(entries: AddressBookEntry[]): AddressBookEntry[] {
  return [...entries].sort((left, right) => {
    const leftFolded = left.label.toLowerCase();
    const rightFolded = right.label.toLowerCase();
    if (leftFolded < rightFolded) return -1;
    if (leftFolded > rightFolded) return 1;
    if (left.label < right.label) return -1;
    if (left.label > right.label) return 1;
    return 0;
  });
}

function labelKey(label: string): string {
  return label.toLocaleLowerCase("en-US");
}

function sanitizeTombstones(value: unknown): AddressBookTombstone[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ADDRESS_BOOK_MAX_TOMBSTONES) {
    throw corruptBookError();
  }
  const tombstones: AddressBookTombstone[] = [];
  const labels = new Set<string>();
  for (const item of value) {
    if (item === null || typeof item !== "object") throw corruptBookError();
    const keys = Object.keys(item).sort();
    if (keys.join(",") !== "deletedAt,label") throw corruptBookError();
    const record = item as Record<string, unknown>;
    if (
      typeof record.label !== "string" ||
      typeof record.deletedAt !== "number" ||
      !Number.isSafeInteger(record.deletedAt) ||
      record.deletedAt < 0 ||
      record.deletedAt > Date.now() + ADDRESS_BOOK_CLOCK_SKEW_MS
    ) {
      throw corruptBookError();
    }
    const label = validateLabel(record.label);
    const key = labelKey(label);
    if (labels.has(key)) throw corruptBookError();
    labels.add(key);
    tombstones.push({ label, deletedAt: record.deletedAt });
  }
  return tombstones;
}

function reconcileBookState(state: AddressBookState): AddressBookState {
  const tombstoneByLabel = new Map<string, AddressBookTombstone>();
  for (const tombstone of state.tombstones) {
    const key = labelKey(tombstone.label);
    const current = tombstoneByLabel.get(key);
    if (!current || tombstone.deletedAt > current.deletedAt) {
      tombstoneByLabel.set(key, tombstone);
    }
  }

  const entries: AddressBookEntry[] = [];
  const entryKeys = new Set<string>();
  for (const entry of sortEntries(state.entries)) {
    const key = labelKey(entry.label);
    if (entryKeys.has(key)) continue;
    const tombstone = tombstoneByLabel.get(key);
    if (tombstone && entry.updatedAt <= tombstone.deletedAt) continue;
    entryKeys.add(key);
    tombstoneByLabel.delete(key);
    entries.push(entry);
  }

  const tombstones = [...tombstoneByLabel.values()].sort((left, right) => {
    if (left.deletedAt !== right.deletedAt) {
      return right.deletedAt - left.deletedAt;
    }
    const leftFolded = labelKey(left.label);
    const rightFolded = labelKey(right.label);
    if (leftFolded < rightFolded) return -1;
    if (leftFolded > rightFolded) return 1;
    return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
  });
  if (tombstones.length > ADDRESS_BOOK_MAX_TOMBSTONES) {
    tombstones.length = ADDRESS_BOOK_MAX_TOMBSTONES;
  }
  return { entries, tombstones };
}

function parseBookPlaintext(value: unknown): AddressBookState {
  if (Array.isArray(value)) {
    return reconcileBookState({
      entries: sanitizeEntries(value),
      tombstones: [],
    });
  }
  if (value === null || typeof value !== "object") throw corruptBookError();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "entries" && keys.join(",") !== "entries,tombstones") {
    throw corruptBookError();
  }
  return reconcileBookState({
    entries: sanitizeEntries(record.entries),
    tombstones: sanitizeTombstones(record.tombstones),
  });
}

async function loadAddressBookState(
  storage: StorageLike,
  selfAddress: string,
): Promise<AddressBookState> {
  const bookKey = addressBookStorageKey(selfAddress);
  const raw = storage.getItem(bookKey);
  if (raw === null) return { entries: [], tombstones: [] };
  const payload = parsePayload(raw);
  const key = await importBookKey(storage, selfAddress, false);
  if (key === null) throw corruptBookError();
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toBuffer(hexToBytes(payload.nonce, "address-book nonce")),
          additionalData: toBuffer(new TextEncoder().encode(bookKey)),
          tagLength: AES_TAG_BITS,
        },
        key,
        toBuffer(hexToBytes(payload.ciphertext, "address-book ciphertext")),
      ),
    );
  } catch {
    throw corruptBookError();
  }
  try {
    return parseBookPlaintext(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw corruptBookError();
  }
}

export async function loadAddressBook(
  storage: StorageLike,
  selfAddress: string,
): Promise<AddressBookEntry[]> {
  return (await loadAddressBookState(storage, selfAddress)).entries;
}

async function persistAddressBook(
  storage: StorageLike,
  selfAddress: string,
  state: AddressBookState,
): Promise<AddressBookState> {
  const next = reconcileBookState({
    entries: sortEntries(state.entries),
    tombstones: state.tombstones,
  });
  const bookKey = addressBookStorageKey(selfAddress);
  const key = await importBookKey(storage, selfAddress, true);
  if (key === null) throw corruptBookError();
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  // Legacy inner JSON stays a bare entry array until a deletion tombstone exists.
  const inner =
    next.tombstones.length === 0
      ? next.entries
      : { entries: next.entries, tombstones: next.tombstones };
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toBuffer(nonce),
        additionalData: toBuffer(new TextEncoder().encode(bookKey)),
        tagLength: AES_TAG_BITS,
      },
      key,
      toBuffer(new TextEncoder().encode(JSON.stringify(inner))),
    ),
  );
  const payload: AddressBookPayload = {
    version: 1,
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  };
  const encoded = JSON.stringify(payload);
  storage.setItem(bookKey, encoded);
  if (storage.getItem(bookKey) !== encoded) {
    throw new Error("The address book could not be persisted on this device.");
  }
  return next;
}

function validateLabel(label: string): string {
  const trimmed = label.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("Enter an address-book label.");
  if (trimmed.length > ADDRESS_BOOK_MAX_LABEL_LENGTH) {
    throw new Error(
      `Labels stay under ${ADDRESS_BOOK_MAX_LABEL_LENGTH + 1} characters.`,
    );
  }
  if (/^0x/i.test(trimmed)) {
    throw new Error("Labels must not look like 0x addresses.");
  }
  return trimmed;
}

export async function saveAddressBookEntry(
  storage: StorageLike,
  selfAddress: string,
  entry: { label: string; address: string },
): Promise<AddressBookEntry[]> {
  const label = validateLabel(entry.label);
  const address = normalizeStarknetAddress(entry.address);
  const existing = await loadAddressBookState(storage, selfAddress);
  const kept = existing.entries.filter(
    (item) => item.label.toLowerCase() !== label.toLowerCase(),
  );
  if (kept.length >= ADDRESS_BOOK_MAX_ENTRIES) {
    throw new Error("The address book is full. Remove an entry first.");
  }
  const next = await persistAddressBook(storage, selfAddress, {
    entries: [...kept, { label, address, updatedAt: Date.now() }],
    tombstones: existing.tombstones.filter(
      (item) => labelKey(item.label) !== labelKey(label),
    ),
  });
  return next.entries;
}

export async function removeAddressBookEntry(
  storage: StorageLike,
  selfAddress: string,
  label: string,
): Promise<AddressBookEntry[]> {
  const existing = await loadAddressBookState(storage, selfAddress);
  const needle = label.trim().toLowerCase();
  const kept: AddressBookEntry[] = [];
  const removed: AddressBookEntry[] = [];
  for (const item of existing.entries) {
    if (item.label.toLowerCase() === needle) removed.push(item);
    else kept.push(item);
  }
  const deletedAt = Date.now();
  const tombstones = existing.tombstones.filter(
    (item) => item.label.toLowerCase() !== needle,
  );
  for (const entry of removed) {
    tombstones.push({ label: entry.label, deletedAt });
  }
  const next = await persistAddressBook(storage, selfAddress, {
    entries: kept,
    tombstones,
  });
  return next.entries;
}

/** Replaces the complete local book only after every imported entry validates. */
export async function replaceAddressBookEntries(
  storage: StorageLike,
  selfAddress: string,
  entries: readonly AddressBookEntry[],
): Promise<AddressBookEntry[]> {
  const incoming = sanitizeEntries(entries);
  const existing = await loadAddressBookState(storage, selfAddress);
  const incomingKeys = new Set(incoming.map((entry) => labelKey(entry.label)));
  const next = await persistAddressBook(storage, selfAddress, {
    entries: incoming,
    tombstones: existing.tombstones.filter(
      (item) => !incomingKeys.has(labelKey(item.label)),
    ),
  });
  return next.entries;
}

/**
 * Additively restores a snapshot. A newer local label wins over an older
 * snapshot entry; a newer authenticated snapshot entry may update that label.
 * Device-local deletion tombstones suppress replay of an older authenticated
 * snapshot for that label; a snapshot entry newer than the tombstone may restore it.
 */
export async function mergeAddressBookEntries(
  storage: StorageLike,
  selfAddress: string,
  entries: readonly AddressBookEntry[],
): Promise<AddressBookEntry[]> {
  const incoming = sanitizeEntries(entries);
  const existing = await loadAddressBookState(storage, selfAddress);
  const byLabel = new Map(
    existing.entries.map((entry) => [labelKey(entry.label), entry]),
  );
  const tombstones = new Map(
    existing.tombstones.map((item) => [labelKey(item.label), item]),
  );
  for (const entry of incoming) {
    const key = labelKey(entry.label);
    const tombstone = tombstones.get(key);
    if (tombstone && entry.updatedAt <= tombstone.deletedAt) {
      continue;
    }
    const current = byLabel.get(key);
    if (!current || entry.updatedAt > current.updatedAt) {
      byLabel.set(key, entry);
      tombstones.delete(key);
    }
  }
  if (byLabel.size > ADDRESS_BOOK_MAX_ENTRIES) {
    throw new Error("The address book is full. Remove an entry first.");
  }
  const next = await persistAddressBook(storage, selfAddress, {
    entries: [...byLabel.values()],
    tombstones: [...tombstones.values()],
  });
  return next.entries;
}

export function resolveAddressBookInput(
  entries: readonly AddressBookEntry[],
  input: string,
): ResolvedAddressInput | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^0x/i.test(trimmed)) {
    let address: string;
    try {
      address = normalizeStarknetAddress(trimmed);
    } catch {
      return null;
    }
    const entry = entries.find((item) => item.address === address);
    return entry ? { address, entry } : { address };
  }
  const entry = entries.find(
    (item) => item.label.toLowerCase() === trimmed.toLowerCase(),
  );
  return entry ? { address: entry.address, entry } : null;
}
