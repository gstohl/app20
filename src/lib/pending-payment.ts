import type { PaymentRequestPayload } from "./otc";
import {
  decodePaymentLinkFragment,
  encodePaymentLinkFragment,
} from "./payment-link";

export const PENDING_PAYMENT_STORAGE_KEY =
  "quietline/pending-payment/v1";

export type PendingPaymentStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

/** Replace the tab's one pending request after applying payment-link validation. */
export function storePendingPayment(
  storage: PendingPaymentStorage,
  request: PaymentRequestPayload,
): PaymentRequestPayload {
  const encoded = encodePaymentLinkFragment(request);
  const normalized = decodePaymentLinkFragment(encoded);
  storage.setItem(PENDING_PAYMENT_STORAGE_KEY, encoded);
  return normalized;
}

/** Read without consuming. Corrupt or stale-format values are discarded. */
export function loadPendingPayment(
  storage: PendingPaymentStorage,
): PaymentRequestPayload | null {
  const encoded = storage.getItem(PENDING_PAYMENT_STORAGE_KEY);
  if (encoded === null) return null;

  try {
    return decodePaymentLinkFragment(encoded);
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
): PaymentRequestPayload | null {
  const encoded = storage.getItem(PENDING_PAYMENT_STORAGE_KEY);
  if (encoded === null) return null;
  storage.removeItem(PENDING_PAYMENT_STORAGE_KEY);

  try {
    return decodePaymentLinkFragment(encoded);
  } catch {
    return null;
  }
}
