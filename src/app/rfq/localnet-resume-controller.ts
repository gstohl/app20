import { reservationReleaseReconciliationRoute } from "./localnet-release-recovery";
import {
  rfqHasFundingEvidence,
  type RfqLifecycleAttemptPhase,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

export type LocalnetResumeAction =
  | "accept-and-fund"
  | "take"
  | "verify-take"
  | "verify-funding"
  | "verify-deal"
  | "request-maker-fill"
  | "retry-maker-fill"
  | "observe-expiry"
  | "reconcile-fill"
  | "claim"
  | "refund"
  | "reconcile-outcome"
  | "verify-reservation-release"
  | "retry-reservation-release"
  | "release-request-reservations"
  | "decline-and-release"
  | "request-fresh-quotes"
  | "none";

export type LocalnetResumeDecision = Readonly<{
  action: LocalnetResumeAction;
  label: string;
  reason: string;
  disabled: boolean;
}>;

function unknownAttempt(
  record: RfqLifecycleRecord,
): RfqLifecycleAttemptPhase | undefined {
  const phases: readonly RfqLifecycleAttemptPhase[] = [
    "funding",
    "fill",
    "claim",
    "refund",
    "reservation-release",
    "take",
  ];
  return phases.find((phase) => {
    const state = record.attempts[phase]?.state;
    return (
      state === "preparing" ||
      state === "wallet-boundary-unknown" ||
      state === "submitted-unknown"
    );
  });
}

function decision(
  action: LocalnetResumeAction,
  label: string,
  reason: string,
  disabled = false,
): LocalnetResumeDecision {
  return Object.freeze({ action, label, reason, disabled });
}

/** Pure localnet policy. It never submits and never turns an unknown attempt into a retry. */
export function localnetResumeDecision(
  record: RfqLifecycleRecord,
  now: number,
): LocalnetResumeDecision {
  if (record.recoveryReadFailure) {
    return decision(
      "verify-deal",
      "Retry deal verification",
      `The latest exact deal read failed: ${record.recoveryReadFailure.detail} This retry only reads and reconciles; it never submits a value-moving operation.`,
    );
  }
  if (
    record.state === "quarantined" &&
    record.requestDigest &&
    record.terms &&
    !record.settlement
  ) {
    return decision(
      "release-request-reservations",
      "Release quarantined request reservations",
      "The exact request identity is retained; verify its idempotent request-wide release before starting another RFQ.",
    );
  }
  if (record.evidenceAuthority.status !== "local-non-authoritative") {
    return decision(
      "none",
      "Authority reconciliation required",
      "Settlement authority is stale, disputed, reorg-invalidated, or quarantined. The record remains read-only until a live same-session verifier reconciles it.",
      true,
    );
  }
  if (record.state === "quarantined" || record.state === "reorged") {
    return decision(
      "none",
      "Action unavailable",
      "This record lacks a safe exact recovery target and remains read-only.",
      true,
    );
  }
  const unknown = unknownAttempt(record);
  if (record.mode === "v3") {
    if (unknown === "take") {
      const takeState = record.attempts.take?.state;
      return decision(
        "verify-take",
        takeState === "preparing"
          ? "Check pre-submission Take lease"
          : takeState === "wallet-boundary-unknown"
            ? "Verify hashless wallet-boundary Take"
            : "Verify submitted Take",
        takeState === "preparing"
          ? "A Take lease may exist without wallet-boundary evidence. Verify the exact lease and escrow record; nothing is resubmitted."
          : "The wallet boundary was entered or Take was submitted. Read the exact escrow Take record and never retry this attempt.",
      );
    }
    if (record.state === "submission-unknown") {
      return decision(
        "verify-take",
        "Verify submitted Take",
        "Take outcome is unknown; verification reads the exact escrow record and never resubmits it.",
      );
    }
    if (record.state === "reviewing") {
      if (record.restoredFromBackup || !record.takerSecret) {
        return decision(
          "none",
          "Verify-only restored RFQ",
          "The restored record intentionally carries no taker secret and cannot submit a Take.",
          true,
        );
      }
      return decision(
        "take",
        record.attempts.take?.state === "reverted" ? "Retry Take" : "Take",
        record.attempts.take?.state === "reverted"
          ? "The prior exact transaction was proven reverted; a new deliberate Take attempt may be created."
          : "Submit the reviewed exact fills atomically from the open maker locks.",
      );
    }
    if (record.state === "settled") {
      return decision(
        "none",
        "Complete",
        "The exact Take is settled; no further value action is available.",
        true,
      );
    }
    return decision(
      "none",
      "No safe v3 action",
      "This RFQ v3 phase has no resumable value-moving command.",
      true,
    );
  }
  if (unknown === "funding") {
    const fundingState = record.attempts.funding?.state;
    return decision(
      "verify-funding",
      fundingState === "preparing"
        ? "Check pre-submission funding lease"
        : fundingState === "wallet-boundary-unknown"
          ? "Verify hashless wallet-boundary funding"
          : "Verify transaction funding",
      fundingState === "preparing"
        ? "A funding lease exists without wallet-boundary evidence. Check the exact deal and coordinator; nothing is resubmitted."
        : fundingState === "wallet-boundary-unknown"
          ? "The wallet boundary was entered but no hash is available. This attempt is verification-only and can never be retried."
          : "Funding may have been submitted. Verification checks the exact transaction outcome and never resubmits it.",
    );
  }
  if (unknown === "fill")
    return record.attempts.fill?.state === "preparing" &&
      record.attempts.fill.target?.operation === "maker-fill"
      ? decision(
          "retry-maker-fill",
          "Retry exact maker-fill request",
          "User-triggered retry reuses the persisted immutable attempt and the maker endpoint's idempotent authorization. It is never automatic.",
        )
      : decision(
          "reconcile-fill",
          "Verify maker fill",
          "The maker fill returned a transaction hash; verify it and do not submit another fill request.",
        );
  if (unknown === "claim" || unknown === "refund")
    return decision(
      "reconcile-outcome",
      "Verify submitted outcome",
      `The ${unknown} outcome is unknown; do not resubmit it.`,
    );
  if (unknown === "reservation-release") {
    try {
      const route = reservationReleaseReconciliationRoute(record);
      return route === "request-reservations"
        ? decision(
            "verify-reservation-release",
            "Verify request reservation release",
            "The coordinator will reuse the persisted request digest and release attempt; no wallet attempt or settlement-expiry command is submitted.",
          )
        : decision(
            "verify-reservation-release",
            "Verify funded settlement expiry",
            "Only this funded record uses the idempotent settlement-expiry command; no new attempt is allocated.",
          );
    } catch (error: unknown) {
      return decision(
        "none",
        "Release verification unavailable",
        error instanceof Error
          ? error.message
          : "The persisted release route is unsafe.",
        true,
      );
    }
  }

  if (record.state === "requesting")
    return decision(
      "release-request-reservations",
      "Check and release request reservations",
      "The quote response was lost. The idempotent coordinator will release every known reservation before another RFQ is started.",
    );
  if (record.state === "quoted" || record.state === "reviewing")
    return decision(
      "decline-and-release",
      "Decline and release reservations",
      "Reloaded pre-funding terms cannot be funded; explicitly release their known coordinator reservations.",
    );
  if (record.state === "cancel-pending")
    return record.requestDigest
      ? decision(
          "retry-reservation-release",
          "Release request reservations",
          "A new persisted release attempt will use the request digest with the idempotent coordinator; no wallet command is submitted.",
        )
      : decision(
          "none",
          "Release unavailable",
          "The persisted request digest is unavailable, so reservations cannot be identified safely.",
          true,
        );
  if (record.state === "expired" && !rfqHasFundingEvidence(record)) {
    return decision(
      "release-request-reservations",
      "Verify expired request release",
      "Quote expiry is not reservation-expiry authority; release the exact request before requesting fresh quotes.",
    );
  }
  if (record.state === "refused") {
    return decision(
      "request-fresh-quotes",
      "Request fresh quotes",
      "The maker cohort explicitly refused the request.",
    );
  }
  if (record.state === "submission-unknown")
    return decision(
      "verify-funding",
      "Verify submitted funding",
      "Funding outcome is unknown; it must not be resubmitted.",
    );
  if (record.state === "funded") {
    const deadline = record.settlement?.deadline ?? 0;
    return now < deadline
      ? decision(
          "request-maker-fill",
          "Request maker fill",
          "Funding is confirmed and the settlement deadline is still open.",
        )
      : decision(
          "observe-expiry",
          "Observe settlement expiry",
          "Refund remains disabled until the local harness confirms expiry.",
        );
  }
  if (record.state === "filled")
    return decision(
      "reconcile-fill",
      "Reconcile observed fill",
      "Confirm exact fill bindings before claim.",
    );
  if (record.state === "claimable")
    return decision("claim", "Claim", "An exact maker fill was observed.");
  if (record.state === "expired" && rfqHasFundingEvidence(record))
    return decision(
      "observe-expiry",
      "Observe settlement expiry",
      "A funded deal needs explicit local expiry observation.",
    );
  if (record.state === "refundable")
    return decision(
      "refund",
      "Refund",
      "Local expiry was observed and no fill was found.",
    );
  if (["settled", "refunded", "cancelled"].includes(record.state))
    return decision(
      "none",
      "Complete",
      "No further value action is available.",
      true,
    );
  return decision(
    "none",
    "No safe action",
    "This phase has no resumable localnet command.",
    true,
  );
}

/**
 * Revalidates an action against the latest in-memory row at the command
 * boundary. This closes stale-tab and direct-callback paths that bypass the
 * disabled button rendered from an older record.
 */
export function authorizeLocalnetResumeCommand(
  presented: RfqLifecycleRecord,
  current: RfqLifecycleRecord | undefined,
  requestedAction: LocalnetResumeAction,
  now: number,
): RfqLifecycleRecord {
  if (!current) throw new Error("The RFQ record is no longer loaded.");
  const samePresentedRevision =
    presented.chainId === current.chainId &&
    presented.account === current.account &&
    presented.rfqId === current.rfqId &&
    presented.storageRevision === current.storageRevision &&
    presented.updatedAt === current.updatedAt &&
    presented.state === current.state &&
    presented.evidenceAuthority.status === current.evidenceAuthority.status &&
    presented.evidenceAuthority.revision === current.evidenceAuthority.revision;
  if (!samePresentedRevision) {
    throw new Error(
      "The RFQ record changed after it was displayed. Review the latest authority state before acting.",
    );
  }
  const allowed = localnetResumeDecision(current, now);
  if (
    requestedAction === "none" ||
    allowed.disabled ||
    allowed.action !== requestedAction
  ) {
    throw new Error(
      allowed.disabled
        ? allowed.reason
        : "The requested RFQ action is not authorized by the latest lifecycle state.",
    );
  }
  return current;
}
