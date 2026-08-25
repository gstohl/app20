import type { LocalnetMarketPairId } from "./LocalnetPrivateIntentDesk";

export type PublicPriceRange = "1" | "7" | "30";

export type PublicPriceCandle = Readonly<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}>;

export type PublicPriceSummary = Readonly<{
  first: number;
  latest: number;
  low: number;
  high: number;
  changePercent: number;
}>;

export const PUBLIC_PRICE_RANGES: ReadonlyArray<
  Readonly<{ value: PublicPriceRange; label: string }>
> = [
  { value: "1", label: "1D" },
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
];

export function coinGeckoStrkOhlcUrl(range: PublicPriceRange): string {
  const query = new URLSearchParams({
    vs_currency: "usd",
    days: range,
  });
  return `https://api.coingecko.com/api/v3/coins/starknet/ohlc?${query}`;
}

export function parseCoinGeckoOhlc(value: unknown): PublicPriceCandle[] {
  if (!Array.isArray(value)) {
    throw new Error("The public OHLC response is not an array.");
  }

  const candles = value.flatMap((entry): PublicPriceCandle[] => {
    if (!Array.isArray(entry) || entry.length < 5) return [];
    const [timestamp, open, high, low, close] = entry;
    if (
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      typeof open !== "number" ||
      !Number.isFinite(open) ||
      open <= 0 ||
      typeof high !== "number" ||
      !Number.isFinite(high) ||
      high <= 0 ||
      typeof low !== "number" ||
      !Number.isFinite(low) ||
      low <= 0 ||
      typeof close !== "number" ||
      !Number.isFinite(close) ||
      close <= 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      high < low
    ) {
      return [];
    }
    return [{ timestamp, open, high, low, close }];
  });

  if (candles.length < 2) {
    throw new Error("The public OHLC response has too few valid candles.");
  }

  return candles
    .sort((left, right) => left.timestamp - right.timestamp)
    .filter(
      (candle, index, sorted) =>
        index === 0 || candle.timestamp !== sorted[index - 1]?.timestamp,
    );
}

export function orientPublicCandle(
  candle: PublicPriceCandle,
  pairId: LocalnetMarketPairId,
): PublicPriceCandle {
  if (pairId === "STRK_USDC") return candle;
  return {
    timestamp: candle.timestamp,
    open: 1 / candle.open,
    high: 1 / candle.low,
    low: 1 / candle.high,
    close: 1 / candle.close,
  };
}

export function summarizePublicCandles(
  candles: readonly PublicPriceCandle[],
  pairId: LocalnetMarketPairId,
): PublicPriceSummary {
  if (candles.length < 2) {
    throw new Error("At least two public OHLC candles are required.");
  }
  const oriented = candles.map((candle) => orientPublicCandle(candle, pairId));
  const first = (oriented[0] as PublicPriceCandle).open;
  const latest = (oriented.at(-1) as PublicPriceCandle).close;
  return {
    first,
    latest,
    low: Math.min(...oriented.map((candle) => candle.low)),
    high: Math.max(...oriented.map((candle) => candle.high)),
    changePercent: ((latest - first) / first) * 100,
  };
}

export function aggregatePublicCandles(
  candles: readonly PublicPriceCandle[],
  maximumCandles = 96,
): PublicPriceCandle[] {
  if (!Number.isInteger(maximumCandles) || maximumCandles < 2) {
    throw new Error("maximumCandles must be an integer of at least 2.");
  }
  if (candles.length <= maximumCandles) return [...candles];

  const bucketSize = Math.ceil(candles.length / maximumCandles);
  const aggregated: PublicPriceCandle[] = [];
  for (let index = 0; index < candles.length; index += bucketSize) {
    const bucket = candles.slice(index, index + bucketSize);
    const first = bucket[0] as PublicPriceCandle;
    const last = bucket.at(-1) as PublicPriceCandle;
    aggregated.push({
      timestamp: last.timestamp,
      open: first.open,
      high: Math.max(...bucket.map((candle) => candle.high)),
      low: Math.min(...bucket.map((candle) => candle.low)),
      close: last.close,
    });
  }
  return aggregated;
}
