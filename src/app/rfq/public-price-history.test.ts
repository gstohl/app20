import { describe, expect, it } from "vitest";
import {
  aggregatePublicCandles,
  coinGeckoStrkOhlcUrl,
  orientPublicCandle,
  parseCoinGeckoOhlc,
  summarizePublicCandles,
  type PublicPriceCandle,
} from "./public-price-history";

const response = [
  [3000, 0.46, 0.52, 0.44, 0.5],
  [1000, 0.4, 0.43, 0.39, 0.42],
  [2000, 0.42, 0.47, 0.41, 0.46],
  [2000, 0.42, 0.48, 0.4, 0.47],
  ["bad", 1, 1, 1, 1],
];

describe("public OHLC history", () => {
  it("parses, sorts, validates, and de-duplicates CoinGecko candles", () => {
    expect(parseCoinGeckoOhlc(response)).toEqual([
      { timestamp: 1000, open: 0.4, high: 0.43, low: 0.39, close: 0.42 },
      { timestamp: 2000, open: 0.42, high: 0.47, low: 0.41, close: 0.46 },
      { timestamp: 3000, open: 0.46, high: 0.52, low: 0.44, close: 0.5 },
    ]);
    expect(() => parseCoinGeckoOhlc([[1000, 1, 0.5, 0.8, 0.9]])).toThrow(
      "too few valid candles",
    );
  });

  it("orients and summarizes OHLC data for either desk direction", () => {
    const candles = parseCoinGeckoOhlc(response);
    const strkUsdc = summarizePublicCandles(candles, "STRK_USDC");
    expect(strkUsdc).toMatchObject({
      first: 0.4,
      latest: 0.5,
      low: 0.39,
      high: 0.52,
    });
    expect(strkUsdc.changePercent).toBeCloseTo(25);

    expect(
      orientPublicCandle(candles[0] as PublicPriceCandle, "USDC_STRK"),
    ).toMatchObject({
      open: 2.5,
      high: 1 / 0.39,
      low: 1 / 0.43,
      close: 1 / 0.42,
    });
    expect(
      summarizePublicCandles(candles, "USDC_STRK").changePercent,
    ).toBeCloseTo(-20);
  });

  it("builds the OHLC endpoint and truthfully aggregates dense candles", () => {
    expect(coinGeckoStrkOhlcUrl("7")).toBe(
      "https://api.coingecko.com/api/v3/coins/starknet/ohlc?vs_currency=usd&days=7",
    );
    const candles = Array.from({ length: 10 }, (_, index) => {
      const open = index + 1;
      return {
        timestamp: index + 1,
        open,
        high: open + 0.5,
        low: open - 0.5,
        close: open + 0.25,
      };
    });
    const aggregated = aggregatePublicCandles(candles, 3);
    expect(aggregated).toHaveLength(3);
    expect(aggregated[0]).toEqual({
      timestamp: 4,
      open: 1,
      high: 4.5,
      low: 0.5,
      close: 4.25,
    });
    expect(aggregated.at(-1)?.close).toBe(10.25);
  });
});
