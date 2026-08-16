import { ALIAS_STORAGE_PREFIX } from "./aliases";
import { DRAFT_STORAGE_PREFIX } from "./drafts";
import { ESCROW_STORAGE_PREFIX } from "./escrow";
import { MAIL_SCAN_CURSOR_PREFIX } from "./mail-scan";
import { OTC_STORAGE_PREFIX } from "./otc";
import { MAIL_ASSIGNMENT_STORAGE_PREFIX } from "./mail-assignments";
import { SENT_MAIL_STORAGE_PREFIX } from "./sent-mail";

export const MAIL_SEED_STORAGE_PREFIX = "quietline/mailseed/v1";

export const LOCAL_MAILBOX_STORAGE_PREFIXES = [
  MAIL_SEED_STORAGE_PREFIX,
  DRAFT_STORAGE_PREFIX,
  SENT_MAIL_STORAGE_PREFIX,
  ALIAS_STORAGE_PREFIX,
  OTC_STORAGE_PREFIX,
  ESCROW_STORAGE_PREFIX,
  MAIL_SCAN_CURSOR_PREFIX,
  MAIL_ASSIGNMENT_STORAGE_PREFIX,
] as const;

type MutableStorage = Pick<Storage, "key" | "length" | "removeItem">;

/**
 * Remove all sensitive Quietline mailbox records from this browser profile.
 * Theme and the compile-gated localnet identity are preferences, not mailbox
 * content, and deliberately remain untouched.
 */
export function clearLocalMailboxStorage(storage: MutableStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      key &&
      LOCAL_MAILBOX_STORAGE_PREFIXES.some(
        (prefix) => key === prefix || key.startsWith(`${prefix}/`),
      )
    ) {
      keys.push(key);
    }
  }
  for (const key of keys) storage.removeItem(key);
  return keys;
}
