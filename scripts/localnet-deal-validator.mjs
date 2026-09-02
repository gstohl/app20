import { fillsDigest } from "../packages/private-intents/src/take-signature.ts";

const VALUE_STATUSES = new Set([1, 2, 3, 4]);
const FILLED_STATUSES = new Set([2, 3]);
const MAX_U128 = (1n << 128n) - 1n;

function canonicalNonzeroFelt(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value))
    throw new Error(`${label} must be a canonical lowercase felt.`);
  const parsed = BigInt(value);
  if (
    parsed <= 0n ||
    parsed >= 1n << 252n ||
    value !== `0x${parsed.toString(16)}`
  )
    throw new Error(`${label} must be a canonical lowercase felt.`);
  return value;
}

function canonicalDigest(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value))
    throw new Error(`${label} must be a canonical lowercase felt.`);
  const parsed = BigInt(value);
  if (
    parsed < 0n ||
    parsed >= 1n << 252n ||
    value !== `0x${parsed.toString(16)}`
  )
    throw new Error(`${label} must be a canonical lowercase felt.`);
  return value;
}

function positiveU128Decimal(value, label) {
  const text = typeof value === "bigint" ? value.toString() : value;
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text))
    throw new Error(`${label} must be a positive canonical decimal amount.`);
  const parsed = BigInt(text);
  if (parsed > MAX_U128) throw new Error(`${label} must fit in u128.`);
  return text;
}

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

export function canonicalLocalnetTakeExpected(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Exact v3 take terms are required.");
  if (
    !Array.isArray(value.fills) ||
    value.fills.length < 1 ||
    value.fills.length > 4
  )
    throw new Error("Exact v3 take requires between one and four fills.");
  const fills = value.fills.map((fill, index) => {
    if (!fill || typeof fill !== "object" || Array.isArray(fill))
      throw new Error(`Exact v3 take fill ${index} is malformed.`);
    return Object.freeze({
      lockId: canonicalNonzeroFelt(fill.lockId, `fill ${index} lockId`),
      amountA: positiveU128Decimal(fill.amountA, `fill ${index} amountA`),
      amountB: positiveU128Decimal(fill.amountB, `fill ${index} amountB`),
    });
  });
  if (new Set(fills.map((fill) => fill.lockId)).size !== fills.length)
    throw new Error("Exact v3 take contains a duplicate lock id.");
  const expected = Object.freeze({
    tokenA: canonicalNonzeroFelt(value.tokenA, "take tokenA"),
    totalA: positiveU128Decimal(value.totalA, "take totalA"),
    tokenB: canonicalNonzeroFelt(value.tokenB, "take tokenB"),
    totalB: positiveU128Decimal(value.totalB, "take totalB"),
    fills: Object.freeze(fills),
  });
  if (expected.tokenA === expected.tokenB)
    throw new Error("Exact v3 take tokens must differ.");
  const summedA = fills.reduce((sum, fill) => sum + BigInt(fill.amountA), 0n);
  const summedB = fills.reduce((sum, fill) => sum + BigInt(fill.amountB), 0n);
  if (
    summedA !== BigInt(expected.totalA) ||
    summedB !== BigInt(expected.totalB)
  )
    throw new Error("Exact v3 take totals do not match its fills.");
  return expected;
}

export function validateLocalnetTakeObservation(
  take,
  expectedValue,
  toBigInt = (value) => BigInt(value),
) {
  const expected = canonicalLocalnetTakeExpected(expectedValue);
  if (!take || typeof take !== "object" || Array.isArray(take))
    throw new Error("Observed local escrow take is absent or malformed.");
  const expectedFillsDigest = fillsDigest(
    expected.fills.map((fill) => ({
      lockId: fill.lockId,
      amountA: BigInt(fill.amountA),
    })),
  );
  if (
    asBigInt(take.tokenA, "take token A", toBigInt) !==
      asBigInt(expected.tokenA, "expected take token A", toBigInt) ||
    asBigInt(take.totalA, "take total A", toBigInt) !==
      BigInt(expected.totalA) ||
    asBigInt(take.tokenB, "take token B", toBigInt) !==
      asBigInt(expected.tokenB, "expected take token B", toBigInt) ||
    asBigInt(take.totalB, "take total B", toBigInt) !==
      BigInt(expected.totalB) ||
    canonicalDigest(take.fillsDigest, "take fills digest") !==
      expectedFillsDigest ||
    take.fillCount !== expected.fills.length ||
    !Number.isSafeInteger(take.takenAt) ||
    take.takenAt <= 0
  ) {
    throw new Error(
      "The on-chain escrow take does not match the exact expected totals and fills.",
    );
  }
  return take;
}
