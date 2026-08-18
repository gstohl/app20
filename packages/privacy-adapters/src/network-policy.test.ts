import { describe, expect, it } from "vitest";
import {
  assertSubmittableNetworkPolicy,
  evaluateNetworkPolicy,
  isReadyWalletFeatureId,
  NetworkPolicyError,
  type PrivacyAdapterKind,
  type PrivacyNetwork,
} from "./network-policy.js";

describe("evaluateNetworkPolicy", () => {
  const liveCases: Array<{
    network: PrivacyNetwork;
    adapter: PrivacyAdapterKind;
    allowed: boolean;
  }> = [
    { network: "mainnet", adapter: "ready", allowed: true },
    { network: "mainnet", adapter: "privy", allowed: false },
    { network: "mainnet", adapter: "localnet", allowed: false },
    { network: "sepolia", adapter: "ready", allowed: true },
    { network: "sepolia", adapter: "privy", allowed: true },
    { network: "sepolia", adapter: "localnet", allowed: false },
    { network: "localnet", adapter: "localnet", allowed: true },
    { network: "localnet", adapter: "ready", allowed: false },
    { network: "localnet", adapter: "privy", allowed: false },
  ];

  for (const testCase of liveCases) {
    it(`${testCase.allowed ? "allows" : "blocks"} ${testCase.network} + ${testCase.adapter}`, () => {
      const decision = evaluateNetworkPolicy({
        ...testCase,
        operation: "private-transfer",
        submissionMode: "live",
      });
      expect(decision.allowed).toBe(testCase.allowed);
      expect(decision.submittable).toBe(testCase.allowed);
    });
  }

  it("allows review builds but marks them non-submittable", () => {
    expect(
      evaluateNetworkPolicy({
        network: "sepolia",
        adapter: "privy",
        operation: "mail",
        submissionMode: "build-only",
      }),
    ).toMatchObject({ allowed: true, submittable: false, code: "build-only" });
  });

  it("does not downgrade private reads in build-only mode", () => {
    expect(
      evaluateNetworkPolicy({
        network: "sepolia",
        adapter: "privy",
        operation: "private-read",
        submissionMode: "build-only",
      }),
    ).toMatchObject({ allowed: true, submittable: true, code: "allowed" });
  });

  it("throws a stable policy error before a forbidden submission", () => {
    expect(() =>
      assertSubmittableNetworkPolicy({
        network: "mainnet",
        adapter: "privy",
        operation: "shield",
        submissionMode: "live",
      }),
    ).toThrow(NetworkPolicyError);
  });
});

describe("isReadyWalletFeatureId", () => {
  it.each(["ready", "Ready", "argentX", "argent-x"])(
    "accepts the reviewed Ready lineage id %s",
    (id) => expect(isReadyWalletFeatureId(id)).toBe(true),
  );

  it.each(["Ready Wallet Copy", "xverse", "metamask", "", "ready-evil"])(
    "rejects an unreviewed or display-name-only id %s",
    (id) => expect(isReadyWalletFeatureId(id)).toBe(false),
  );
});
