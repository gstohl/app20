import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertPriceSchedule,
  evaluatePriceSchedule,
  invertPriceSchedule,
  scheduleUnitPriceE18,
  type PriceSchedule,
} from "./schedule.ts";

type VectorPoint = { a: string; b: string };
type ScheduleVectors = {
  evaluate: readonly {
    name: string;
    points: readonly VectorPoint[];
    amount: string;
    expected: string;
  }[];
  invalid: readonly {
    name: string;
    points: readonly VectorPoint[];
    amount: string;
    error: string;
  }[];
};

const vectors = JSON.parse(
  readFileSync(
    new URL("./fixtures/schedule-vectors.json", import.meta.url),
    "utf8",
  ),
) as ScheduleVectors;

function schedule(points: readonly VectorPoint[]): PriceSchedule {
  return points.map((point) => ({ a: BigInt(point.a), b: BigInt(point.b) }));
}

describe("RFQ v3 price schedules", () => {
  for (const vector of vectors.evaluate) {
    it(`matches the shared Cairo vector ${vector.name}`, () => {
      expect(
        evaluatePriceSchedule(schedule(vector.points), BigInt(vector.amount)),
      ).toBe(BigInt(vector.expected));
    });
  }

  for (const vector of vectors.invalid) {
    it(`rejects the shared Cairo vector ${vector.name}`, () => {
      expect(() =>
        evaluatePriceSchedule(schedule(vector.points), BigInt(vector.amount)),
      ).toThrow(vector.error);
    });
  }

  it("enforces positive u128 points", () => {
    expect(() => assertPriceSchedule([{ a: 1n << 128n, b: 1n }])).toThrow(
      /BAD_SCHEDULE/,
    );
    expect(() => assertPriceSchedule([{ a: 1n, b: 1n << 128n }])).toThrow(
      /BAD_SCHEDULE/,
    );
  });

  it("inverts to the smallest amount whose floored evaluation meets target", () => {
    const tiered = [
      { a: 3n, b: 10n },
      { a: 6n, b: 11n },
      { a: 10n, b: 20n },
    ] as const;
    expect(invertPriceSchedule(tiered, 10n)).toBe(3n);
    expect(invertPriceSchedule(tiered, 11n)).toBe(6n);
    expect(invertPriceSchedule(tiered, 12n)).toBe(7n);
    expect(invertPriceSchedule(tiered, 20n)).toBe(10n);
    expect(invertPriceSchedule(tiered, 21n)).toBeNull();
  });

  it("calculates integer unit prices at 18-decimal precision", () => {
    expect(
      scheduleUnitPriceE18(
        [
          { a: 2n, b: 5n },
          { a: 4n, b: 10n },
        ],
        3n,
      ),
    ).toBe(2_333_333_333_333_333_333n);
  });
});
