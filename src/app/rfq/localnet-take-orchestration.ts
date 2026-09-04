import type { ProviderInterface, WalletAccountV6 } from "starknet";
import {
  type App20Strk20Action,
  Strk20NotSubmittedError,
  submitActions,
  type SubmitActionsOptions,
} from "@/lib/strk20";

export type PreparedLocalnetTake<TTarget> = Readonly<{
  account: WalletAccountV6;
  provider: ProviderInterface;
  actions: App20Strk20Action[];
  target: TTarget;
  attemptId: string;
  policy: () => void;
  onSubmitted?: SubmitActionsOptions["onSubmitted"];
}>;

export class LocalnetTakeKnownNotSubmittedError extends Strk20NotSubmittedError {
  readonly cause: unknown;
  readonly disposition: "no-attempt" | "lease-abandoned";

  constructor(cause: unknown, disposition: "no-attempt" | "lease-abandoned") {
    super(cause);
    this.name = "LocalnetTakeKnownNotSubmittedError";
    this.cause = cause;
    this.disposition = disposition;
  }
}

export class LocalnetTakePrewalletRecoveryPendingError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      "Exact pre-wallet Take abandonment remains response-ambiguous; verify the persisted preparing attempt against the escrow Take record.",
    );
    this.name = "LocalnetTakePrewalletRecoveryPendingError";
    this.cause = cause;
  }
}

export type LocalnetTakeOrchestration<TTarget> = Readonly<{
  prepareBeforeLease: () => Promise<PreparedLocalnetTake<TTarget>>;
  persistPreparedAttempt: (
    prepared: PreparedLocalnetTake<TTarget>,
  ) => Promise<unknown>;
  authorizeWalletSubmission: () => Promise<unknown>;
  prepareLease: (target: TTarget, attemptId: string) => Promise<unknown>;
  markUnknown: (target: TTarget, attemptId: string) => Promise<unknown>;
  abandonLease: (target: TTarget, attemptId: string) => Promise<unknown>;
  leaseDefinitelyNotAcquired?: (error: unknown) => boolean;
  submit?: typeof submitActions;
}>;

/** Runs the v3 Take prepare/CAS/wallet-boundary protocol without implicit retry. */
export async function runLocalnetTakeOrchestration<TTarget>(
  orchestration: LocalnetTakeOrchestration<TTarget>,
) {
  let prepared: PreparedLocalnetTake<TTarget>;
  try {
    prepared = await orchestration.prepareBeforeLease();
  } catch (error: unknown) {
    throw new LocalnetTakeKnownNotSubmittedError(error, "no-attempt");
  }
  try {
    await orchestration.persistPreparedAttempt(prepared);
  } catch (error: unknown) {
    throw new LocalnetTakeKnownNotSubmittedError(error, "no-attempt");
  }

  let leaseAcquired = false;
  let walletBoundaryStarted = false;
  try {
    try {
      await orchestration.prepareLease(prepared.target, prepared.attemptId);
    } catch {
      try {
        await orchestration.prepareLease(prepared.target, prepared.attemptId);
      } catch (replayError: unknown) {
        for (let retry = 0; retry < 2; retry += 1) {
          try {
            await orchestration.abandonLease(
              prepared.target,
              prepared.attemptId,
            );
            throw new LocalnetTakeKnownNotSubmittedError(
              replayError,
              "lease-abandoned",
            );
          } catch (abandonError: unknown) {
            if (abandonError instanceof LocalnetTakeKnownNotSubmittedError)
              throw abandonError;
          }
        }
        if (orchestration.leaseDefinitelyNotAcquired?.(replayError)) {
          throw new LocalnetTakeKnownNotSubmittedError(
            replayError,
            "no-attempt",
          );
        }
        throw new LocalnetTakePrewalletRecoveryPendingError(replayError);
      }
    }
    leaseAcquired = true;
    await orchestration.authorizeWalletSubmission();
    const submit = orchestration.submit ?? submitActions;
    return await submit(prepared.account, prepared.provider, prepared.actions, {
      policy: prepared.policy,
      beforeWalletSubmission: async () => {
        walletBoundaryStarted = true;
        await orchestration.markUnknown(prepared.target, prepared.attemptId);
        await orchestration.authorizeWalletSubmission();
      },
      onSubmitted: prepared.onSubmitted,
    });
  } catch (error: unknown) {
    if (leaseAcquired && !walletBoundaryStarted) {
      let lastAbandonError: unknown;
      for (let retry = 0; retry < 2; retry += 1) {
        try {
          await orchestration.abandonLease(prepared.target, prepared.attemptId);
          throw new LocalnetTakeKnownNotSubmittedError(
            error,
            "lease-abandoned",
          );
        } catch (abandonError: unknown) {
          if (abandonError instanceof LocalnetTakeKnownNotSubmittedError)
            throw abandonError;
          lastAbandonError = abandonError;
        }
      }
      throw new LocalnetTakePrewalletRecoveryPendingError(lastAbandonError);
    }
    throw error;
  }
}
