import { scryptAsync } from "@noble/hashes/scrypt.js";
import { MAIL_SEED_STORAGE_PREFIX } from "./local-mailbox-storage";

const SEED_BYTES = 32;
const WRAP_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const HEX_SEED = /^[0-9a-f]{64}$/i;
const AES_TAG_BITS = 128;

export const MAIL_VAULT_KDF = "scrypt" as const;
export const MAIL_VAULT_SCRYPT = {
  N: 2 ** 15,
  r: 8,
  p: 1,
} as const;

export type MailVaultKind = "missing" | "plaintext" | "passphrase";

export type MailVaultRecord =
  | { version: 1; kind: "plaintext"; seed: string }
  | {
      version: 1;
      kind: "passphrase";
      kdf: typeof MAIL_VAULT_KDF;
      N: number;
      r: number;
      p: number;
      salt: string;
      nonce: string;
      ciphertext: string;
    };

export type InspectedMailVault =
  | { kind: "missing" }
  | { kind: "plaintext"; seed: Uint8Array; record: MailVaultRecord }
  | { kind: "passphrase"; record: Extract<MailVaultRecord, { kind: "passphrase" }> };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function mailVaultKey(chainId: string, address: string): string {
  return `${MAIL_SEED_STORAGE_PREFIX}/${chainId}/${address}`;
}

export function seedToHex(seed: Uint8Array): string {
  if (seed.length !== SEED_BYTES) {
    throw new Error("Mail seed must be exactly 32 bytes.");
  }
  return Array.from(seed, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function seedFromHex(value: string): Uint8Array | null {
  if (!HEX_SEED.test(value)) return null;
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string, expected: number, label: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length !== expected * 2) {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseMailVaultRecord(raw: string | null): MailVaultRecord | null {
  if (!raw) return null;
  if (HEX_SEED.test(raw)) {
    return { version: 1, kind: "plaintext", seed: raw.toLowerCase() };
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || value.version !== 1) return null;
    if (value.kind === "plaintext" && typeof value.seed === "string") {
      const seed = seedFromHex(value.seed);
      return seed ? { version: 1, kind: "plaintext", seed: seedToHex(seed) } : null;
    }
    if (
      value.kind === "passphrase" &&
      value.kdf === MAIL_VAULT_KDF &&
      Number.isSafeInteger(value.N) &&
      Number.isSafeInteger(value.r) &&
      Number.isSafeInteger(value.p) &&
      typeof value.salt === "string" &&
      typeof value.nonce === "string" &&
      typeof value.ciphertext === "string"
    ) {
      return {
        version: 1,
        kind: "passphrase",
        kdf: MAIL_VAULT_KDF,
        N: Number(value.N),
        r: Number(value.r),
        p: Number(value.p),
        salt: value.salt,
        nonce: value.nonce,
        ciphertext: value.ciphertext,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function inspectMailVault(
  storage: Pick<Storage, "getItem">,
  chainId: string,
  address: string,
): InspectedMailVault {
  const record = parseMailVaultRecord(storage.getItem(mailVaultKey(chainId, address)));
  if (!record) return { kind: "missing" };
  if (record.kind === "plaintext") {
    const seed = seedFromHex(record.seed);
    if (!seed) return { kind: "missing" };
    return { kind: "plaintext", seed, record };
  }
  return { kind: "passphrase", record };
}

export function persistPlaintextSeed(
  storage: StorageLike,
  chainId: string,
  address: string,
  seed: Uint8Array,
): void {
  const record: MailVaultRecord = {
    version: 1,
    kind: "plaintext",
    seed: seedToHex(seed),
  };
  const encoded = JSON.stringify(record);
  storage.setItem(mailVaultKey(chainId, address), encoded);
  if (storage.getItem(mailVaultKey(chainId, address)) !== encoded) {
    throw new Error("Quietline could not persist the device mail key.");
  }
}

async function deriveWrapKey(
  passphrase: string,
  salt: Uint8Array,
  params: { N: number; r: number; p: number },
): Promise<Uint8Array> {
  if (passphrase.length < 8) {
    throw new Error("Passphrase must be at least 8 characters.");
  }
  return scryptAsync(passphrase, salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: WRAP_KEY_BYTES,
  });
}

export async function wrapMailSeed(
  seed: Uint8Array,
  passphrase: string,
  params: { N: number; r: number; p: number } = MAIL_VAULT_SCRYPT,
): Promise<Extract<MailVaultRecord, { kind: "passphrase" }>> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const wrapKey = await deriveWrapKey(passphrase, salt, params);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toBuffer(wrapKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  wrapKey.fill(0);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toBuffer(nonce), tagLength: AES_TAG_BITS },
      cryptoKey,
      toBuffer(seed),
    ),
  );
  return {
    version: 1,
    kind: "passphrase",
    kdf: MAIL_VAULT_KDF,
    N: params.N,
    r: params.r,
    p: params.p,
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  };
}

export async function unwrapMailSeed(
  record: Extract<MailVaultRecord, { kind: "passphrase" }>,
  passphrase: string,
): Promise<Uint8Array> {
  const salt = hexToBytes(record.salt, SALT_BYTES, "vault salt");
  const nonce = hexToBytes(record.nonce, NONCE_BYTES, "vault nonce");
  const ciphertext = Uint8Array.from(
    record.ciphertext.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ??
      [],
  );
  if (ciphertext.length < SEED_BYTES + 16) {
    throw new Error("Wrapped mailbox vault is truncated.");
  }
  const wrapKey = await deriveWrapKey(passphrase, salt, {
    N: record.N,
    r: record.r,
    p: record.p,
  });
  try {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "raw",
      toBuffer(wrapKey),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const seed = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toBuffer(nonce), tagLength: AES_TAG_BITS },
        cryptoKey,
        toBuffer(ciphertext),
      ),
    );
    if (seed.length !== SEED_BYTES) {
      throw new Error("Unwrapped mailbox seed has the wrong length.");
    }
    return seed;
  } catch {
    throw new Error("That passphrase does not open this mailbox vault.");
  } finally {
    wrapKey.fill(0);
  }
}

export function persistVaultRecord(
  storage: StorageLike,
  chainId: string,
  address: string,
  record: MailVaultRecord,
): void {
  const encoded =
    record.kind === "plaintext" ? record.seed : JSON.stringify(record);
  storage.setItem(mailVaultKey(chainId, address), encoded);
  if (storage.getItem(mailVaultKey(chainId, address)) !== encoded) {
    throw new Error("Quietline could not persist the mailbox vault.");
  }
}

export async function persistWrappedSeed(
  storage: StorageLike,
  chainId: string,
  address: string,
  seed: Uint8Array,
  passphrase: string,
  params: { N: number; r: number; p: number } = MAIL_VAULT_SCRYPT,
): Promise<void> {
  persistVaultRecord(
    storage,
    chainId,
    address,
    await wrapMailSeed(seed, passphrase, params),
  );
}
