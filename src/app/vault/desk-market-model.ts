import type { LocalnetMarketPairId } from "./LocalnetPrivateIntentDesk";

export const LOCALNET_REFERENCE_STRK_USDC = 2;
export const LOCALNET_DESK_SPREAD_BPS = 30;

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

function afterSpread(value: number): number {
  return value * (1 - LOCALNET_DESK_SPREAD_BPS / 10_000);
}

export function deskMarketModel(pairId: LocalnetMarketPairId): DeskMarketModel {
  const strkToUsdc = pairId === "STRK_USDC";
  const sizes = strkToUsdc ? [0, 1, 5, 10, 25, 50] : [0, 2, 10, 20, 50, 100];
  const grossRate = strkToUsdc
    ? LOCALNET_REFERENCE_STRK_USDC
    : 1 / LOCALNET_REFERENCE_STRK_USDC;
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
    referencePrice: LOCALNET_REFERENCE_STRK_USDC,
    clientRate,
    clientRateLabel: strkToUsdc
      ? `${clientRate.toFixed(4)} USDC / STRK`
      : `${clientRate.toFixed(4)} STRK / USDC`,
    sizes,
    points,
    bid: afterSpread(LOCALNET_REFERENCE_STRK_USDC),
    midpoint: LOCALNET_REFERENCE_STRK_USDC,
    ask: LOCALNET_REFERENCE_STRK_USDC / (1 - LOCALNET_DESK_SPREAD_BPS / 10_000),
  };
}
