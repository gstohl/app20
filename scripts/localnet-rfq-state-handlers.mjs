import {
  abandonFundingHttpTargetThroughCoordinator,
  acquireReleaseHttpTargetThroughCoordinator,
  markFundingUnknownHttpTargetThroughCoordinator,
  observeFundedHttpTargetThroughCoordinator,
  prepareFundingHttpTargetThroughCoordinator,
  releaseHttpTargetThroughCoordinator,
  terminalizeHttpTargetThroughCoordinator,
} from "./localnet-release-boundary.mjs";

/** Importable handler seam used by startApi and barrier-controlled tests. */
export function createLocalnetRfqStateHandlers({
  coordinator,
  observeEscrow,
  release,
  now,
  validateFundedObservation = () => undefined,
  beforeReleaseObservation = async () => undefined,
  afterReleaseObservation = async () => undefined,
}) {
  return Object.freeze({
    async releaseIntent(target, releaseLeaseId) {
      await acquireReleaseHttpTargetThroughCoordinator({
        coordinator,
        target,
        releaseLeaseId,
        now: now(),
      });
      await beforeReleaseObservation(target);
      const observed = await observeEscrow(target.rfqId);
      await afterReleaseObservation(target, observed);
      if (observed.status !== 0) {
        if (observed.status !== 1)
          throw new Error(
            "Request release observed a terminal or malformed escrow collision; durable authority remains fenced.",
          );
        validateFundedObservation(target, observed, 1);
        await coordinator.observeFundedDuringRelease({
          intentDigest: target.requestDigest,
          rfqId: target.rfqId,
          account: target.account,
          chainId: target.chainId,
          releaseLeaseId,
        });
        throw new Error(
          "Request-wide reservation release is blocked after funding; use the exact funded recovery path.",
        );
      }
      return releaseHttpTargetThroughCoordinator({
        coordinator,
        target,
        releaseLeaseId,
        release,
        now: now(),
        reason: "client released an ambiguous or restored RFQ",
      });
    },

    prepareFunding(target, attemptId) {
      return prepareFundingHttpTargetThroughCoordinator({
        coordinator,
        target,
        attemptId,
      });
    },

    markFundingUnknown(target, attemptId) {
      return markFundingUnknownHttpTargetThroughCoordinator({
        coordinator,
        target,
        attemptId,
      });
    },

    abandonFunding(target, attemptId) {
      return abandonFundingHttpTargetThroughCoordinator({
        coordinator,
        target,
        attemptId,
      });
    },

    async observeFunding(target, attemptId) {
      const observed = await observeEscrow(target.dealId);
      if (observed.status !== 1)
        throw new Error("Exact escrow funding is not in the funded state.");
      validateFundedObservation(target, observed, 1);
      await observeFundedHttpTargetThroughCoordinator({
        coordinator,
        target,
        attemptId,
      });
      return observed;
    },

    /** Exact status convergence used by hydration and every browser action. */
    async convergeObservation(target, attemptId, expectedStatus) {
      const observed = await observeEscrow(target.dealId);
      if (
        ![1, 2, 3, 4].includes(observed.status) ||
        observed.status !== expectedStatus
      )
        throw new Error(
          "Exact escrow status changed before coordinator convergence.",
        );
      validateFundedObservation(target, observed, expectedStatus);
      let request = coordinator
        .listRequests()
        .find(
          (candidate) =>
            candidate.intentDigest ===
            (target.intentDigest ?? target.requestDigest),
        );
      if (["funding-pending", "funding-unknown"].includes(request?.state)) {
        await observeFundedHttpTargetThroughCoordinator({
          coordinator,
          target,
          attemptId,
        });
        request = coordinator
          .listRequests()
          .find(
            (candidate) =>
              candidate.intentDigest ===
              (target.intentDigest ?? target.requestDigest),
          );
      }
      if (observed.status === 1) {
        if (!["funded", "expired"].includes(request?.state))
          throw new Error(
            "Coordinator did not establish the exact funded or expiry-recovery state.",
          );
        return observed;
      }
      if (observed.status === 2 || observed.status === 3) {
        if (request?.state === "funded") {
          await terminalizeHttpTargetThroughCoordinator({
            coordinator,
            target,
            outcome: "filled",
          });
          request = coordinator
            .listRequests()
            .find(
              (candidate) =>
                candidate.intentDigest ===
                (target.intentDigest ?? target.requestDigest),
            );
        }
        if (observed.status === 3 && request?.state === "filled") {
          await terminalizeHttpTargetThroughCoordinator({
            coordinator,
            target,
            outcome: "settled",
          });
          request = coordinator
            .listRequests()
            .find(
              (candidate) =>
                candidate.intentDigest ===
                (target.intentDigest ?? target.requestDigest),
            );
        }
        const expected = observed.status === 2 ? "filled" : "settled";
        if (request?.state !== expected)
          throw new Error(
            `Coordinator did not establish the exact ${expected} terminal state.`,
          );
        return observed;
      }
      if (request?.state === "funded") {
        await terminalizeHttpTargetThroughCoordinator({
          coordinator,
          target,
          outcome: "expired",
        });
        request = coordinator
          .listRequests()
          .find(
            (candidate) =>
              candidate.intentDigest ===
              (target.intentDigest ?? target.requestDigest),
          );
      }
      if (request?.state === "expired") {
        await terminalizeHttpTargetThroughCoordinator({
          coordinator,
          target,
          outcome: "refunded",
        });
        request = coordinator
          .listRequests()
          .find(
            (candidate) =>
              candidate.intentDigest ===
              (target.intentDigest ?? target.requestDigest),
          );
      }
      if (request?.state !== "refunded")
        throw new Error(
          "Coordinator did not establish the exact refunded terminal state.",
        );
      return observed;
    },
  });
}
