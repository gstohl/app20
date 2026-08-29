import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RfqActiveCard from "./RfqActiveCard";
import RfqActivity from "./RfqActivity";
import RfqRecoveryCard from "./RfqRecoveryCard";
import SettlementEvidencePanel from "./SettlementEvidencePanel";
import {
  RFQ_AUTHORITY_PROJECTION_SOURCE,
  refreshLiveRfqAuthority,
  rfqAuthorityLabel,
  type RfqAuthorityStatus,
} from "./rfq-authority";
import {
  createRfqLifecycleRecord,
  reviseRfqLifecycle,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

const NOW = 1_900_000_000;
const DIGEST = `0x${"cc".repeat(32)}`;

const TERMS = {
  pairId: "STRK_USDC",
  sellSymbol: "STRK",
  sellAddress: "0x1",
  sellDecimals: 18,
  sellAmount: "100",
  buySymbol: "USDC",
  buyAddress: "0x2",
  buyDecimals: 6,
  minBuyAmount: "180",
  rfqExpiresAt: NOW + 600,
} as const;

function fundedRecord(
  status: RfqAuthorityStatus,
  state: RfqLifecycleRecord["state"] = "funded",
): RfqLifecycleRecord {
  const base = createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "requesting",
    now: NOW,
    requestDigest: DIGEST,
    terms: TERMS,
  });
  const funded = reviseRfqLifecycle(base, {
    state,
    settlement: {
      version: "Localnet V2",
      dealId: "0x99",
      escrowAddress: "0x5",
      ticketAddress: "0x6",
      deadline: NOW + 600,
    },
    updatedAt: NOW,
  });
  return Object.freeze({
    ...funded,
    evidenceAuthority: Object.freeze({
      status,
      label: rfqAuthorityLabel(status),
      revision: 3,
      observedAt: NOW,
    }),
  });
}

