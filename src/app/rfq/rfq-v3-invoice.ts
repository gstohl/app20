import {
  bucketForAmount,
  evaluatePriceSchedule,
  invertPriceSchedule,
  scheduleUnitPriceE18,
  type SelectedFillV3,
  type SelectFillsV3Result,
  type SizeBucket,
  type SolverQuoteV3,
} from "@app20/private-intents";

const E18 = 10n ** 18n;
const STRK_SCALE = 10n ** 18n;
const USDC_SCALE = 10n ** 6n;

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n)
    throw new Error("Invoice sizing denominator is invalid.");
  return (numerator + denominator - 1n) / denominator;
}

export type InvoiceSellEstimate = Readonly<{
  estimatedSellAmount: bigint;
  bucket: SizeBucket;
}>;

/** Estimates STRK base units at median mid and adds the fixed two-percent buffer. */
export function estimateInvoiceSellSize(input: {
  targetBuyBaseUnits: bigint;
  medianMidE18: bigint;
}): InvoiceSellEstimate {
  if (
    typeof input.targetBuyBaseUnits !== "bigint" ||
    input.targetBuyBaseUnits <= 0n
  ) {
    throw new Error("Invoice target must be a positive bigint.");
  }
  if (typeof input.medianMidE18 !== "bigint" || input.medianMidE18 <= 0n) {
    throw new Error(
      "A positive verified maker median mid is required for invoice sizing.",
    );
  }
  const atMid = ceilDivide(
    input.targetBuyBaseUnits * STRK_SCALE * E18,
    USDC_SCALE * input.medianMidE18,
  );
  const estimatedSellAmount = ceilDivide(atMid * 102n, 100n);
  return Object.freeze({
    estimatedSellAmount,
    bucket: bucketForAmount("STRK", estimatedSellAmount),
  });
}

export type InvoiceSelectedFill = Readonly<{
  quote: SolverQuoteV3;
  lockId: string;
  amountA: bigint;
  amountB: bigint;
}>;

export type InvoiceExactSizing = Readonly<{
  exactSellAmount: bigint;
  totalBuyAmount: bigint;
  fills: readonly InvoiceSelectedFill[];
}>;

/**
 * Finds the deterministic minimum used by invoice mode:
 *
 * 1. Every selected lock starts at its schedule minimum (Take cannot send zero
 *    to a listed fill).
 * 2. Locks are considered by unit price at their selected cap, best first.
 * 3. Each lock is grown only as far as needed, using `invertPriceSchedule`;
 *    if it cannot finish the target it is grown to its selected cap and the
 *    next lock is considered.
 * 4. The first allocation reaching the target is returned. If all selected
 *    caps cannot reach it, the quoted bucket rung is refused.
 *
 * This keeps the inverse deterministic and aligned with the v3 split ordering;
 * no amount or floor is sent back to a maker.
 */
export function sizeInvoiceFromSelectedFills(input: {
  targetBuyBaseUnits: bigint;
  selection: SelectFillsV3Result;
  bucket?: SizeBucket;
}): InvoiceExactSizing {
  if (
    typeof input.targetBuyBaseUnits !== "bigint" ||
    input.targetBuyBaseUnits <= 0n
  ) {
    throw new Error("Invoice target must be a positive bigint.");
  }
  if (input.selection.kind !== "selected") {
    throw new Error(
      `Invoice sizing requires selected fills; selection refused: ${input.selection.reason}.`,
    );
  }
  if (input.selection.fills.length < 1 || input.selection.fills.length > 4) {
    throw new Error(
      "Invoice sizing requires between one and four selected fills.",
    );
  }
  const ordered = [...input.selection.fills].sort((left, right) => {
    const leftPrice = scheduleUnitPriceE18(left.quote.schedule, left.amountA);
    const rightPrice = scheduleUnitPriceE18(
      right.quote.schedule,
      right.amountA,
    );
    if (leftPrice !== rightPrice) return leftPrice > rightPrice ? -1 : 1;
    return left.quote.solverId.localeCompare(right.quote.solverId);
  });
  const allocations = ordered.map((fill) => {
    const minimum = fill.quote.schedule[0]!;
    if (fill.amountA < minimum.a) {
      throw new Error(
        "A selected invoice fill is outside its signed schedule.",
      );
    }
    return {
      fill,
      amountA: minimum.a,
      amountB: minimum.b,
    };
  });
  let totalB = allocations.reduce((sum, fill) => sum + fill.amountB, 0n);
  for (const allocation of allocations) {
    if (totalB >= input.targetBuyBaseUnits) break;
    const withoutCurrent = totalB - allocation.amountB;
    const neededFromCurrent = input.targetBuyBaseUnits - withoutCurrent;
    const inverted = invertPriceSchedule(
      allocation.fill.quote.schedule,
      neededFromCurrent,
    );
    const candidate =
      inverted !== null && inverted <= allocation.fill.amountA
        ? inverted
        : allocation.fill.amountA;
    allocation.amountA = candidate;
    allocation.amountB = evaluatePriceSchedule(
      allocation.fill.quote.schedule,
      candidate,
    );
    totalB = withoutCurrent + allocation.amountB;
  }
  if (totalB < input.targetBuyBaseUnits) {
    throw new Error("No quoted bucket rung can reach the invoice target.");
  }
  const exactSellAmount = allocations.reduce(
    (sum, allocation) => sum + allocation.amountA,
    0n,
  );
  if (
    input.bucket &&
    (exactSellAmount < input.bucket.min || exactSellAmount > input.bucket.max)
  ) {
    throw new Error(
      "The exact invoice size falls outside the quoted bucket rung.",
    );
  }
  const fills = allocations.map((allocation) =>
    Object.freeze({
      quote: allocation.fill.quote,
      lockId: allocation.fill.quote.lockId,
      amountA: allocation.amountA,
      amountB: allocation.amountB,
    }),
  );
  return Object.freeze({
    exactSellAmount,
    totalBuyAmount: fills.reduce((sum, fill) => sum + fill.amountB, 0n),
    fills: Object.freeze(fills),
  });
}

export const chooseInvoiceSellSize = sizeInvoiceFromSelectedFills;

export function invoiceSelectionFromSizing(
  sizing: InvoiceExactSizing,
): readonly SelectedFillV3[] {
  return Object.freeze(
    sizing.fills.map(({ quote, amountA, amountB }) =>
      Object.freeze({ quote, amountA, amountB }),
    ),
  );
}
