import { feltEquals } from "@/lib/addresses";
import { buildEscrowTakeActions } from "@/lib/escrow-actions";
import {
  assertReadyExecutionUnchanged,
  snapshotReadyExecution,
} from "@/lib/ready-execution";
import {
  readStrk20PrivateBalance,
  transactionHashFromError,
  transactionStateFromError,
} from "@/lib/strk20";
import {
  LOCALNET_PROVIDER_INDEX,
  myFrontendProviders,
} from "@/utils/constants";
import {
  abandonLocalnetTake,
  convergeLocalnetTake,
  createLocalnetIntentId,
  localnetCommandWasRejected,
  localnetTakeTargetFromLifecycle,
  markLocalnetTakeUnknown,
  observeLocalnetTake,
  prepareLocalnetTake,
  readEscrowTake,
  readLocalnetRfqOperationsStatus,
} from "../localnet-private-intents";
import {
  LocalnetTakeKnownNotSubmittedError,
  runLocalnetTakeOrchestration,
} from "../localnet-take-orchestration";
import {
  beginRfqPhaseAttempt,
  confirmRfqV3Take,
  revertRfqV3Take,
  takeAttemptTargetFromLifecycle,
  transitionRfqLifecycle,
  updateRfqPhaseAttempt,
  type RfqLifecycleRecord,
} from "../rfq-lifecycle";
import {
  validateLiveV3FinalReview,
  type RfqFinalReviewSnapshot,
  type RfqFinalReviewV3Terms,
} from "../rfq-final-review";
import { gateRfqAction, operationsAvailability } from "../rfq-operations";

export type V3TakePersistence = Readonly<{
  persist(record: RfqLifecycleRecord): Promise<RfqLifecycleRecord | void>;
  authorize(record: RfqLifecycleRecord): Promise<RfqLifecycleRecord>;
}>;

export type V3TakeExecutionResult =
  | Readonly<{
      kind: "settled";
      record: RfqLifecycleRecord;
      transactionHash: string;
      takeBlock: number;
    }>
  | Readonly<{
      kind: "submission-unknown";
      record: RfqLifecycleRecord;
      transactionHash?: string;
      reason: string;
    }>
  | Readonly<{
      kind: "reverted";
      record: RfqLifecycleRecord;
      transactionHash?: string;
      reason: string;
    }>
  | Readonly<{
      kind: "quarantined";
      record: RfqLifecycleRecord;
      transactionHash?: string;
      reason: string;
    }>;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The RFQ v3 Take failed.";
}

function v3ReviewTerms(record: RfqLifecycleRecord): RfqFinalReviewV3Terms {
  if (
    record.mode !== "v3" ||
    !record.terms ||
    !record.terms.buyAmount ||
    !record.fills
  ) {
    throw new Error("The persisted RFQ v3 exact fills are unavailable.");
  }
  return Object.freeze({
    mode: "v3",
    rfqId: record.rfqId,
    sellAddress: record.terms.sellAddress,
    exactSellAmount: BigInt(record.terms.sellAmount),
    buyAddress: record.terms.buyAddress,
    totalBuyAmount: BigInt(record.terms.buyAmount),
    floorBuyAmount: BigInt(record.terms.minBuyAmount ?? "0"),
    fills: Object.freeze(
      record.fills.map((fill) =>
        Object.freeze({
          makerId: fill.makerId,
          lockId: fill.lockId,
          amountA: BigInt(fill.amountA),
          amountB: BigInt(fill.amountB),
          lockExpiresAt: fill.lockExpiresAt,
        }),
      ),
    ),
    feeBps: 0,
    app20FeeAmount: 0n,
  });
}

