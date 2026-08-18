import { constants, RpcProvider } from "starknet";
import { describe, expect, it } from "vitest";
import { STRK20_POOL_SEPOLIA } from "../src/constants.js";
import { contractDiscovery } from "../src/discovery.js";
import { mockProver } from "../src/prover.js";
import { privyProxyProver } from "../src/proxy/provider.js";
import { loadPrivacyPoolAbi, loadPrivacySdkTesting } from "../src/sdk.js";

const sdkInstalled = await Promise.all([
  loadPrivacySdkTesting(),
  loadPrivacyPoolAbi(),
])
  .then(() => true)
  .catch(() => false);

/** Optional compatibility check; runs when the GitHub Packages peer is installed. */
describe.runIf(sdkInstalled)("official privacy SDK compatibility", () => {
  const provider = new RpcProvider({
    nodeUrl: "https://rpc.invalid",
  });

  it("constructs the direct contract discovery provider", async () => {
    const resolved = await contractDiscovery({
      rateLimit: { concurrency: 2, maxRetries: 0 },
    }).resolve({
      provider,
      poolAddress: STRK20_POOL_SEPOLIA,
    });

    expect(resolved).toMatchObject({
      discoverNotes: expect.any(Function),
      discoverChannels: expect.any(Function),
      discoverRequirement: expect.any(Function),
    });
  });

  it("constructs the authenticated proxy proof provider", async () => {
    const resolved = await privyProxyProver({
      url: "https://proxy.example/rpc",
      tenantId: "tenant-demo",
      accessToken: "token",
    }).resolve({
      provider,
      network: "sepolia",
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      nodeUrl: provider.channel.nodeUrl,
      poolAddress: STRK20_POOL_SEPOLIA,
    });

    expect(resolved).toMatchObject({
      getDefaultDetails: expect.any(Function),
      prove: expect.any(Function),
      invalidateNonceCache: expect.any(Function),
    });
  });

  it("constructs the call-based mock proof provider", async () => {
    const resolved = await mockProver().resolve({
      provider,
      network: "sepolia",
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      nodeUrl: provider.channel.nodeUrl,
      poolAddress: STRK20_POOL_SEPOLIA,
    });

    expect(resolved).toMatchObject({
      getDefaultDetails: expect.any(Function),
      prove: expect.any(Function),
    });
  });
});
