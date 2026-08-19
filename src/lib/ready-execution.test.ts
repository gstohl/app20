import { describe, expect, it } from "vitest";
import { readyExecutionDrift } from "./ready-execution";

describe("readyExecutionDrift", () => {
  it("accepts the same account and network", () => {
    expect(
      readyExecutionDrift(
        { address: "0x1", providerIndex: 0 },
        { address: "0x1", providerIndex: 0 },
      ),
    ).toBeNull();
  });

  it("rejects an account change", () => {
    expect(
      readyExecutionDrift(
        { address: "0x1", providerIndex: 2 },
        { address: "0x2", providerIndex: 2 },
      ),
    ).toMatch(/account changed/i);
  });

  it("rejects a Sepolia to Mainnet switch", () => {
    expect(
      readyExecutionDrift(
        { address: "0x1", providerIndex: 2 },
        { address: "0x1", providerIndex: 0 },
      ),
    ).toMatch(/network changed/i);
  });
});
