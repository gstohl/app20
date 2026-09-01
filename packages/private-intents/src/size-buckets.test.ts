import { describe, expect, it } from "vitest";
import {
  SIZE_BUCKET_LADDER,
  assertLadderBucket,
  bucketForAmount,
  formatSizeBucketLabel,
} from "./size-buckets.ts";

describe("RFQ v3 size buckets", () => {
  it("contains the fixed STRK and USDC base-unit ladders", () => {
    expect(SIZE_BUCKET_LADDER.STRK).toHaveLength(9);
    expect(SIZE_BUCKET_LADDER.STRK[0]).toEqual({
      min: 50_000_000_000_000_000n,
      max: 100_000_000_000_000_000n,
    });
    expect(SIZE_BUCKET_LADDER.STRK.at(-1)).toEqual({
      min: 25_000_000_000_000_000_000n,
      max: 50_000_000_000_000_000_000n,
    });
    expect(SIZE_BUCKET_LADDER.USDC[0]).toEqual({
      min: 100_000n,
      max: 200_000n,
    });
    expect(SIZE_BUCKET_LADDER.USDC.at(-1)).toEqual({
      min: 50_000_000n,
      max: 100_000_000n,
    });
    expect(Object.isFrozen(SIZE_BUCKET_LADDER.STRK[0])).toBe(true);
  });

  it("assigns shared boundaries to the lower rung", () => {
    expect(bucketForAmount("STRK", 50_000_000_000_000_000n)).toBe(
      SIZE_BUCKET_LADDER.STRK[0],
    );
    expect(bucketForAmount("STRK", 100_000_000_000_000_000n)).toBe(
      SIZE_BUCKET_LADDER.STRK[0],
    );
    expect(bucketForAmount("STRK", 100_000_000_000_000_001n)).toBe(
      SIZE_BUCKET_LADDER.STRK[1],
    );
  });

  it("refuses amounts outside the ladder and non-ladder maker buckets", () => {
    expect(() => bucketForAmount("USDC", 99_999n)).toThrow(/outside/);
    expect(() => bucketForAmount("USDC", 100_000_001n)).toThrow(/outside/);
    expect(() =>
      assertLadderBucket("USDC", { min: 100_001n, max: 200_000n }),
    ).toThrow(/reviewed ladder/);
    expect(() =>
      assertLadderBucket("USDC", SIZE_BUCKET_LADDER.USDC[3]!),
    ).not.toThrow();
  });

  it("formats compact UI labels without floating-point arithmetic", () => {
    expect(formatSizeBucketLabel("STRK", SIZE_BUCKET_LADDER.STRK[3]!)).toBe(
      "0.5–1 STRK",
    );
    expect(formatSizeBucketLabel("USDC", SIZE_BUCKET_LADDER.USDC[3]!)).toBe(
      "1–2.5 USDC",
    );
  });
});
