import { describe, expect, it } from "vitest";
import { deriveCommitmentDeadline } from "./escrow-vnext-deadline";

const windows = {
  quoteExpiresAt: 140,
  reservationExpiresAt: 130,
  rfqExpiresAt: 150,
  directoryValidUntil: 160,
  now: 100,
};

describe("VNext commitment deadline policy", () => {
  it("selects the earliest authorization window", () => {
    expect(deriveCommitmentDeadline(windows)).toBe(130);
  });

  it("rejects an expired or exactly-current minimum", () => {
    expect(() => deriveCommitmentDeadline({ ...windows, now: 130 })).toThrow(/later than now/);
    expect(() => deriveCommitmentDeadline({ ...windows, quoteExpiresAt: 99 })).toThrow(/later than now/);
  });

  it("rejects unsafe and non-integral timestamps", () => {
    expect(() => deriveCommitmentDeadline({ ...windows, rfqExpiresAt: 1.5 })).toThrow(/safe-integer/);
    expect(() => deriveCommitmentDeadline({ ...windows, now: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/safe-integer/);
  });
});
