import { validateAndParseAddress } from "starknet";

export const ADDRESS_BOOK_STORAGE_PREFIX = "app20/address-book/v1";
export const ADDRESS_BOOK_CHANGED_EVENT = "app20:address-book-changed";
export const ADDRESS_BOOK_MAX_ENTRIES = 200;
export const ADDRESS_BOOK_MAX_LABEL_LENGTH = 40;

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AES_TAG_BITS = 128;
const HEX_KEY = /^[0-9a-f]{64}$/i;

export type AddressBookEntry = {
  label: string;
  address: string;
  updatedAt: number;
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
  if (!Array.isArray(value)) throw corruptBookError();
  const entries: AddressBookEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") throw corruptBookError();
    const record = item as Record<string, unknown>;
    if (
      typeof record.label !== "string" ||
      typeof record.address !== "string" ||
      typeof record.updatedAt !== "number"
    ) {
      throw corruptBookError();
    }
    entries.push({
      label: record.label,
      address: normalizeStarknetAddress(record.address),
      updatedAt: record.updatedAt,
    });
  }
  return sortEntries(entries);
}

function sortEntries(entries: AddressBookEntry[]): AddressBookEntry[] {
  return [...entries].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

export async function loadAddressBook(
  storage: StorageLike,
  selfAddress: string,
): Promise<AddressBookEntry[]> {
  const bookKey = addressBookStorageKey(selfAddress);
  const raw = storage.getItem(bookKey);
  if (raw === null) return [];
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
  return sanitizeEntries(JSON.parse(new TextDecoder().decode(plaintext)));
}

async function encryptBook(
  storage: StorageLike,
  selfAddress: string,
  entries: AddressBookEntry[],
): Promise<void> {
  const bookKey = addressBookStorageKey(selfAddress);
  const key = await importBookKey(storage, selfAddress, true);
  if (key === null) throw corruptBookError();
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toBuffer(nonce),
        additionalData: toBuffer(new TextEncoder().encode(bookKey)),
        tagLength: AES_TAG_BITS,
      },
      key,
      toBuffer(new TextEncoder().encode(JSON.stringify(sortEntries(entries)))),
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
}

function validateLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, " ");
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
  const existing = await loadAddressBook(storage, selfAddress);
  const kept = existing.filter(
    (item) => item.label.toLowerCase() !== label.toLowerCase(),
  );
  if (kept.length >= ADDRESS_BOOK_MAX_ENTRIES) {
    throw new Error("The address book is full. Remove an entry first.");
  }
  const next = sortEntries([
    ...kept,
    { label, address, updatedAt: Date.now() },
  ]);
  await encryptBook(storage, selfAddress, next);
  return next;
}

export async function removeAddressBookEntry(
  storage: StorageLike,
  selfAddress: string,
  label: string,
): Promise<AddressBookEntry[]> {
  const existing = await loadAddressBook(storage, selfAddress);
  const next = existing.filter(
    (item) => item.label.toLowerCase() !== label.trim().toLowerCase(),
  );
  await encryptBook(storage, selfAddress, next);
  return next;
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
