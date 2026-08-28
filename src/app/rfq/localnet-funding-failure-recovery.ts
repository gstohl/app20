import {
  transactionHashFromError,
  transactionStateFromError,
} from "@/lib/strk20";
import {
  LocalnetFundingKnownNotSubmittedError,
  LocalnetFundingPrewalletRecoveryPendingError,
} from "./localnet-funding-orchestration";
import {
  transitionRfqLifecycle,
  updateRfqPhaseAttempt,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

export type LocalnetFundingFailureEvidence = Readonly<{
  record: RfqLifecycleRecord;
  releaseRequired: boolean;
  verificationOnly: boolean;
}>;

/** Pure Desk catch seam: it never performs a wallet call or invents a hash. */
export function applyLocalnetFundingFailureEvidence(
  record: RfqLifecycleRecord,
  error: unknown,
  now: number,
): LocalnetFundingFailureEvidence {
  const attempt = record.attempts.funding;
  if (error instanceof LocalnetFundingKnownNotSubmittedError) {
    const next =
      attempt?.state === "preparing"
        ? updateRfqPhaseAttempt(record, "funding", "reverted", now, {
            walletBoundary: "not-entered",
            observation:
              "Exact server abandonment confirmed that the wallet boundary was not entered.",
          })
        : record;
    return Object.freeze({
      record: next,
      releaseRequired: true,
      verificationOnly: false,
    });
  }

  if (error instanceof LocalnetFundingPrewalletRecoveryPendingError) {
    return Object.freeze({
      record,
      releaseRequired: false,
      verificationOnly: true,
    });
  }

  const transactionHash = transactionHashFromError(error);
  const state = transactionStateFromError(error);
  if (state === "unknown" && attempt?.state === "preparing") {
    let next = updateRfqPhaseAttempt(
      record,
      "funding",
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
    if (next.state !== "submission-unknown")
      next = transitionRfqLifecycle(next, "submission-unknown", now);
    return Object.freeze({
      record: next,
      releaseRequired: false,
      verificationOnly: true,
    });
  }

  if (state === "reverted" && transactionHash && attempt) {
    let next = updateRfqPhaseAttempt(
      record,
      "funding",
      "submitted-unknown",
      now,
      {
        transactionHash,
        walletBoundary: "entered",
        observation:
          "A post-wallet revert remains funding-unknown; receipt status alone cannot reopen this attempt.",
      },
    );
    if (next.state !== "submission-unknown")
      next = transitionRfqLifecycle(next, "submission-unknown", now);
    return Object.freeze({
      record: next,
      releaseRequired: false,
      verificationOnly: true,
    });
  }

  return Object.freeze({
    record,
    releaseRequired: false,
    verificationOnly: Boolean(attempt),
  });
}
