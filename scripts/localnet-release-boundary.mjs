function exactCoordinatorTarget(target) {
  return {
    intentDigest: target.intentDigest ?? target.requestDigest,
    rfqId: target.rfqId,
    account: target.account,
    chainId: target.chainId,
    dealId: target.dealId ?? target.rfqId,
    reservationId: target.reservationId,
    makerId: target.solverId ?? target.makerId,
    fence: target.reservationFence ?? target.fence,
    quoteDigest: target.quoteDigest,
    ...(target.sellToken === undefined
      ? {}
      : {
          sellToken: target.sellToken,
          sellAmount: target.sellAmount,
          buyToken: target.buyToken,
          buyAmount: target.buyAmount,
          deadline: target.deadline,
          ticketAddress: target.ticketAddress,
        }),
  };
}

export async function acquireReleaseHttpTargetThroughCoordinator({
  coordinator,
  target,
  releaseLeaseId,
  now,
}) {
  return coordinator.acquireReleaseLease({
    intentDigest: target.requestDigest,
    rfqId: target.rfqId,
    account: target.account,
    chainId: target.chainId,
    releaseLeaseId,
    now,
  });
}

export async function releaseHttpTargetThroughCoordinator({
  coordinator,
  target,
  releaseLeaseId,
  release,
  now,
  reason,
}) {
  return coordinator.releaseIntent(
    {
      intentDigest: target.requestDigest,
      rfqId: target.rfqId,
      account: target.account,
      chainId: target.chainId,
      releaseLeaseId,
    },
    release,
    now,
    reason,
  );
}

export async function prepareFundingHttpTargetThroughCoordinator({
  coordinator,
  target,
  attemptId,
}) {
  return coordinator.prepareFunding({
    ...exactCoordinatorTarget(target),
    attemptId,
  });
}

export async function markFundingUnknownHttpTargetThroughCoordinator({
  coordinator,
  target,
  attemptId,
}) {
  return coordinator.markFundingUnknown({
    ...exactCoordinatorTarget(target),
    attemptId,
  });
}

export async function abandonFundingHttpTargetThroughCoordinator({
  coordinator,
  target,
  attemptId,
}) {
  return coordinator.abandonFunding({
    ...exactCoordinatorTarget(target),
    attemptId,
  });
}

export async function observeFundedHttpTargetThroughCoordinator({
  coordinator,
  target,
  attemptId,
}) {
  return coordinator.observeFunded({
    ...exactCoordinatorTarget(target),
    attemptId,
  });
}

export async function releaseFundedHttpTargetThroughCoordinator({
  coordinator,
  target,
  release,
  now,
  reason,
}) {
  return coordinator.releaseSelected(
    exactCoordinatorTarget(target),
    release,
    now,
    reason,
  );
}

export async function bindExpiryHttpTargetThroughCoordinator({
  coordinator,
  target,
}) {
  return coordinator.bindDeal(exactCoordinatorTarget(target));
}

export async function terminalizeHttpTargetThroughCoordinator({
  coordinator,
  target,
  outcome,
}) {
  return coordinator.terminalize(exactCoordinatorTarget(target), outcome);
}
