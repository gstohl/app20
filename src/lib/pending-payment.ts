import { decodePaymentLink, type DecodedPaymentLink } from "./payment-link";

export const PENDING_PAYMENT_STORAGE_KEY = "app20/pending-payment/v1";

export type PendingPaymentStorage = Pick<
 Storage,
 "getItem" | "setItem" | "removeItem"
>;

/**
 * Replace the tab's one pending request after validating its complete link.
 * Keeping the original fragment preserves a verified signature for the inbox;
 * re-encoding only the request would silently downgrade it to unsigned.
 */
export function storePendingPayment(
 storage: PendingPaymentStorage,
 fragment: string,
): DecodedPaymentLink {
 const decoded = decodePaymentLink(fragment);
 storage.setItem(PENDING_PAYMENT_STORAGE_KEY, fragment);
 return decoded;
}

/** Read without consuming. Corrupt or stale-format values are discarded. */
export function loadPendingPayment(
 storage: PendingPaymentStorage,
): DecodedPaymentLink | null {
 const encoded = storage.getItem(PENDING_PAYMENT_STORAGE_KEY);
 if (encoded === null) return null;

 try {
  return decodePaymentLink(encoded);
 } catch {
  storage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
  return null;
 }
}

/** Remove any pending request from this tab. */
export function clearPendingPayment(storage: PendingPaymentStorage): void {
 storage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
}

/**
 * Take the pending request exactly once. It is removed before decoding so a
 * malformed value or a throwing consumer cannot accidentally replay it.
 */
export function consumePendingPayment(
 storage: PendingPaymentStorage,
): DecodedPaymentLink | null {
 const encoded = storage.getItem(PENDING_PAYMENT_STORAGE_KEY);
 if (encoded === null) return null;
 storage.removeItem(PENDING_PAYMENT_STORAGE_KEY);

 try {
  return decodePaymentLink(encoded);
 } catch {
  return null;
 }
}
