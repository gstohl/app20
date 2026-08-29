import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RFQ_AUTHORITY_PROJECTION_SOURCE,
  displayedRfqAuthority,
  normalizeRfqAuthorityProjection,
  refreshLiveRfqAuthority,
  rfqAuthorityLabel,
  rfqAuthorityPresentation,
  rfqAuthoritySignalForRecord,
} from "./rfq-authority";
import {
  applyRfqAuthoritySignal,
  createRfqLifecycleRecord,
  reviseRfqLifecycle,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

const NOW = 1_900_000_000;
const EPOCH = "a".repeat(32);
const DIGEST = `0x${"bb".repeat(32)}`;

function settledRecord(): RfqLifecycleRecord {
  const base = createRfqLifecycleRecord({
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    state: "requesting",
    now: NOW,
    requestDigest: DIGEST,
  });
  return reviseRfqLifecycle(base, {
    state: "settled",
    settlement: {
      version: "Localnet V2",
      dealId: "0x77",
      escrowAddress: "0x5",
      deadline: NOW + 600,
      ticketAddress: "0x6",
    },
    updatedAt: NOW,
  });
}

function projection(overrides: Record<string, unknown> = {}) {
  return {
    source: RFQ_AUTHORITY_PROJECTION_SOURCE,
    runtimeEpoch: EPOCH,
    chainId: "0x1",
    account: "0xabc",
    rfqId: "0x77",
    dealId: "0x77",
    status: "authoritative",
    revision: 1,
    observedAt: NOW,
    validUntil: NOW + 30,
    ...overrides,
  };
}

describe("RFQ authority projection", () => {
  it("derives the shown label from the enum and discards a caller label", () => {
    const normalized = normalizeRfqAuthorityProjection(
      projection({ label: "Finalized by me, trust it" }),
    );
    expect(normalized).not.toHaveProperty("label");
    const signal = rfqAuthoritySignalForRecord(
      normalized,
      settledRecord(),
      EPOCH,
    );
    expect(signal.label).toBe(rfqAuthorityLabel("authoritative"));
    expect(signal.label).not.toContain("trust it");
  });

  it.each([
    ["source", { source: "browser" }],
    ["status", { status: "definitely-final" }],
    ["runtime epoch", { runtimeEpoch: "zz" }],
    ["revision", { revision: 0 }],
    ["observation time", { observedAt: 0 }],
    ["validity deadline", { validUntil: NOW }],
  ])("rejects a projection with an invalid %s", (_label, overrides) => {
    expect(() =>
      normalizeRfqAuthorityProjection(projection(overrides)),
    ).toThrow();
  });

  it.each([
    ["runtime", { runtimeEpoch: "b".repeat(32) }],
    ["chain", { chainId: "0x2" }],
    ["account", { account: "0xdef" }],
    ["RFQ", { rfqId: "0x78" }],
    ["deal", { dealId: "0x9a" }],
  ])("refuses a projection bound to another %s", (_label, overrides) => {
    const normalized = normalizeRfqAuthorityProjection(projection(overrides));
    expect(() =>
      rfqAuthoritySignalForRecord(normalized, settledRecord(), EPOCH),
    ).toThrow();
  });

  it("requires an increasing revision against the persisted record", () => {
    const record = applyRfqAuthoritySignal(
      settledRecord(),
      rfqAuthoritySignalForRecord(
        normalizeRfqAuthorityProjection(projection({ revision: 4 })),
        settledRecord(),
        EPOCH,
      ),
    );
    expect(() =>
      rfqAuthoritySignalForRecord(
        normalizeRfqAuthorityProjection(projection({ revision: 4 })),
        record,
        EPOCH,
      ),
    ).toThrow(/must increase/);
  });

  it("refuses to bind an authority answer to an unfunded record", () => {
    const unfunded = createRfqLifecycleRecord({
      chainId: "0x1",
      account: "0xabc",
      rfqId: "0x77",
      state: "requesting",
      now: NOW,
      requestDigest: DIGEST,
    });
    expect(() =>
      rfqAuthoritySignalForRecord(
        normalizeRfqAuthorityProjection(projection()),
        unfunded,
        EPOCH,
      ),
    ).toThrow(/another deal/);
  });
});

describe("restored authority presentation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts live finality only through a fresh server read and expires it in the open tab", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ result: projection() }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const candidate = Object.freeze({
      ...settledRecord(),
      attempts: Object.freeze({
        funding: Object.freeze({ transactionHash: "0x101" }),
        fill: Object.freeze({ transactionHash: "0x102" }),
        claim: Object.freeze({ transactionHash: "0x103" }),
      }),
    }) as RfqLifecycleRecord;
    const live = await refreshLiveRfqAuthority(candidate, EPOCH);
    expect(displayedRfqAuthority(live).status).toBe("authoritative");
    expect(rfqAuthorityPresentation(live)).toMatchObject({
      label: rfqAuthorityLabel("authoritative"),
      blocksValueActions: true,
      needsReconciliation: false,
    });
    const restoredClone = structuredClone(live);
    expect(displayedRfqAuthority(restoredClone).status).toBe("stale");
    vi.setSystemTime((NOW + 30) * 1_000);
    expect(displayedRfqAuthority(live).status).toBe("stale");
  });

  it("shows a restored authoritative row as verification pending", () => {
    const verified = applyRfqAuthoritySignal(
      settledRecord(),
      rfqAuthoritySignalForRecord(
        normalizeRfqAuthorityProjection(projection()),
        settledRecord(),
        EPOCH,
      ),
    );
    expect(verified.evidenceAuthority.status).toBe("authoritative");
    expect(displayedRfqAuthority(verified).status).toBe("stale");
    expect(rfqAuthorityPresentation(verified)).toMatchObject({
      blocksValueActions: true,
      needsReconciliation: true,
    });
  });

  it("cannot be talked into finality by a forged persisted row", () => {
    const forged = Object.freeze({
      ...settledRecord(),
      evidenceAuthority: Object.freeze({
        status: "authoritative" as const,
        label: "FINALIZED — SAFE TO SPEND",
        revision: Number.MAX_SAFE_INTEGER,
        observedAt: NOW,
      }),
    });
    const presentation = rfqAuthorityPresentation(forged);
    expect(presentation.status).toBe("stale");
    expect(presentation.label).toBe(rfqAuthorityLabel("stale"));
    expect(presentation.label).not.toContain("SAFE TO SPEND");
  });

  it.each([
    ["authoritative", true],
    ["stale", true],
    ["disagreement", true],
    ["reorged", true],
    ["quarantined", true],
    ["local-non-authoritative", false],
  ] as const)("blocks value actions for %s = %s", (status, blocked) => {
    const record = Object.freeze({
      ...settledRecord(),
      evidenceAuthority: Object.freeze({
        status,
        label: rfqAuthorityLabel(status),
        revision: 2,
        observedAt: NOW,
      }),
    });
    const presentation = rfqAuthorityPresentation(record);
    expect(presentation.blocksValueActions).toBe(blocked);
    expect(presentation.needsReconciliation).toBe(
      presentation.status !== "authoritative" && blocked,
    );
  });

  it("moves a settled record to reorged without proposing a resubmission", () => {
    const settled = settledRecord();
    const reorged = applyRfqAuthoritySignal(
      settled,
      rfqAuthoritySignalForRecord(
        normalizeRfqAuthorityProjection(
          projection({ status: "reorged", revision: 7 }),
        ),
        settled,
        EPOCH,
      ),
    );
    expect(reorged.state).toBe("reorged");
    const presentation = rfqAuthorityPresentation(reorged);
    expect(presentation.tone).toBe("critical");
    expect(presentation.blocksValueActions).toBe(true);
    expect(presentation.needsReconciliation).toBe(true);
    expect(presentation.detail).toContain("nothing was resubmitted");
  });
});
