import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_PUBLIC_HEDGE_DWELL_SECONDS,
  OPERATIONS_HAS_ATOMIC_CROSSING,
  OPERATIONS_HAS_INVENTORY_PROOF,
  RISK_EXCEPTION_DOMAIN,
  RISK_MANIFEST_DOMAIN,
  assessExposure,
  browserSafeMakerOperations,
  normalizeRiskManifestBody,
  planOperationalNetting,
  riskExceptionBodyDigest,
  riskManifestBodyDigest,
  transitionOperationsControl,
  verifyRiskException,
  verifyRiskManifest,
  type RiskExceptionBodyV1,
  type RiskManifestBodyV1,
  type SignedRiskExceptionV1,
  type SignedRiskManifestV1,
  type VerifiedRiskManifest,
} from "./operations.js";

const now = 2_000_000_000;
const tokenA = "0x111";
const tokenB = "0x222";

function body(overrides: Partial<RiskManifestBodyV1> = {}): RiskManifestBodyV1 {
  return {
    domain: RISK_MANIFEST_DOMAIN,
    version: 1,
    manifestId: `0x${"11".repeat(32)}`,
    previousManifestDigest: null,
    makerId: "maker-a",
    chainId: "starknet:APP20_LOCALNET",
    registryRevision: "app20-assets/localnet/2026-08-25",
    issuedAt: now - 100,
    validFrom: now - 50,
    validUntil: now + 86_400,
    minimumHedgeDwellSeconds: 1_800,
    maximumHedgeDwellSeconds: DEFAULT_MAX_PUBLIC_HEDGE_DWELL_SECONDS,
    assets: [
      {
        token: tokenA,
        denominationBaseUnits: "25",
        minBatchBaseUnits: "50",
        maxPerTradeBaseUnits: "500",
        maxGrossExposureBaseUnits: "1000",
        maxNetExposureBaseUnits: "750",
        maxDailyFilledBaseUnits: "2000",
      },
      {
        token: tokenB,
        denominationBaseUnits: "25",
        minBatchBaseUnits: "50",
        maxPerTradeBaseUnits: "500",
        maxGrossExposureBaseUnits: "1000",
        maxNetExposureBaseUnits: "750",
        maxDailyFilledBaseUnits: "2000",
      },
    ],
    venues: [
      { venueId: "approved-public-venue", route: "public", enabled: true },
    ],
    ...overrides,
  };
}

async function signedManifest(
  manifestBody = body(),
): Promise<SignedRiskManifestV1> {
  return {
    version: 1,
    body: manifestBody,
    bodyDigest: await riskManifestBodyDigest(manifestBody),
    approvals: [
      { role: "risk", approverKeyId: "risk-key-a", signature: "0x1" },
      {
        role: "operations",
        approverKeyId: "operations-key-a",
        signature: "0x2",
      },
    ],
  };
}

async function verifiedManifest(
  manifestBody = body(),
): Promise<VerifiedRiskManifest> {
  return verifyRiskManifest(await signedManifest(manifestBody), {
    now,
    verifyApproval: async () => true,
  });
}

async function signedException(
  manifest: VerifiedRiskManifest,
  overrides: Partial<RiskExceptionBodyV1> = {},
): Promise<SignedRiskExceptionV1> {
  const exceptionBody: RiskExceptionBodyV1 = {
    domain: RISK_EXCEPTION_DOMAIN,
    version: 1,
    exceptionId: `0x${"22".repeat(32)}`,
    manifestDigest: manifest.bodyDigest,
    makerId: manifest.body.makerId,
    kind: "per-trade-cap-override",
    token: tokenB,
    maximumAmountBaseUnits: "700",
    reason: "Reviewed localnet exception exercise.",
    issuedAt: now - 1,
    expiresAt: now + 300,
    ...overrides,
  };
  return {
    version: 1,
    body: exceptionBody,
    bodyDigest: await riskExceptionBodyDigest(exceptionBody),
    approvals: [
      { role: "risk", approverKeyId: "risk-key-a", signature: "0x1" },
      { role: "risk", approverKeyId: "risk-key-b", signature: "0x2" },
      {
        role: "security_compliance",
        approverKeyId: "security-key-a",
        signature: "0x3",
      },
    ],
  };
}

