import { describe, expect, it } from "vitest";
import { deriveKeypair } from "@/lib/mail";
import { exportMailSeed, restoreMailSeed } from "./seedBackup";

function seed(): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => index);
}

describe("mail seed backup", () => {
  it("restores the exported seed and derives the same keypair", () => {
    const original = seed();
    const backup = exportMailSeed(original);
    const restored = restoreMailSeed(backup);

    expect(backup).toBe(
      "00010203 04050607 08090a0b 0c0d0e0f 10111213 14151617 18191a1b 1c1d1e1f",
    );
    expect(restored.seed).toEqual(original);
    expect(restored.keypair).toEqual(deriveKeypair(original));
  });

  it("accepts hexadecimal letter case without changing the seed", () => {
    const backup = exportMailSeed(new Uint8Array(32).fill(0xab)).toUpperCase();
    expect(restoreMailSeed(backup).seed).toEqual(new Uint8Array(32).fill(0xab));
  });

  it.each([
    ["empty", ""],
    ["ungrouped", "00".repeat(32)],
    ["too few groups", new Array(7).fill("00000000").join(" ")],
    ["too many groups", new Array(9).fill("00000000").join(" ")],
    ["short group", `${new Array(7).fill("00000000").join(" ")} 0000000`],
    ["non-hexadecimal", `${new Array(7).fill("00000000").join(" ")} 0000000g`],
    ["0x-prefixed", new Array(8).fill("0x000000").join(" ")],
    ["double-spaced", new Array(8).fill("00000000").join("  ")],
    ["leading whitespace", ` ${new Array(8).fill("00000000").join(" ")}`],
    ["trailing newline", `${new Array(8).fill("00000000").join(" ")}\n`],
  ])("rejects a malformed %s backup", (_label, backup) => {
    expect(() => restoreMailSeed(backup)).toThrow(
      /exactly 64 hexadecimal characters in eight groups of eight/i,
    );
  });

  it("refuses to export a seed with the wrong byte length", () => {
    expect(() => exportMailSeed(new Uint8Array(31))).toThrow(/exactly 32 bytes/i);
  });
});
