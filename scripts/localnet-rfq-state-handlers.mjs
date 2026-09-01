import {
  abandonFundingHttpTargetThroughCoordinator,
  acquireReleaseHttpTargetThroughCoordinator,
  markFundingUnknownHttpTargetThroughCoordinator,
  observeFundedHttpTargetThroughCoordinator,
  prepareFundingHttpTargetThroughCoordinator,
  releaseHttpTargetThroughCoordinator,
  terminalizeHttpTargetThroughCoordinator,
} from "./localnet-release-boundary.mjs";

function requestForTarget(coordinator, target) {
  const intentDigest = target.intentDigest ?? target.requestDigest;
  if (typeof coordinator.getRequest === "function") {
    return coordinator.getRequest(intentDigest);
  }
  return coordinator
    .listRequests()
    .find((candidate) => candidate.intentDigest === intentDigest);
}

/** Importable handler seam used by startApi and barrier-controlled tests. */
export function createLocalnetRfqStateHandlers({
  coordinator,
  observeEscrow,
  release,
  now,
  validateFundedObservation = () => undefined,
  observeTake = async () => null,
  validateTakeObservation = () => undefined,
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

    prepareTake(target, attemptId) {
      return coordinator.prepareTake(target, attemptId);
    },

    markTakeUnknown(target, attemptId) {
      return coordinator.markTakeUnknown(target, attemptId);
    },

    abandonTake(target, attemptId) {
      return coordinator.abandonTake(target, attemptId);
    },

    async observeTake(target, attemptId) {
      const observed = await observeTake(target.dealId);
      if (!observed)
        throw new Error("Exact v3 escrow take has not been observed.");
      validateTakeObservation(observed, target.expected);
      await coordinator.observeTaken(target, attemptId);
      return observed;
    },

    async convergeTake(target, attemptId, expectedObservation) {
      if (expectedObservation !== "taken" && expectedObservation !== "absent")
        throw new Error("V3 take convergence observation is invalid.");
      const observed = await observeTake(target.dealId);
      if (expectedObservation === "taken") {
        if (!observed)
          throw new Error("Exact v3 escrow take changed before convergence.");
        validateTakeObservation(observed, target.expected);
        await coordinator.observeTaken(target, attemptId);
        return observed;
      }
      if (observed)
        throw new Error("V3 take absence contradicts an on-chain take record.");
      await coordinator.markTakeAbsent(target, attemptId);
      return null;
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
      let request = requestForTarget(coordinator, target);
      if (["funding-pending", "funding-unknown"].includes(request?.state)) {
        await observeFundedHttpTargetThroughCoordinator({
          coordinator,
          target,
          attemptId,
        });
        request = requestForTarget(coordinator, target);
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
          request = requestForTarget(coordinator, target);
        }
        if (observed.status === 3 && request?.state === "filled") {
          await terminalizeHttpTargetThroughCoordinator({
            coordinator,
            target,
            outcome: "settled",
          });
          request = requestForTarget(coordinator, target);
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
        request = requestForTarget(coordinator, target);
      }
      if (request?.state === "expired") {
        await terminalizeHttpTargetThroughCoordinator({
          coordinator,
          target,
          outcome: "refunded",
        });
        request = requestForTarget(coordinator, target);
      }
      if (request?.state !== "refunded")
        throw new Error(
          "Coordinator did not establish the exact refunded terminal state.",
        );
      return observed;
    },
  });
}