describe("signed maker risk policy", () => {
  it("requires current Risk and Operations approvals over the exact manifest", async () => {
    const signed = await signedManifest();
    const verified = await verifyRiskManifest(signed, {
      now,
      verifyApproval: async (digest, approval) =>
        digest === signed.bodyDigest && approval.signature !== "0x0",
    });
    expect(verified.body.makerId).toBe("maker-a");
    expect(verified.body.assets.map((asset) => asset.token)).toEqual([
      "0x111",
      "0x222",
    ]);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.body.assets)).toBe(true);
    expect(() =>
      assessExposure(
        { ...verified } as VerifiedRiskManifest,
        {
          makerId: "maker-a",
          token: tokenB,
          observedAt: now,
          grossExposureBaseUnits: "0",
          netExposureBaseUnits: "0",
          dailyFilledBaseUnits: "0",
          outstandingEscrowBaseUnits: "0",
          reconciliation: "current",
        },
        "1",
        now,
      ),
    ).toThrow(/approval verification/i);

    await expect(
      verifyRiskManifest(
        {
          ...signed,
          body: { ...signed.body, registryRevision: "tampered" },
        },
        { now, verifyApproval: async () => true },
      ),
    ).rejects.toThrow(/digest/i);
    await expect(
      verifyRiskManifest(
        { ...signed, approvals: signed.approvals.slice(0, 1) },
        { now, verifyApproval: async () => true },
      ),
    ).rejects.toThrow(/Risk and Operations/i);
    await expect(
      verifyRiskManifest(signed, {
        now: signed.body.validUntil + 1,
        verifyApproval: async () => true,
      }),
    ).rejects.toThrow(/currently valid/i);
    expect(() =>
      normalizeRiskManifestBody(
        body({
          assets: [
            {
              token: "0x0",
              denominationBaseUnits: "25",
              minBatchBaseUnits: "50",
              maxPerTradeBaseUnits: "500",
              maxGrossExposureBaseUnits: "1000",
              maxNetExposureBaseUnits: "750",
              maxDailyFilledBaseUnits: "2000",
            },
          ],
        }),
      ),
    ).toThrow(/canonical Starknet felt/i);
  });

  it("requires dual Risk and Security/Compliance approval for exceptions", async () => {
    const manifest = await verifiedManifest();
    const signed = await signedException(manifest);
    const verified = await verifyRiskException(signed, manifest, {
      now,
      verifyApproval: async () => true,
    });
    expect(verified.body.kind).toBe("per-trade-cap-override");

    await expect(
      verifyRiskException(
        { ...signed, approvals: signed.approvals.slice(0, 2) },
        manifest,
        { now, verifyApproval: async () => true },
      ),
    ).rejects.toThrow(/Security\/Compliance/i);
  });

  it("fails closed on stale reconciliation and exposure caps unless a scoped exception is verified", async () => {
    const manifest = await verifiedManifest();
    const snapshot = {
      makerId: "maker-a",
      token: tokenB,
      observedAt: now,
      grossExposureBaseUnits: "500",
      netExposureBaseUnits: "400",
      dailyFilledBaseUnits: "1500",
      outstandingEscrowBaseUnits: "100",
      reconciliation: "drift" as const,
    };
    const blocked = assessExposure(manifest, snapshot, "600", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.blocks).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/reconciliation/i),
        expect.stringMatching(/per-trade/i),
        expect.stringMatching(/gross-exposure/i),
        expect.stringMatching(/net-exposure/i),
        expect.stringMatching(/daily-filled/i),
      ]),
    );

    const exception = await verifyRiskException(
      await signedException(manifest),
      manifest,
      { now, verifyApproval: async () => true },
    );
    const withException = assessExposure(
      manifest,
      {
        ...snapshot,
        grossExposureBaseUnits: "100",
        netExposureBaseUnits: "50",
        dailyFilledBaseUnits: "100",
        outstandingEscrowBaseUnits: "0",
        reconciliation: "current",
      },
      "600",
      now,
      exception,
    );
    expect(withException.allowed).toBe(true);
    expect(() =>
      assessExposure(
        manifest,
        { ...snapshot, reconciliation: "current" },
        "600",
        now,
        { ...exception } as typeof exception,
      ),
    ).toThrow(/approval verification/i);

    const afterExceptionExpiry = assessExposure(
      manifest,
      {
        ...snapshot,
        observedAt: now + 301,
        reconciliation: "current",
      },
      "600",
      now + 301,
      exception,
    );
    expect(afterExceptionExpiry.allowed).toBe(false);
    expect(afterExceptionExpiry.blocks).toContain(
      "Proposed trade exceeds the per-trade cap.",
    );
  });
});

