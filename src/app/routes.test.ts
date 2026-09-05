import { describe, expect, it } from "vitest";
import {
  CANONICAL_ROUTES,
  legacyMarketProposalTarget,
  legacyRouteRedirect,
  legacyRouteTarget,
  marketProposalPath,
  validatedRfqPair,
} from "./routes";

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

  it.each([
    ["/inbox", "#thread", "/mail/inbox"],
    ["/intents", "#review", "/cross-chain-review"],
    ["/workflows", "#active", "/rfq"],
  ])("preserves %s bookmark hash through its redirect", (source, hash, to) => {
    expect(legacyRouteRedirect(source, hash)).toEqual({
      to,
      hash: hash.slice(1),
    });
  });

  it("omits an empty redirect hash and rejects non-legacy paths", () => {
    expect(legacyRouteRedirect("/inbox")).toEqual({ to: "/mail/inbox" });
    expect(legacyRouteRedirect("/rfq", "#new")).toBeNull();
  });

  it("preserves only reviewed RFQ pair directions in handoff search state", () => {
    expect(validatedRfqPair("STRK_USDC")).toBe("STRK_USDC");
    expect(validatedRfqPair("USDC_STRK")).toBe("USDC_STRK");
    expect(validatedRfqPair("ETH_USDC")).toBe("STRK_USDC");
  });

  it("keeps first-class destinations canonical", () => {
    expect(CANONICAL_ROUTES.home).toBe("/");
    expect(legacyRouteTarget(CANONICAL_ROUTES.home)).toBeNull();
    expect(CANONICAL_ROUTES.rfq).toBe("/rfq");
    expect(CANONICAL_ROUTES.rfqOperations).toBe("/rfq/operations");
    expect(CANONICAL_ROUTES.funding).toBe("/funding");
    expect(CANONICAL_ROUTES.send).toBe("/send");
    expect(CANONICAL_ROUTES.recovery).toBe("/recovery/privy");
    expect(CANONICAL_ROUTES.crossChainReview).toBe("/cross-chain-review");
    expect(legacyRouteTarget(CANONICAL_ROUTES.rfq)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.mail)).toBeNull();
    expect(CANONICAL_ROUTES.chat).toBe("/chat");
    expect(legacyRouteTarget(CANONICAL_ROUTES.chat)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.contacts)).toBeNull();
    expect(legacyRouteTarget(CANONICAL_ROUTES.pay)).toBeNull();
  });

  it("keeps market proposal under the RFQ namespace", () => {
    expect(CANONICAL_ROUTES.marketProposal).toBe(
      "/rfq/markets/$tokenA/$tokenB/proposal",
    );
    expect(marketProposalPath("strk", "usdc")).toBe(
      "/rfq/markets/strk/usdc/proposal",
    );
    expect(CANONICAL_ROUTES.marketProposal).not.toContain("pool");
  });

  it.each([
    ["/pools/create/strk/usdc", "/rfq/markets/strk/usdc/proposal"],
    ["/pools/create/eth/usdc/", "/rfq/markets/eth/usdc/proposal"],
  ])("redirects the legacy pool bookmark %s to %s", (source, target) => {
    expect(legacyMarketProposalTarget(source)).toBe(target);
  });

  it.each(["/pools/create", "/rfq", "/pools/create/strk/usdc/extra"])(
    "does not claim %s as a legacy proposal bookmark",
    (pathname) => {
      expect(legacyMarketProposalTarget(pathname)).toBeNull();
    },
  );
});
