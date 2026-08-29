import { describe, expect, it } from "vitest";
import {
  LOCALNET_APP20_FEE_POLICY_ID,
  LOCALNET_ECONOMIC_POLICY_ID,
  LOCALNET_OPERATIONS_SCHEMA,
  gateRfqAction,
  directoryFreshnessState,
  localnetEconomicReview,
  normalizeRfqOperationsStatus,
  operationsAvailability,
} from "./rfq-operations";

const NOW = 2_000_000_000;

function wire(overrides: Record<string, unknown> = {}) {
  return {
    schema: LOCALNET_OPERATIONS_SCHEMA,
    environment: "localnet",
    observedAt: NOW,
    validUntil: NOW + 30,
    mode: "running",
    reason: "Named localnet fixture operations are running.",
    claimsAndRefundsEnabled: true,
    directory: { epoch: 0, checkpoint: "local-fixture-checkpoint-v1", validUntil: NOW + 30 },
    cohort: { governed: 2, invited: 2, responded: 1, refused: 1, unavailable: 0 },
    makers: [
      {
        makerId: "app20-localnet-solver",
        keyId: "app20-localnet-solver/ecdsa-p256-v1",
        keyStatus: "valid",
        keyValidUntil: NOW + 3_600,
        invitationStatus: "responded",
        capacityBand: "medium",
        eligible: true,
        rationale: "Eligible because the exact reviewed clip was reserved.",
      },
      {
        makerId: "app20-localnet-solver-b",
        keyId: "app20-localnet-solver-b/ecdsa-p256-v1",
        keyStatus: "valid",
        keyValidUntil: NOW + 3_600,
        invitationStatus: "refused",
        capacityBand: "none",
        eligible: false,
        rationale: "Excluded because the exact reviewed clip was refused.",
      },
    ],
    rawInventoryExposed: false,
    ...overrides,
  };
}

