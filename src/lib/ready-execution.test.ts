import { describe, expect, it } from "vitest";
import { assertReadyRailSelected, readyExecutionDrift } from "./ready-execution";

describe("readyExecutionDrift", () => {
  it("requires an explicit Ready rail at the signing sink", () => {
    expect(() => assertReadyRailSelected("privy")).toThrow(/switch explicitly to the Ready rail/i);
    expect(() => assertReadyRailSelected("ready")).not.toThrow();
  });

  it("accepts the same account and network", () => {
    expect(
      readyExecutionDrift(
        { address: "0x1", chainId: "0x1", providerIndex: 0 },
        { address: "0x1", chainId: "0x1", providerIndex: 0 },
      ),
    ).toBeNull();
  });

  it("rejects an account change", () => {
    expect(
      readyExecutionDrift(
        { address: "0x1", chainId: "0x1", providerIndex: 2 },
        { address: "0x2", chainId: "0x1", providerIndex: 2 },
      ),
    ).toMatch(/account changed/i);
  });

  it("rejects a wallet chain switch", () => {
    expect(
      readyExecutionDrift(
        { address: "0x1", chainId: "0x1", providerIndex: 0 },
        { address: "0x1", chainId: "0x2", providerIndex: 0 },
      ),
    ).toMatch(/wallet chain changed/i);
  });

  it("rejects a Sepolia to Mainnet switch", () => {
    expect(
      readyExecutionDrift(
        { address: "0x1", chainId: "0x1", providerIndex: 2 },
        { address: "0x1", chainId: "0x1", providerIndex: 0 },
      ),
    ).toMatch(/network changed/i);
  });
});
