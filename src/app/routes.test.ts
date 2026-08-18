import { describe, expect, it } from "vitest";
import { CANONICAL_ROUTES, legacyRouteTarget } from "./routes";

describe("VLT20 canonical routes", () => {
  it.each([
    ["/", "/vault"],
    ["/mail", "/mail/inbox"],
    ["/inbox", "/mail/inbox"],
  ])("redirects %s to %s", (source, target) => {
    expect(legacyRouteTarget(source)).toBe(target);
  });

  it("keeps first-class destinations canonical", () => {
    expect(legacyRouteTarget(CANONICAL_ROUTES.vault)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.mail)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.pay)).toBeNull();
  });
});
