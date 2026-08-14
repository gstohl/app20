import {
  canonicalizeStarknetAddress,
  feltEquals,
} from "./addresses";
import { sanitizeUntrustedText } from "./text";

export const ALIAS_STORAGE_PREFIX = "quietline/aliases/v1";

export type AliasRecord = {
  address: string;
  label: string;
  addedAt: number;
};

export type AliasStorage = Pick<Storage, "getItem" | "setItem">;

function cleanLabel(label: string): string {
  if (label.length > 256) {
    throw new Error("Alias label cannot exceed 64 characters.");
  }
  const cleaned = sanitizeUntrustedText(label).trim().replace(/\s+/g, " ");
  if (!cleaned) throw new Error("Alias label cannot be empty.");
  if (cleaned.length > 64) throw new Error("Alias label cannot exceed 64 characters.");
  return cleaned;
}

export function aliasStorageKey(selfAddress: string): string {
  return `${ALIAS_STORAGE_PREFIX}/${selfAddress}`;
}

export function loadAliases(
  storage: AliasStorage,
  selfAddress: string,
): AliasRecord[] {
  const serialized = storage.getItem(aliasStorageKey(selfAddress));
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    const aliases: AliasRecord[] = [];
    for (const record of value) {
      if (
        record === null ||
        typeof record !== "object" ||
        typeof record.address !== "string" ||
        typeof record.label !== "string" ||
        typeof record.addedAt !== "number" ||
        !Number.isSafeInteger(record.addedAt) ||
        record.addedAt < 0
      ) {
        continue;
      }
      try {
        aliases.push({
          address: canonicalizeStarknetAddress(record.address),
          label: cleanLabel(record.label),
          addedAt: record.addedAt,
        });
      } catch {
        // Ignore malformed local records instead of breaking compose.
      }
    }
    return aliases;
  } catch {
    return [];
  }
}

export function findAliasByAddress(
  aliases: readonly AliasRecord[],
  address: string,
): AliasRecord | undefined {
  return aliases.find((record) => feltEquals(record.address, address));
}

function findAliasByLabel(
  aliases: readonly AliasRecord[],
  label: string,
): AliasRecord | undefined {
  const normalized = sanitizeUntrustedText(label)
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
  return aliases.find(
    (record) => record.label.toLocaleLowerCase() === normalized,
  );
}

/** Resolves a local label when present; otherwise returns the raw input. */
export function resolveAliasInput(
  aliases: readonly AliasRecord[],
  input: string,
): string {
  return findAliasByLabel(aliases, input)?.address ?? input.trim();
}

export function saveAlias(
  storage: AliasStorage,
  selfAddress: string,
  address: string,
  label: string,
  addedAt = Math.floor(Date.now() / 1_000),
): AliasRecord[] {
  const canonical = canonicalizeStarknetAddress(address);
  const cleaned = cleanLabel(label);
  const aliases = loadAliases(storage, selfAddress);
  const duplicateLabel = aliases.find(
    (record) =>
      record.label.toLocaleLowerCase() === cleaned.toLocaleLowerCase() &&
      !feltEquals(record.address, canonical),
  );
  if (duplicateLabel) {
    throw new Error("That local alias already points to another address.");
  }

  const next = aliases.filter(
    (record) => !feltEquals(record.address, canonical),
  );
  next.push({ address: canonical, label: cleaned, addedAt });
  next.sort((left, right) => left.label.localeCompare(right.label));
  storage.setItem(aliasStorageKey(selfAddress), JSON.stringify(next));
  return next;
}

export function removeAlias(
  storage: AliasStorage,
  selfAddress: string,
  address: string,
): AliasRecord[] {
  const aliases = loadAliases(storage, selfAddress).filter(
    (record) => !feltEquals(record.address, address),
  );
  storage.setItem(aliasStorageKey(selfAddress), JSON.stringify(aliases));
  return aliases;
}
