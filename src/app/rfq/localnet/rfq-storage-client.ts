import { localnetRuntimeEpoch } from "@/dev/localnet-runtime-epoch";
import { createIndexedDbRfqStorage } from "../rfq-storage";

type IndexedDbRfqStorage = ReturnType<typeof createIndexedDbRfqStorage>;

/**
 * Reuses one IndexedDB facade until the localnet runtime epoch changes.
 * Recreating on every persist/authorize re-opens the database wrapper for the
 * same epoch without changing CAS semantics.
 */
export function createLocalnetRfqStorageClient(
  getEpoch: () => string = localnetRuntimeEpoch,
  createStorage: (
    epoch: string,
  ) => IndexedDbRfqStorage = createIndexedDbRfqStorage,
) {
  let epoch: string | undefined;
  let storage: IndexedDbRfqStorage | undefined;
  return Object.freeze({
    current(): IndexedDbRfqStorage {
      const next = getEpoch();
      if (!storage || epoch !== next) {
        epoch = next;
        storage = createStorage(next);
      }
      return storage;
    },
  });
}
