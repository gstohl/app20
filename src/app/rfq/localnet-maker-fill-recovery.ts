import type { LocalnetIntentTerms } from "./localnet-private-intents";
import {
  canonicalLocalRfqId,
  updateRfqPhaseAttempt,
  type RfqLifecycleRecord,
  type RfqMakerFillAttemptTarget,
} from "./rfq-lifecycle";

export function makerFillAttemptTarget(
  terms: LocalnetIntentTerms,
): RfqMakerFillAttemptTarget {
  const rfqId = canonicalLocalRfqId(terms.rfqId);
  const dealId = canonicalLocalRfqId(terms.dealId);
  if (rfqId !== dealId)
    throw new Error("Local deal identity must equal the canonical RFQ identity.");
  return Object.freeze({
    operation: "maker-fill",
    chainId: terms.chainId,
    account: terms.account,
    rfqId,
    requestDigest: terms.intentDigest,
    dealId,
    solverId: terms.solverId,
    reservationId: terms.reservationId,
    reservationFence: terms.reservationFence,
    quoteDigest: terms.quoteDigest,
    sellToken: terms.sellToken,
    sellAmount: terms.sellAmount.toString(),
    buyToken: terms.buyToken,
    buyAmount: terms.buyAmount.toString(),
    deadline: terms.deadline,
    ticketAddress: terms.ticketAddress,
  });
}

export function termsFromMakerFillAttempt(
  record: RfqLifecycleRecord,
): LocalnetIntentTerms {
  const attempt = record.attempts.fill;
  const target = attempt?.target;
  if (
    !attempt ||
    attempt.state !== "preparing" ||
    target?.operation !== "maker-fill"
  ) {
    throw new Error(
      "Only a persisted preparing maker-fill attempt can be retried.",
    );
  }
  if (
    target.chainId !== record.chainId ||
    target.account !== record.account ||
    canonicalLocalRfqId(target.rfqId) !== canonicalLocalRfqId(record.rfqId) ||
    target.requestDigest !== record.requestDigest ||
    canonicalLocalRfqId(target.dealId) !==
      canonicalLocalRfqId(record.settlement?.dealId ?? "") ||
    target.solverId !== record.selectedQuote?.solverId ||
    target.reservationId !== record.selectedQuote?.reservationId ||
    target.reservationFence !== record.selectedQuote?.reservationFence ||
    target.quoteDigest !== record.selectedQuote?.quoteDigest
  ) {
    throw new Error(
      "The persisted maker-fill attempt target no longer matches its RFQ context.",
    );
  }
  return Object.freeze({
    account: target.account,
    chainId: target.chainId,
    rfqId: target.rfqId,
    dealId: target.dealId,
    intentDigest: target.requestDigest,
    solverId: target.solverId,
    reservationId: target.reservationId,
    reservationFence: target.reservationFence,
    quoteDigest: target.quoteDigest,
    sellToken: target.sellToken,
    sellAmount: BigInt(target.sellAmount),
    buyToken: target.buyToken,
    buyAmount: BigInt(target.buyAmount),
    deadline: target.deadline,
    ticketAddress: target.ticketAddress,
  });
}

/** User-triggered only. The same immutable attempt and maker request are reused. */
export async function retryPersistedMakerFill(
  record: RfqLifecycleRecord,
  dependencies: Readonly<{
    authorize: (record: RfqLifecycleRecord) => Promise<RfqLifecycleRecord>;
    beforeSubmit: (record: RfqLifecycleRecord) => void;
    submitExact: (
      terms: LocalnetIntentTerms,
      attemptId: string,
    ) => Promise<string>;
    persist: (record: RfqLifecycleRecord) => Promise<unknown>;
    now: () => number;
  }>,
): Promise<RfqLifecycleRecord> {
  const authorized = await dependencies.authorize(record);
  const attempt = authorized.attempts.fill;
  const terms = termsFromMakerFillAttempt(authorized);
  dependencies.beforeSubmit(authorized);
  const transactionHash = await dependencies.submitExact(
    terms,
    attempt!.attemptId,
  );
  const next = updateRfqPhaseAttempt(
    authorized,
    "fill",
    "submitted-unknown",
    dependencies.now(),
    {
      transactionHash,
      observation:
        "The exact persisted maker-fill request returned a transaction hash.",
    },
  );
  await dependencies.persist(next);
  return next;
}
