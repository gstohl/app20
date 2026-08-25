export const CANONICAL_ROUTES = {
  home: "/",
  swap: "/swap/strk/usdc",
  vault: "/vault",
  mail: "/mail/inbox",
  intents: "/intents",
  contacts: "/contacts",
  pay: "/pay",
} as const;

export function legacyRouteTarget(pathname: string): string | null {
  switch (pathname) {
    case "/mail":
    case "/inbox":
      return CANONICAL_ROUTES.mail;
    case "/intents":
      return `${CANONICAL_ROUTES.vault}#intents`;
    case "/workflows":
      return CANONICAL_ROUTES.vault;
    default:
      return null;
  }
}
