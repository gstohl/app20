import { describe, expect, it, vi } from "vitest";
import {
  chainIdFromStandardAccount,
  createWalletDiscoveryCoordinator,
  describeWalletConnectError,
  walletDiscoveryIdentityKey,
  type WalletDiscoveryStore,
} from "./wallet-connect";

describe("chainIdFromStandardAccount", () => {
  it("strips the starknet: prefix", () => {
    expect(chainIdFromStandardAccount({ chains: ["starknet:SN_MAIN"] })).toBe(
      "SN_MAIN",
    );
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

function createFakeDiscoveryStore(initial: Array<{ name: string }> = []) {
  const listeners = new Set<(wallets: readonly { name: string }[]) => void>();
  let wallets = initial.slice();
  const store: WalletDiscoveryStore<{ name: string }> & {
    emit(next: Array<{ name: string }>): void;
    listenerCount(): number;
  } = {
    getWallets: () => wallets.slice(),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(next) {
      wallets = next.slice();
      for (const listener of listeners) listener(wallets.slice());
    },
    listenerCount: () => listeners.size,
  };
  return store;
}

describe("wallet discovery coordinator", () => {
  it("keys a wallet list by identity so order-preserving copies match", () => {
    expect(
      walletDiscoveryIdentityKey([{ name: "Ready" }, { name: "Localnet" }]),
    ).toBe("Ready\0Localnet");
  });

  it("reuses one store across overlapping subscribers and remounts", async () => {
    let resolveLoad!: (store: WalletDiscoveryStore<{ name: string }>) => void;
    let loadCount = 0;
    const store = createFakeDiscoveryStore([{ name: "Ready" }]);
    const coordinator = createWalletDiscoveryCoordinator(() => {
      loadCount += 1;
      return new Promise<WalletDiscoveryStore<{ name: string }>>((resolve) => {
        resolveLoad = resolve;
      });
    });

    const first: Array<{ name: string }>[] = [];
    const second: Array<{ name: string }>[] = [];
    const stopFirst = coordinator.subscribe({
      onWallets: (wallets) => first.push(wallets),
      onError: () => {
        throw new Error("first subscriber should not fail");
      },
    });
    const stopSecond = coordinator.subscribe({
      onWallets: (wallets) => second.push(wallets),
      onError: () => {
        throw new Error("second subscriber should not fail");
      },
    });

    expect(loadCount).toBe(1);
    resolveLoad(store);
    await vi.waitFor(() => {
      expect(first).toEqual([[{ name: "Ready" }]]);
      expect(second).toEqual([[{ name: "Ready" }]]);
    });
    expect(coordinator.storeCreateCount).toBe(1);
    expect(store.listenerCount()).toBe(2);

    stopFirst();
    stopSecond();
    expect(store.listenerCount()).toBe(0);

    const remount: Array<{ name: string }>[] = [];
    const stopRemount = coordinator.subscribe({
      onWallets: (wallets) => remount.push(wallets),
      onError: () => {
        throw new Error("remount should reuse the store");
      },
    });
    expect(loadCount).toBe(1);
    expect(coordinator.storeCreateCount).toBe(1);
    expect(remount).toEqual([[{ name: "Ready" }]]);
    stopRemount();
  });

  it("does not attach a store listener if unsubscribed before load completes", async () => {
    let resolveLoad!: (store: WalletDiscoveryStore<{ name: string }>) => void;
    const store = createFakeDiscoveryStore([{ name: "Ready" }]);
    const coordinator = createWalletDiscoveryCoordinator(
      () =>
        new Promise<WalletDiscoveryStore<{ name: string }>>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const updates: Array<{ name: string }>[] = [];
    const stop = coordinator.subscribe({
      onWallets: (wallets) => updates.push(wallets),
      onError: () => {
        throw new Error("cancelled load should not error");
      },
    });
    stop();
    resolveLoad(store);
    await vi.waitFor(() => {
      expect(coordinator.storeCreateCount).toBe(1);
    });
    expect(updates).toEqual([]);
    expect(store.listenerCount()).toBe(0);
  });

  it("does not notify for identical wallet identity lists", async () => {
    const store = createFakeDiscoveryStore([{ name: "Ready" }]);
    const coordinator = createWalletDiscoveryCoordinator(async () => store);
    const updates: Array<{ name: string }>[] = [];
    const stop = coordinator.subscribe({
      onWallets: (wallets) => updates.push(wallets),
      onError: () => {
        throw new Error("identical-list test should not error");
      },
    });
    await vi.waitFor(() => {
      expect(updates).toHaveLength(1);
    });
    store.emit([{ name: "Ready" }]);
    expect(updates).toHaveLength(1);
    store.emit([{ name: "Ready" }, { name: "Localnet (dev)" }]);
    expect(updates).toEqual([
      [{ name: "Ready" }],
      [{ name: "Ready" }, { name: "Localnet (dev)" }],
    ]);
    stop();
  });

  it("retries after a failed load", async () => {
    let shouldFail = true;
    const store = createFakeDiscoveryStore([]);
    const coordinator = createWalletDiscoveryCoordinator(async () => {
      if (shouldFail) throw new Error("discovery boom");
      return store;
    });
    const errors: unknown[] = [];
    const firstStop = coordinator.subscribe({
      onWallets: () => {
        throw new Error("failed load should not emit wallets");
      },
      onError: (error) => errors.push(error),
    });
    await vi.waitFor(() => {
      expect(errors).toHaveLength(1);
    });
    firstStop();

    shouldFail = false;
    const wallets: Array<{ name: string }>[] = [];
    const stop = coordinator.subscribe({
      onWallets: (next) => wallets.push(next),
      onError: () => {
        throw new Error("retry should succeed");
      },
    });
    await vi.waitFor(() => {
      expect(wallets).toEqual([[]]);
    });
    expect(coordinator.storeCreateCount).toBe(1);
    stop();
  });
});
