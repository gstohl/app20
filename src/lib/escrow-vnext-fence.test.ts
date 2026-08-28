import { describe, expect, it } from "vitest";
import { selectedReservationFence } from "./escrow-vnext-fence";

describe("VNext selected reservation fence policy", () => {
  it("binds the selected fence when it equals or advances the quote", () => {
    expect(
      selectedReservationFence({ quotedFence: 2n, selectedFence: 2n }),
    ).toBe(2n);
    expect(
      selectedReservationFence({ quotedFence: 2n, selectedFence: 5n }),
    ).toBe(5n);
  });

  it("rejects number, string, NaN, infinity, and missing fence casts", () => {
    const invalidRuntimeValues: unknown[] = [
      1,
      "1",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
    ];
    for (const value of invalidRuntimeValues) {
      expect(() =>
        selectedReservationFence({
          quotedFence: value,
          selectedFence: 2n,
        } as unknown as Parameters<typeof selectedReservationFence>[0]),
      ).toThrow(/bigint/);
      expect(() =>
        selectedReservationFence({
          quotedFence: 1n,
          selectedFence: value,
        } as unknown as Parameters<typeof selectedReservationFence>[0]),
      ).toThrow(/bigint/);
    }
  });

  it("rejects zero, negative, stale, and overflowing fences", () => {
    const maxU256 = (1n << 256n) - 1n;
    expect(() =>
      selectedReservationFence({ quotedFence: 0n, selectedFence: 1n }),
    ).toThrow(/greater than zero/);
    expect(() =>
      selectedReservationFence({ quotedFence: -1n, selectedFence: 1n }),
    ).toThrow(/greater than zero/);
    expect(() =>
      selectedReservationFence({ quotedFence: 3n, selectedFence: 2n }),
    ).toThrow(/stale/);
    expect(
      selectedReservationFence({
        quotedFence: maxU256,
        selectedFence: maxU256,
      }),
    ).toBe(maxU256);
    expect(() =>
      selectedReservationFence({
        quotedFence: maxU256 + 1n,
        selectedFence: maxU256 + 1n,
      }),
    ).toThrow(/fit u256/);
    expect(() =>
      selectedReservationFence({
        quotedFence: 1n,
        selectedFence: maxU256 + 1n,
      }),
    ).toThrow(/fit u256/);
  });
});
