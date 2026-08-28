import type { WALLET_API } from "@starknet-io/types-js";
import type { ProviderInterface, WalletAccountV6 } from "starknet";
import {
  Strk20NotSubmittedError,
  submitActions,
  type SubmitActionsOptions,
} from "@/lib/strk20";

export type PreparedLocalnetFunding<TTarget> = Readonly<{
  account: WalletAccountV6;
  provider: ProviderInterface;
  actions: WALLET_API.STRK20_ACTION[];
  target: TTarget;
  attemptId: string;
  policy: () => void;
  onSubmitted?: SubmitActionsOptions["onSubmitted"];
}>;

export class LocalnetFundingKnownNotSubmittedError extends Strk20NotSubmittedError {
  readonly cause: unknown;
  readonly disposition: "no-attempt" | "lease-abandoned";

  constructor(cause: unknown, disposition: "no-attempt" | "lease-abandoned") {
    super(cause);
    this.name = "LocalnetFundingKnownNotSubmittedError";
    this.cause = cause;
    this.disposition = disposition;
  }
}

export class LocalnetFundingPrewalletRecoveryPendingError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      "Exact pre-wallet abandonment remains response-ambiguous; verify the persisted preparing attempt against status 0.",
    );
    this.name = "LocalnetFundingPrewalletRecoveryPendingError";
    this.cause = cause;
  }
}

export type LocalnetFundingOrchestration<TTarget> = Readonly<{
  /** All quote acceptance, nonce consumption, and action construction happens here. */
  prepareBeforeLease: () => Promise<PreparedLocalnetFunding<TTarget>>;
  /** Persists the durable browser attempt only after local preparation succeeds. */
  persistPreparedAttempt: (
    prepared: PreparedLocalnetFunding<TTarget>,
  ) => Promise<unknown>;
  /** Advances the exact browser execution lease after server preparation and before the wallet boundary. */
  authorizeWalletSubmission: () => Promise<unknown>;
  /** Idempotent for the exact target and attempt ID. */
  prepareLease: (target: TTarget, attemptId: string) => Promise<unknown>;
  markUnknown: (target: TTarget, attemptId: string) => Promise<unknown>;
  abandonLease: (target: TTarget, attemptId: string) => Promise<unknown>;
  leaseDefinitelyNotAcquired?: (error: unknown) => boolean;
  submit?: typeof submitActions;
}>;

/**
 * Production funding seam. No server lease exists until all fallible local work
 * is complete. A lost prepare response is replayed with the same attempt. After
 * the lease, the final submit policy is the sole pre-wallet fallible operation.
 */
export async function runLocalnetFundingOrchestration<TTarget>(
  orchestration: LocalnetFundingOrchestration<TTarget>,
) {
  let prepared: PreparedLocalnetFunding<TTarget>;
  try {
    prepared = await orchestration.prepareBeforeLease();
  } catch (error: unknown) {
    throw new LocalnetFundingKnownNotSubmittedError(error, "no-attempt");
  }
  try {
    await orchestration.persistPreparedAttempt(prepared);
  } catch (error: unknown) {
    throw new LocalnetFundingKnownNotSubmittedError(error, "no-attempt");
  }
  let leaseAcquired = false;
  let walletBoundaryStarted = false;
  try {
    try {
      await orchestration.prepareLease(prepared.target, prepared.attemptId);
    } catch {
      // The first request may have committed and lost its response. Replaying
      // this exact attempt is the only safe way to discover that lease.
      try {
        await orchestration.prepareLease(prepared.target, prepared.attemptId);
      } catch (replayError: unknown) {
        // Two lost responses are still ambiguous. Exact abandonment is itself
        // replayed: a durable abandoned-attempt tombstone makes response-loss
        // recovery distinguishable from an unknown active lease.
        for (let retry = 0; retry < 2; retry += 1) {
          try {
            await orchestration.abandonLease(
              prepared.target,
              prepared.attemptId,
            );
            throw new LocalnetFundingKnownNotSubmittedError(
              replayError,
              "lease-abandoned",
            );
          } catch (abandonError: unknown) {
            if (abandonError instanceof LocalnetFundingKnownNotSubmittedError)
              throw abandonError;
          }
        }
        if (orchestration.leaseDefinitelyNotAcquired?.(replayError)) {
          throw new LocalnetFundingKnownNotSubmittedError(
            replayError,
            "no-attempt",
          );
        }
        throw new LocalnetFundingPrewalletRecoveryPendingError(replayError);
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
        // markUnknown is an awaited TOCTOU fence. The final browser
        // tombstone/revision CAS belongs after it and immediately before
        // submitActions reruns the complete policy and enters the wallet.
        await orchestration.authorizeWalletSubmission();
      },
      onSubmitted: prepared.onSubmitted,
    });
  } catch (error: unknown) {
    if (
      leaseAcquired &&
      !walletBoundaryStarted &&
      error instanceof Strk20NotSubmittedError
    ) {
      let lastAbandonError: unknown;
      for (let retry = 0; retry < 2; retry += 1) {
        try {
          await orchestration.abandonLease(prepared.target, prepared.attemptId);
          throw new LocalnetFundingKnownNotSubmittedError(
            error,
            "lease-abandoned",
          );
        } catch (abandonError: unknown) {
          if (abandonError instanceof LocalnetFundingKnownNotSubmittedError)
            throw abandonError;
          lastAbandonError = abandonError;
        }
      }
      throw new LocalnetFundingPrewalletRecoveryPendingError(lastAbandonError);
    }
    throw error;
  }
}
