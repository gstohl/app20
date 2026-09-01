import { describe, expect, it } from "vitest";
import {
  APP20_INTENT_DOMAIN,
  CROSS_CHAIN_STAGES,
  canonicalizeCrossChainIntent,
  canTransitionCrossChainStage,
  createCrossChainLifecycle,
  digestCrossChainIntent,
  transitionCrossChainLifecycle,
  transitionCrossChainStage,
  type CrossChainIntentV1,
  type CrossChainStage,
} from "./index";

const ACTIVE_NOW = Date.parse("2030-01-01T00:01:00.000Z");
const EXPIRED_NOW = Date.parse("2030-01-01T00:05:00.000Z");

function intent(
  overrides: Partial<CrossChainIntentV1> = {},
): CrossChainIntentV1 {
  return {
    version: 1,
    intentId: "intent-0123456789abcdef0123456789abcdef",
    revision: 0,
    kind: "cross-chain",
    sourceAccount: {
      id: "starknet:mainnet:0x123",
      chainId: "starknet:SN_MAIN",
      address: "0x123",
      signer: "ready",
      custody: "user",
      capabilities: ["strk20", "wallet-standard"],
      policyMode: "advisory",
    },
    destinationAccount: {
      chainId: "eip155:1",
      address: "0x456",
    },
    refundAccount: {
      chainId: "starknet:SN_MAIN",
      address: "0x123",
    },
    sourceAsset: {
      chainId: "starknet:SN_MAIN",
      assetId: "starknet:STRK",
      decimals: 18,
    },
    destinationAsset: {
      chainId: "eip155:1",
      assetId: "eip155:1/erc20:0xabc",
      decimals: 6,
    },
    amount: "1000000000000000000",
    minimumOutput: "990000",
    maximumFee: "10000",
    slippageBps: 100,
    deadline: "2030-01-01T00:10:00.000Z",
    providerId: "near-intents:1click",
    swapMode: "exact-input",
    fundingMode: "origin-chain",
    deliveryMode: "destination-chain",
    refundMode: "origin-chain",
    privacyMode: "public",
    disclosedTo: [
      "intents-provider",
      "solver",
      "source-chain",
      "destination-chain",
    ],
    createdAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:05:00.000Z",
    ...overrides,
  };
}

