import { describe, expect, it } from "vitest";
import type { RfqLifecycleState } from "./rfq-lifecycle";
import { rfqStateLabel } from "./rfq-state-label";

const STATES: readonly RfqLifecycleState[] = [
  "draft",
  "requesting",
  "quoted",
  "reviewing",
  "submission-unknown",
  "funded",
  "filled",
  "claimable",
  "settled",
  "expired",
  "refundable",
  "refunded",
  "refused",
  "cancel-pending",
  "cancelled",
  "reorged",
  "quarantined",
];

describe("RFQ state labels", () => {
  it.each(STATES)("returns a non-empty label for %s", (state) => {
    const label = rfqStateLabel(state);
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe(state);
  });

  it("names v3 submission as an atomic Take rather than funding", () => {
    expect(rfqStateLabel("submission-unknown", "v3")).toBe(
      "Take outcome unknown",
    );
    expect(rfqStateLabel("settled", "v3")).toMatch(/atomically/i);
  });
});