describe("browser-safe localnet RFQ operations", () => {
  it("keeps every invited maker with deterministic eligible and excluded rationale", () => {
    const status = normalizeRfqOperationsStatus(wire());
    expect(status.makers).toHaveLength(2);
    expect(status.cohort).toEqual({
      governed: 2,
      invited: 2,
      responded: 1,
      refused: 1,
      unavailable: 0,
    });
    expect(status.makers.map((maker) => [maker.makerId, maker.invitationStatus, maker.capacityBand, maker.eligible])).toEqual([
      ["app20-localnet-solver", "responded", "medium", true],
      ["app20-localnet-solver-b", "refused", "none", false],
    ]);
    expect(JSON.stringify(status)).not.toMatch(/settlementAccount|availableBaseUnits|rawBalance|processPid|operationLog/i);
    expect(status.rawInventoryExposed).toBe(false);
  });

  it.each(["paused", "drain-only"] as const)("blocks starts in %s while preserving recovery", (mode) => {
    const status = normalizeRfqOperationsStatus(wire({ mode }));
    const availability = operationsAvailability(status, NOW + 1);
    expect(gateRfqAction(availability, "request").allowed).toBe(false);
    expect(gateRfqAction(availability, "fund").allowed).toBe(false);
    expect(gateRfqAction(availability, "fill").allowed).toBe(false);
    expect(gateRfqAction(availability, "claim").allowed).toBe(true);
    expect(gateRfqAction(availability, "refund").allowed).toBe(true);
  });

  it("fails closed on unknown and stale status without disabling claim or refund", () => {
    const unknown = operationsAvailability(null, NOW);
    const stale = operationsAvailability(normalizeRfqOperationsStatus(wire()), NOW + 30);
    for (const availability of [unknown, stale]) {
      expect(gateRfqAction(availability, "request").allowed).toBe(false);
      expect(gateRfqAction(availability, "fund").allowed).toBe(false);
      expect(gateRfqAction(availability, "claim").allowed).toBe(true);
      expect(gateRfqAction(availability, "refund").allowed).toBe(true);
    }
  });

  it("blocks starts when no maker or the selected maker is eligible", () => {
    const status = normalizeRfqOperationsStatus(wire({
      cohort: { governed: 2, invited: 2, responded: 0, refused: 0, unavailable: 2 },
      makers: (wire().makers as Array<Record<string, unknown>>).map((maker) => ({
        ...maker,
        invitationStatus: "unavailable",
        capacityBand: "unknown",
        eligible: false,
        rationale: "Excluded because this local maker process is unavailable.",
      })),
    }));
    const unavailable = operationsAvailability(status, NOW + 1);
    expect(gateRfqAction(unavailable, "fund").allowed).toBe(false);
    expect(gateRfqAction(operationsAvailability(normalizeRfqOperationsStatus(wire()), NOW + 1), "fund", "missing-maker").allowed).toBe(false);
  });

  it("rejects future-dated status rather than extending freshness", () => {
    const status = normalizeRfqOperationsStatus(wire({ observedAt: NOW + 10, validUntil: NOW + 30 }));
    expect(operationsAvailability(status, NOW).mode).toBe("unknown");
  });

  it("derives fresh, expiring, and expired directory states from the published deadline", () => {
    const status = normalizeRfqOperationsStatus(wire());
    expect(directoryFreshnessState(status.directory, NOW)).toBe("fresh");
    expect(directoryFreshnessState(status.directory, NOW + 20)).toBe("expiring");
    expect(operationsAvailability(status, NOW + 20).mode).toBe("stale");
    expect(directoryFreshnessState(status.directory, NOW + 30)).toBe("expired");
  });

  it("rejects missing, malformed, contradictory, and unknown cohort or key fields", () => {
    const missingCohort = wire();
    delete (missingCohort as Record<string, unknown>).cohort;
    expect(() => normalizeRfqOperationsStatus(missingCohort)).toThrow(/schema/i);

    const missingKeyStatus = wire();
    delete ((missingKeyStatus.makers as Array<Record<string, unknown>>)[0] as Record<string, unknown>).keyStatus;
    expect(() => normalizeRfqOperationsStatus(missingKeyStatus)).toThrow(/schema/i);

    const missingKeyDeadline = wire();
    delete ((missingKeyDeadline.makers as Array<Record<string, unknown>>)[0] as Record<string, unknown>).keyValidUntil;
    expect(() => normalizeRfqOperationsStatus(missingKeyDeadline)).toThrow(/schema/i);

    expect(() => normalizeRfqOperationsStatus(wire({
      cohort: { governed: 2, invited: 1, responded: 1, refused: 1, unavailable: 0 },
    }))).toThrow(/contradicts/i);
    expect(() => normalizeRfqOperationsStatus(wire({
      makers: (wire().makers as Array<Record<string, unknown>>).map((maker, index) =>
        index === 0 ? { ...maker, keyStatus: "rotated", eligible: true } : maker,
      ),
    }))).toThrow(/eligibility/i);
    expect(() => normalizeRfqOperationsStatus(wire({
      makers: (wire().makers as Array<Record<string, unknown>>).map((maker, index) =>
        index === 0 ? { ...maker, unexpected: "field" } : maker,
      ),
    }))).toThrow(/schema/i);
  });

  it.each(["expired", "rotated"] as const)(
    "blocks a %s maker key even when the maker is otherwise available",
    (keyStatus) => {
      const status = normalizeRfqOperationsStatus(wire({
        makers: (wire().makers as Array<Record<string, unknown>>).map((maker, index) =>
          index === 0
            ? { ...maker, keyStatus, keyValidUntil: NOW - 1, eligible: false }
            : maker,
        ),
      }));
      expect(gateRfqAction(operationsAvailability(status, NOW + 1), "fund", "app20-localnet-solver").allowed).toBe(false);
    },
  );

  it("rejects raw health, PID, account, log, inventory, or balance fields", () => {
    for (const forbidden of [
      { pid: 123 },
      { settlementAccount: "0x123" },
      { operationLog: [] },
      { availableInventory: "100" },
      { balance: "100" },
    ]) {
      expect(() => normalizeRfqOperationsStatus({ ...wire(), ...forbidden })).toThrow(/forbidden field|schema/i);
    }
  });
});

describe("named localnet economic policy", () => {
  it("replaces Instant minBuy=1 with an exact reference/deviation floor in both directions", () => {
    const forward = localnetEconomicReview({ pairId: "STRK_USDC", sellAmount: 10n ** 17n, surface: "swap" });
    expect(forward.referenceGrossBuyAmount).toBe(200_000n);
    expect(forward.reviewedFloor).toBe(198_000n);
    expect(forward.reviewedFloor).not.toBe(1n);
    expect(forward.policyId).toBe(LOCALNET_ECONOMIC_POLICY_ID);

    const reverse = localnetEconomicReview({ pairId: "USDC_STRK", sellAmount: 100_000n, surface: "swap" });
    expect(reverse.referenceGrossBuyAmount).toBe(50_000_000_000_000_000n);
    expect(reverse.reviewedFloor).toBe(49_500_000_000_000_000n);
  });

  it("enforces reviewed floor deviation and named per-trade caps", () => {
    expect(() => localnetEconomicReview({ pairId: "STRK_USDC", sellAmount: 10n ** 17n, requestedFloor: 197_999n, surface: "block" })).toThrow(/deviation/i);
    expect(() => localnetEconomicReview({ pairId: "STRK_USDC", sellAmount: 51n * 10n ** 18n, surface: "swap" })).toThrow(/per-trade cap/i);
    expect(LOCALNET_APP20_FEE_POLICY_ID).toMatch(/zero-fixture/);
  });
});
