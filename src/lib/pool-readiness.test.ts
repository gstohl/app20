import { describe, expect, it } from "vitest";
import {
  POOL_READINESS_DEFINITIONS,
  buildPoolReadiness,
  type PoolReadinessInput,
} from "./pool-readiness";

describe("pool deployment readiness evidence", () => {
  it("represents every missing category independently as unknown and blocked", () => {
    const readiness = buildPoolReadiness();

    expect(Object.keys(readiness.checks)).toEqual([
      "correctNetwork",
      "ownerAccount",
      "allowedContracts",
      "requiredBalances",
      "factoryAddress",
      "abiHash",
      "calldata",
      "independentReview",
      "fundingApprovals",
      "walletConfirmation",
    ]);
    expect(
      Object.values(readiness.checks).map(({ key, status }) => [key, status]),
    ).toEqual(POOL_READINESS_DEFINITIONS.map(({ key }) => [key, "unknown"]));
    expect(readiness.blockedBy).toEqual(
      POOL_READINESS_DEFINITIONS.map(({ key }) => key),
    );
    expect(readiness.deployment.status).toBe("block");
  });

  it("keeps network, owner, contracts, and balances as separate evidence", () => {
    const readiness = buildPoolReadiness({
      correctNetwork: {
        status: "pass",
        freshness: "current",
        evidence: "Active chain matches the proposal chain.",
      },
      ownerAccount: {
        status: "block",
        freshness: "current",
        evidence: "Active account differs from the proposal owner.",
      },
      allowedContracts: {
        status: "pass",
        freshness: "current",
        evidence: "Both contracts resolve in registry revision test-7.",
      },
      requiredBalances: {
        status: "unknown",
        freshness: "unknown",
        evidence: "No authoritative balance read is available.",
      },
    });

    expect(readiness.checks.correctNetwork.status).toBe("pass");
    expect(readiness.checks.ownerAccount.status).toBe("block");
    expect(readiness.checks.allowedContracts.status).toBe("pass");
    expect(readiness.checks.requiredBalances.status).toBe("unknown");
    expect(readiness.blockedBy).toContain("ownerAccount");
    expect(readiness.blockedBy).toContain("requiredBalances");
    expect(readiness.blockedBy).not.toContain("allowedContracts");
  });

  it("downgrades stale passing evidence to block and unqualified passing evidence to unknown", () => {
    const readiness = buildPoolReadiness({
      correctNetwork: {
        status: "pass",
        freshness: "stale",
        evidence: "The network matched before the latest context change.",
      },
      ownerAccount: {
        status: "pass",
        evidence: "The account was observed without freshness evidence.",
      },
      allowedContracts: {
        status: "pass",
        freshness: "current",
        evidence: "",
      },
    });

    expect(readiness.checks.correctNetwork).toMatchObject({
      status: "block",
      freshness: "stale",
    });
    expect(readiness.checks.ownerAccount).toMatchObject({
      status: "unknown",
      freshness: "unknown",
    });
    expect(readiness.checks.allowedContracts).toMatchObject({
      status: "unknown",
      freshness: "current",
    });
    expect(readiness.deployment.status).toBe("block");
  });

  it("keeps factory address, ABI hash, and calldata independently unavailable", () => {
    const readiness = buildPoolReadiness({
      factoryAddress: {
        status: "unknown",
        freshness: "unknown",
        evidence: "No reviewed production factory address is available.",
      },
      abiHash: {
        status: "unknown",
        freshness: "unknown",
        evidence: "No reviewed production ABI hash is available.",
      },
      calldata: {
        status: "unknown",
        freshness: "unknown",
        evidence: "No reviewed deployment calldata is available.",
      },
    });

    expect(readiness.checks.factoryAddress.status).toBe("unknown");
    expect(readiness.checks.abiHash.status).toBe("unknown");
    expect(readiness.checks.calldata.status).toBe("unknown");
    expect(readiness.blockedBy).toEqual(
      expect.arrayContaining(["factoryAddress", "abiHash", "calldata"]),
    );
    expect(readiness.deployment).toMatchObject({ status: "block" });
  });

  it("never turns passing evidence into deployment authorization", () => {
    const allCurrentPass = Object.fromEntries(
      POOL_READINESS_DEFINITIONS.map(({ key }) => [
        key,
        {
          status: "pass",
          freshness: "current",
          evidence: `Current test evidence for ${key}.`,
        },
      ]),
    ) as PoolReadinessInput;

    const readiness = buildPoolReadiness(allCurrentPass);
    expect(readiness.blockedBy).toEqual([]);
    expect(
      Object.values(readiness.checks).every((check) => check.status === "pass"),
    ).toBe(true);
    expect(readiness.deployment).toEqual({
      status: "block",
      evidence:
        "Passing readiness evidence is informational only; deployment is unavailable in this proposal-only model.",
    });
  });
});
