import { describe, expect, it } from "vitest";
import {
  ADDRESS_BOOK_STORAGE_PREFIX,
  addressBookStorageKey,
  loadAddressBook,
  mergeAddressBookEntries,
  normalizeStarknetAddress,
  removeAddressBookEntry,
  replaceAddressBookEntries,
  resolveAddressBookInput,
  saveAddressBookEntry,
} from "./address-book";

const SELF = "0xa11ce";
const OTHER_SELF = "0xb0b";
const ALICE =
  "0x02c94f628dd794a0712d84860a2f778e9bea73ab72f6bcb1c0fcc00cfb95e9d8";
const BOB =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("encrypted address book", () => {
  it("uses the app20 v1 storage key scoped to the normalized self address", () => {
    expect(addressBookStorageKey(SELF)).toBe(
      `${ADDRESS_BOOK_STORAGE_PREFIX}/${normalizeStarknetAddress(SELF)}`,
    );
    expect(() => addressBookStorageKey("")).toThrow(/Connect a wallet/);
  });

  it("round-trips entries and never stores plaintext labels or addresses", async () => {
    const storage = makeStorage();
    await saveAddressBookEntry(storage, SELF, {
      label: "Bob desk",
      address: BOB,
    });
    const entries = await saveAddressBookEntry(storage, SELF, {
      label: "alice cold",
      address: ALICE,
    });
    expect(entries.map((entry) => entry.label)).toEqual([
      "alice cold",
      "Bob desk",
    ]);
    expect(entries[0].address).toBe(normalizeStarknetAddress(ALICE));

    const raw = storage.getItem(addressBookStorageKey(SELF));
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("Bob");
    expect(raw).not.toContain(BOB.slice(4, 20));
    expect(JSON.parse(raw as string)).toMatchObject({ version: 1 });

    const reloaded = await loadAddressBook(storage, SELF);
    expect(reloaded).toEqual(entries);
  });

  it("upserts by case-insensitive label and validates inputs", async () => {
    const storage = makeStorage();
    await saveAddressBookEntry(storage, SELF, { label: "Desk", address: BOB });
    const entries = await saveAddressBookEntry(storage, SELF, {
      label: "desk",
      address: ALICE,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].address).toBe(normalizeStarknetAddress(ALICE));

    await expect(
      saveAddressBookEntry(storage, SELF, { label: "  ", address: ALICE }),
    ).rejects.toThrow(/label/i);
    await expect(
      saveAddressBookEntry(storage, SELF, { label: "0xabc", address: ALICE }),
    ).rejects.toThrow(/must not look like 0x/);
    await expect(
      saveAddressBookEntry(storage, SELF, { label: "Bad", address: "zzz" }),
    ).rejects.toThrow(/valid Starknet address/);
  });

  it("keeps books isolated per self address and supports removal", async () => {
    const storage = makeStorage();
    await saveAddressBookEntry(storage, SELF, { label: "Desk", address: BOB });
    expect(await loadAddressBook(storage, OTHER_SELF)).toEqual([]);

    const afterRemove = await removeAddressBookEntry(storage, SELF, "desk");
    expect(afterRemove).toEqual([]);
    expect(await loadAddressBook(storage, SELF)).toEqual([]);
  });

  it("fails closed on tampered ciphertext and on a missing book key", async () => {
    const storage = makeStorage();
    await saveAddressBookEntry(storage, SELF, { label: "Desk", address: BOB });
    const bookKey = addressBookStorageKey(SELF);
    const payload = JSON.parse(storage.getItem(bookKey) as string) as {
      ciphertext: string;
    };
    const flipped =
      (payload.ciphertext[0] === "0" ? "1" : "0") + payload.ciphertext.slice(1);
    storage.setItem(
      bookKey,
      JSON.stringify({
        version: 1,
        nonce: "00".repeat(12),
        ciphertext: flipped,
      }),
    );
    await expect(loadAddressBook(storage, SELF)).rejects.toThrow(
      /could not be opened/,
    );

    const keyless = makeStorage();
    await saveAddressBookEntry(keyless, SELF, { label: "Desk", address: BOB });
    keyless.removeItem(
      `${ADDRESS_BOOK_STORAGE_PREFIX}/key/${normalizeStarknetAddress(SELF)}`,
    );
    await expect(loadAddressBook(keyless, SELF)).rejects.toThrow(
      /could not be opened/,
    );
  });

  it("replaces and merge-restores validated snapshots atomically", async () => {
    const storage = makeStorage();
    await saveAddressBookEntry(storage, SELF, { label: "Desk", address: BOB });
    const current = await loadAddressBook(storage, SELF);

    const replaced = await replaceAddressBookEntries(storage, SELF, [
      { label: "Treasury", address: ALICE, updatedAt: Date.now() - 10 },
    ]);
    expect(replaced.map((entry) => entry.label)).toEqual(["Treasury"]);

    const merged = await mergeAddressBookEntries(storage, SELF, [
      { label: "Treasury", address: BOB, updatedAt: replaced[0].updatedAt - 1 },
      { label: "Desk", address: BOB, updatedAt: current[0].updatedAt + 1 },
    ]);
    expect(merged.map((entry) => entry.label)).toEqual(["Desk", "Treasury"]);
    expect(merged.find((entry) => entry.label === "Treasury")?.address).toBe(
      normalizeStarknetAddress(ALICE),
    );

    const beforeFailure = await loadAddressBook(storage, SELF);
    await expect(
      replaceAddressBookEntries(storage, SELF, [
        { label: "Duplicate", address: ALICE, updatedAt: Date.now() },
        { label: "duplicate", address: BOB, updatedAt: Date.now() },
      ]),
    ).rejects.toThrow(/left untouched/i);
    expect(await loadAddressBook(storage, SELF)).toEqual(beforeFailure);
  });

  it("resolves labels, raw addresses, and rejects unknown input", async () => {
    const storage = makeStorage();
    const entries = await saveAddressBookEntry(storage, SELF, {
      label: "Bob desk",
      address: BOB,
    });

    const byLabel = resolveAddressBookInput(entries, "bob DESK");
    expect(byLabel?.address).toBe(normalizeStarknetAddress(BOB));
    expect(byLabel?.entry?.label).toBe("Bob desk");

    const byAddress = resolveAddressBookInput(entries, BOB);
    expect(byAddress?.address).toBe(normalizeStarknetAddress(BOB));
    expect(byAddress?.entry?.label).toBe("Bob desk");

    const foreign = resolveAddressBookInput(entries, ALICE);
    expect(foreign?.address).toBe(normalizeStarknetAddress(ALICE));
    expect(foreign?.entry).toBeUndefined();

    expect(resolveAddressBookInput(entries, "unknown label")).toBeNull();
    expect(resolveAddressBookInput(entries, "0xnothex")).toBeNull();
    expect(resolveAddressBookInput(entries, "   ")).toBeNull();
  });
});
