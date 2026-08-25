export const DEFAULT_SWAP_ROUTE = "/swap/strk/usdc" as const;

export type SupportedSwapPairId = "STRK_USDC" | "USDC_STRK";

export type SwapRoutePair = Readonly<{
    tokenA: string;
    tokenB: string;
    pairId: SupportedSwapPairId | null;
}>;

const TOKEN_SEGMENT = /^[a-z0-9][a-z0-9._:-]{0,95}$/i;

export function normalizeSwapToken(value: string): string | null {
    const normalized = value.trim().toLowerCase();
    return TOKEN_SEGMENT.test(normalized) ? normalized : null;
}

export function resolveSwapRoutePair(
    tokenAInput: string,
    tokenBInput: string,
): SwapRoutePair | null {
    const tokenA = normalizeSwapToken(tokenAInput);
    const tokenB = normalizeSwapToken(tokenBInput);
    if (!tokenA || !tokenB) return null;

    const pairId =
        tokenA === "strk" && tokenB === "usdc"
            ? "STRK_USDC"
            : tokenA === "usdc" && tokenB === "strk"
              ? "USDC_STRK"
              : null;
    return { tokenA, tokenB, pairId };
}

export function swapRoutePath(tokenA: string, tokenB: string): string {
    const pair = resolveSwapRoutePair(tokenA, tokenB);
    if (!pair) return DEFAULT_SWAP_ROUTE;
    return `/swap/${encodeURIComponent(pair.tokenA)}/${encodeURIComponent(pair.tokenB)}`;
}

export function poolCreationPath(tokenA: string, tokenB: string): string {
    const pair = resolveSwapRoutePair(tokenA, tokenB);
    if (!pair) return "/pools/create/strk/usdc";
    return `/pools/create/${encodeURIComponent(pair.tokenA)}/${encodeURIComponent(pair.tokenB)}`;
}
