import { reservationReleaseReconciliationRoute } from "./localnet-release-recovery";
import {
  rfqHasFundingEvidence,
  type RfqAttemptPhase,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

export type LocalnetResumeAction =
  | "accept-and-fund"
  | "verify-funding"
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
): RfqAttemptPhase | undefined {
  const phases: readonly RfqAttemptPhase[] = [
    "funding",
    "fill",
    "claim",
    "refund",
    "reservation-release",
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
  if (record.state === "quarantined" || record.state === "reorged") {
    return decision(
      "none",
      "Action unavailable",
      "This record lacks a safe exact recovery target and remains read-only.",
      true,
    );
  }
  const unknown = unknownAttempt(record);
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
