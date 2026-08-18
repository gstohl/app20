import { describe, expect, it } from "vitest";
import { provingBlockId, waitForMaturity } from "../src/privacy.js";
import { SequencingError } from "../src/errors.js";

describe("provingBlockId", () => {
  it("backs off 10 blocks from the tip", async () => {
    const block = await provingBlockId({
      getBlockNumber: async () => 42,
    } as never);
    expect(block).toBe(32);
  });

  it("rejects a chain that is too young to prove against", async () => {
    await expect(
      provingBlockId({ getBlockNumber: async () => 4 } as never),
    ).rejects.toBeInstanceOf(SequencingError);
  });

  it("times out instead of holding a wallet queue forever", async () => {
    await expect(
      waitForMaturity(
        { getBlockNumber: async () => 42 } as never,
        42,
        10,
        1,
        5,
      ),
    ).rejects.toBeInstanceOf(SequencingError);
  });
});
