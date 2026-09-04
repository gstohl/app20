import { describe, expect, it } from "vitest";
import {
  MAX_TRACKED_READ_IDS,
  loadReadMessageIds,
  saveReadMessageIds,
} from "./mail-read-state";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (name: string) => map.get(name) ?? null,
    setItem: (name: string, value: string) => void map.set(name, value),
    map,
  };
}

describe("mail read state", () => {
  it("round-trips opened records for one chain and account", () => {
    const storage = memoryStorage();
    saveReadMessageIds(storage, "0x1", "0xabc", new Set(["a", "b"]));
    expect([...loadReadMessageIds(storage, "0x1", "0xabc")]).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps accounts and chains apart", () => {
    const storage = memoryStorage();
    saveReadMessageIds(storage, "0x1", "0xabc", new Set(["a"]));
    expect(loadReadMessageIds(storage, "0x1", "0xdef").size).toBe(0);
    expect(loadReadMessageIds(storage, "0x2", "0xabc").size).toBe(0);
  });

  it("ignores malformed or absent entries instead of throwing", () => {
    expect(
      loadReadMessageIds(memoryStorage({ x: "y" }), "0x1", "0xabc").size,
    ).toBe(0);
    const broken = memoryStorage({
      "app20/mailread/v1/0x1/0xabc": "{not json",
    });
    expect(loadReadMessageIds(broken, "0x1", "0xabc").size).toBe(0);
    const wrongShape = memoryStorage({
      "app20/mailread/v1/0x1/0xabc": '{"a":1}',
    });
    expect(loadReadMessageIds(wrongShape, "0x1", "0xabc").size).toBe(0);
  });

  it("writes nothing without a chain and account", () => {
    const storage = memoryStorage();
    saveReadMessageIds(storage, "", "0xabc", new Set(["a"]));
    expect(storage.map.size).toBe(0);
  });

  it("bounds how much history one mailbox can store", () => {
    const storage = memoryStorage();
    const ids = new Set(
      Array.from({ length: MAX_TRACKED_READ_IDS + 25 }, (_, i) => `id-${i}`),
    );
    saveReadMessageIds(storage, "0x1", "0xabc", ids);
    const loaded = loadReadMessageIds(storage, "0x1", "0xabc");
    expect(loaded.size).toBe(MAX_TRACKED_READ_IDS);
    expect(loaded.has(`id-${MAX_TRACKED_READ_IDS + 24}`)).toBe(true);
  });
});
