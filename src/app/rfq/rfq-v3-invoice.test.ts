import { describe, expect, it } from "vitest";
import type { SolverQuoteV3 } from "@app20/private-intents";
import {
  estimateInvoiceSellSize,
  sizeInvoiceFromSelectedFills,
} from "./rfq-v3-invoice";

function quote(
  solverId: string,
  lockId: string,
  schedule: readonly Readonly<{ a: bigint; b: bigint }>[],
): SolverQuoteV3 {
  return { solverId, lockId, schedule } as SolverQuoteV3;
}

describe("RFQ v3 invoice sizing", () => {
  it("estimates target divided by median mid with a two-percent buffer", () => {
    expect(
      estimateInvoiceSellSize({
        targetBuyBaseUnits: 2_000_000n,
        medianMidE18: 2n * 10n ** 18n,
      }),
    ).toEqual({
      estimatedSellAmount: 1_020_000_000_000_000_000n,
      bucket: {
        min: 1_000_000_000_000_000_000n,
        max: 2_500_000_000_000_000_000n,
      },
    });
  });

  it("uses schedule inversion to choose the smallest exact amount", () => {
    const selected = quote("maker-a", "0x41", [
      { a: 500_000_000_000_000_000n, b: 1_000_000n },
      { a: 1_500_000_000_000_000_000n, b: 3_000_000n },
    ]);
    const result = sizeInvoiceFromSelectedFills({
      targetBuyBaseUnits: 2_000_000n,
      selection: {
        kind: "selected",
        rule: "app20/rfq-selection/v3",
        totalB: 3_000_000n,
        fills: [
          {
            quote: selected,
            amountA: 1_500_000_000_000_000_000n,
            amountB: 3_000_000n,
          },
        ],
      },
      bucket: {
        min: 500_000_000_000_000_000n,
        max: 1_000_000_000_000_000_000n,
      },
    });
    expect(result).toMatchObject({
      exactSellAmount: 1_000_000_000_000_000_000n,
      totalBuyAmount: 2_000_000n,
      fills: [{ lockId: "0x41", amountB: 2_000_000n }],
    });
  });

  it("refuses when selected caps cannot reach the invoice target", () => {
    const selected = quote("maker-a", "0x41", [
      { a: 1n, b: 2n },
      { a: 2n, b: 4n },
    ]);
    expect(() =>
      sizeInvoiceFromSelectedFills({
        targetBuyBaseUnits: 5n,
        selection: {
          kind: "selected",
          rule: "app20/rfq-selection/v3",
          totalB: 4n,
          fills: [{ quote: selected, amountA: 2n, amountB: 4n }],
        },
      }),
    ).toThrow(/no quoted bucket rung/i);
  });
});