export function receiptBlockNumber(receipt: unknown, fallback: number): number {
  const outer =
    receipt && typeof receipt === "object"
      ? (receipt as Record<string, unknown>)
      : undefined;
  const value =
    outer?.value && typeof outer.value === "object"
      ? (outer.value as Record<string, unknown>)
      : outer;
  const candidate = value?.block_number ?? value?.blockNumber;
  return Number.isSafeInteger(candidate) && Number(candidate) >= 0
    ? Number(candidate)
    : fallback;
}

export async function readV3FinalReviewSnapshot(
  record: RfqLifecycleRecord,
): Promise<RfqFinalReviewSnapshot> {
  if (record.mode !== "v3" || !record.terms) {
    throw new Error("RFQ v3 exact terms are unavailable.");
  }
  const started = snapshotReadyExecution();
  if (
    started.providerIndex !== LOCALNET_PROVIDER_INDEX ||
    !feltEquals(started.address, record.account) ||
    !feltEquals(started.chainId, record.chainId)
  ) {
    throw new Error(
      "Reconnect the LOCAL wallet account and chain bound to this RFQ.",
    );
  }
  const raw = await started.account.strk20Balances([record.terms.sellAddress]);
  return Object.freeze({
    account: started.address,
    chainId: started.chainId,
    walletRail: "ready",
    observedAt: Math.floor(Date.now() / 1_000),
    shieldedBalance: readStrk20PrivateBalance(raw, record.terms.sellAddress),
  });
}

async function persistExact(
  persistence: V3TakePersistence,
  record: RfqLifecycleRecord,
): Promise<RfqLifecycleRecord> {
  const saved = await persistence.persist(record);
  return saved ?? record;
}

/**
 * Executes one explicitly reviewed RFQ v3 Take with the existing durable
 * prepare/CAS/wallet-boundary discipline. Unknown outcomes are never retried.
 */
