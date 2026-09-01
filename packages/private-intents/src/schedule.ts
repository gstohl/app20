import { PrivateIntentError } from "./index.ts";

export type PriceSchedulePoint = Readonly<{ a: bigint; b: bigint }>;
export type PriceSchedule = readonly PriceSchedulePoint[];

const MAX_U128 = (1n << 128n) - 1n;
const E18 = 10n ** 18n;

function badSchedule(message: string): never {
  throw new PrivateIntentError(`BAD_SCHEDULE: ${message}`);
}

export function assertPriceSchedule(schedule: PriceSchedule): void {
  if (!Array.isArray(schedule) || schedule.length < 1 || schedule.length > 4) {
    badSchedule("price schedule must contain 1 to 4 points.");
  }
  let previous: PriceSchedulePoint | undefined;
  for (const [index, point] of schedule.entries()) {
    if (
      !point ||
      typeof point !== "object" ||
      typeof point.a !== "bigint" ||
      typeof point.b !== "bigint" ||
      point.a <= 0n ||
      point.b <= 0n ||
      point.a > MAX_U128 ||
      point.b > MAX_U128
    ) {
      badSchedule(`point ${index} must contain positive u128 a and b values.`);
    }
    if (previous && point.a <= previous.a) {
      badSchedule("a values must be strictly increasing.");
    }
    if (previous && point.b < previous.b) {
      badSchedule("b values must be non-decreasing.");
    }
    previous = point;
  }
}

export function evaluatePriceSchedule(
  schedule: PriceSchedule,
  amountA: bigint,
): bigint {
  assertPriceSchedule(schedule);
  const first = schedule[0]!;
  const last = schedule[schedule.length - 1]!;
  if (typeof amountA !== "bigint" || amountA < first.a || amountA > last.a) {
    throw new PrivateIntentError(
      "OUT_OF_SCHEDULE: amount is outside the price schedule domain.",
    );
  }
  if (schedule.length === 1) return first.b;
  for (let index = 0; index < schedule.length - 1; index += 1) {
    const left = schedule[index]!;
    const right = schedule[index + 1]!;
    if (amountA <= right.a) {
      return (
        left.b + ((amountA - left.a) * (right.b - left.b)) / (right.a - left.a)
      );
    }
  }
  throw new PrivateIntentError(
    "OUT_OF_SCHEDULE: amount is outside the price schedule domain.",
  );
}

export function invertPriceSchedule(
  schedule: PriceSchedule,
  targetB: bigint,
): bigint | null {
  assertPriceSchedule(schedule);
  if (typeof targetB !== "bigint") {
    throw new PrivateIntentError("targetB must be a bigint.");
  }
  const first = schedule[0]!;
  const last = schedule[schedule.length - 1]!;
  if (targetB <= first.b) return first.a;
  if (targetB > last.b) return null;

  let low = first.a;
  let high = last.a;
  while (low < high) {
    const middle = low + (high - low) / 2n;
    if (evaluatePriceSchedule(schedule, middle) >= targetB) high = middle;
    else low = middle + 1n;
  }
  return low;
}

export function scheduleUnitPriceE18(
  schedule: PriceSchedule,
  amountA: bigint,
): bigint {
  return (evaluatePriceSchedule(schedule, amountA) * E18) / amountA;
}
