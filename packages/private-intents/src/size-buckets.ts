import { PrivateIntentError } from "./index.ts";

export type SizeBucketSymbol = "STRK" | "USDC";
export type SizeBucket = Readonly<{ min: bigint; max: bigint }>;

const STRK = 10n ** 18n;
const USDC = 10n ** 6n;

export const SIZE_BUCKET_LADDER: Readonly<
  Record<SizeBucketSymbol, readonly SizeBucket[]>
> = Object.freeze({
  STRK: Object.freeze([
    Object.freeze({ min: STRK / 20n, max: STRK / 10n }),
    Object.freeze({ min: STRK / 10n, max: STRK / 4n }),
    Object.freeze({ min: STRK / 4n, max: STRK / 2n }),
    Object.freeze({ min: STRK / 2n, max: STRK }),
    Object.freeze({ min: STRK, max: (STRK * 5n) / 2n }),
    Object.freeze({ min: (STRK * 5n) / 2n, max: STRK * 5n }),
    Object.freeze({ min: STRK * 5n, max: STRK * 10n }),
    Object.freeze({ min: STRK * 10n, max: STRK * 25n }),
    Object.freeze({ min: STRK * 25n, max: STRK * 50n }),
  ]),
  USDC: Object.freeze([
    Object.freeze({ min: USDC / 10n, max: USDC / 5n }),
    Object.freeze({ min: USDC / 5n, max: USDC / 2n }),
    Object.freeze({ min: USDC / 2n, max: USDC }),
    Object.freeze({ min: USDC, max: (USDC * 5n) / 2n }),
    Object.freeze({ min: (USDC * 5n) / 2n, max: USDC * 5n }),
    Object.freeze({ min: USDC * 5n, max: USDC * 10n }),
    Object.freeze({ min: USDC * 10n, max: USDC * 25n }),
    Object.freeze({ min: USDC * 25n, max: USDC * 50n }),
    Object.freeze({ min: USDC * 50n, max: USDC * 100n }),
  ]),
});

function ladderFor(symbol: SizeBucketSymbol): readonly SizeBucket[] {
  const ladder = SIZE_BUCKET_LADDER[symbol];
  if (!ladder) {
    throw new PrivateIntentError("Size bucket symbol must be STRK or USDC.");
  }
  return ladder;
}

export function bucketForAmount(
  symbol: SizeBucketSymbol,
  amount: bigint,
): SizeBucket {
  if (typeof amount !== "bigint" || amount <= 0n) {
    throw new PrivateIntentError("Size bucket amount must be positive.");
  }
  const ladder = ladderFor(symbol);
  const bucket = ladder.find(
    (candidate, index) =>
      amount <= candidate.max &&
      (index === 0 ? amount >= candidate.min : amount > candidate.min),
  );
  if (!bucket) {
    throw new PrivateIntentError(
      `${symbol} amount is outside the reviewed size bucket ladder.`,
    );
  }
  return bucket;
}

export function assertLadderBucket(
  symbol: SizeBucketSymbol,
  bucket: SizeBucket,
): void {
  const ladder = ladderFor(symbol);
  if (
    !bucket ||
    typeof bucket.min !== "bigint" ||
    typeof bucket.max !== "bigint" ||
    !ladder.some(
      (candidate) =>
        candidate.min === bucket.min && candidate.max === bucket.max,
    )
  ) {
    throw new PrivateIntentError(
      `${symbol} size bucket must use the reviewed ladder.`,
    );
  }
}

function formatBaseUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function formatSizeBucketLabel(
  symbol: SizeBucketSymbol,
  bucket: SizeBucket,
  decimals = symbol === "STRK" ? 18 : 6,
): string {
  assertLadderBucket(symbol, bucket);
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new PrivateIntentError(
      "Size bucket label decimals must be an integer in [0, 255].",
    );
  }
  const minimum = formatBaseUnits(bucket.min, decimals);
  const maximum = formatBaseUnits(bucket.max, decimals);
  return `${minimum}–${maximum} ${symbol}`;
}
