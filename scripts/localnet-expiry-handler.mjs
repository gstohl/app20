import { runLocalnetFundedExpiry } from "./localnet-funded-expiry.mjs";
import {
  bindExpiryHttpTargetThroughCoordinator,
  terminalizeHttpTargetThroughCoordinator,
} from "./localnet-release-boundary.mjs";

/** Durable owner resolution; the in-memory owner map is only an optimization. */
export function resolveExactLocalnetReservationOwner({
  coordinator,
  makerById,
  reservationOwners,
  target,
}) {
  const request = coordinator
    .listRequests()
    .find(
      (candidate) =>
        candidate.intentDigest ===
        (target.intentDigest ?? target.requestDigest),
    );
  const reservationId =
    target.reservationId ?? request?.selection?.reservationId;
  const live = reservationId ? reservationOwners.get(reservationId) : undefined;
  const durableTerms =
    request?.ticketAuthorization?.settlementTerms ??
    request?.settlementTerms ??
    request?.ticketSettlementTerms;
  const durableTicket =
    request?.ticketAuthorization?.ticketAddress ??
    request?.settlementTerms?.ticketAddress;
  if (live && durableTerms) {
    return Object.freeze({
      ...live,
      sellToken: durableTerms.sellToken,
      sellAmount: BigInt(durableTerms.sellAmount),
      buyToken: durableTerms.buyToken,
      buyAmount: BigInt(durableTerms.buyAmount),
      deadline: durableTerms.deadline,
      ...(durableTicket === undefined ? {} : { ticketAddress: durableTicket }),
    });
  }
  if (live) return live;
  if (!request?.selection || !durableTerms) return undefined;
  const client = makerById.get(request.selection.makerId);
  if (!client) return undefined;
  return Object.freeze({
    client,
    intentDigest: request.intentDigest,
    selected: true,
    fence: request.selection.fence,
    quoteDigest: request.selection.quoteDigest,
    sellToken: durableTerms.sellToken,
    sellAmount: BigInt(durableTerms.sellAmount),
    buyToken: durableTerms.buyToken,
    buyAmount: BigInt(durableTerms.buyAmount),
    deadline: durableTerms.deadline,
    ...(durableTicket === undefined ? {} : { ticketAddress: durableTicket }),
  });
}

/** Production expiry endpoint seam used directly by startApi. */
export function createLocalnetExpiryHandler({
  coordinator,
  makerById,
  reservationOwners,
  observeEscrow,
  validateFundedObservation,
  readTime,
  advanceTime,
  now,
  afterBarrier = async () => undefined,
}) {
  const resolveOwner = (target) =>
    resolveExactLocalnetReservationOwner({
      coordinator,
      makerById,
      reservationOwners,
      target,
    });

  return Object.freeze({
    resolveOwner,
    async expire(target) {
      const owner = resolveOwner(target);
      if (
        !owner?.selected ||
        owner.intentDigest !== target.intentDigest ||
        owner.client?.solverId !== target.solverId
      ) {
        throw new Error(
          "The durable selected private quote does not match this expiry path.",
        );
      }
      const observed = await observeEscrow(target.dealId);
      validateFundedObservation(target, observed, 1);
      const result = await runLocalnetFundedExpiry({
        target,
        deadline: observed.deadline,
        bind: async (exactTarget) => {
          const bound = await bindExpiryHttpTargetThroughCoordinator({
            coordinator,
            target: exactTarget,
          });
          await afterBarrier("bind", exactTarget);
          return bound;
        },
        readTime,
        advanceTime: async (timestamp) => {
          await advanceTime(timestamp);
          await afterBarrier("time", target);
        },
        observeExpired: () => observeEscrow(target.dealId),
        terminalize: async (exactTarget) => {
          const terminal = await terminalizeHttpTargetThroughCoordinator({
            coordinator,
            target: exactTarget,
            outcome: "expired",
          });
          await afterBarrier("terminal", exactTarget);
          return terminal;
        },
      });
      await afterBarrier("response", target);
      return result;
    },
  });
}
