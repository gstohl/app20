export const STRK_DECIMALS = 18;
export const STRK_SCALE = 10n ** BigInt(STRK_DECIMALS);
export const DEFAULT_STRK_AMOUNT = "0.1";
export const STRK_AMOUNT_STORAGE_PREFIX = "quietline/value-amount/v1";

const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d+))?$/;

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

/** Parse a human STRK amount without ever passing through a JS number. */
export function parseStrkAmount(value: string): bigint {
  const trimmed = value.trim();
  const match = DECIMAL_AMOUNT.exec(trimmed);
  if (!match) {
    throw new Error("Enter a positive decimal STRK amount.");
  }

  const fraction = match[2] ?? "";
  if (fraction.length > STRK_DECIMALS) {
    throw new Error("STRK supports at most 18 decimal places.");
  }

  const amount =
    BigInt(match[1]) * STRK_SCALE +
    BigInt(fraction.padEnd(STRK_DECIMALS, "0") || "0");
  if (amount <= 0n) {
    throw new Error("STRK amount must be greater than zero.");
  }
  return amount;
}

/** Format base units exactly, trimming only insignificant trailing zeroes. */
export function formatStrkAmount(amount: bigint): string {
  if (amount < 0n) throw new Error("STRK base units cannot be negative.");
  const whole = amount / STRK_SCALE;
  const fraction = (amount % STRK_SCALE)
    .toString()
    .padStart(STRK_DECIMALS, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function strkAmountStorageKey(network: string): string {
  return `${STRK_AMOUNT_STORAGE_PREFIX}/${encodeURIComponent(network)}`;
}

/** Invalid or inaccessible stored values fail safely to the deliberately small default. */
export function loadStrkAmount(
  storage: StorageReader,
  network: string,
): string {
  try {
    const stored = storage.getItem(strkAmountStorageKey(network));
    if (stored !== null) {
      parseStrkAmount(stored);
      return stored.trim();
    }
  } catch {
    // A malformed value or unavailable storage must not restore a risky amount.
  }
  return DEFAULT_STRK_AMOUNT;
}

/** Persist only an amount that has already passed exact STRK validation. */
export function saveStrkAmount(
  storage: StorageWriter,
  network: string,
  value: string,
): string {
  const normalized = formatStrkAmount(parseStrkAmount(value));
  storage.setItem(strkAmountStorageKey(network), normalized);
  return normalized;
}
