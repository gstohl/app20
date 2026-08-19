import { describe, expect, it } from "vitest";
import { CANONICAL_ROUTES, legacyRouteTarget } from "./routes";

describe("APP20 canonical routes", () => {
  it.each([
    ["/", "/vault"],
    ["/mail", "/mail/inbox"],
    ["/inbox", "/mail/inbox"],
    ["/intents", "/vault#intents"],
  ])("redirects %s to %s", (source, target) => {
    expect(legacyRouteTarget(source)).toBe(target);
  });

  it("keeps first-class destinations canonical", () => {
    expect(legacyRouteTarget(CANONICAL_ROUTES.vault)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.mail)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.workflows)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.pay)).toBeNull();
  });
});
