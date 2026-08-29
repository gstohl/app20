import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import OperationsDashboard from "./OperationsDashboard";
import type { OperationsAvailability } from "./rfq-operations";
import { useRfqOperations } from "./use-rfq-operations";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("./use-rfq-operations", () => ({
  useRfqOperations: vi.fn(),
}));

const NOW = 2_000_000_000;
const availability: OperationsAvailability = {
  mode: "running",
  reason: "Named localnet fixture operations are running.",
  claimsAndRefundsEnabled: true,
  asOf: NOW,
  status: {
    schema: "app20/rfq-operations-status/v1",
    environment: "localnet",
    observedAt: NOW,
    validUntil: NOW + 30,
    mode: "running",
    reason: "Named localnet fixture operations are running.",
    claimsAndRefundsEnabled: true,
    directory: {
      epoch: 0,
      checkpoint: "local-fixture-checkpoint-v1",
      validUntil: NOW + 3_600,
    },
    cohort: {
      governed: 2,
      invited: 1,
      responded: 1,
      refused: 0,
      unavailable: 0,
    },
    makers: [
      {
        makerId: "maker-a",
        keyId: "maker-a/key-v1",
        keyStatus: "valid",
        keyValidUntil: NOW + 3_600,
        invitationStatus: "responded",
        capacityBand: "medium",
        eligible: true,
        rationale: "Eligible under the current governed directory.",
      },
    ],
    rawInventoryExposed: false,
  },
};

describe("RFQ operations dashboard maker directory", () => {
  it("passes the live directory, governed count, and current time to the cohort", () => {
    vi.mocked(useRfqOperations).mockReturnValue(availability);

    const markup = renderToStaticMarkup(<OperationsDashboard />);

    expect(markup).toContain("Maker-directory epoch</dt><dd>0</dd>");
    expect(markup).toContain("local-fixture-checkpoint-v1");
    expect(markup).toContain("Directory freshness</dt><dd><strong>Fresh</strong>");
    expect(markup).toContain("Governed makers 2 · invited 1 · responded 1");
    expect(markup).toContain("<strong>Eligible</strong>");
    expect(markup).not.toContain("Maker-directory epoch</dt><dd>Unavailable");
  });
});
