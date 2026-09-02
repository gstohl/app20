import { createIndexedDbRfqStorage } from "../rfq-storage";
import { exportAndPostRfqHistoryIfEnabled } from "@/lib/rfq-history-backup";

export const RFQ_AUTO_BACKUP_PENDING_KEY =
  "app20/rfq-history-auto-backup/pending/v1";
export const RFQ_AUTO_BACKUP_REQUESTED_EVENT =
  "app20:rfq-history-auto-backup-requested";

export type PendingRfqAutoBackup = Readonly<{
  version: 1;
  chainId: string;
  account: string;
  requestedAt: number;
}>;

/**
 * Calls the opt-in hook after settlement. Mail owns signing and posting, so the
 * validated export callback leaves a same-origin, account-scoped request for
 * Inbox to consume when its mailbox signer is mounted and unlocked.
 */
export function requestRfqHistoryAutoBackup(input: {
  chainId: string;
  account: string;
}): Promise<Readonly<{ posted: boolean; count: number }>> {
  return exportAndPostRfqHistoryIfEnabled({
    preferenceStorage: window.localStorage,
    storage: createIndexedDbRfqStorage(),
    chainId: input.chainId,
    account: input.account,
    post: async () => {
      const pending: PendingRfqAutoBackup = Object.freeze({
        version: 1,
        chainId: input.chainId,
        account: input.account,
        requestedAt: Date.now(),
      });
      window.localStorage.setItem(
        RFQ_AUTO_BACKUP_PENDING_KEY,
        JSON.stringify(pending),
      );
      window.dispatchEvent(
        new CustomEvent(RFQ_AUTO_BACKUP_REQUESTED_EVENT, {
          detail: pending,
        }),
      );
    },
  });
}

export function consumePendingRfqHistoryAutoBackup(
  storage: Pick<Storage, "getItem" | "removeItem">,
  scope: Readonly<{ chainId: string; account: string }>,
): PendingRfqAutoBackup | null {
  const raw = storage.getItem(RFQ_AUTO_BACKUP_PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as Partial<PendingRfqAutoBackup>;
    if (
      candidate.version !== 1 ||
      candidate.chainId !== scope.chainId ||
      candidate.account?.toLowerCase() !== scope.account.toLowerCase() ||
      typeof candidate.requestedAt !== "number" ||
      !Number.isSafeInteger(candidate.requestedAt) ||
      candidate.requestedAt <= 0
    ) {
      return null;
    }
    storage.removeItem(RFQ_AUTO_BACKUP_PENDING_KEY);
    return Object.freeze({
      version: 1,
      chainId: candidate.chainId,
      account: candidate.account,
      requestedAt: candidate.requestedAt,
    });
  } catch {
    return null;
  }
}
