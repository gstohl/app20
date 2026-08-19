import { describe, expect, it } from "vitest";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import {
  assertWalletOperationPolicy,
  assertWalletSubmissionPolicy,
  isSelectablePrivacyWallet,
} from "./wallet-policy";

function wallet(id: string): WalletWithStarknetFeatures {
  return {
    name: id,
    version: "1.0.0",
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    chains: [],
    accounts: [],
    features: {
      "starknet:walletApi": {
        id,
        version: "1.0.0",
        walletVersion: "test",
        request: async () => undefined,
      },
    },
  } as unknown as WalletWithStarknetFeatures;
}

describe("Wallet Standard product policy", () => {
  it("selects reviewed Ready lineage IDs without trusting the display name", () => {
    expect(isSelectablePrivacyWallet(wallet("argentX"))).toBe(true);
    expect(isSelectablePrivacyWallet(wallet("ready"))).toBe(true);
    expect(isSelectablePrivacyWallet(wallet("Ready Wallet Copy"))).toBe(false);
  });

  it("blocks unreviewed wallet IDs on both live networks", () => {
    expect(() =>
      assertWalletOperationPolicy(wallet("xverse"), 0, "private-transfer"),
    ).toThrow(/Ready/i);
    expect(() =>
      assertWalletOperationPolicy(wallet("xverse"), 2, "private-transfer"),
    ).toThrow(/Ready/i);
  });

  it("allows Ready operations on Mainnet and Sepolia", () => {
    expect(() =>
      assertWalletOperationPolicy(wallet("argentX"), 0, "mail"),
    ).not.toThrow();
    expect(() =>
      assertWalletOperationPolicy(wallet("ready"), 2, "private-read"),
    ).not.toThrow();
  });

  it("lets Ready submit a public send and blocks unreviewed wallets", () => {
    expect(() =>
      assertWalletSubmissionPolicy(wallet("ready"), 0, "public-send"),
    ).not.toThrow();
    expect(() =>
      assertWalletSubmissionPolicy(wallet("xverse"), 0, "public-send"),
    ).toThrow(/Ready/i);
  });
});
