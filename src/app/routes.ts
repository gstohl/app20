export const CANONICAL_ROUTES = {
  home: "/vault",
  vault: "/vault",
  mail: "/mail/inbox",
  intents: "/intents",
  workflows: "/workflows",
  contacts: "/contacts",
  pay: "/pay",
} as const;

export function legacyRouteTarget(pathname: string): string | null {
  switch (pathname) {
    case "/":
      return CANONICAL_ROUTES.vault;
    case "/mail":
    case "/inbox":
      return CANONICAL_ROUTES.mail;
    case "/intents":
      return `${CANONICAL_ROUTES.vault}#intents`;
    default:
      return null;
  }
}
