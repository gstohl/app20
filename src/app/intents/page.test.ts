import { assertCrossChainIntent } from "@app20/domain";
import { mapCrossChainIntentToDryQuote } from "@app20/near-intents";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import IntentsPage, {
  REVIEW_SCENARIOS,
  buildReviewIntent,
  resolveAddressBookInput,
  runDryReview,
  type AddressBookEntry,
} from "./page";

const BOOK: readonly AddressBookEntry[] = [
  { label: "Exchange", address: "treasury.near", chainId: "near:mainnet" },
  { label: "cold", address: "0xabc123", chainId: "starknet:SN_MAIN" },
  { label: "anywhere", address: "0xdef456" },
];

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

  it("replays fixtures without contacting a network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await runDryReview("provider-honors-terms");
      await runDryReview("funding-shaped-response");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
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

describe("book-backed accounts", () => {
  it("keeps cross-chain labels session-only and does not advertise a storage namespace", () => {
    const markup = renderToStaticMarkup(createElement(IntentsPage));
    expect(markup).toContain("Session labels only");
    expect(markup).not.toContain("app20/address-book");
  });

  it("resolves labels case-insensitively, with or without the @ prefix", () => {
    expect(resolveAddressBookInput("@exchange", BOOK, "near:mainnet")).toEqual({
      address: "treasury.near",
      entry: BOOK[0],
    });
    expect(resolveAddressBookInput("EXCHANGE", BOOK, "near:mainnet")).toEqual({
      address: "treasury.near",
      entry: BOOK[0],
    });
    expect(
      resolveAddressBookInput("  @Cold ", BOOK, "starknet:SN_MAIN"),
    ).toEqual({ address: "0xabc123", entry: BOOK[1] });
  });

  it("passes raw addresses through and trims them", () => {
    expect(
      resolveAddressBookInput(" alice.near ", BOOK, "near:mainnet"),
    ).toEqual({ address: "alice.near" });
    expect(resolveAddressBookInput("", BOOK)).toEqual({ address: "" });
  });

  it("never resolves a label across chains, but allows chain-agnostic entries", () => {
    expect(resolveAddressBookInput("@cold", BOOK, "near:mainnet")).toEqual({
      address: "@cold",
    });
    expect(resolveAddressBookInput("@anywhere", BOOK, "near:mainnet")).toEqual({
      address: "0xdef456",
      entry: BOOK[2],
    });
  });

  it("verifies a replay whose accounts came from book labels and binds them into the digest", async () => {
    const destination = resolveAddressBookInput(
      "@exchange",
      BOOK,
      "near:mainnet",
    );
    const refund = resolveAddressBookInput("@cold", BOOK, "starknet:SN_MAIN");
    const report = await runDryReview("provider-honors-terms", {
      destinationAddress: destination.address,
      refundAddress: refund.address,
    });
    expect(report.outcome).toBe("verified");
    expect(report.transportCalls).toBe(1);
    expect(report.verifierCalls).toBe(1);

    const intent = buildReviewIntent({
      destinationAddress: destination.address,
      refundAddress: refund.address,
    });
    expect(() => assertCrossChainIntent(intent)).not.toThrow();
    const request = mapCrossChainIntentToDryQuote(intent);
    expect(request.recipient).toBe("treasury.near");
    expect(request.refundTo).toBe("0xabc123");

    const defaultReport = await runDryReview("provider-honors-terms");
    expect(report.intentDigest).not.toBe(defaultReport.intentDigest);
  });

  it("fails closed before any transport call when an address is malformed", async () => {
    const report = await runDryReview("provider-honors-terms", {
      destinationAddress: "not a near account",
    });
    expect(report.outcome).toBe("rejected");
    expect(report.failure).toContain("destinationAccount.address");
    expect(report.transportCalls).toBe(0);
    expect(report.verifierCalls).toBe(0);
    const byId = new Map(report.checks.map((check) => [check.id, check]));
    expect(byId.get("canonical-intent")?.status).toBe("failed");
    expect(byId.get("preflight-order")?.status).toBe("skipped");
    expect(byId.get("intent-bounds")?.status).toBe("skipped");
    expect(report.quote).toBeUndefined();
    expect(report.provenance).toBeUndefined();
  });

  it("renders destination and refund book fields on the desk", () => {
    const markup = renderToStaticMarkup(createElement(IntentsPage));
    expect(markup).toContain("Destination account (NEAR)");
    expect(markup).toContain("Refund account (Starknet)");
    expect(markup).toContain('id="intents-destination"');
    expect(markup).toContain('id="intents-refund"');
    expect(markup).toContain("Saved addresses for Destination account (NEAR)");
    expect(markup).toContain("Saved addresses for Refund account (Starknet)");
    expect(markup).toContain("review-fixture.near");
  });
});
