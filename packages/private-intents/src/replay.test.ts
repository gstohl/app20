import { describe, expect, it } from "vitest";
import { createMemoryAsyncReplayStore } from "./replay";

const D = `0x${"11".repeat(32)}`;
const E = `0x${"22".repeat(32)}`;
const input = { replayNonce: D, envelopeDigest: D, directoryDigest: E, makerId: "maker", now: 100 } as const;

describe("async replay CAS contract", () => {
  it("is atomic for concurrent retry and refuses same nonce with different bytes", async () => {
    const store = createMemoryAsyncReplayStore();
    const results = await Promise.all([store.consume(input), store.consume(input)]);
    expect(results.map((result) => result.kind).sort()).toEqual(["accepted", "idempotent"]);
    await expect(store.consume({ ...input, envelopeDigest: E })).resolves.toEqual({ kind: "conflict" });
  });
});
