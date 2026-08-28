import { describe, expect, it } from "vitest";
import {
  deskLeakChips,
  deskVenueCopy,
  suggestsBlockSurface,
} from "./desk-disclosure";

describe("desk disclosure", () => {
  it("never uses a bare private badge", () => {
    for (const venue of [
      "idle",
      "inventory",
      "public-route",
      "refused",
    ] as const) {
      const labels = deskLeakChips(venue)
        .map((chip) => chip.label)
        .join(" ");
      expect(labels.toLowerCase()).not.toMatch(/\bdark pool\b/);
      expect(labels).not.toBe("PRIVATE");
      expect(deskVenueCopy(venue).toLowerCase()).not.toMatch(
        /sealed|anonymous|unlinkable|dark pool/,
      );
    }
    expect(deskLeakChips("idle").map((chip) => chip.label)).not.toContain(
      "Refused",
    );
    expect(deskLeakChips("inventory").map((chip) => chip.id)).toEqual([
      "owner",
      "size",
      "venue",
    ]);
  });

  it("suggests Block only above the size band", () => {
    expect(
      suggestsBlockSurface({ sellSymbol: "STRK", sellAmount: "0.1" }),
    ).toBe(false);
    expect(
      suggestsBlockSurface({ sellSymbol: "USDC", sellAmount: "2500" }),
    ).toBe(false);
    expect(
      suggestsBlockSurface({ sellSymbol: "USDC", sellAmount: "10000" }),
    ).toBe(true);
    expect(
      suggestsBlockSurface({ sellSymbol: "STRK", sellAmount: "5000" }),
    ).toBe(true);
  });
});
