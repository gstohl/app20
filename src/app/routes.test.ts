import { describe, expect, it } from "vitest";
import { CANONICAL_ROUTES, legacyRouteTarget, validatedRfqPair } from "./routes";

describe("APP20 canonical routes", () => {
  it.each([
    ["/mail", "/mail/inbox"],
    ["/inbox", "/mail/inbox"],
    ["/vault", "/rfq"],
    ["/intents", "/cross-chain-review"],
    ["/workflows", "/rfq"],
  ])("redirects %s to %s", (source, target) => {
    expect(legacyRouteTarget(source)).toBe(target);
  });

  it("preserves only reviewed RFQ pair directions in handoff search state", () => {
    expect(validatedRfqPair("STRK_USDC")).toBe("STRK_USDC");
    expect(validatedRfqPair("USDC_STRK")).toBe("USDC_STRK");
    expect(validatedRfqPair("ETH_USDC")).toBe("STRK_USDC");
  });

  it("keeps first-class destinations canonical", () => {
    expect(CANONICAL_ROUTES.home).toBe("/");
    expect(CANONICAL_ROUTES.swap).toBe("/swap/strk/usdc");
    expect(legacyRouteTarget(CANONICAL_ROUTES.home)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.swap)).toBeNull();
    expect(CANONICAL_ROUTES.rfq).toBe("/rfq");
    expect(CANONICAL_ROUTES.rfqOperations).toBe("/rfq/operations");
    expect(CANONICAL_ROUTES.funding).toBe("/funding");
    expect(CANONICAL_ROUTES.send).toBe("/send");
    expect(CANONICAL_ROUTES.recovery).toBe("/recovery/privy");
    expect(CANONICAL_ROUTES.crossChainReview).toBe("/cross-chain-review");
    expect(legacyRouteTarget(CANONICAL_ROUTES.rfq)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.mail)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.contacts)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.pay)).toBeNull();
  });
});
