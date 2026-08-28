import {
  beginRfqPhaseAttempt,
  canonicalLocalRfqId,
  canonicalRfqAccount,
  canonicalRfqChainId,
  observeLocalSettlementExpiry,
  rfqHasFundingEvidence,
  transitionRfqLifecycle,
  updateRfqPhaseAttempt,
  type RfqLifecycleRecord,
  type RfqReleaseAttemptTarget,
} from "./rfq-lifecycle";
import type { LocalnetIntentTerms } from "./localnet-private-intents";

export type ReservationReleaseReconciliationRoute =
  | "request-reservations"
  | "funded-settlement-expiry";

type ReleaseRecoveryDependencies = Readonly<{
  releaseRequestReservations: (
    target: Extract<
      RfqReleaseAttemptTarget,
      { operation: "request-reservations" }
    >,
  ) => Promise<void>;
  expireFundedSettlement: (terms: LocalnetIntentTerms) => Promise<number>;
  persist: (record: RfqLifecycleRecord) => Promise<unknown>;
  authorize: (record: RfqLifecycleRecord) => Promise<RfqLifecycleRecord>;
  beforeSubmit: (record: RfqLifecycleRecord) => void;
  now: () => number;
}>;

const UNKNOWN_ATTEMPT_STATES = new Set([
  "preparing",
  "wallet-boundary-unknown",
  "submitted-unknown",
]);
const VALUE_MOVING_PHASES = ["funding", "fill", "claim", "refund"] as const;

function sameIdentity(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}

function assertNoUnknownValueMovingAttempt(record: RfqLifecycleRecord): void {
  const phase = VALUE_MOVING_PHASES.find((candidate) =>
    UNKNOWN_ATTEMPT_STATES.has(record.attempts[candidate]?.state ?? ""),
  );
  if (phase) {
    throw new Error(
      `The unknown ${phase} wallet attempt must be verified without submitting another command.`,
    );
  }
}

function requestTarget(
  record: RfqLifecycleRecord,
  releaseLeaseId: string,
): Extract<RfqReleaseAttemptTarget, { operation: "request-reservations" }> {
  if (!record.requestDigest) {
    throw new Error(
      "Persisted request digest is unavailable; reservations cannot be identified safely.",
    );
  }
  return Object.freeze({
    operation: "request-reservations",
    chainId: canonicalRfqChainId(record.chainId),
    account: canonicalRfqAccount(record.account),
    rfqId: canonicalLocalRfqId(record.rfqId),
    requestDigest: record.requestDigest,
    releaseLeaseId,
  });
}

function fundedTarget(
  record: RfqLifecycleRecord,
): Extract<RfqReleaseAttemptTarget, { operation: "funded-settlement-expiry" }> {
  if (
    record.state !== "funded" ||
    !record.requestDigest ||
    !record.terms ||
    !record.selectedQuote?.reservationFence ||
    !record.selectedQuote.quoteDigest ||
    !record.settlement ||
    record.selectedQuote.intentDigest !== record.requestDigest ||
    !sameIdentity(record.settlement.dealId, record.rfqId)
  ) {
    throw new Error(
      "Only an exact request-linked funded settlement record can use settlement-expiry reconciliation.",
    );
  }
  return Object.freeze({
    operation: "funded-settlement-expiry",
    chainId: canonicalRfqChainId(record.chainId),
    account: canonicalRfqAccount(record.account),
    rfqId: canonicalLocalRfqId(record.rfqId),
    requestDigest: record.requestDigest,
    dealId: canonicalLocalRfqId(record.settlement.dealId),
    escrowAddress: record.settlement.escrowAddress,
    solverId: record.selectedQuote.solverId,
    reservationId: record.selectedQuote.reservationId,
    reservationFence: record.selectedQuote.reservationFence,
    quoteDigest: record.selectedQuote.quoteDigest,
  });
}

function targetsEqual(
  left: RfqReleaseAttemptTarget,
  right: RfqReleaseAttemptTarget,
): boolean {
  if (left.operation !== right.operation) return false;
  if (
    canonicalRfqChainId(left.chainId) !== canonicalRfqChainId(right.chainId) ||
    canonicalRfqAccount(left.account) !== canonicalRfqAccount(right.account) ||
    canonicalLocalRfqId(left.rfqId) !== canonicalLocalRfqId(right.rfqId) ||
    left.requestDigest !== right.requestDigest
  )
    return false;
  if (
    left.operation === "request-reservations" ||
    right.operation === "request-reservations"
  )
    return (
      left.operation === "request-reservations" &&
      right.operation === "request-reservations" &&
      left.releaseLeaseId === right.releaseLeaseId
    );
  return (
    sameIdentity(left.dealId, right.dealId) &&
    sameIdentity(left.escrowAddress, right.escrowAddress) &&
    left.solverId === right.solverId &&
    left.reservationId === right.reservationId &&
    left.reservationFence === right.reservationFence &&
    left.quoteDigest === right.quoteDigest
  );
}

