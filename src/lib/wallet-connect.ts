export function chainIdFromStandardAccount(account: {
  chains?: readonly string[];
}): string | null {
  const standardChain = account.chains?.[0];
  if (!standardChain) return null;
  return standardChain.startsWith("starknet:")
    ? standardChain.slice("starknet:".length)
    : standardChain;
}

export function describeWalletConnectError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Wallet connection failed.";
  if (/\bnot preauthorized\b/i.test(message)) {
    return "This site is not authorized in the wallet yet. Approve the connection prompt in Ready. If none appeared, open Ready → Connected sites, remove this origin, and try again. Use http://localhost:5173 — not 127.0.0.1 — so the origin matches.";
  }
  return message;
}

export type DiscoverableWallet = {
  readonly name: string;
};

export type WalletDiscoveryStore<
  T extends DiscoverableWallet = DiscoverableWallet,
> = {
  getWallets: () => T[];
  subscribe: (listener: (wallets: readonly T[]) => void) => () => void;
};

export type WalletDiscoveryLoader<
  T extends DiscoverableWallet = DiscoverableWallet,
> = () => Promise<WalletDiscoveryStore<T>>;

export type WalletDiscoveryHandlers<T extends DiscoverableWallet> = {
  onWallets: (wallets: T[]) => void;
  onError: (error: unknown) => void;
};

/** Stable identity for a discovered wallet list so identical snapshots do not notify. */
export function walletDiscoveryIdentityKey(
  wallets: readonly DiscoverableWallet[],
): string {
  return wallets.map((wallet) => wallet.name).join("\0");
}

/**
 * Lazy Wallet Standard discovery. `createStore` registers window-level
 * listeners with no cleanup, so the coordinator must reuse one store for the
 * page lifetime and only attach React subscribers while a picker is open.
 */
export function createWalletDiscoveryCoordinator<
  T extends DiscoverableWallet = DiscoverableWallet,
>(load: WalletDiscoveryLoader<T>) {
  let store: WalletDiscoveryStore<T> | null = null;
  let inFlight: Promise<WalletDiscoveryStore<T>> | null = null;
  let storeCreateCount = 0;

  function ensureStore(): Promise<WalletDiscoveryStore<T>> {
    if (store) return Promise.resolve(store);
    if (inFlight) return inFlight;
    inFlight = load()
      .then((created) => {
        store = created;
        storeCreateCount += 1;
        return created;
      })
      .catch((error: unknown) => {
        inFlight = null;
        throw error;
      });
    return inFlight;
  }

  return {
    get storeCreateCount() {
      return storeCreateCount;
    },
    subscribe(handlers: WalletDiscoveryHandlers<T>): () => void {
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      let previousKey: string | null = null;

      const attach = (nextStore: WalletDiscoveryStore<T>) => {
        if (cancelled) return;
        const emit = (list: readonly T[]) => {
          if (cancelled) return;
          const key = walletDiscoveryIdentityKey(list);
          if (key === previousKey) return;
          previousKey = key;
          handlers.onWallets(list.slice());
        };
        emit(nextStore.getWallets());
        unsubscribe = nextStore.subscribe(emit);
      };

      if (store) {
        attach(store);
      } else {
        void ensureStore()
          .then(attach)
          .catch((error: unknown) => {
            if (!cancelled) handlers.onError(error);
          });
      }

      return () => {
        cancelled = true;
        unsubscribe?.();
        unsubscribe = null;
      };
    },
  };
}
