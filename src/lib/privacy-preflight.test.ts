import { describe, expect, it } from "vitest";
import {
  buildPrivacyPreflight,
  canProceedFromPrivacyPreflight,
  evaluatePrivacyPreflight,
  requiresInformedConfirmation,
  type PrivacyPreflightInput,
} from "./privacy-preflight";

const NOW = 1_800_000_000;
const stamp = {
  provenance: "local-fixture:v1",
  observedAt: NOW - 10,
  validUntil: NOW + 60,
};

function input(
  overrides: Partial<PrivacyPreflightInput> = {},
): PrivacyPreflightInput {
  return {
    amount: 100_000_001n,
    asset: "USDC",
    network: "starknet:APP20_LOCALNET",
    now: NOW,
    amountFrequency: {
      ...stamp,
      exactAmountObservationCount: 1,
      cohortObservationCount: 20,
    },
    denominationAlternatives: {
      ...stamp,
      amounts: [100_000_000n, 50_000_000n],
    },
    noteMaturity: { ...stamp, mature: true },
    timingCorrelation: { ...stamp, correlation: "not-observed" },
    invitedMakerDisclosure: {
      ...stamp,
      makerCount: 2,
      disclosedFields: ["size", "pair", "deadline"],
    },
    publicSettlementLeakage: {
      ...stamp,
      publicFields: ["pair", "amount", "deadline", "helper activity"],
    },
    ...overrides,
  };
}

describe("privacy preflight", () => {
  it("preserves exact base units and produces deterministic evidence-labelled findings", () => {
    const first = evaluatePrivacyPreflight(input());
    const second = buildPrivacyPreflight(input());
    expect(first).toEqual(second);
    expect(first.amountBaseUnits).toBe("100000001");
    expect(first.findings).toHaveLength(6);
    expect(
      first.findings.every(
        (finding) =>
          finding.provenance &&
          finding.observedAt !== null &&
          finding.validUntil !== null &&
          finding.freshness === "current",
      ),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/privacyScore|anonymityScore/i);
  });

  it("sorts, deduplicates, and excludes the entered denomination", () => {
    const report = evaluatePrivacyPreflight(
      input({
        denominationAlternatives: {
          ...stamp,
          amounts: [100_000_000n, 50_000_000n, 100_000_001n, 50_000_000n],
        },
      }),
    );
    expect(
      report.findings.find(
        (finding) => finding.id === "denomination-alternatives",
      )?.message,
    ).toContain("50000000, 100000000");
  });

  it("marks missing and stale evidence unavailable without guessing", () => {
    const report = evaluatePrivacyPreflight(
      input({
        amountFrequency: undefined,
        denominationAlternatives: undefined,
        timingCorrelation: {
          ...stamp,
          validUntil: NOW - 1,
          correlation: "not-observed",
        },
      }),
    );
    expect(
      report.findings.find((finding) => finding.id === "amount-frequency"),
    ).toMatchObject({
      level: "unavailable",
      provenance: "not-provided",
      freshness: "unavailable",
    });
    expect(
      report.findings.find((finding) => finding.id === "timing-correlation"),
    ).toMatchObject({ level: "unavailable", freshness: "stale" });
    expect(JSON.stringify(report)).toMatch(/no anonymity claim|unavailable/i);
  });

  it("blocks missing or stale required maturity evidence and never bypasses a block", () => {
    const missing = evaluatePrivacyPreflight(
      input({
        requiresMatureNote: true,
        noteMaturity: undefined,
      }),
    );
    expect(
      missing.findings.find((finding) => finding.id === "note-maturity"),
    ).toMatchObject({ level: "block", freshness: "unavailable" });
    expect(canProceedFromPrivacyPreflight(missing, true)).toBe(false);

    const stale = evaluatePrivacyPreflight(
      input({
        noteMaturity: {
          ...stamp,
          validUntil: NOW - 1,
          mature: true,
          requiredForQuote: true,
        },
      }),
    );
    expect(
      stale.findings.find((finding) => finding.id === "note-maturity"),
    ).toMatchObject({ level: "block", freshness: "stale" });
    expect(canProceedFromPrivacyPreflight(stale, true)).toBe(false);
  });

  it("requires informed confirmation for known disclosure warnings", () => {
    const report = evaluatePrivacyPreflight(input());
    expect(requiresInformedConfirmation(report)).toBe(true);
    expect(canProceedFromPrivacyPreflight(report, false)).toBe(false);
    expect(canProceedFromPrivacyPreflight(report, true)).toBe(true);
  });

  it("blocks when invited-maker or public-settlement disclosure evidence is missing", () => {
    const report = evaluatePrivacyPreflight(
      input({
        amountFrequency: undefined,
        denominationAlternatives: undefined,
        noteMaturity: undefined,
        timingCorrelation: undefined,
        invitedMakerDisclosure: undefined,
        publicSettlementLeakage: undefined,
      }),
    );
    expect(
      report.findings.find(
        (finding) => finding.id === "invited-maker-disclosure",
      )?.level,
    ).toBe("block");
    expect(
      report.findings.find((finding) => finding.id === "public-settlement")
        ?.level,
    ).toBe("block");
    expect(canProceedFromPrivacyPreflight(report, true)).toBe(false);
  });

  it("rejects future-dated and overlong evidence validity", () => {
    expect(() =>
      evaluatePrivacyPreflight(
        input({
          amountFrequency: {
            ...stamp,
            observedAt: NOW + 1,
            validUntil: NOW + 2,
            exactAmountObservationCount: 2,
            cohortObservationCount: 5,
          },
        }),
      ),
    ).toThrow(/future/i);
    expect(() =>
      evaluatePrivacyPreflight(
        input({
          timingCorrelation: {
            ...stamp,
            validUntil: stamp.observedAt + 24 * 60 * 60 + 1,
            correlation: "not-observed",
          },
        }),
      ),
    ).toThrow(/validity window/i);
  });

  it("validates u256 quantities and evidence rather than coercing them", () => {
    expect(() => evaluatePrivacyPreflight(input({ amount: 0n }))).toThrow(
      /positive u256/i,
    );
    expect(() =>
      evaluatePrivacyPreflight(input({ amount: 1n << 256n })),
    ).toThrow(/positive u256/i);
    expect(() =>
      evaluatePrivacyPreflight(
        input({
          denominationAlternatives: { ...stamp, amounts: [0n] },
        }),
      ),
    ).toThrow(/denomination amount 0.*positive u256/i);
    expect(() =>
      evaluatePrivacyPreflight(
        input({
          amountFrequency: {
            ...stamp,
            exactAmountObservationCount: 21,
            cohortObservationCount: 20,
          },
        }),
      ),
    ).toThrow(/counts are invalid/i);
  });
});
