const VALUE_STATUSES = new Set([1, 2, 3, 4]);
const FILLED_STATUSES = new Set([2, 3]);

function asBigInt(value, label, toBigInt) {
  try {
    return toBigInt(value);
  } catch {
    throw new Error(`Observed ${label} is not a canonical integer.`);
  }
}

/** Phase-independent validation of the immutable escrow binding. */
export function assertLocalnetDealImmutableTerms(
  deal,
  { sellToken, sellAmount, buyToken, buyAmount, deadline, ticketAddress },
  toBigInt = (value) => BigInt(value),
) {
  if (!deal || typeof deal !== "object" || Array.isArray(deal))
    throw new Error("Observed local escrow deal is malformed.");
  if (
    asBigInt(deal.legAToken, "sell token", toBigInt) !==
      asBigInt(sellToken, "expected sell token", toBigInt) ||
    asBigInt(deal.legAAmount, "sell amount", toBigInt) !==
      asBigInt(sellAmount, "expected sell amount", toBigInt) ||
    asBigInt(deal.legBToken, "buy token", toBigInt) !==
      asBigInt(buyToken, "expected buy token", toBigInt) ||
    asBigInt(deal.legBTerms, "buy terms", toBigInt) !==
      asBigInt(buyAmount, "expected buy amount", toBigInt) ||
    deal.deadline !== deadline ||
    asBigInt(deal.ticket, "ticket", toBigInt) !==
      asBigInt(ticketAddress, "expected ticket", toBigInt)
  ) {
    throw new Error(
      "The on-chain escrow immutable terms do not match the quoted private intent.",
    );
  }
}

/** Phase validation is deliberately separate from immutable deal validation. */
export function assertLocalnetDealPhase(deal, expectedStatus) {
  if (!VALUE_STATUSES.has(expectedStatus))
    throw new Error("Expected escrow status must be exactly 1, 2, 3, or 4.");
  if (deal.status !== expectedStatus)
    throw new Error(
      `Exact escrow phase mismatch: expected status ${expectedStatus}, observed ${deal.status}.`,
    );
}

/** Production validator used by startApi, convergence, solve, and expiry. */
export function validateLocalnetDealObservation(
  deal,
  terms,
  expectedStatus,
  toBigInt = (value) => BigInt(value),
) {
  assertLocalnetDealPhase(deal, expectedStatus);
  assertLocalnetDealImmutableTerms(deal, terms, toBigInt);
  if (
    FILLED_STATUSES.has(expectedStatus) &&
    asBigInt(deal.legBAmount, "filled output amount", toBigInt) !==
      asBigInt(terms.buyAmount, "expected filled output amount", toBigInt)
  ) {
    throw new Error(
      "The on-chain escrow filled output amount does not match the exact selected quote.",
    );
  }
  return deal;
}