describe("APP20 canonical intents", () => {
  it("uses a domain-separated deterministic encoding", () => {
    const encoded = canonicalizeCrossChainIntent(intent());
    expect(encoded).toContain(`"domain":"${APP20_INTENT_DOMAIN}"`);
    expect(encoded).toBe(canonicalizeCrossChainIntent(intent()));
  });

  it("sorts set-like fields while binding every disclosure recipient", async () => {
    const first = intent();
    const reorderedCapabilities = intent({
      sourceAccount: {
        ...first.sourceAccount,
        capabilities: ["wallet-standard", "strk20"],
      },
    });
    expect(await digestCrossChainIntent(first)).toBe(
      await digestCrossChainIntent(reorderedCapabilities),
    );

    const reorderedDisclosure = intent({
      disclosedTo: [
        "solver",
        "intents-provider",
        "source-chain",
        "destination-chain",
      ],
    });
    expect(await digestCrossChainIntent(first)).toBe(
      await digestCrossChainIntent(reorderedDisclosure),
    );
    const fewerDisclosures = intent({
      disclosedTo: ["intents-provider", "solver", "source-chain"],
    });
    expect(await digestCrossChainIntent(first)).not.toBe(
      await digestCrossChainIntent(fewerDisclosures),
    );
  });

  it("binds accounts, modes, amounts, bounds, deadlines, and disclosures", async () => {
    const base = await digestCrossChainIntent(intent());
    const original = intent();
    const changed: readonly CrossChainIntentV1[] = [
      intent({
        sourceAccount: { ...original.sourceAccount, address: "0x124" },
      }),
      intent({
        destinationAccount: {
          ...original.destinationAccount,
          address: "0x457",
        },
      }),
      intent({
        refundAccount: { ...original.refundAccount, address: "0x125" },
      }),
      intent({ swapMode: "flex-input" }),
      intent({ fundingMode: "intents" }),
      intent({ deliveryMode: "intents" }),
      intent({ refundMode: "intents" }),
      intent({ amount: "1000000000000000001" }),
      intent({ minimumOutput: "990001" }),
      intent({ maximumFee: "10001" }),
      intent({ slippageBps: 101 }),
      intent({ deadline: "2030-01-01T00:11:00.000Z" }),
      intent({ expiresAt: "2030-01-01T00:04:59.000Z" }),
      intent({
        disclosedTo: [
          "intents-provider",
          "solver",
          "source-chain",
          "destination-chain",
          "policy-enclave",
        ],
      }),
    ];
    for (const mutation of changed) {
      expect(await digestCrossChainIntent(mutation)).not.toBe(base);
    }
  });

  it.each([
    ["amount", "01"],
    ["minimumOutput", "-1"],
    ["maximumFee", "1.5"],
    ["amount", `1${"0".repeat(78)}`],
  ] as const)("rejects non-canonical %s base units", (field, value) => {
    expect(() =>
      canonicalizeCrossChainIntent(intent({ [field]: value })),
    ).toThrow(/canonical|greater than zero/i);
  });

  it("rejects hostile runtime enum values at every trust boundary", () => {
    const base = intent();
    const hostile: CrossChainIntentV1[] = [
      intent({ providerId: "other" as CrossChainIntentV1["providerId"] }),
      intent({ swapMode: "evil" as CrossChainIntentV1["swapMode"] }),
      intent({ fundingMode: "evil" as CrossChainIntentV1["fundingMode"] }),
      intent({ deliveryMode: "evil" as CrossChainIntentV1["deliveryMode"] }),
      intent({ refundMode: "evil" as CrossChainIntentV1["refundMode"] }),
      intent({ privacyMode: "evil" as CrossChainIntentV1["privacyMode"] }),
      intent({
        sourceAccount: {
          ...base.sourceAccount,
          signer: "evil" as CrossChainIntentV1["sourceAccount"]["signer"],
        },
      }),
      intent({
        sourceAccount: {
          ...base.sourceAccount,
          custody: "evil" as CrossChainIntentV1["sourceAccount"]["custody"],
        },
      }),
      intent({
        sourceAccount: {
          ...base.sourceAccount,
          policyMode:
            "evil" as CrossChainIntentV1["sourceAccount"]["policyMode"],
        },
      }),
      intent({
        disclosedTo: ["evil" as CrossChainIntentV1["disclosedTo"][number]],
      }),
    ];
    for (const value of hostile) {
      expect(() => canonicalizeCrossChainIntent(value)).toThrow(/supported/i);
    }
  });

  it("rejects malformed identifiers, timestamps, duplicate sets, and extra fields", () => {
    const base = intent();
    expect(() =>
      canonicalizeCrossChainIntent(intent({ intentId: "short" })),
    ).toThrow(/intentId/i);
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({
          sourceAccount: { ...base.sourceAccount, chainId: "starknet mainnet" },
        }),
      ),
    ).toThrow(/chain identifier/i);
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({ sourceAccount: { ...base.sourceAccount, id: " bad-id" } }),
      ),
    ).toThrow(/malformed/i);
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({ createdAt: "2030-02-30T00:00:00.000Z" }),
      ),
    ).toThrow(/real canonical/i);
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({
          sourceAccount: {
            ...base.sourceAccount,
            capabilities: ["strk20", "strk20"],
          },
        }),
      ),
    ).toThrow(/duplicates/i);
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({ disclosedTo: ["solver", "solver"] }),
      ),
    ).toThrow(/duplicates/i);
    expect(() =>
      canonicalizeCrossChainIntent({
        ...base,
        unboundTerm: "mallory",
      } as CrossChainIntentV1),
    ).toThrow(/unrecognized field/i);
  });

  it("rejects source, destination, refund, and cross-chain mismatches", () => {
    const base = intent();
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({
          sourceAsset: { ...base.sourceAsset, chainId: "eip155:1" },
        }),
      ),
    ).toThrow(/source account and source asset/i);
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({
          destinationAccount: {
            ...base.destinationAccount,
            chainId: "eip155:10",
          },
        }),
      ),
    ).toThrow(/destination account and destination asset/i);
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({
          refundAccount: { ...base.refundAccount, chainId: "eip155:1" },
        }),
      ),
    ).toThrow(/origin-chain refund/i);
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({
          destinationAccount: {
            ...base.destinationAccount,
            chainId: base.sourceAsset.chainId,
          },
          destinationAsset: {
            ...base.destinationAsset,
            chainId: base.sourceAsset.chainId,
          },
        }),
      ),
    ).toThrow(/different source and destination/i);
  });

  it("rejects expiry after the provider deadline", () => {
    expect(() =>
      canonicalizeCrossChainIntent(
        intent({ expiresAt: "2030-01-01T00:11:00.000Z" }),
      ),
    ).toThrow(/expiresAt cannot be later/i);
  });
});

