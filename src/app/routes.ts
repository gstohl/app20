export const CANONICAL_ROUTES = {
  home: "/",
  swap: "/swap/strk/usdc",
  rfq: "/rfq",
  rfqOperations: "/rfq/operations",
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