describe("authority presentation in the record card", () => {
  it("labels a local-only outcome as an observation, not a settlement proof", () => {
    const markup = renderToStaticMarkup(
      <RfqActiveCard
        record={fundedRecord("local-non-authoritative")}
        now={NOW}
      />,
    );
    expect(markup).toContain(rfqAuthorityLabel("local-non-authoritative"));
    expect(markup).toContain("not proof that value moved");
  });

  it.each(["authoritative", "stale", "disagreement", "reorged", "quarantined"] as const)(
    "disables the resume action while authority is %s",
    (status) => {
      const markup = renderToStaticMarkup(
        <RfqActiveCard
          record={fundedRecord(status)}
          now={NOW}
          onAction={() => undefined}
        />,
      );
      expect(markup).toContain(
        rfqAuthorityLabel(status === "authoritative" ? "stale" : status),
      );
      expect(markup).not.toMatch(/<button type="button"(?![^>]*disabled)[^>]*>(?:(?!<\/button>).)*(?:fill|Claim|Refund|fund)/i);
    },
  );

  it("presents a reorg as an alert that never offers a resubmission", () => {
    const markup = renderToStaticMarkup(
      <RfqActiveCard
        record={fundedRecord("reorged", "reorged")}
        now={NOW}
        onAction={() => undefined}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Reorg-invalidated");
    expect(markup).toContain("reconcile with the maker");
    expect(markup).not.toMatch(/<button(?![^>]*disabled)[^>]*>[^<]*(?:Claim|Refund|Fund|fill)/i);
  });

  it("uses plain-language outcome words instead of raw enums as the headline", () => {
    const markup = renderToStaticMarkup(
      <RfqActiveCard record={fundedRecord("stale")} now={NOW} />,
    );
    expect(markup).toContain("Funded · waiting for the maker");
  });
});

describe("activity records", () => {
  it("gives every record its own heading and a distinguishing copy label", () => {
    const markup = renderToStaticMarkup(
      <RfqActivity records={[fundedRecord("local-non-authoritative")]} />,
    );
    expect(markup).toContain("<h3");
    expect(markup).toContain("STRK → USDC");
    expect(markup).toMatch(/Copy RFQ ID [^<]*0x77/);
  });

  it("does not offer deletion for a terminal record needing reconciliation", () => {
    const markup = renderToStaticMarkup(
      <RfqActivity
        records={[fundedRecord("disagreement", "settled")]}
        onRemove={() => undefined}
        onClearAll={() => undefined}
      />,
    );
    expect(markup).toContain(rfqAuthorityLabel("disagreement"));
    expect(markup).not.toContain("Forget browser history");
    expect(markup).not.toContain("Forget all terminal");
  });

  it("does not claim history is empty while storage is loading or unavailable", () => {
    for (const loadState of ["loading", "storage-unavailable"] as const) {
      const markup = renderToStaticMarkup(
        <RfqActivity records={[]} loadState={loadState} onRetryLoad={() => undefined} />,
      );
      expect(markup).not.toContain("No saved RFQ history");
    }
    expect(
      renderToStaticMarkup(<RfqActivity records={[]} loadState="loading" />),
    ).toContain("Loading your saved RFQ history");
    expect(
      renderToStaticMarkup(
        <RfqActivity records={[]} loadState="storage-unavailable" />,
      ),
    ).toContain("Saved RFQ history could not be opened");
  });
});

describe("settlement evidence panel", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("states the bounded authority scope when no receipt exists", () => {
    const markup = renderToStaticMarkup(<SettlementEvidencePanel />);
    expect(markup).toContain("No exportable receipt");
    expect(markup).toContain("localnet-only");
    expect(markup).toContain("Sepolia/Mainnet production authority remains unavailable");
    expect(markup).not.toContain("configured-chain verifier is unavailable");
  });

  it("describes a live terminal lifecycle without inventing an exportable receipt", async () => {
    const runtimeEpoch = "a".repeat(32);
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            result: {
              source: RFQ_AUTHORITY_PROJECTION_SOURCE,
              runtimeEpoch,
              chainId: "0x1",
              account: "0xabc",
              rfqId: "0x77",
              dealId: "0x77",
              status: "authoritative",
              revision: 4,
              observedAt: NOW,
              validUntil: NOW + 30,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const terminalBase = fundedRecord(
      "local-non-authoritative",
      "settled",
    );
    const terminal = Object.freeze({
      ...terminalBase,
      settlement: Object.freeze({
        ...terminalBase.settlement,
        dealId: "0x77",
      }),
      attempts: Object.freeze({
        funding: Object.freeze({ transactionHash: "0x101" }),
        fill: Object.freeze({ transactionHash: "0x102" }),
        claim: Object.freeze({ transactionHash: "0x103" }),
      }),
    }) as RfqLifecycleRecord;
    const live = await refreshLiveRfqAuthority(terminal, runtimeEpoch);
    const markup = renderToStaticMarkup(
      <SettlementEvidencePanel records={[live]} />,
    );
    expect(markup).toContain("Terminal lifecycle finalized locally");
    expect(markup).toContain("No exportable receipt is available");
    expect(markup).toContain("Localnet-only modeled authority");
    expect(markup).toContain("Sepolia/Mainnet production authority remains unavailable");
    expect(markup).not.toContain("No authoritative receipt");
    expect(markup).not.toContain("configured-chain verifier is unavailable");
  });

  it("lists records that need reconciliation before any value action", () => {
    const markup = renderToStaticMarkup(
      <SettlementEvidencePanel records={[fundedRecord("reorged")]} />,
    );
    expect(markup).toContain("Needs reconciliation");
    expect(markup).toContain("Nothing is resubmitted for you.");
  });
});

describe("storage recovery", () => {
  it("offers a verify-only retry when the local database refuses to open", () => {
    const markup = renderToStaticMarkup(
      <RfqRecoveryCard
        loadState="storage-unavailable"
        detail="IndexedDB is unavailable."
        onRetry={() => undefined}
      />,
    );
    expect(markup).toContain("Saved RFQ history could not be opened");
    expect(markup).toContain("Retry read");
    expect(markup).toContain("no maker reservation was touched");
  });

  it("asks for the bound wallet instead of failing silently offline", () => {
    const markup = renderToStaticMarkup(
      <RfqRecoveryCard loadState="stale/offline" onRetry={() => undefined} />,
    );
    expect(markup).toContain("Review wallet connection");
  });

  it("stays silent when records loaded normally", () => {
    expect(renderToStaticMarkup(<RfqRecoveryCard loadState="ready" />)).toBe("");
  });
});
