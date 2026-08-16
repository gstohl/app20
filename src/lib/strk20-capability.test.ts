import { describe, expect, it } from "vitest";
import {
  evaluateStrk20Capability,
  formatStrk20CapabilityDiagnostic,
  supportsWalletApi010,
} from "./strk20";

const completeAccount = {
  strk20InvokeTransaction() {},
  strk20Balances() {},
};

describe("STRK20 wallet capability diagnostics", () => {
  it("accepts Wallet API 0.10 only when both account methods exist", () => {
    const capability = evaluateStrk20Capability({
      walletName: "Example privacy wallet",
      walletVersion: "1.0.0",
      walletApiVersions: ["0.10"],
      specVersions: ["0.9"],
      account: completeAccount,
    });

    expect(capability).toMatchObject({
      supported: true,
      versionSupported: true,
      walletApiVersions: ["0.10"],
      specVersions: ["0.9"],
      missingMethods: [],
      accountMethods: {
        strk20InvokeTransaction: true,
        strk20Balances: true,
      },
    });
  });

  it("fails closed when a wallet declares a new spec but omits a method", () => {
    const capability = evaluateStrk20Capability({
      walletName: "Incomplete wallet",
      walletApiVersions: [],
      specVersions: ["v0.10.3"],
      account: { strk20InvokeTransaction() {} },
    });

    expect(capability.versionSupported).toBe(true);
    expect(capability.supported).toBe(false);
    expect(capability.missingMethods).toEqual(["strk20Balances"]);
  });

  it("reports a connected wallet that has not declared the dapp API", () => {
    const capability = evaluateStrk20Capability({
      walletName: "XVERSE",
      walletVersion: "1.0.0",
      walletApiVersions: ["0.9"],
      specVersions: [],
      account: completeAccount,
      declarationErrors: { specs: "Method not implemented" },
    });
    const diagnostic = formatStrk20CapabilityDiagnostic(capability);

    expect(capability.supported).toBe(false);
    expect(diagnostic).toContain("Wallet: XVERSE");
    expect(diagnostic).toContain('walletApiVersions: ["0.9"]');
    expect(diagnostic).toContain("specVersions: []");
    expect(diagnostic).toContain("Required dapp-facing Wallet API: >= 0.10");
    expect(diagnostic).toContain("strk20InvokeTransaction: present");
    expect(diagnostic).toContain("strk20Balances: present");
    expect(diagnostic).toContain("Version requirement: not met");
    expect(diagnostic).toContain(
      "specVersions query error: Method not implemented",
    );
  });

  it.each([
    ["0.9", false],
    ["v0.10", true],
    ["0.10.3", true],
    ["1.0", true],
    ["not-a-version", false],
  ])("parses version %s", (version, expected) => {
    expect(supportsWalletApi010(version)).toBe(expected);
  });
});
