import { PrivateIntentError } from "./index.ts";
import type { SolverQuoteV3 } from "./quote-v3.ts";
import {
  assertPriceSchedule,
  evaluatePriceSchedule,
  scheduleUnitPriceE18,
} from "./schedule.ts";

export const RFQ_SELECTION_V3_RULE = "app20/rfq-selection/v3" as const;

export type SelectedFillV3 = Readonly<{
  quote: SolverQuoteV3;
  amountA: bigint;
  amountB: bigint;
}>;

export type SelectFillsV3Result =
  | Readonly<{
      kind: "selected";
      fills: readonly SelectedFillV3[];
      totalB: bigint;
      rule: typeof RFQ_SELECTION_V3_RULE;
    }>
  | Readonly<{
      kind: "refused";
      reason: "insufficient-depth" | "below-floor" | "no-quotes";
    }>;

export type SelectFillsV3Input = Readonly<{
  quotes: readonly SolverQuoteV3[];
  exactSellAmount: bigint;
  floorBuyAmount: bigint;
  maxFills?: number;
}>;

const MAX_U128 = (1n << 128n) - 1n;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function quoteFallback(left: SolverQuoteV3, right: SolverQuoteV3): number {
  const lockOrder = compareText(left.lockId, right.lockId);
  if (lockOrder !== 0) return lockOrder;
  return compareText(left.nonce, right.nonce);
}

function selected(
  fills: readonly SelectedFillV3[],
  floorBuyAmount: bigint,
): SelectFillsV3Result {
  const totalB = fills.reduce((total, fill) => total + fill.amountB, 0n);
  if (totalB < floorBuyAmount) {
    return Object.freeze({ kind: "refused", reason: "below-floor" });
  }
  return Object.freeze({
    kind: "selected",
    fills: Object.freeze(
      fills.map((fill) => Object.freeze({ ...fill })),
    ),
    totalB,
    rule: RFQ_SELECTION_V3_RULE,
  });
}

export function selectFillsV3(input: SelectFillsV3Input): SelectFillsV3Result {
  if (
    typeof input.exactSellAmount !== "bigint" ||
    input.exactSellAmount <= 0n ||
    input.exactSellAmount > MAX_U128
  ) {
    throw new PrivateIntentError(
      "exactSellAmount must be a positive u128 value.",
    );
  }
  if (typeof input.floorBuyAmount !== "bigint" || input.floorBuyAmount < 0n) {
    throw new PrivateIntentError(
      "floorBuyAmount must be a non-negative bigint.",
    );
  }
  const maxFills = input.maxFills ?? 4;
  if (!Number.isSafeInteger(maxFills) || maxFills < 1 || maxFills > 4) {
    throw new PrivateIntentError("maxFills must be an integer in [1, 4].");
  }
  if (input.quotes.length === 0) {
    return Object.freeze({ kind: "refused", reason: "no-quotes" });
  }
  for (const quote of input.quotes) assertPriceSchedule(quote.schedule);

  const singleCandidates = input.quotes
    .filter((quote) => {
      const first = quote.schedule[0];
      const last = quote.schedule[quote.schedule.length - 1];
      return (
        first !== undefined &&
        last !== undefined &&
        first.a <= input.exactSellAmount &&
        input.exactSellAmount <= last.a
      );
    })
    .map((quote) => ({
      quote,
      amountA: input.exactSellAmount,
      amountB: evaluatePriceSchedule(quote.schedule, input.exactSellAmount),
    }))
    .sort((left, right) => {
      if (left.amountB !== right.amountB) {
        return left.amountB > right.amountB ? -1 : 1;
      }
      if (left.quote.quoteExpiresAt !== right.quote.quoteExpiresAt) {
        return left.quote.quoteExpiresAt > right.quote.quoteExpiresAt ? -1 : 1;
      }
      const solverOrder = compareText(
        left.quote.solverId,
        right.quote.solverId,
      );
      if (solverOrder !== 0) return solverOrder;
      return quoteFallback(left.quote, right.quote);
    });
  const bestSingle = singleCandidates[0];
  if (bestSingle) return selected([bestSingle], input.floorBuyAmount);

  const ordered = input.quotes
    .map((quote) => {
      const last = quote.schedule[quote.schedule.length - 1]!;
      return {
        quote,
        unitPriceE18: scheduleUnitPriceE18(quote.schedule, last.a),
      };
    })
    .sort((left, right) => {
      if (left.unitPriceE18 !== right.unitPriceE18) {
        return left.unitPriceE18 > right.unitPriceE18 ? -1 : 1;
      }
      const solverOrder = compareText(
        left.quote.solverId,
        right.quote.solverId,
      );
      if (solverOrder !== 0) return solverOrder;
      return quoteFallback(left.quote, right.quote);
    });

  let remainder = input.exactSellAmount;
  const fills: SelectedFillV3[] = [];
  for (const { quote } of ordered) {
    if (remainder === 0n || fills.length >= maxFills) break;
    const first = quote.schedule[0]!;
    const last = quote.schedule[quote.schedule.length - 1]!;
    const amountA = remainder < last.a ? remainder : last.a;
    if (amountA < first.a) continue;
    fills.push({
      quote,
      amountA,
      amountB: evaluatePriceSchedule(quote.schedule, amountA),
    });
    remainder -= amountA;
  }
  if (remainder > 0n) {
    return Object.freeze({ kind: "refused", reason: "insufficient-depth" });
  }
  return selected(fills, input.floorBuyAmount);
}