export async function executeLocalnetV3Take(input: {
  record: RfqLifecycleRecord;
  initialSnapshot?: RfqFinalReviewSnapshot;
  persistence: V3TakePersistence;
}): Promise<V3TakeExecutionResult> {
  let current = input.record;
  if (current.mode !== "v3" || current.state !== "reviewing") {
    throw new Error("Only an RFQ v3 in final review can submit Take.");
  }
  const started = snapshotReadyExecution();
  if (
    started.providerIndex !== LOCALNET_PROVIDER_INDEX ||
    !feltEquals(started.address, current.account) ||
    !feltEquals(started.chainId, current.chainId)
  ) {
    throw new Error(
      "Reconnect the LOCAL wallet account and chain bound to this RFQ.",
    );
  }
  const provider = myFrontendProviders[LOCALNET_PROVIDER_INDEX];
  const currentSnapshot = await readV3FinalReviewSnapshot(current);
  const review = await validateLiveV3FinalReview({
    initial: input.initialSnapshot ?? currentSnapshot,
    current: currentSnapshot,
    terms: v3ReviewTerms(current),
    now: currentSnapshot.observedAt,
  });
  if (!review.ok) {
    throw new Error(`Final Take review changed: ${review.blockers.join(" ")}`);
  }
  const operationsStatus = await readLocalnetRfqOperationsStatus();
  const gate = gateRfqAction(
    operationsAvailability(operationsStatus, currentSnapshot.observedAt),
    "take",
  );
  if (!gate.allowed) throw new Error(gate.reason);

  const attemptId = createLocalnetIntentId();
  current = beginRfqPhaseAttempt(
    current,
    "take",
    attemptId,
    currentSnapshot.observedAt,
    takeAttemptTargetFromLifecycle(current),
  );
  current = await persistExact(input.persistence, current);
  const preparedTarget = localnetTakeTargetFromLifecycle(current);

  try {
    const submitted = await runLocalnetTakeOrchestration({
      prepareBeforeLease: async () => {
        if (!current.terms || !current.takerSecret || !current.fills) {
          throw new Error("The exact Take bindings are unavailable.");
        }
        return Object.freeze({
          account: started.account,
          provider,
          actions: buildEscrowTakeActions({
            escrowAddress: current.settlement!.escrowAddress,
            recoveryAddress: started.address,
            rfqId: current.rfqId,
            tokenA: current.terms.sellAddress,
            tokenB: current.terms.buyAddress,
            takerSecret: current.takerSecret,
            fills: current.fills.map((fill) => ({
              lockId: fill.lockId,
              amountA: BigInt(fill.amountA),
            })),
          }),
          target: preparedTarget,
          attemptId,
          policy: () => {
            assertReadyExecutionUnchanged(started, "private-swap");
            const now = Math.floor(Date.now() / 1_000);
            const liveGate = gateRfqAction(
              operationsAvailability(operationsStatus, now),
              "take",
            );
            if (!liveGate.allowed) throw new Error(liveGate.reason);
            if (now >= current.settlement!.deadline) {
              throw new Error("The reviewed maker locks expired before Take.");
            }
          },
          onSubmitted: async (transactionHash: string) => {
            current = updateRfqPhaseAttempt(
              current,
              "take",
              "submitted-unknown",
              Math.floor(Date.now() / 1_000),
              { transactionHash },
            );
            current = transitionRfqLifecycle(
              current,
              "submission-unknown",
              Math.floor(Date.now() / 1_000),
            );
            current = await persistExact(input.persistence, current);
          },
        });
      },
      persistPreparedAttempt: async () => {
        current = await input.persistence.authorize(current);
      },
      authorizeWalletSubmission: async () => {
        current = await input.persistence.authorize(current);
      },
      prepareLease: prepareLocalnetTake,
      markUnknown: markLocalnetTakeUnknown,
      abandonLease: abandonLocalnetTake,
      leaseDefinitelyNotAcquired: localnetCommandWasRejected,
    });

    if (current.state === "reviewing") {
      current = updateRfqPhaseAttempt(
        current,
        "take",
        "submitted-unknown",
        Math.floor(Date.now() / 1_000),
        { transactionHash: submitted.transactionHash },
      );
      current = transitionRfqLifecycle(
        current,
        "submission-unknown",
        Math.floor(Date.now() / 1_000),
      );
      current = await persistExact(input.persistence, current);
    }
    const target = localnetTakeTargetFromLifecycle(current);
    const take = await readEscrowTake(current.rfqId);
    if (!take) {
      return Object.freeze({
        kind: "submission-unknown",
        record: current,
        transactionHash: submitted.transactionHash,
        reason:
          "The wallet confirmed submission, but the exact escrow Take record is not visible yet. Verify it; do not retry.",
      });
    }
    await observeLocalnetTake(target, attemptId);
    current = confirmRfqV3Take(current, take, Math.floor(Date.now() / 1_000));
    current = await persistExact(input.persistence, current);
    if (current.state !== "settled") {
      return Object.freeze({
        kind: "quarantined",
        record: current,
        transactionHash: submitted.transactionHash,
        reason:
          "The observed escrow Take contradicts the persisted exact fills. The record is quarantined and is not presented as settled.",
      });
    }
    const head = await provider.getBlockNumber();
    return Object.freeze({
      kind: "settled",
      record: current,
      transactionHash: submitted.transactionHash,
      takeBlock: receiptBlockNumber(submitted.receipt, head),
    });
  } catch (error: unknown) {
    const reason = errorMessage(error);
    const transactionHash = transactionHashFromError(error);
    const state = transactionStateFromError(error);
    if (error instanceof LocalnetTakeKnownNotSubmittedError) {
      current = updateRfqPhaseAttempt(
        current,
        "take",
        "reverted",
        Math.floor(Date.now() / 1_000),
        { observation: "Take was proven not submitted before wallet entry." },
      );
      current = await persistExact(input.persistence, current);
      return Object.freeze({ kind: "reverted", record: current, reason });
    }
    if (state === "reverted") {
      if (current.state === "submission-unknown") {
        await convergeLocalnetTake(
          localnetTakeTargetFromLifecycle(current),
          attemptId,
          "absent",
        );
        current = revertRfqV3Take(
          current,
          Math.floor(Date.now() / 1_000),
          "The exact Take transaction reverted.",
        );
      } else {
        current = updateRfqPhaseAttempt(
          current,
          "take",
          "reverted",
          Math.floor(Date.now() / 1_000),
          {
            ...(transactionHash ? { transactionHash } : {}),
            observation: "The exact Take transaction reverted.",
          },
        );
      }
      current = await persistExact(input.persistence, current);
      return Object.freeze({
        kind: "reverted",
        record: current,
        ...(transactionHash ? { transactionHash } : {}),
        reason,
      });
    }
    if (current.state === "reviewing") {
      current = updateRfqPhaseAttempt(
        current,
        "take",
        "wallet-boundary-unknown",
        Math.floor(Date.now() / 1_000),
        {
          walletBoundary: "entered",
          observation:
            "The wallet boundary was entered without a confirmed transaction hash.",
        },
      );
      current = transitionRfqLifecycle(
        current,
        "submission-unknown",
        Math.floor(Date.now() / 1_000),
      );
      current = await persistExact(input.persistence, current);
    }
    return Object.freeze({
      kind: "submission-unknown",
      record: current,
      ...(transactionHash ? { transactionHash } : {}),
      reason,
    });
  }
}

