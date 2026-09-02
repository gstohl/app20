import type { AggregatedMids } from "@app20/private-intents";
import type { LocalnetMarketPairId } from "./LocalnetPrivateIntentDesk";

export const LOCALNET_REFERENCE_STRK_USDC = 2;
/** Non-executable chart example only; signed fixture makers quote 20 and 30 bps. */
export const LOCALNET_DESK_SPREAD_BPS = 30;
export const LOCALNET_FIXTURE_SPREAD_RANGE_BPS = Object.freeze({
  minimum: 20,
  maximum: 30,
});

export type DeskExecutionPoint = Readonly<{
  sell: number;
  grossReceive: number;
  quotedReceive: number;
}>;

export type DeskMarketModel = Readonly<{
  pairId: LocalnetMarketPairId;
  sellSymbol: "STRK" | "USDC";
  buySymbol: "STRK" | "USDC";
  referencePair: "STRK / USDC";
  referencePrice: number;
  clientRate: number;
  clientRateLabel: string;
  sizes: readonly number[];
  points: readonly DeskExecutionPoint[];
  bid: number;
  midpoint: number;
  ask: number;
}>;

/** Applies the non-executable chart example spread, never selected-maker terms. */
function afterSpread(value: number): number {
  return value * (1 - LOCALNET_DESK_SPREAD_BPS / 10_000);
}

function buildDeskMarketModel(
  pairId: LocalnetMarketPairId,
  referenceStrkUsdc: number,
): DeskMarketModel {
  if (!Number.isFinite(referenceStrkUsdc) || referenceStrkUsdc <= 0)
    throw new Error("A positive maker reference mid is required.");
  const strkToUsdc = pairId === "STRK_USDC";
  const sizes = strkToUsdc ? [0, 1, 5, 10, 25, 50] : [0, 2, 10, 20, 50, 100];
  const grossRate = strkToUsdc ? referenceStrkUsdc : 1 / referenceStrkUsdc;
  const clientRate = afterSpread(grossRate);
  const points = sizes.map((sell) => ({
    sell,
    grossReceive: sell * grossRate,
    quotedReceive: sell * clientRate,
  }));

  return {
    pairId,
    sellSymbol: strkToUsdc ? "STRK" : "USDC",
    buySymbol: strkToUsdc ? "USDC" : "STRK",
    referencePair: "STRK / USDC",
    referencePrice: referenceStrkUsdc,
    clientRate,
    clientRateLabel: strkToUsdc
      ? `${clientRate.toFixed(4)} USDC / STRK`
      : `${clientRate.toFixed(4)} STRK / USDC`,
    sizes,
    points,
    bid: afterSpread(referenceStrkUsdc),
    midpoint: referenceStrkUsdc,
    ask: referenceStrkUsdc / (1 - LOCALNET_DESK_SPREAD_BPS / 10_000),
  };
}

export function deskMarketModel(pairId: LocalnetMarketPairId): DeskMarketModel {
  return buildDeskMarketModel(pairId, LOCALNET_REFERENCE_STRK_USDC);
}

/** Builds the non-executable board from the browser-verified maker median. */
export function deskMarketModelFromMakerMids(
  pairId: LocalnetMarketPairId,
  mids: AggregatedMids,
): DeskMarketModel {
  if (mids.count < 1 || mids.medianE18 <= 0n)
    throw new Error("A verified maker indicative mid is unavailable.");
  return buildDeskMarketModel(pairId, Number(mids.medianE18) / 1e18);
}
