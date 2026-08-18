import { describe, expect, it, vi } from "vitest";
import { PrivyStrk20Client } from "../src/proxy-client.js";

function mockOwnership(
  client: PrivyStrk20Client,
  wallets: Array<{
    walletId: string;
    address?: string;
    publicKey?: string;
  }>,
) {
  vi.spyOn(client.core.privy, "utils").mockReturnValue({
    auth: () => ({
      verifyAccessToken: vi.fn(async () => ({ user_id: "user-1" })),
    }),
  } as never);
  vi.spyOn(client.core, "listWallets").mockResolvedValue(wallets as never);
}

describe("PrivyStrk20Client", () => {
  it("uses the access token for wallet signing when no server key exists", async () => {
    const client = new PrivyStrk20Client({
      network: "sepolia",
      privyAppId: "app-demo",
      privyAppSecret: "secret-demo",
      rpcUrl: "https://rpc.invalid",
      proxy: {
        url: "https://proxy.example/rpc",
        tenantId: "tenant-demo",
      },
    });
    const sessionResult = { address: "0xabc" };
    const coreSession = vi
      .spyOn(client.core, "session")
      .mockResolvedValue(sessionResult as never);
    const accessToken = vi.fn(async () => "user-access-token");
    const wallet = {
      walletId: "wallet-1",
      address: "0xabc",
      publicKey: "0x1",
    } as never;
    mockOwnership(client, [wallet]);

    await expect(client.session(wallet, { accessToken })).resolves.toBe(
      sessionResult,
    );

    expect(coreSession).toHaveBeenCalledWith(
      wallet,
      expect.objectContaining({
        authorization: {
          userJwtProvider: expect.any(Function),
        },
        prover: expect.objectContaining({
          kind: "service",
          submittable: true,
        }),
      }),
    );
    const sessionOptions = coreSession.mock.calls[0]?.[1];
    expect(sessionOptions).toBeDefined();
    const userJwtProvider = sessionOptions!.authorization?.userJwtProvider;
    await expect(userJwtProvider?.({ forceRefresh: true })).resolves.toEqual([
      "user-access-token",
    ]);
    expect(accessToken).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("uses a configured server key without using the token as a wallet JWT", async () => {
    const client = new PrivyStrk20Client({
      network: "sepolia",
      privyAppId: "app-demo",
      privyAppSecret: "secret-demo",
      rpcUrl: "https://rpc.invalid",
      authorizationPrivateKey: "server-authorization-key",
      proxy: {
        url: "https://proxy.example/rpc",
        tenantId: "tenant-demo",
      },
    });
    const coreSession = vi
      .spyOn(client.core, "session")
      .mockResolvedValue({ address: "0xabc" } as never);
    const accessToken = vi.fn(async () => "user-access-token");
    mockOwnership(client, [
      { walletId: "wallet-1", address: "0xabc", publicKey: "0x1" },
    ]);

    await client.session("wallet-1", { accessToken });

    const sessionOptions = coreSession.mock.calls[0]?.[1];
    expect(sessionOptions?.authorization?.userJwtProvider).toBeUndefined();
    expect(accessToken).toHaveBeenCalledTimes(1);
    expect(accessToken).toHaveBeenCalledWith({ forceRefresh: false });
  });

  it("rejects a wallet outside the authenticated user's wallet list", async () => {
    const client = new PrivyStrk20Client({
      privyAppId: "app-demo",
      privyAppSecret: "secret-demo",
      rpcUrl: "https://rpc.invalid",
      authorizationPrivateKey: "server-authorization-key",
      proxy: {
        url: "https://proxy.example/rpc",
        tenantId: "tenant-demo",
      },
    });
    mockOwnership(client, []);
    const coreSession = vi.spyOn(client.core, "session");

    await expect(
      client.session("wallet-1", { accessToken: "user-access-token" }),
    ).rejects.toThrow("does not belong");
    expect(coreSession).not.toHaveBeenCalled();
  });

  it("rejects an empty token before creating a signing session", async () => {
    const client = new PrivyStrk20Client({
      privyAppId: "app-demo",
      privyAppSecret: "secret-demo",
      rpcUrl: "https://rpc.invalid",
      proxy: {
        url: "https://proxy.example/rpc",
        tenantId: "tenant-demo",
      },
    });
    const coreSession = vi.spyOn(client.core, "session");

    await expect(
      client.session("wallet-1", { accessToken: "" }),
    ).rejects.toThrow("Privy access token is empty");
    expect(coreSession).not.toHaveBeenCalled();
  });
});