/** Reads and converges one persisted Take attempt without submitting anything. */
export async function verifyLocalnetV3Take(input: {
  record: RfqLifecycleRecord;
  persistence: V3TakePersistence;
}): Promise<
  | V3TakeExecutionResult
  | Readonly<{ kind: "absent"; record: RfqLifecycleRecord; reason: string }>
> {
  let current = input.record;
  if (current.mode !== "v3" || !current.attempts.take) {
    throw new Error("The persisted RFQ v3 Take attempt is unavailable.");
  }
  const attempt = current.attempts.take;
  const take = await readEscrowTake(current.rfqId);
  if (!take) {
    if (attempt.state === "preparing" && current.state === "reviewing") {
      await abandonLocalnetTake(
        localnetTakeTargetFromLifecycle(current),
        attempt.attemptId,
      );
      current = updateRfqPhaseAttempt(
        current,
        "take",
        "reverted",
        Math.floor(Date.now() / 1_000),
        {
          observation:
            "The exact pre-wallet Take lease was abandoned after an empty escrow observation.",
        },
      );
      current = await persistExact(input.persistence, current);
      return Object.freeze({
        kind: "reverted",
        record: current,
        reason:
          "No escrow Take was observed and the pre-wallet lease was abandoned. A new explicit Take may be reviewed.",
      });
    }
    return Object.freeze({
      kind: "absent",
      record: current,
      reason:
        "The exact escrow Take is not observed. The unknown attempt remains fenced and was not retried.",
    });
  }
  if (current.state !== "submission-unknown") {
    throw new Error(
      "An observed Take contradicts a lifecycle without wallet-boundary evidence.",
    );
  }
  await observeLocalnetTake(
    localnetTakeTargetFromLifecycle(current),
    attempt.attemptId,
  );
  current = confirmRfqV3Take(current, take, Math.floor(Date.now() / 1_000));
  current = await persistExact(input.persistence, current);
  const transactionHash =
    current.takeTransactionHash ?? attempt.transactionHash ?? "unavailable";
  if (current.state !== "settled") {
    return Object.freeze({
      kind: "quarantined",
      record: current,
      transactionHash,
      reason:
        "The observed escrow Take contradicts the persisted exact fills. The record is quarantined and is not presented as settled.",
    });
  }
  return Object.freeze({
    kind: "settled",
    record: current,
    transactionHash,
    takeBlock:
      await myFrontendProviders[LOCALNET_PROVIDER_INDEX].getBlockNumber(),
  });
}
