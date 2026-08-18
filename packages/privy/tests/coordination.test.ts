import { describe, expect, it } from "vitest";
import { inMemoryPrivacySequencing } from "../src/coordination.js";

describe("in-memory privacy coordination", () => {
  it("shares one state across client instances for the same chain and account", () => {
    const first = inMemoryPrivacySequencing("sepolia:0xabc");
    const second = inMemoryPrivacySequencing("sepolia:0xabc");
    const other = inMemoryPrivacySequencing("sepolia:0xdef");

    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });
});
