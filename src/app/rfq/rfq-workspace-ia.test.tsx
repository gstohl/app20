import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MakerCohortPanel from "./MakerCohortPanel";
import RfqFinalReview from "./RfqFinalReview";
import type { BrowserSafeMakerStatus } from "./rfq-operations";
import type { RfqFinalReviewTerms } from "./rfq-final-review";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const NOW = 1_900_000_000;

const MAKERS: readonly BrowserSafeMakerStatus[] = [
  {
    makerId: "maker-a",
    keyId: "key-a",
    keyStatus: "valid",
    keyValidUntil: NOW + 3_600,
    invitationStatus: "responded",
    capacityBand: "medium",
    eligible: true,
    rationale: "Signed a verified quote for this exact request.",
  },
  {
    makerId: "maker-b",
    keyId: "key-b",
    keyStatus: "rotated",
    keyValidUntil: NOW - 1,
    invitationStatus: "refused",
    capacityBand: "small",
    eligible: false,
    rationale: "Declined: insufficient reserved inventory.",
  },
];

const TERMS: RfqFinalReviewTerms = {
  rfqId: "0x77",
  quoteNonce: "0x01",
  intentDigest: `0x${"dd".repeat(32)}`,
  quoteDigest: `0x${"ee".repeat(32)}`,
  reservationId: "res-1",
  reservationFence: 4n,
  makerId: "maker-a",
  makerKeyId: "key-a",
  sellSymbol: "STRK",
  sellAddress: "0x1",
  sellDecimals: 18,
  sellAmount: 1_000_000_000_000_000_000n,
  buySymbol: "USDC",
  buyAddress: "0x2",
  buyDecimals: 6,
  buyAmount: 2_000_000n,
  minBuyAmount: 1_900_000n,
  referenceGrossBuyAmount: 2_010_000n,
  spreadBps: 25,
  registryRevision: "rev-1",
  quoteExpiresAt: NOW + 600,
  reservationExpiresAt: NOW + 900,
  settlementExpiresAt: NOW + 1_200,
  app20FeeAmount: 0n,
  app20FeePolicyId: "fee-zero",
  economicPolicyId: "policy-1",
  perTradeCapBaseUnits: 10_000_000_000_000_000_000n,
  maximumTotalDeviationBps: 100,
  maximumMakerSpreadBps: 50,
  requiresMatureNote: true,
};

