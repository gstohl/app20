export const CANONICAL_ROUTES = {
  home: "/",
  swap: "/swap/strk/usdc",
  rfq: "/rfq",
  rfqOperations: "/rfq/operations",
  marketProposal: "/rfq/markets/$tokenA/$tokenB/proposal",
  funding: "/funding",
  send: "/send",
  recovery: "/recovery/privy",
  crossChainReview: "/cross-chain-review",
  mail: "/mail/inbox",
  intents: "/intents",
  contacts: "/contacts",
  pay: "/pay",
} as const;

export type RfqPairSearch = "STRK_USDC" | "USDC_STRK";

export function validatedRfqPair(value: unknown): RfqPairSearch {
  return value === "USDC_STRK" ? "USDC_STRK" : "STRK_USDC";
}

export function marketProposalPath(tokenA: string, tokenB: string): string {
  return `/rfq/markets/${tokenA}/${tokenB}/proposal`;
}

/** Legacy pool-creation bookmarks resolve to the proposal-only market surface. */
export function legacyMarketProposalTarget(pathname: string): string | null {
  const match = /^\/pools\/create\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  return match ? marketProposalPath(match[1], match[2]) : null;
}

export function legacyRouteTarget(pathname: string): string | null {
  switch (pathname) {
    case "/mail":
    case "/inbox":
      return CANONICAL_ROUTES.mail;
    case "/vault":
    case "/workflows":
      return CANONICAL_ROUTES.rfq;
    case "/intents":
      return CANONICAL_ROUTES.crossChainReview;
    default:
      return null;
  }
}

/** TanStack redirect fields for a legacy route, retaining its bookmark hash. */
export function legacyRouteRedirect(
  pathname: string,
  locationHash = "",
): Readonly<{ to: string; hash?: string }> | null {
  const to = legacyRouteTarget(pathname);
  if (!to) return null;
  const hash = locationHash.replace(/^#/, "");
  return { to, ...(hash ? { hash } : {}) };
}