describe("inventory operations", () => {
  it("nets finalized consented fills, waits for dwell, then rounds public residuals", async () => {
    const manifest = await verifiedManifest();
    const fills = [
      {
        fillDigest: `sha256:${"31".repeat(32)}`,
        finalized: true,
        principalNettingConsent: true,
        sellToken: tokenA,
        sellAmount: 100n,
        buyToken: tokenB,
        buyAmount: 80n,
        filledAt: now,
      },
    ];
    const early = planOperationalNetting(manifest, fills, now + 1_000);
    expect(early).toMatchObject({
      mode: "independent-fill-netting",
      atomic: false,
      publicHedgeOrders: [],
    });
    expect(early.deferred[0]?.reason).toMatch(/dwell/i);

    const matured = planOperationalNetting(manifest, fills, now + 1_800);
    expect(matured.publicHedgeOrders).toEqual([
      expect.objectContaining({
        token: tokenB,
        amountBaseUnits: "100",
        venueId: "approved-public-venue",
      }),
    ]);
    expect(matured.publicHedgeOrders[0]?.correlationWarning).toMatch(
      /do not make it private/i,
    );
    expect(OPERATIONS_HAS_ATOMIC_CROSSING).toBe(false);
    expect(OPERATIONS_HAS_INVENTORY_PROOF).toBe(false);
    expect(() =>
      planOperationalNetting(manifest, [fills[0], fills[0]], now + 1_800),
    ).toThrow(/twice/i);
  });

  it("never nets unfinalized flow or flow without principal-netting consent", async () => {
    const manifest = await verifiedManifest();
    expect(
      planOperationalNetting(
        manifest,
        [
          {
            fillDigest: `sha256:${"41".repeat(32)}`,
            finalized: false,
            principalNettingConsent: false,
            sellToken: tokenA,
            sellAmount: 100n,
            buyToken: tokenB,
            buyAmount: 80n,
            filledAt: now,
          },
        ],
        now + 1_800,
      ).matchedFillDigests,
    ).toEqual([]);
    expect(() =>
      planOperationalNetting(
        manifest,
        [
          {
            fillDigest: `sha256:${"42".repeat(32)}`,
            finalized: true,
            principalNettingConsent: false,
            sellToken: tokenA,
            sellAmount: 100n,
            buyToken: tokenB,
            buyAmount: 80n,
            filledAt: now,
          },
        ],
        now + 1_800,
      ),
    ).toThrow(/consent/i);
    expect(() =>
      planOperationalNetting(
        manifest,
        [
          {
            fillDigest: `sha256:${"43".repeat(32)}`,
            finalized: true,
            principalNettingConsent: true,
            sellToken: tokenA,
            sellAmount: 1n << 256n,
            buyToken: tokenB,
            buyAmount: 80n,
            filledAt: now,
          },
        ],
        now + 1_800,
      ),
    ).toThrow(/positive u256/i);
  });

  it("blocks public restocking when no approved venue is enabled", async () => {
    const manifest = await verifiedManifest(
      body({
        venues: [{ venueId: "disabled", route: "public", enabled: false }],
      }),
    );
    const plan = planOperationalNetting(
      manifest,
      [
        {
          fillDigest: `sha256:${"51".repeat(32)}`,
          finalized: true,
          principalNettingConsent: true,
          sellToken: tokenA,
          sellAmount: 100n,
          buyToken: tokenB,
          buyAmount: 80n,
          filledAt: now,
        },
      ],
      now + 1_800,
    );
    expect(plan.publicHedgeOrders).toEqual([]);
    expect(plan.blocked[0]?.reason).toMatch(/No approved/i);
  });

  it("publishes bands and utilization without exposing raw balances", () => {
    const control = {
      mode: "running" as const,
      reason: "Normal operations",
      updatedAt: now,
      updatedBy: "operator-a",
      claimsAndRefundsEnabled: true as const,
    };
    const next = transitionOperationsControl(control, {
      mode: "drain-only",
      reason: "Reconciliation drill",
      updatedAt: now + 1,
      updatedBy: "operator-b",
    });
    expect(next).toMatchObject({
      mode: "drain-only",
      claimsAndRefundsEnabled: true,
    });
    expect(() =>
      transitionOperationsControl(next, {
        mode: "paused",
        reason: "stale",
        updatedAt: now,
        updatedBy: "operator-b",
      }),
    ).toThrow(/monotonic/i);

    const safe = browserSafeMakerOperations({
      makerId: "maker-a",
      control: next,
      reconciliation: "current",
      activeReservations: 2,
      quarantinedReservations: 1,
      capacities: [
        {
          token: tokenB,
          availableBaseUnits: 750n,
          exposureBaseUnits: 250n,
          exposureCapBaseUnits: 1_000n,
          smallThresholdBaseUnits: 100n,
          mediumThresholdBaseUnits: 500n,
        },
      ],
    });
    expect(safe).toMatchObject({
      rawBalancesExposed: false,
      capacity: [
        {
          token: tokenB,
          band: "large",
          exposureUtilizationBps: 2500,
        },
      ],
    });
    expect(JSON.stringify(safe)).not.toContain("750");
    expect(JSON.stringify(safe)).not.toContain("availableBaseUnits");
  });
});
