import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  READY_ACCOUNT_CLASS_HASH_V0_5_0,
  STRK20_POOL_SEPOLIA,
} from "../src/constants.js";
import { ConfigError } from "../src/errors.js";

const KEYS = [
  "PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "RPC_URL",
  "ALCHEMY_API_KEY",
  "STARKNET_NETWORK",
  "STRK20_POOL_ADDRESS",
  "STRK20_PROVING_URL",
  "STRK20_DISCOVERY_URL",
  "STRK20_PROVER_MODE",
  "STRK20_MATURITY_POLL_MS",
  "STRK20_MATURITY_TIMEOUT_MS",
  "READY_CLASSHASH",
];

const snapshot = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
});

describe("loadConfig", () => {
  it("requires Privy credentials", () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    expect(() => loadConfig({ rpcUrl: "https://example.invalid" })).toThrow(
      ConfigError,
    );
  });

  it("builds an Alchemy RPC URL when only the API key is set", () => {
    const config = loadConfig({
      network: "sepolia",
      privyAppId: "app",
      privyAppSecret: "secret",
      alchemyApiKey: "key-123",
    });
    expect(config.rpcUrl).toContain("starknet-sepolia.g.alchemy.com");
    expect(config.rpcUrl).toContain("key-123");
    expect(config.poolAddress).toBe(STRK20_POOL_SEPOLIA);
    expect(config.readyClassHash).toBe(READY_ACCOUNT_CLASS_HASH_V0_5_0);
  });

  it("prefers an explicit RPC URL over Alchemy", () => {
    const config = loadConfig({
      network: "mainnet",
      privyAppId: "app",
      privyAppSecret: "secret",
      rpcUrl: "https://custom.rpc",
      alchemyApiKey: "ignored",
    });
    expect(config.rpcUrl).toBe("https://custom.rpc");
    expect(config.poolAddress).toBeUndefined();
  });

  it("configures a non-submittable mock with direct contract discovery", () => {
    const config = loadConfig({
      network: "sepolia",
      privyAppId: "app",
      privyAppSecret: "secret",
      rpcUrl: "https://custom.rpc",
      proverMode: "mock",
    });

    expect(config.prover).toMatchObject({
      kind: "mock",
      submittable: false,
    });
    expect(config.discovery).toMatchObject({ kind: "contract" });
  });

  it("maps service URLs to submittable production sources", () => {
    const config = loadConfig({
      network: "sepolia",
      privyAppId: "app",
      privyAppSecret: "secret",
      rpcUrl: "https://custom.rpc",
      provingUrl: "https://prover.example",
      discoveryUrl: "https://discovery.example",
    });

    expect(config.prover).toMatchObject({
      kind: "service",
      submittable: true,
    });
    expect(config.discovery).toMatchObject({ kind: "service" });
  });

  it("rejects a submittable prover when mock mode is explicit", () => {
    expect(() =>
      loadConfig({
        network: "sepolia",
        privyAppId: "app",
        privyAppSecret: "secret",
        rpcUrl: "https://custom.rpc",
        proverMode: "mock",
        prover: {
          kind: "custom",
          submittable: true,
          resolve: async () => ({}),
        },
      }),
    ).toThrow(ConfigError);
  });

  it("validates maturity polling controls", () => {
    const config = loadConfig({
      network: "sepolia",
      privyAppId: "app",
      privyAppSecret: "secret",
      rpcUrl: "https://custom.rpc",
      maturityPollMs: 25,
      maturityTimeoutMs: 1_000,
    });
    expect(config.maturityPollMs).toBe(25);
    expect(config.maturityTimeoutMs).toBe(1_000);

    expect(() =>
      loadConfig({
        privyAppId: "app",
        privyAppSecret: "secret",
        rpcUrl: "https://custom.rpc",
        maturityTimeoutMs: 0,
      }),
    ).toThrow(ConfigError);
  });

  it("requires a URL when service mode is explicitly enabled", () => {
    expect(() =>
      loadConfig({
        network: "sepolia",
        privyAppId: "app",
        privyAppSecret: "secret",
        rpcUrl: "https://custom.rpc",
        proverMode: "service",
      }),
    ).toThrow(ConfigError);
  });

  it("rejects an invalid prover mode from the environment", () => {
    process.env.STRK20_PROVER_MODE = "unsafe";
    expect(() =>
      loadConfig({
        privyAppId: "app",
        privyAppSecret: "secret",
        rpcUrl: "https://custom.rpc",
      }),
    ).toThrow(ConfigError);
  });
});