export function assertReservationReleaseTarget(
  record: RfqLifecycleRecord,
): RfqReleaseAttemptTarget {
  const target = record.attempts["reservation-release"]?.target;
  if (
    !target ||
    target.operation === "maker-fill" ||
    target.operation === "funding-ticket"
  )
    throw new Error(
      "The persisted release attempt has no immutable release target.",
    );
  const expected =
    target.operation === "request-reservations"
      ? requestTarget(record, target.releaseLeaseId)
      : fundedTarget(record);
  if (!targetsEqual(target, expected)) {
    throw new Error(
      "The persisted release attempt target does not match this account, chain, RFQ, request, quote, reservation, fence, or deal.",
    );
  }
  if (
    (target.operation === "request-reservations" &&
      ![
        "requesting",
        "quoted",
        "reviewing",
        "cancel-pending",
        "cancelled",
      ].includes(record.state)) ||
    (target.operation === "funded-settlement-expiry" &&
      !["funded", "refundable", "refunded"].includes(record.state))
  ) {
    throw new Error(
      "The persisted lifecycle state contradicts its release operation.",
    );
  }
  return target;
}

function fundedTerms(
  record: RfqLifecycleRecord,
  target = fundedTarget(record),
): LocalnetIntentTerms {
  if (
    !record.terms ||
    !record.selectedQuote ||
    !record.settlement?.ticketAddress
  )
    throw new Error("Exact terms and settlement ticket are unavailable.");
  return {
    account: target.account,
    chainId: target.chainId,
    rfqId: target.rfqId,
    dealId: target.dealId,
    intentDigest: target.requestDigest,
    solverId: target.solverId,
    reservationId: target.reservationId,
    reservationFence: target.reservationFence,
    quoteDigest: target.quoteDigest,
    sellToken: record.terms.sellAddress,
    sellAmount: BigInt(record.terms.sellAmount),
    buyToken: record.terms.buyAddress,
    buyAmount: BigInt(record.selectedQuote.buyAmount),
    deadline: record.settlement.deadline,
    ticketAddress: record.settlement.ticketAddress,
  };
}

export function reservationReleaseReconciliationRoute(
  record: RfqLifecycleRecord,
): ReservationReleaseReconciliationRoute {
  assertNoUnknownValueMovingAttempt(record);
  return assertReservationReleaseTarget(record).operation;
}

export function preparePreFundingReservationRelease(
  record: RfqLifecycleRecord,
  attemptId: string,
  now: number,
): RfqLifecycleRecord {
  assertNoUnknownValueMovingAttempt(record);
  if (
    !record.requestDigest ||
    rfqHasFundingEvidence(record) ||
    (record.attempts.funding !== undefined &&
      !(
        record.attempts.funding.state === "reverted" &&
        record.attempts.funding.walletBoundary === "not-entered"
      )) ||
    ![
      "requesting",
      "quoted",
      "reviewing",
      "expired",
      "quarantined",
      "cancel-pending",
    ].includes(record.state)
  ) {
    throw new Error(
      "Only a request-backed pre-funding record with no wallet attempt or a proven no-wallet revert can begin reservation release.",
    );
  }
  const pending =
    record.state === "cancel-pending"
      ? record
      : transitionRfqLifecycle(record, "cancel-pending", now);
  return beginRfqPhaseAttempt(
    pending,
    "reservation-release",
    attemptId,
    now,
    requestTarget(pending, attemptId),
  );
}

export function prepareFundedSettlementExpiry(
  record: RfqLifecycleRecord,
  attemptId: string,
  now: number,
): RfqLifecycleRecord {
  assertNoUnknownValueMovingAttempt(record);
  const target = fundedTarget(record);
  return beginRfqPhaseAttempt(
    record,
    "reservation-release",
    attemptId,
    now,
    target,
  );
}

/** Reconciles only an already-persisted, immutable release target. */
export async function reconcilePersistedReservationRelease(
  record: RfqLifecycleRecord,
  dependencies: ReleaseRecoveryDependencies,
): Promise<RfqLifecycleRecord> {
  const attempt = record.attempts["reservation-release"];
  if (!attempt || !UNKNOWN_ATTEMPT_STATES.has(attempt.state)) {
    throw new Error(
      "No unresolved persisted reservation-release attempt is available to reconcile.",
    );
  }
  assertNoUnknownValueMovingAttempt(record);
  assertReservationReleaseTarget(record);
  const authorized = await dependencies.authorize(record);
  const target = assertReservationReleaseTarget(authorized);
  dependencies.beforeSubmit(authorized);
  if (target.operation === "request-reservations") {
    await dependencies.releaseRequestReservations(target);
    const confirmedAt = dependencies.now();
    let confirmed = updateRfqPhaseAttempt(
      authorized,
      "reservation-release",
      "confirmed",
      confirmedAt,
      {
        observation:
          "The idempotent coordinator verified release for the immutable request target.",
      },
    );
    if (confirmed.state !== "cancel-pending") {
      confirmed = transitionRfqLifecycle(
        confirmed,
        "cancel-pending",
        confirmedAt,
      );
    }
    const cancelled = transitionRfqLifecycle(
      confirmed,
      "cancelled",
      confirmedAt,
    );
    await dependencies.persist(cancelled);
    return cancelled;
  }

  const expiredAt = await dependencies.expireFundedSettlement(
    fundedTerms(authorized, target),
  );
  const confirmed = updateRfqPhaseAttempt(
    authorized,
    "reservation-release",
    "confirmed",
    expiredAt,
    {
      observation:
        "The idempotent local harness verified the immutable funded expiry target.",
    },
  );
  const refundable = observeLocalSettlementExpiry(confirmed, expiredAt);
  await dependencies.persist(refundable);
  return refundable;
}
