import { describe, expect, it, vi } from "vitest";
import { createLocalnetRfqStorageClient } from "./rfq-storage-client";

describe("localnet RFQ storage client cache", () => {
  it("reuses the facade for one runtime epoch and rebuilds after an epoch change", () => {
    let epoch = "epoch-a";
    const createStorage = vi.fn((value: string) => ({ epoch: value }));
    const client = createLocalnetRfqStorageClient(
      () => epoch,
      createStorage as never,
    );
    const first = client.current();
    expect(client.current()).toBe(first);
    expect(client.current()).toBe(first);
    expect(createStorage).toHaveBeenCalledTimes(1);
    epoch = "epoch-b";
    const second = client.current();
    expect(second).not.toBe(first);
    expect(second).toEqual({ epoch: "epoch-b" });
    expect(createStorage).toHaveBeenCalledTimes(2);
    expect(client.current()).toBe(second);
  });
});
