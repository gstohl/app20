import {
    transactionHashFromError,
    transactionStateFromError,
} from "@/lib/strk20";
import {
    updateRfqPhaseAttempt,
    type RfqLifecycleRecord,
} from "../rfq-lifecycle";

/** Pure Desk catch seam for claim/refund: it never invents a hash or retries. */
export function applyLocalnetPayoutFailureEvidence(
    record: RfqLifecycleRecord,
    phase: "claim" | "refund",
    error: unknown,
    now: number,
): RfqLifecycleRecord {
    const attempt = record.attempts[phase];
    const transactionHash = transactionHashFromError(error);
    const state = transactionStateFromError(error);
    if (state === "unknown" && attempt?.state === "preparing") {
        return updateRfqPhaseAttempt(
            record,
            phase,
            transactionHash ? "submitted-unknown" : "wallet-boundary-unknown",
            now,
            {
                ...(transactionHash ? { transactionHash } : {}),
                walletBoundary: "entered",
                observation: transactionHash
                    ? "The wallet boundary returned a hash whose outcome remains unknown."
                    : "The wallet submission boundary was entered but no transaction hash became available. Verification only; nothing may be retried.",
            },
        );
    }
    if (state === "reverted" && attempt) {
        return updateRfqPhaseAttempt(record, phase, "reverted", now, {
            ...(transactionHash ? { transactionHash } : {}),
            observation: `Wallet or chain reported a reverted ${phase} attempt.`,
        });
    }
    return record;
}
