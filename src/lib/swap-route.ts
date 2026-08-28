import {
  configuredMarketPair,
  resolveCanonicalPair,
  type App20CanonicalToken,
  type App20TokenNetwork,
} from "./token-registry";

export const DEFAULT_SWAP_ROUTE = "/swap/strk/usdc" as const;

export type SupportedSwapPairId = "STRK_USDC" | "USDC_STRK";

export type SwapRoutePair = Readonly<{
  network: App20TokenNetwork;
  tokenA: App20CanonicalToken;
  tokenB: App20CanonicalToken;
  pairId: SupportedSwapPairId | null;
}>;

export type SwapRouteResolution =
  | Readonly<{ kind: "invalid"; message: string }>
  | Readonly<{ kind: "unverified"; message: string }>
  | Readonly<{ kind: "duplicate"; message: string }>
  | Readonly<{ kind: "reviewed-no-inventory"; pair: SwapRoutePair }>
  | Readonly<{
      kind: "configured";
      pair: SwapRoutePair & { pairId: SupportedSwapPairId };
    }>;

const TOKEN_SEGMENT = /^[a-z0-9][a-z0-9._:-]{0,95}$/i;

export function normalizeSwapToken(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return TOKEN_SEGMENT.test(normalized) ? normalized : null;
}

export function resolveSwapRoutePair(
  network: App20TokenNetwork,
  tokenAInput: string,
  tokenBInput: string,
): SwapRouteResolution {
  const tokenA = normalizeSwapToken(tokenAInput);
  const tokenB = normalizeSwapToken(tokenBInput);
  if (!tokenA || !tokenB) {
    return { kind: "invalid", message: "Token route syntax is invalid." };
  }
  const resolved = resolveCanonicalPair(network, tokenA, tokenB);
  if (!resolved.ok) {
    return resolved.code === "SAME_TOKEN"
      ? { kind: "duplicate", message: resolved.message }
      : { kind: "unverified", message: resolved.message };
  }

  const configured = configuredMarketPair(network);
  let pairId: SupportedSwapPairId | null = null;
  if (configured.ok) {
    if (
      resolved.pair.tokenA.address === configured.pair.tokenA.address &&
      resolved.pair.tokenB.address === configured.pair.tokenB.address
    ) {
      pairId = "STRK_USDC";
    } else if (
      resolved.pair.tokenA.address === configured.pair.tokenB.address &&
      resolved.pair.tokenB.address === configured.pair.tokenA.address
    ) {
      pairId = "USDC_STRK";
    }
  }
  const pair: SwapRoutePair = {
    network,
    tokenA: resolved.pair.tokenA,
    tokenB: resolved.pair.tokenB,
    pairId,
  };
  return pairId
    ? { kind: "configured", pair: { ...pair, pairId } }
    : { kind: "reviewed-no-inventory", pair };
}

export function swapRoutePath(tokenA: string, tokenB: string): string {
  const normalizedA = normalizeSwapToken(tokenA);
  const normalizedB = normalizeSwapToken(tokenB);
  if (!normalizedA || !normalizedB) return DEFAULT_SWAP_ROUTE;
  return `/swap/${encodeURIComponent(normalizedA)}/${encodeURIComponent(normalizedB)}`;
}

export function marketProposalPath(tokenA: string, tokenB: string): string {
  const normalizedA = normalizeSwapToken(tokenA);
  const normalizedB = normalizeSwapToken(tokenB);
  if (!normalizedA || !normalizedB) return "/rfq/markets/strk/usdc/proposal";
  return `/rfq/markets/${encodeURIComponent(normalizedA)}/${encodeURIComponent(normalizedB)}/proposal`;
}

/** @deprecated Use the proposal-only canonical RFQ market route. */
export const poolCreationPath = marketProposalPath;
