export type RfqCountdownView = Readonly<{
  remaining: number;
  iso: string;
  label: string;
  ariaLive: "polite" | "off";
}>;

export function rfqCountdownView(
  expiresAt: number,
  now: number,
): RfqCountdownView {
  const remaining = Math.max(0, expiresAt - now);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return Object.freeze({
    remaining,
    iso: new Date(expiresAt * 1_000).toISOString(),
    label: remaining ? `${minutes}m ${seconds}s remaining` : "expired",
    ariaLive: remaining === 0 || remaining === 60 ? "polite" : "off",
  });
}