describe("RFQ workspace information architecture", () => {
  const workspace = source("src/app/rfq/RfqWorkspace.tsx");

  it("gives the route exactly one page heading", () => {
    expect(workspace.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(workspace).toContain("<h1 className={styles.workspaceTitle}>");
    expect(workspace).toContain("Private RFQ");
  });

  it("matches hash navigation exactly so only one workspace tab is current", () => {
    expect(
      workspace.match(
        /activeOptions=\{\{ exact: true, includeHash: true \}\}/g,
      ),
    ).toHaveLength(2);
  });

  it("keeps one records view with a scope instead of two tabs over one set", () => {
    expect(workspace).toContain('aria-label="Record scope"');
    expect(workspace).toContain('hash="records"');
    expect(workspace).not.toContain('hash="activity"');
    // Existing bookmarks still resolve.
    expect(workspace).toContain('value === "active"');
    expect(workspace).toContain('value === "activity"');
  });

  it("moves focus to a labelled region after hash navigation", () => {
    expect(workspace).toContain("viewRegionRef");
    expect(workspace).toContain("viewRegionRef.current?.focus()");
    for (const label of [
      'aria-label="New RFQ request"',
      'aria-label="RFQ records"',
    ]) {
      expect(workspace).toContain(label);
    }
  });

  it("keeps privacy copy honest about what stays observable", () => {
    expect(workspace).toContain("Not published as a public order");
    expect(workspace).toContain("can still be correlated");
    expect(workspace).toContain("Invited makers see size-blind terms");
    expect(workspace).toContain("Exact size and floor stay in");
    expect(workspace).toContain("collateral locks");
    expect(workspace).toMatch(/OPEN\s+payout-note amounts/);
    expect(workspace).not.toMatch(/anonymous|untraceable|unlinkable/i);
  });

  it("keeps the global privacy boundary compact and available on demand", () => {
    expect(workspace).toContain(
      'label="Review privacy and observability details"',
    );
    expect(workspace).toContain('indicator="Review +"');
    expect(workspace).not.toContain(
      "<details className={styles.privacyBoundary}",
    );
  });

  it("keeps privacy evidence available behind a versioned one-time briefing", () => {
    const desk = source("src/app/rfq/LocalnetPrivateIntentDesk.tsx");
    expect(desk).toContain('aria-label="Privacy boundary summary"');
    expect(desk).toContain("<details className={styles.preflightEvidence}>");
    expect(desk).not.toContain(
      "<details className={styles.preflightEvidence} open>",
    );
    expect(desk).toContain("RFQ_PRIVACY_BRIEFING_STORAGE_KEY");
    expect(desk).toContain("RFQ_PRIVACY_BRIEFING_REVISION");
    expect(desk).toContain("Acknowledge and continue");
    expect(desk).not.toContain("I understand the bucket disclosure");
  });

  it("offers a verify-only retry rather than a resubmission on storage failure", () => {
    expect(workspace).toContain("RfqRecoveryCard");
    expect(workspace).toContain("setReloadToken");
  });

  it("shares loading and recovery state with Activity instead of showing a false empty state", () => {
    expect(workspace).toContain("<RfqActivity");
    expect(workspace).toContain("loadState={loadState}");
    expect(workspace).toContain("loadDetail={loadDetail}");
    expect(workspace).toContain("onRetryLoad={retryWorkspaceLoad}");
  });

  it("focuses the actual wallet session controls for offline recovery", () => {
    expect(workspace).toContain('loadState === "stale/offline"');
    expect(workspace).toContain(
      'getElementById("app20-session-control")?.focus()',
    );
    expect(source("src/app/components/SessionControl.tsx")).toContain(
      'id="app20-session-control"',
    );
  });

  it("re-reads the durable record before authorizing any resume command", () => {
    expect(
      workspace.indexOf("createIndexedDbRfqStorage().load(record)"),
    ).toBeLessThan(workspace.indexOf("authorizeLocalnetResumeCommand("));
    expect(workspace).toContain("durableRecord");
  });

  it("keeps every maker comparison visible before quote review", () => {
    const desk = source("src/app/rfq/LocalnetPrivateIntentDesk.tsx");
    expect(desk.indexOf("Compare all makers")).toBeLessThan(
      desk.indexOf("Review selected quote"),
    );
    expect(desk).toContain("Review every verified response, refusal");
    expect(desk).not.toContain("<details className={styles.quoteComparison}>");
  });

  it("aligns the eligibility clock to each wall-clock second rather than polling every 30 seconds", () => {
    const desk = source("src/app/rfq/LocalnetPrivateIntentDesk.tsx");
    expect(desk).toContain("1_000 - (Date.now() % 1_000)");
    expect(desk).toContain("window.setInterval(tick, 1_000)");
    expect(desk).not.toContain("30_000");
  });

  it("does not tick the whole workspace every second to demote live authority", () => {
    expect(workspace).not.toContain("setAuthorityClock");
    expect(workspace).toContain("recordsRef.current");
    expect(workspace).toContain("window.setInterval(refresh, 5_000)");
    expect(workspace).not.toContain("window.setInterval(refresh, 1_000)");
  });
});

describe("maker cohort layout", () => {
  const markup = renderToStaticMarkup(
    <MakerCohortPanel
      makers={MAKERS}
      directory={{
        epoch: 0,
        checkpoint: "local-fixture-checkpoint-v1",
        validUntil: NOW + 30,
      }}
      governedMakerCount={2}
      now={NOW}
      sellSymbol="STRK"
      buySymbol="USDC"
    />,
  );

  it("stacks makers as cards instead of a wide table", () => {
    expect(markup).not.toContain("<table");
    expect(markup).toContain("<ul");
    expect(markup).toContain('aria-label="Maker maker-a"');
  });

  it("still shows every invited maker and its rationale", () => {
    expect(markup).toContain("maker-a");
    expect(markup).toContain("maker-b");
    expect(markup).toContain("Declined: insufficient reserved inventory.");
    expect(markup).toContain("raw inventory not exposed");
    expect(markup).toContain(
      "Governed makers 2 · invited 2 · responded 1 · refused 1 · unavailable",
    );
    expect(markup).toContain("Maker-directory epoch");
    expect(markup).toContain("local-fixture-checkpoint-v1");
    expect(markup).toContain("Directory freshness");
    expect(markup).toContain("Fresh");
    expect(markup).toContain("Key status");
    expect(markup).toContain("Rotated · excluded from eligibility");
    expect(markup).toContain("Excluded");
  });

  it("stops presenting freshness and eligibility at their exact deadlines", () => {
    const maker = {
      ...MAKERS[0],
      keyValidUntil: NOW + 11,
    };
    const directory = {
      epoch: 0 as const,
      checkpoint: "local-fixture-checkpoint-v1" as const,
      validUntil: NOW + 11,
    };
    const before = renderToStaticMarkup(
      <MakerCohortPanel makers={[maker]} directory={directory} now={NOW} />,
    );
    const atDeadline = renderToStaticMarkup(
      <MakerCohortPanel
        makers={[maker]}
        directory={directory}
        now={NOW + 11}
      />,
    );

    expect(before).toContain("<strong>Fresh</strong>");
    expect(before).toContain("<strong>Eligible</strong>");
    expect(atDeadline).toContain("Expired · stale; not eligible");
    expect(atDeadline).toContain("Expired · excluded from eligibility");
    expect(atDeadline).toContain("<strong>Excluded</strong>");
  });
});

describe("final review hierarchy", () => {
  const markup = renderToStaticMarkup(
    <RfqFinalReview
      terms={TERMS}
      onAccept={() => undefined}
      onDecline={() => undefined}
    />,
  );

  it("leads with what the person gets before protocol internals", () => {
    const headline = markup.indexOf("You receive");
    const details = markup.indexOf("Protocol details");
    expect(headline).toBeGreaterThan(-1);
    expect(details).toBeGreaterThan(headline);
  });

  it("puts the primary and decline actions ahead of the details disclosure", () => {
    const accept = markup.indexOf("Accept and fund on LOCALNET");
    const decline = markup.indexOf("Decline selected quote");
    const details = markup.indexOf("Protocol details");
    expect(accept).toBeLessThan(decline);
    expect(decline).toBeLessThan(details);
  });

  it("states the refund rule and pending settlement authority up front", () => {
    expect(markup).toContain("If the maker never fills");
    expect(markup).toContain("Settlement authority");
    expect(markup).toContain("localnet-only demo");
    expect(markup).toContain("modeled same-devnet readers");
    expect(markup).toContain(
      "Sepolia/Mainnet production authority remains unavailable",
    );
  });

  it("uses maker wording rather than solver in visible copy", () => {
    expect(markup).toContain("Maker");
    expect(markup).not.toMatch(/solver/i);
  });

  it("renders copyable local RFQ, quote, and reservation references without calling them settlement authority", () => {
    expect(markup).toContain("Copy RFQ ID 0x77");
    expect(markup).toContain("Copy Quote ID 0x01");
    expect(markup).toContain("Copy Reservation ID res-1");
    expect(markup).toContain("Local reference · not settlement authority");
    expect(markup).toContain('aria-label="Copy RFQ ID 0x77; authority:');
    expect(markup).toContain('aria-label="Copy Quote ID 0x01; authority:');
    expect(markup).toContain(
      'aria-label="Copy Reservation ID res-1; authority:',
    );
  });
});