describe("APP20 cross-chain lifecycle", () => {
  it("permits the reviewed happy-path ordering", () => {
    const stages = [
      "VALIDATING",
      "PREFLIGHT_POLICY",
      "QUOTING",
      "AWAITING_REVIEW",
      "BUILDING",
      "AWAITING_FINAL_POLICY",
      "AWAITING_SIGNATURE",
      "SUBMITTING",
      "SUBMITTED",
      "SOURCE_CONFIRMING",
      "SOURCE_FINALIZED",
      "SETTLEMENT_PENDING",
      "DESTINATION_CONFIRMING",
      "COMPLETED",
    ] as const;
    expect(
      stages.reduce<CrossChainStage>(
        (current, next) => transitionCrossChainStage(current, next),
        "DRAFT",
      ),
    ).toBe("COMPLETED");
  });

  it("requires policy preflight before every quote transition", () => {
    for (const stage of CROSS_CHAIN_STAGES) {
      expect(canTransitionCrossChainStage(stage, "QUOTING")).toBe(
        stage === "PREFLIGHT_POLICY",
      );
    }
    expect(canTransitionCrossChainStage("AWAITING_REVIEW", "VALIDATING")).toBe(
      true,
    );
  });

  it("forces unknown submissions into reconciliation instead of retry", () => {
    expect(
      canTransitionCrossChainStage("SUBMITTING", "SUBMISSION_UNKNOWN"),
    ).toBe(true);
    expect(
      canTransitionCrossChainStage("SUBMISSION_UNKNOWN", "SUBMITTING"),
    ).toBe(false);
    expect(() =>
      transitionCrossChainStage("SUBMISSION_UNKNOWN", "SUBMITTING"),
    ).toThrow(/invalid/i);
  });

  it("binds transitions to the exact active revision and canonical terms", async () => {
    const original = intent();
    const state = await createCrossChainLifecycle(original, ACTIVE_NOW);
    await expect(
      transitionCrossChainLifecycle(
        state,
        intent({ revision: 1 }),
        "VALIDATING",
        ACTIVE_NOW,
      ),
    ).rejects.toThrow(/stale intent revision/i);
    await expect(
      transitionCrossChainLifecycle(
        state,
        intent({ amount: "1000000000000000001" }),
        "VALIDATING",
        ACTIVE_NOW,
      ),
    ).rejects.toThrow(/without a revision increment|stale/i);
    await expect(
      transitionCrossChainLifecycle(state, original, "VALIDATING", ACTIVE_NOW),
    ).resolves.toMatchObject({ stage: "VALIDATING", revision: 0 });
  });

  it("refuses to start or retry an expired revision", async () => {
    const active = intent();
    const state = await createCrossChainLifecycle(active, ACTIVE_NOW);
    await expect(
      transitionCrossChainLifecycle(state, active, "VALIDATING", EXPIRED_NOW),
    ).rejects.toThrow(/expired/i);
    await expect(
      transitionCrossChainLifecycle(state, active, "EXPIRED", EXPIRED_NOW),
    ).resolves.toMatchObject({ stage: "EXPIRED" });
    await expect(
      createCrossChainLifecycle(active, EXPIRED_NOW),
    ).rejects.toThrow(/expired/i);
  });

  it("does not leave terminal states", () => {
    expect(() => transitionCrossChainStage("COMPLETED", "DRAFT")).toThrow(
      /terminal/i,
    );
    expect(() => transitionCrossChainStage("REFUNDED", "QUOTING")).toThrow(
      /terminal/i,
    );
  });
});
