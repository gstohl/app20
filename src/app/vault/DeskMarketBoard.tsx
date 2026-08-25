"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { LocalnetMarketPairId } from "./LocalnetPrivateIntentDesk";
import { deskMarketModel, LOCALNET_DESK_SPREAD_BPS } from "./desk-market-model";
import {
  aggregatePublicCandles,
  coinGeckoStrkOhlcUrl,
  orientPublicCandle,
  parseCoinGeckoOhlc,
  PUBLIC_PRICE_RANGES,
  summarizePublicCandles,
  type PublicPriceCandle,
  type PublicPriceRange,
} from "./public-price-history";
import styles from "./vault.module.css";

export type DeskMarketBoardProps = Readonly<{
  pairId: LocalnetMarketPairId;
}>;

type PriceState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready"; candles: readonly PublicPriceCandle[] }>
  | Readonly<{ kind: "error"; message: string }>;

type ChartCandle = PublicPriceCandle &
  Readonly<{
    x: number;
    openY: number;
    highY: number;
    lowY: number;
    closeY: number;
  }>;

const DEFAULT_CHART_SIZE: Readonly<{ width: number; height: number }> =
  Object.freeze({ width: 760, height: 320 });

function formatPrice(value: number): string {
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(5);
  return value.toFixed(6);
}

function formatCompactPrice(value: number): string {
  return value >= 1 ? value.toFixed(3) : value.toFixed(4);
}

