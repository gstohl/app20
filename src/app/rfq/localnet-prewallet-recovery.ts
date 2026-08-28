import type { LocalnetIntentTerms } from "./localnet-private-intents";
import {
  preparePreFundingReservationRelease,
  reconcilePersistedReservationRelease,
} from "./localnet-release-recovery";
import {
  canonicalLocalRfqId,
  reconcileRfqLifecycleWithLocalDeal,
  updateRfqPhaseAttempt,
  type RfqLifecycleRecord,
  type RfqReleaseAttemptTarget,
} from "./rfq-lifecycle";

export function localnetIntentTermsFromLifecycle(
  record: RfqLifecycleRecord,
): LocalnetIntentTerms {
  if (
    !record.requestDigest ||
    !record.terms ||
    !record.selectedQuote?.reservationFence ||
    !record.selectedQuote.quoteDigest ||
    !record.settlement?.ticketAddress
  ) {
    throw new Error(
      "Persisted exact request, quote, funding settlement, and ticket terms are unavailable.",
    );
  }
  const rfqId = canonicalLocalRfqId(record.rfqId);
  const dealId = canonicalLocalRfqId(record.settlement.dealId);
  if (rfqId !== dealId)
    throw new Error(
      "Local deal identity must equal the canonical RFQ identity.",
    );
  return Object.freeze({
    account: record.account,
    chainId: record.chainId,
    rfqId,
    dealId,
    intentDigest: record.requestDigest,
    solverId: record.selectedQuote.solverId,
    reservationId: record.selectedQuote.reservationId,
    reservationFence: record.selectedQuote.reservationFence,
    quoteDigest: record.selectedQuote.quoteDigest,
    sellToken: record.terms.sellAddress,
    sellAmount: BigInt(record.terms.sellAmount),
    buyToken: record.terms.buyAddress,
    buyAmount: BigInt(record.selectedQuote.buyAmount),
    deadline: record.settlement.deadline,
    ticketAddress: record.settlement.ticketAddress,
  });
}

type RequestReleaseTarget = Extract<
  RfqReleaseAttemptTarget,
  { operation: "request-reservations" }
>;

export type LocalnetPrewalletRecoveryDependencies = Readonly<{
  abandonFunding: (
    terms: LocalnetIntentTerms,
    attemptId: string,
  ) => Promise<unknown>;
  releaseRequestReservations: (target: RequestReleaseTarget) => Promise<void>;
  persist: (record: RfqLifecycleRecord) => Promise<unknown>;
  authorize: (record: RfqLifecycleRecord) => Promise<RfqLifecycleRecord>;
  createAttemptId: () => string;
  now: () => number;
  beforeAbandon: (record: RfqLifecycleRecord) => void;
  beforeRelease?: (record: RfqLifecycleRecord) => void;
}>;

/**
 * Production Desk/Workspace crash-barrier recovery. It is valid only for a
 * restored preparing attempt and an exact status-0 deal observation. Server
 * tombstoning is completed before browser not-entered evidence and request-wide
 * release are persisted.
 */
export async function recoverLocalnetPreparingFundingAfterEmptyObservation(
  record: RfqLifecycleRecord,
  observed: unknown,
  dependencies: LocalnetPrewalletRecoveryDependencies,
): Promise<RfqLifecycleRecord> {
  const attempt = record.attempts.funding;
  if (attempt?.state !== "preparing")
    throw new Error(
      "Only the exact restored preparing funding attempt can use pre-wallet recovery.",
    );
  const authorized = await dependencies.authorize(record);
  const stamp = dependencies.now();
  const reconciled = reconcileRfqLifecycleWithLocalDeal(
    authorized,
    observed,
    stamp,
  );
  if (
    reconciled.state === "quarantined" ||
    reconciled.latestObservation?.status !== 0
  ) {
    throw new Error(
      "Pre-wallet recovery requires an exact empty-chain status-0 observation.",
    );
  }

  const terms = localnetIntentTermsFromLifecycle(reconciled);
  let abandonmentError: unknown;
  for (let retry = 0; retry < 2; retry += 1) {
    try {
      dependencies.beforeAbandon(reconciled);
      await dependencies.abandonFunding(terms, attempt.attemptId);
      abandonmentError = undefined;
      break;
    } catch (error: unknown) {
      abandonmentError = error;
    }
  }
  if (abandonmentError) throw abandonmentError;

  const proven = updateRfqPhaseAttempt(
    reconciled,
    "funding",
    "reverted",
    dependencies.now(),
    {
      walletBoundary: "not-entered",
      observation:
        "Exact status 0 and the durable coordinator tombstone prove the wallet boundary was not entered.",
    },
  );
  await dependencies.persist(proven);
  const pending = preparePreFundingReservationRelease(
    proven,
    dependencies.createAttemptId(),
    dependencies.now(),
  );
  await dependencies.persist(pending);
  return reconcilePersistedReservationRelease(pending, {
    releaseRequestReservations: dependencies.releaseRequestReservations,
    expireFundedSettlement: async () => {
      throw new Error("Pre-wallet recovery cannot use funded expiry.");
    },
    persist: dependencies.persist,
    authorize: dependencies.authorize,
    beforeSubmit: (releaseAuthorized) =>
      dependencies.beforeRelease?.(releaseAuthorized),
    now: dependencies.now,
  });
}
