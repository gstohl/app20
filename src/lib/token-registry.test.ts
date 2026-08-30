import { describe, expect, it } from "vitest";
import unreviewedCandidate from "../../docs/evidence/token-candidates/UNREVIEWED.example.json";
import {
  APP20_TOKEN_REGISTRY_REVISION,
  app20TokenRegistry,
  configuredMarketPair,
  networkForProviderIndex,
  resolveCanonicalPair,
  resolveCanonicalToken,
  type App20CanonicalToken,
} from "./token-registry";

const registry: readonly App20CanonicalToken[] = [
  {
    network: "localnet",
    key: "strk",
    address: "0x4718",
    symbol: "STRK",
    decimals: 18,
    aliases: ["strk", "starknet"],
  },
  {
    network: "localnet",
    key: "usdc",
    address: "0x53c",
    symbol: "USDC",
    decimals: 6,
    aliases: ["usdc", "usd-coin"],
  },
];

describe("APP20 token registry", () => {
  it("resolves aliases and equivalent felt forms to reviewed metadata", () => {
    expect(APP20_TOKEN_REGISTRY_REVISION).toMatch(/^app20\/token-registry\//);
    expect(
      resolveCanonicalToken("localnet", "usd-coin", registry),
    ).toMatchObject({
      ok: true,
      token: { address: "0x53c", decimals: 6 },
    });
    expect(
      resolveCanonicalToken("localnet", "0x00053C", registry),
    ).toMatchObject({
      ok: true,
      token: { key: "usdc" },
    });
  });

  it("rejects canonical duplicates and unreviewed assets", () => {
    expect(
      resolveCanonicalPair("localnet", "usdc", "0x00053c", registry),
    ).toMatchObject({ ok: false, code: "SAME_TOKEN" });
    expect(resolveCanonicalToken("localnet", "eth", registry)).toMatchObject({
      ok: false,
      code: "TOKEN_NOT_ALLOWED",
    });
  });

  it("rejects conflicting aliases and cross-network registry reuse", () => {
    const conflict: readonly App20CanonicalToken[] = [
      ...registry,
      {
        network: "localnet",
        key: "strk",
        address: "0x999",
        symbol: "STRK",
        decimals: 18,
        aliases: ["usdc"],
      },
    ];
    expect(resolveCanonicalToken("localnet", "usdc", conflict)).toMatchObject({
      ok: false,
      code: "TOKEN_NOT_ALLOWED",
    });
    expect(resolveCanonicalToken("sepolia", "usdc", registry)).toMatchObject({
      ok: false,
      code: "TOKEN_UNCONFIGURED",
    });
  });

  it("never treats a token candidate evidence record as public runtime configuration", () => {
    const candidateRecord = {
      ...unreviewedCandidate,
      proposedAddress: "0x123",
      reviewerIdentity: "review-fixture@example.invalid",
      reviewDate: "2026-08-30T00:00:00.000Z",
    };
    const evidenceAsRegistry = [
      candidateRecord as unknown as App20CanonicalToken,
    ];

    expect(
      resolveCanonicalToken("sepolia", "0x123", evidenceAsRegistry),
    ).toMatchObject({ ok: false, code: "TOKEN_NOT_ALLOWED" });
    expect(
      resolveCanonicalToken("sepolia", "usdc", evidenceAsRegistry),
    ).toMatchObject({ ok: false, code: "TOKEN_UNCONFIGURED" });
    expect(
      app20TokenRegistry("sepolia").some((token) => token.key === "usdc"),
    ).toBe(false);
    expect(
      app20TokenRegistry("mainnet").some((token) => token.key === "usdc"),
    ).toBe(false);
    expect(configuredMarketPair("sepolia")).toMatchObject({
      ok: false,
      code: "TOKEN_UNCONFIGURED",
    });
    expect(configuredMarketPair("mainnet")).toMatchObject({
      ok: false,
      code: "TOKEN_UNCONFIGURED",
    });
  });

  it("maps only supported provider indices", () => {
    expect(networkForProviderIndex(0)).toBe("mainnet");
    expect(networkForProviderIndex(2)).toBe("sepolia");
    expect(networkForProviderIndex(1)).toBeNull();
  });
});
