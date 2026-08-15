import { createStore } from "@starknet-io/get-starknet-discovery";
import {
  StandardConnect,
  StandardEvents,
  StarknetWalletApi,
} from "@starknet-io/get-starknet-wallet-standard/features";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QuietlineLocalnetWallet,
  registerLocalnetWalletStandard,
  type LocalnetWalletConfig,
} from "./localnet-wallet";

const config: LocalnetWalletConfig = {
  walletName: "Localnet (dev)",
  chainId: "0x51554945544c494e455f4c4f43414c",
  rpcUrl: "/__quietline_localnet_rpc",
  poolAddress: "0x100",
  helperAddress: "0x200",
  escrowAddress: "0x250",
  tokenAddress: "0x300",
  counterTokenAddress: "0x400",
  proofMode: "mock proof",
  identities: [
    { id: "alice", label: "Alice", address: "0x111" },
    { id: "bob", label: "Bob", address: "0x222" },
  ],
};

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
    writable: true,
  });
});

describe("Quietline localnet Wallet Standard wallet", () => {
  it("is discovered, connects through standard:connect, and switches Alice/Bob", async () => {
    const fakeWindow = new EventTarget() as unknown as Window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
      writable: true,
    });
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/balances") return [{ token: "0x300", balance: "0x7" }];
      return { transaction_hash: "0xabc" };
    });
    const wallet = new QuietlineLocalnetWallet(
      config,
      new MemoryStorage(),
      apiRequest,
    );
    const unregister = registerLocalnetWalletStandard(wallet, fakeWindow);
    const store = createStore({ eip1193Adapters: [] });

    expect(store.getWallets().map(({ name }) => name)).toContain(
      "Localnet (dev)",
    );
    const connected = await wallet.features[StandardConnect].connect();
    expect(connected.accounts[0]?.address).toBe("0x111");

    const changes: string[] = [];
    const stopListening = wallet.features[StandardEvents].on(
      "change",
      ({ accounts }) => {
        if (accounts?.[0]) changes.push(accounts[0].address);
      },
    );
    wallet.selectIdentity("bob");
    expect(wallet.accounts[0]?.address).toBe("0x222");
    expect(changes).toEqual(["0x222"]);

    stopListening();
    unregister();
  });

  it("implements the Wallet API surface used by the app", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const apiRequest = vi.fn(async (path: string, init?: RequestInit) => {
      requests.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path === "/balances") return [{ token: "0x300", balance: "0x7" }];
      return { transaction_hash: "0xabc" };
    });
    const wallet = new QuietlineLocalnetWallet(
      config,
      new MemoryStorage(),
      apiRequest,
    );
    await wallet.features[StandardConnect].connect();
    const request = wallet.features[StarknetWalletApi].request;

    await expect(request({ type: "wallet_requestAccounts" })).resolves.toEqual([
      "0x111",
    ]);
    await expect(request({ type: "wallet_getPermissions" })).resolves.toEqual([
      "accounts",
    ]);
    await expect(request({ type: "wallet_requestChainId" })).resolves.toBe(
      config.chainId,
    );
    await expect(
      request({ type: "wallet_supportedWalletApi" }),
    ).resolves.toEqual(["0.10"]);
    await expect(request({ type: "wallet_supportedSpecs" })).resolves.toEqual([
      "0.10",
    ]);
    await expect(
      request({
        type: "wallet_addInvokeTransaction",
        params: {
          calls: [
            {
              contract_address: "0x200",
              entry_point: "register_pubkey",
              calldata: ["0x1", "0x2"],
            },
          ],
        },
      }),
    ).resolves.toEqual({ transaction_hash: "0xabc" });
    await expect(
      request({
        type: "wallet_strk20InvokeTransaction",
        params: {
          actions: [{ type: "deposit", token: "0x300", amount: "0x1" }],
        },
      }),
    ).resolves.toEqual({ transaction_hash: "0xabc" });
    await expect(
      request({ type: "wallet_strk20Balances", params: { tokens: [] } }),
    ).resolves.toEqual([{ token: "0x300", balance: "0x7" }]);

    expect(requests.map(({ path }) => path)).toEqual([
      "/invoke",
      "/privacy",
      "/balances",
    ]);
    expect(requests[1]?.body).toMatchObject({ identity: "alice" });
  });
});
