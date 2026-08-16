import { describe, expect, it } from "vitest";
import {
  chainIdFromStandardAccount,
  describeWalletConnectError,
} from "./wallet-connect";

describe("chainIdFromStandardAccount", () => {
  it("strips the starknet: prefix", () => {
    expect(
      chainIdFromStandardAccount({ chains: ["starknet:SN_MAIN"] }),
    ).toBe("SN_MAIN");
  });

  it("returns a bare chain id", () => {
    expect(chainIdFromStandardAccount({ chains: ["SN_SEPOLIA"] })).toBe(
      "SN_SEPOLIA",
    );
  });

  it("returns null when no chain is declared", () => {
    expect(chainIdFromStandardAccount({})).toBeNull();
    expect(chainIdFromStandardAccount({ chains: [] })).toBeNull();
  });
});

describe("describeWalletConnectError", () => {
  it("explains Ready's Not preauthorized refusal", () => {
    expect(describeWalletConnectError(new Error("Not preauthorized"))).toMatch(
      /not authorized in the wallet yet/i,
    );
  });

  it("passes through other errors", () => {
    expect(describeWalletConnectError(new Error("User abort"))).toBe(
      "User abort",
    );
  });
});
