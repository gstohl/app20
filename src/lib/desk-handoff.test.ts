import { describe, expect, it } from "vitest";
import { consumeDeskHandoff, storeDeskHandoff } from "./desk-handoff";

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("private desk session handoff", () => {
  it("normalizes, consumes once, and keeps the address out of URLs", () => {
    const storage = makeStorage();
    storeDeskHandoff(storage, "rfq", "0xb0b", 1_000);
    expect(consumeDeskHandoff(storage, "rfq", 2_000)).toMatch(/^0x0+b0b$/);
    expect(consumeDeskHandoff(storage, "rfq", 2_000)).toBeNull();
  });

  it("rejects expired, wrong-purpose, malformed, and future handoffs", () => {
    const expired = makeStorage();
    storeDeskHandoff(expired, "mail", "0xb0b", 1_000);
    expect(
      consumeDeskHandoff(expired, "mail", 5 * 60 * 1_000 + 1_001),
    ).toBeNull();

    const wrongPurpose = makeStorage();
    storeDeskHandoff(wrongPurpose, "rfq", "0xb0b", 1_000);
    expect(consumeDeskHandoff(wrongPurpose, "mail", 2_000)).toBeNull();

    const malformed = makeStorage();
    malformed.setItem("app20/desk-handoff/v1", "not-json");
    expect(consumeDeskHandoff(malformed, "rfq", 2_000)).toBeNull();

    const future = makeStorage();
    storeDeskHandoff(future, "rfq", "0xb0b", 3_000);
    expect(consumeDeskHandoff(future, "rfq", 2_000)).toBeNull();
  });
});
