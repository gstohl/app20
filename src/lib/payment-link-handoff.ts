import {
  clearPendingPayment,
  loadPendingPayment,
  type PendingPaymentStorage,
} from "./pending-payment";
import {
  recordPaymentLinkRequest,
  type PaymentRecord,
  type StorageLike,
} from "./otc";

/**
 * Import the reviewed /pay request into one connected mailbox account.
 * Reading the URL never calls this function; the /pay confirmation stores only
 * session state, and the mailbox persists it before clearing that handoff.
 */
export function importPendingPaymentIntoMailbox(
  sessionStorage: PendingPaymentStorage,
  localStorage: StorageLike,
  chainId: string,
  selfAddress: string,
  at?: number,
): PaymentRecord | null {
  const request = loadPendingPayment(sessionStorage);
  if (!request) return null;

  const record = recordPaymentLinkRequest(
    localStorage,
    chainId,
    selfAddress,
    request,
    at,
  );
  clearPendingPayment(sessionStorage);
  return record;
}
