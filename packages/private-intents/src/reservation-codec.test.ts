import { describe, expect, it } from "vitest";
import { createMakerReservation } from "#index";
import { decodeStoredMakerReservation } from "#reservation-codec";

const NOW = 1_800_000_000;

function completeRecord() {
  return {
    reservation: createMakerReservation({
      reservationId: `0x${"11".repeat(32)}`,
      makerId: "maker-a",
      intentDigest: `0x${"22".repeat(32)}`,
      rfqDigest: `0x${"33".repeat(32)}`,
      asset: "0x123",
      amountBaseUnits: 100n,
      createdAt: NOW,
      expiresAt: NOW + 300,
      fence: 1n,
    }),
    nonce: `0x${"44".repeat(32)}`,
    solverId: "maker-a",
    solverKey: "solver-key-a",
    spreadBps: 25,
    sellToken: "0x123",
    sellAmount: 100n,
    buyToken: "0x456",
    grossBuyAmount: 120n,
    buyAmount: 117n,
    minBuyAmount: 110n,
    rfqExpiresAt: NOW + 200,
    pricingProvenance: "test-price-v1",
  };
}

describe("stored maker reservation codec", () => {
  it("decodes the complete WAL record contract", () => {
    expect(decodeStoredMakerReservation(completeRecord())).toEqual(
      completeRecord(),
    );
  });

  it("rejects missing and unknown top-level fields", () => {
    const { solverKey: _missing, ...incomplete } = completeRecord();
    expect(() => decodeStoredMakerReservation(incomplete)).toThrow(
      /solverKey is required/i,
    );
    expect(() =>
      decodeStoredMakerReservation({ ...completeRecord(), unsupported: true }),
    ).toThrow(/field unsupported is unsupported/i);
  });

  it("rejects a nested reservation with a missing state", () => {
    const record = completeRecord();
    const { state: _missing, ...reservation } = record.reservation;
    expect(() =>
      decodeStoredMakerReservation({ ...record, reservation }),
    ).toThrow(/reservation state is required/i);
  });

  it("rejects a nested reservation with an out-of-enum state", () => {
    const record = completeRecord();
    expect(() =>
      decodeStoredMakerReservation({
        ...record,
        reservation: { ...record.reservation, state: "cancelled" },
      }),
    ).toThrow(/reservation state is invalid/i);
  });

  it("rejects incomplete signed quote bindings", () => {
    expect(() =>
      decodeStoredMakerReservation({
        ...completeRecord(),
        signedCanonical: "canonical-quote",
      }),
    ).toThrow(/signature fields are incomplete/i);
  });
});