function formatChange(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatChartTime(timestamp: number, range: PublicPriceRange): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(range === "1" ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Public price data is unavailable.";
}

export default function DeskMarketBoard({ pairId }: DeskMarketBoardProps) {
  const model = deskMarketModel(pairId);
  const [range, setRange] = useState<PublicPriceRange>("1");
  const [refreshKey, setRefreshKey] = useState(0);
  const [priceState, setPriceState] = useState<PriceState>({ kind: "loading" });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [chartSize, setChartSize] = useState(DEFAULT_CHART_SIZE);
  const chartRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setPriceState({ kind: "loading" });
    setHoveredIndex(null);
    void fetch(coinGeckoStrkOhlcUrl(range), {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Public price service returned ${response.status}.`);
        }
        const body: unknown = await response.json();
        setPriceState({ kind: "ready", candles: parseCoinGeckoOhlc(body) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPriceState({ kind: "error", message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [range, refreshKey]);

  useEffect(() => {
    if (priceState.kind !== "ready" || !chartRef.current) return;
    const chartElement = chartRef.current;
    const updateSize = () => {
      const bounds = chartElement.getBoundingClientRect();
      const width = Math.max(320, Math.round(bounds.width));
      const height = Math.max(220, Math.round(bounds.height));
      setChartSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(chartElement);
    return () => observer.disconnect();
  }, [priceState.kind]);

  const chart = useMemo(() => {
    if (priceState.kind !== "ready") return null;
    const plotLeft = Math.max(50, Math.min(64, chartSize.width * 0.14));
    const plotRight = chartSize.width - 18;
    const plotTop = 20;
    const plotBottom = chartSize.height - 44;
    const plotWidth = plotRight - plotLeft;
    const maximumCandles = Math.max(24, Math.floor(plotWidth / 5));
    const oriented = aggregatePublicCandles(
      priceState.candles,
      maximumCandles,
    ).map((candle) => orientPublicCandle(candle, pairId));
    const rawLow = Math.min(...oriented.map((candle) => candle.low));
    const rawHigh = Math.max(...oriented.map((candle) => candle.high));
    const rawSpan = rawHigh - rawLow;
    const padding =
      rawSpan > 0 ? rawSpan * 0.08 : Math.max(rawHigh * 0.02, 0.000001);
    const low = Math.max(0, rawLow - padding);
    const high = rawHigh + padding;
    const span = high - low;
    const firstTimestamp = oriented[0]?.timestamp ?? 0;
    const lastTimestamp = oriented.at(-1)?.timestamp ?? firstTimestamp + 1;
    const timestampSpan = Math.max(lastTimestamp - firstTimestamp, 1);
    const candleWidth = Math.min(
      9,
      Math.max(2.5, (plotWidth / oriented.length) * 0.62),
    );
    const candleLeft = plotLeft + candleWidth / 2;
    const candleRight = plotRight - candleWidth / 2;
    const toY = (price: number) =>
      plotBottom - ((plotBottom - plotTop) * (price - low)) / span;
    const candles: ChartCandle[] = oriented.map((candle) => ({
      ...candle,
      x:
        candleLeft +
        ((candleRight - candleLeft) * (candle.timestamp - firstTimestamp)) /
          timestampSpan,
      openY: toY(candle.open),
      highY: toY(candle.high),
      lowY: toY(candle.low),
      closeY: toY(candle.close),
    }));
    return {
      width: chartSize.width,
      height: chartSize.height,
      plotLeft,
      plotRight,
      plotTop,
      plotBottom,
      candles,
      candleWidth,
      axisLevels: Array.from({ length: 5 }, (_, index) => {
        const price = low + ((high - low) * index) / 4;
        return { price, y: toY(price) };
      }),
      summary: summarizePublicCandles(priceState.candles, pairId),
      firstTimestamp,
      lastTimestamp,
      lastCloseY: candles.at(-1)?.closeY ?? plotBottom,
    };
  }, [chartSize, pairId, priceState]);

  const activeCandle = chart
    ? chart.candles[hoveredIndex ?? chart.candles.length - 1]
    : undefined;
  const quoteUnit = pairId === "STRK_USDC" ? "USDC / STRK" : "STRK / USDC";
  const pairLabel = pairId === "STRK_USDC" ? "STRK / USDC" : "USDC / STRK";

  function selectHoveredCandle(event: PointerEvent<SVGSVGElement>) {
    if (!chart) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX =
      ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * chart.width;
    const ratio = Math.min(
      1,
      Math.max(0, (svgX - chart.plotLeft) / (chart.plotRight - chart.plotLeft)),
    );
    setHoveredIndex(Math.round(ratio * (chart.candles.length - 1)));
  }

  return (
    <div className={styles.marketBoard}>
      <section className={styles.marketStats} aria-label="Desk market summary">
        <div>
          <span>PUBLIC SPOT</span>
          <strong>
            {chart
              ? formatPrice(chart.summary.latest)
              : priceState.kind === "error"
                ? "—"
                : "LOADING"}
          </strong>
          <small>{quoteUnit} · CoinGecko</small>
        </div>
        <div>
          <span>
            {PUBLIC_PRICE_RANGES.find((item) => item.value === range)?.label}{" "}
            CHANGE
          </span>
          <strong
            className={
              chart
                ? chart.summary.changePercent >= 0
                  ? styles.marketPositive
                  : styles.marketNegative
                : undefined
            }
          >
            {chart ? formatChange(chart.summary.changePercent) : "—"}
          </strong>
          <small>Public market context</small>
        </div>
        <div>
          <span>RANGE LOW / HIGH</span>
          <strong>
            {chart
              ? `${formatCompactPrice(chart.summary.low)} / ${formatCompactPrice(chart.summary.high)}`
              : "— / —"}
          </strong>
          <small>{quoteUnit}</small>
        </div>
        <div>
          <span>PRIVATE DESK EDGE</span>
          <strong>{LOCALNET_DESK_SPREAD_BPS} BPS</strong>
          <small>Applied by signed quote</small>
        </div>
      </section>

      <div className={styles.marketDataGrid}>
        <section
          className={styles.executionChart}
          aria-labelledby="price-chart-title"
        >
          <header className={styles.marketSectionHeader}>
            <div>
              <span>PUBLIC OHLC · COINGECKO</span>
              <h3 id="price-chart-title">{pairLabel} candlesticks</h3>
            </div>
            <div
              className={styles.priceRangeTabs}
              aria-label="Price chart range"
            >
              {PUBLIC_PRICE_RANGES.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  aria-pressed={range === item.value}
                  onClick={() => setRange(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </header>

          <div className={styles.chartFrame}>
            {chart ? (
              <svg
                ref={chartRef}
                className={styles.marketChart}
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                role="img"
                aria-labelledby="price-chart-title price-chart-description"
                preserveAspectRatio="xMidYMid meet"
                onPointerMove={selectHoveredCandle}
                onPointerLeave={() => setHoveredIndex(null)}
              >
                <desc id="price-chart-description">
                  Public {quoteUnit} OHLC candlesticks from CoinGecko for the
                  selected time range. Private APP20 quotes and fills are not
                  plotted.
                </desc>
                {chart.axisLevels.map(({ price, y }) => (
                  <g key={price}>
                    <line
                      className={styles.chartGridLine}
                      x1={chart.plotLeft}
                      x2={chart.plotRight}
                      y1={y}
                      y2={y}
                    />
                    <text
                      className={styles.chartAxisText}
                      x={chart.plotLeft - 10}
                      y={y + 3}
                      textAnchor="end"
                    >
                      {formatPrice(price)}
                    </text>
                  </g>
                ))}
                <line
                  className={styles.chartLastPriceLine}
                  x1={chart.plotLeft}
                  x2={chart.plotRight}
                  y1={chart.lastCloseY}
                  y2={chart.lastCloseY}
                />
                {chart.candles.map((candle) => {
                  const rising = candle.close >= candle.open;
                  return (
                    <g key={candle.timestamp}>
                      <line
                        className={
                          rising
                            ? styles.chartCandleWickUp
                            : styles.chartCandleWickDown
                        }
                        x1={candle.x}
                        x2={candle.x}
                        y1={candle.highY}
                        y2={candle.lowY}
                      />
                      <rect
                        className={
                          rising
                            ? styles.chartCandleBodyUp
                            : styles.chartCandleBodyDown
                        }
                        x={candle.x - chart.candleWidth / 2}
                        y={Math.min(candle.openY, candle.closeY)}
                        width={chart.candleWidth}
                        height={Math.max(
                          1.5,
                          Math.abs(candle.openY - candle.closeY),
                        )}
                      />
                    </g>
                  );
                })}
                {activeCandle ? (
                  <g>
                    <line
                      className={styles.chartCrosshair}
                      x1={activeCandle.x}
                      x2={activeCandle.x}
                      y1={chart.plotTop}
                      y2={chart.plotBottom}
                    />
                    <line
                      className={styles.chartCrosshair}
                      x1={chart.plotLeft}
                      x2={chart.plotRight}
                      y1={activeCandle.closeY}
                      y2={activeCandle.closeY}
                    />
                    <circle
                      className={styles.chartActivePoint}
                      cx={activeCandle.x}
                      cy={activeCandle.closeY}
                      r="3"
                    />
                  </g>
                ) : null}
                <text
                  className={styles.chartLastPriceText}
                  x={chart.plotRight - 4}
                  y={chart.lastCloseY - 5}
                  textAnchor="end"
                >
                  C {formatPrice(chart.summary.latest)}
                </text>
                <text
                  className={styles.chartAxisText}
                  x={chart.plotLeft}
                  y={chart.plotBottom + 20}
                >
                  {formatChartTime(chart.firstTimestamp, range)}
                </text>
                <text
                  className={styles.chartAxisText}
                  x={(chart.plotLeft + chart.plotRight) / 2}
                  y={chart.plotBottom + 20}
                  textAnchor="middle"
                >
                  {formatChartTime(
                    (chart.firstTimestamp + chart.lastTimestamp) / 2,
                    range,
                  )}
                </text>
                <text
                  className={styles.chartAxisText}
                  x={chart.plotRight}
                  y={chart.plotBottom + 20}
                  textAnchor="end"
                >
                  {formatChartTime(chart.lastTimestamp, range)}
                </text>
                <text
                  className={styles.chartAxisTitle}
                  x={(chart.plotLeft + chart.plotRight) / 2}
                  y={chart.height - 5}
                  textAnchor="middle"
                >
                  UTC · {quoteUnit}
                </text>
              </svg>
            ) : (
              <div
                className={styles.chartStatus}
                role={priceState.kind === "error" ? "alert" : "status"}
              >
                <strong>
                  {priceState.kind === "error"
                    ? "Candlestick chart unavailable"
                    : "Loading public candlesticks…"}
                </strong>
                {priceState.kind === "error" ? (
                  <>
                    <p>{priceState.message}</p>
                    <button
                      type="button"
                      onClick={() => setRefreshKey((value) => value + 1)}
                    >
                      Retry
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>
          <footer className={styles.chartFooter}>
            <span>
              {activeCandle
                ? `O ${formatPrice(activeCandle.open)} · H ${formatPrice(activeCandle.high)} · L ${formatPrice(activeCandle.low)} · C ${formatPrice(activeCandle.close)} · ${formatChartTime(activeCandle.timestamp, range)} UTC`
                : "PUBLIC OHLC UNAVAILABLE"}
            </span>
            <small>
              <a
                href="https://www.coingecko.com/en/coins/starknet"
                target="_blank"
                rel="noreferrer"
              >
                CoinGecko ↗
              </a>
              {" · "}context only; private quotes come from APP20 inventory
            </small>
          </footer>
        </section>

        <aside
          className={styles.referenceBook}
          aria-labelledby="reference-book-title"
        >
          <header className={styles.marketSectionHeader}>
            <div>
              <span>LOCALNET QUOTE MODEL</span>
              <h3 id="reference-book-title">Private quote ladder</h3>
            </div>
            <strong>DEPTH PRIVATE</strong>
          </header>
          <div className={styles.ladderHead} aria-hidden="true">
            <span>LEVEL</span>
            <span>USDC / STRK</span>
          </div>
          <dl className={styles.priceLadder}>
            <div className={styles.ladderAsk}>
              <dt>Indicative ask</dt>
              <dd>{model.ask.toFixed(4)}</dd>
            </div>
            <div className={styles.ladderMid}>
              <dt>Fixture midpoint</dt>
              <dd>{model.midpoint.toFixed(4)}</dd>
            </div>
            <div className={styles.ladderBid}>
              <dt>Indicative bid</dt>
              <dd>{model.bid.toFixed(4)}</dd>
            </div>
          </dl>
          <div className={styles.depthWithheld}>
            <span>AVAILABLE SIZE</span>
            <strong>Disclosed by signed quote</strong>
            <p>
              The public chart is context, not the executable price. Requesting
              a quote checks solver inventory and returns signed terms for your
              exact clip.
            </p>
          </div>
        </aside>
      </div>

      <section
        className={styles.marketSignals}
        aria-label="Market and execution status"
      >
        <article>
          <span>INVENTORY</span>
          <strong>Checked at quote time</strong>
          <p>
            A refusal stops here and never silently routes to a public venue.
          </p>
        </article>
        <article>
          <span>SETTLEMENT</span>
          <strong>Lock → fill → claim</strong>
          <p>Block expiry follows the separate lock → expiry → refund path.</p>
        </article>
      </section>
    </div>
  );
}
