import { describe, expect, it } from "vitest";
import { constants } from "starknet";
import { resolveActiveStarknetSession } from "./active-session";

const base = {
  mode: "ready" as const,
  providerIndex: 2,
  readyConnected: true,
  readyAddress: "0x123",
  readyChainId: constants.StarknetChainId.SN_SEPOLIA,
  privyConnected: false,
  privyAddress: "",
};

describe("active Starknet session", () => {
  it("returns the compatible active Ready account", () => {
    expect(resolveActiveStarknetSession(base)).toMatchObject({
      rail: "ready",
      account: "0x123",
      network: "sepolia",
      compatible: true,
    });
  });

  it("does not fall unknown or mismatched Ready chains back to Sepolia", () => {
    expect(
      resolveActiveStarknetSession({ ...base, readyChainId: "0x1234" }),
    ).toMatchObject({ network: null, chainId: null, compatible: false });
    expect(
      resolveActiveStarknetSession({ ...base, providerIndex: 0 }),
    ).toMatchObject({ network: "sepolia", compatible: false });
  });

  it("gives active Privy ownership precedence without exposing Ready", () => {
    expect(
      resolveActiveStarknetSession({
        ...base,
        mode: "privy",
        privyConnected: true,
        privyAddress: "0x456",
      }),
    ).toMatchObject({
      rail: "privy",
      account: "0x456",
      network: "sepolia",
      compatible: true,
    });
  });
});
