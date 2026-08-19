import { assertCrossChainIntent } from "@app20/domain";
import { mapCrossChainIntentToDryQuote } from "@app20/near-intents";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import IntentsPage, {
  REVIEW_SCENARIOS,
  buildReviewIntent,
  runDryReview,
} from "./page";

describe("intents dry review desk", () => {
  it("builds one canonical cross-chain intent that maps to a pinned dry request", () => {
    const intent = buildReviewIntent();
    expect(() => assertCrossChainIntent(intent)).not.toThrow();
    expect(intent.providerId).toBe("near-intents:1click");
    const request = mapCrossChainIntentToDryQuote(intent);
    expect(request.dry).toBe(true);
    expect(request.amount).toBe(intent.amount);
  });

  it("verifies the honest fixture with provenance after exactly one transport and verifier call", async () => {
    const report = await runDryReview("provider-honors-terms");
    expect(report.outcome).toBe("verified");
    expect(report.failure).toBeUndefined();
    expect(report.transportCalls).toBe(1);
    expect(report.verifierCalls).toBe(1);
    expect(report.checks.map((check) => check.status)).toEqual([
      "passed",
      "passed",
      "passed",
      "passed",
      "passed",
      "passed",
    ]);
    expect(
      report.checks.find((check) => check.id === "preflight-order")?.detail,
    ).toBe("preflight → transport");
    expect(report.quote?.amountIn).toBe(buildReviewIntent().amount);
    expect(report.provenance).toMatchObject({
      verified: true,
      algorithm: "ed25519",
      keyId: "near-1click-review-fixture-key",
    });
    expect(report.intentDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a funding-shaped response before the signature verifier is consulted", async () => {
    const report = await runDryReview("funding-shaped-response");
    expect(report.outcome).toBe("rejected");
    expect(report.failure).toContain("depositAddress");
    expect(report.verifierCalls).toBe(0);
    expect(report.quote).toBeUndefined();
    expect(report.provenance).toBeUndefined();
    const byId = new Map(report.checks.map((check) => [check.id, check]));
    expect(byId.get("strict-echo")?.status).toBe("failed");
    expect(byId.get("provenance")?.status).toBe("skipped");
    expect(byId.get("intent-bounds")?.status).toBe("skipped");
  });

  it("rejects a tampered echoed request before signature verification", async () => {
    const report = await runDryReview("tampered-echoed-request");
    expect(report.outcome).toBe("rejected");
    expect(report.failure).toContain(
      "quoteRequest.amount does not match the reviewed dry request",
    );
    expect(report.verifierCalls).toBe(0);
    expect(report.quote).toBeUndefined();
  });

  it("rejects a signed quote whose minimum output is below the approved bound", async () => {
    const report = await runDryReview("output-below-minimum");
    expect(report.outcome).toBe("rejected");
    expect(report.failure).toContain("below the user-approved minimum output");
    expect(report.verifierCalls).toBe(1);
    expect(report.provenance?.verified).toBe(true);
    expect(report.quote).toBeUndefined();
    const bounds = report.checks.find((check) => check.id === "intent-bounds");
    expect(bounds?.status).toBe("failed");
  });

  it("ships four distinct fixture scenarios", () => {
    expect(REVIEW_SCENARIOS).toHaveLength(4);
    expect(new Set(REVIEW_SCENARIOS.map((scenario) => scenario.id)).size).toBe(
      4,
    );
    expect(
      REVIEW_SCENARIOS.filter(
        (scenario) => scenario.expectation === "rejected",
      ),
    ).toHaveLength(3);
  });

  it("stays stamped review-only with no submit surface and no testnet claim", () => {
    const markup = renderToStaticMarkup(createElement(IntentsPage));
    expect(markup).toContain("REVIEW ONLY · CANNOT SUBMIT");
    expect(markup).toContain("Replay dry review (fixture)");
    expect(markup).toContain("Intents testnet");
    expect(markup).toContain(">None<");
    expect(markup).not.toContain(">Available<");
    expect(markup).not.toContain("Create live intent");
    expect(markup).not.toContain('type="submit"');
    expect(markup).not.toContain("<form");
  });
});
