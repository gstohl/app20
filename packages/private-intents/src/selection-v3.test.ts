import { describe, expect, it } from "vitest";
import { QUOTE_V3_DOMAIN, type SolverQuoteV3 } from "./quote-v3.ts";
import { selectFillsV3 } from "./selection-v3.ts";

const D = `0x${"11".repeat(32)}`;
const SIGNATURE = `0x${"00".repeat(31)}01${"00".repeat(31)}01`;

function quote(
  solverId: string,
  schedule: readonly { a: bigint; b: bigint }[],
  overrides: Partial<SolverQuoteV3> = {},
): SolverQuoteV3 {
  return {
    domain: QUOTE_V3_DOMAIN,
    version: 3,
    solverId,
    quoteKeyId: `${solverId}/q1`,
    nonce: D,
    pool: "starknet:APP20_LOCALNET",
    helper: "0x1",
    escrowAddress: "0x1",
    rfqDigest: D,
    rfqFelt: "0x2",
    sellToken: "0x3",
    buyToken: "0x4",
    schedule,
    lockId: `0x${(100 + solverId.charCodeAt(solverId.length - 1)).toString(16)}`,
    lockTicket: "0x6",
    lockTransactionHash: "0x7",
    lockExpiresAt: 1_900_000_100,
    spreadBps: 1,
    pricingProvenance: "fixture",
    quotedAt: 1_900_000_000,
    quoteExpiresAt: 1_900_000_050,
    signature: SIGNATURE,
    ...overrides,
  };
}

function selectedFills(
  result: ReturnType<typeof selectFillsV3>,
): readonly { quote: SolverQuoteV3; amountA: bigint; amountB: bigint }[] {
  if (result.kind !== "selected") throw new Error("expected selection");
  return result.fills;
}

describe("RFQ v3 fill selection", () => {
  it("returns no-quotes for an empty invited-maker result", () => {
    expect(
      selectFillsV3({
        quotes: [],
        exactSellAmount: 10n,
        floorBuyAmount: 0n,
      }),
    ).toEqual({ kind: "refused", reason: "no-quotes" });
  });

  it("picks the single cover with the greatest evaluated receive amount", () => {
    const weak = quote("maker-b", [
      { a: 1n, b: 2n },
      { a: 10n, b: 20n },
    ]);
    const best = quote("maker-a", [
      { a: 1n, b: 3n },
      { a: 10n, b: 25n },
    ]);
    const result = selectFillsV3({
      quotes: [weak, best],
      exactSellAmount: 7n,
      floorBuyAmount: 0n,
    });
    expect(selectedFills(result)).toEqual([
      { quote: best, amountA: 7n, amountB: 17n },
    ]);
  });

  it("breaks equal single amounts by later expiry and then solverId", () => {
    const early = quote("maker-a", [{ a: 10n, b: 20n }], {
      quoteExpiresAt: 1_900_000_040,
    });
    const lateB = quote("maker-b", [{ a: 10n, b: 20n }]);
    expect(
      selectedFills(
        selectFillsV3({
          quotes: [early, lateB],
          exactSellAmount: 10n,
          floorBuyAmount: 0n,
        }),
      )[0]?.quote,
    ).toBe(lateB);

    const lateA = quote("maker-a", [{ a: 10n, b: 20n }]);
    expect(
      selectedFills(
        selectFillsV3({
          quotes: [lateB, lateA],
          exactSellAmount: 10n,
          floorBuyAmount: 0n,
        }),
      )[0]?.quote,
    ).toBe(lateA);
  });

  it("orders split fills by unit price at a_max and allocates greedily", () => {
    const lower = quote("maker-a", [
      { a: 1n, b: 2n },
      { a: 6n, b: 12n },
    ]);
    const higher = quote("maker-b", [
      { a: 2n, b: 6n },
      { a: 5n, b: 15n },
    ]);
    const result = selectFillsV3({
      quotes: [lower, higher],
      exactSellAmount: 10n,
      floorBuyAmount: 0n,
    });
    expect(selectedFills(result)).toEqual([
      { quote: higher, amountA: 5n, amountB: 15n },
      { quote: lower, amountA: 5n, amountB: 10n },
    ]);
    expect(result).toMatchObject({
      kind: "selected",
      totalB: 25n,
      rule: "app20/rfq-selection/v3",
    });
  });

  it("skips a split quote when the remainder is below its a_min", () => {
    const first = quote("maker-a", [
      { a: 1n, b: 4n },
      { a: 7n, b: 28n },
    ]);
    const infeasible = quote("maker-b", [
      { a: 4n, b: 12n },
      { a: 6n, b: 18n },
    ]);
    const fallback = quote("maker-c", [
      { a: 3n, b: 6n },
      { a: 5n, b: 10n },
    ]);
    const result = selectFillsV3({
      quotes: [fallback, infeasible, first],
      exactSellAmount: 10n,
      floorBuyAmount: 0n,
    });
    expect(selectedFills(result).map((fill) => fill.quote.solverId)).toEqual([
      "maker-a",
      "maker-c",
    ]);
    expect(selectedFills(result).map((fill) => fill.amountA)).toEqual([7n, 3n]);
  });

  it("stops at maxFills and reports insufficient depth", () => {
    const quotes = ["maker-a", "maker-b", "maker-c"].map((maker, index) =>
      quote(maker, [
        { a: 1n, b: BigInt(4 - index) },
        { a: 4n, b: BigInt((4 - index) * 4) },
      ]),
    );
    expect(
      selectFillsV3({
        quotes,
        exactSellAmount: 10n,
        floorBuyAmount: 0n,
        maxFills: 2,
      }),
    ).toEqual({ kind: "refused", reason: "insufficient-depth" });
  });

  it("reports insufficient depth before considering the floor", () => {
    expect(
      selectFillsV3({
        quotes: [quote("maker-a", [{ a: 1n, b: 100n }, { a: 4n, b: 400n }])],
        exactSellAmount: 10n,
        floorBuyAmount: 1_000n,
      }),
    ).toEqual({ kind: "refused", reason: "insufficient-depth" });
  });

  it("refuses a complete selection below the sealed local floor", () => {
    expect(
      selectFillsV3({
        quotes: [quote("maker-a", [{ a: 10n, b: 20n }])],
        exactSellAmount: 10n,
        floorBuyAmount: 21n,
      }),
    ).toEqual({ kind: "refused", reason: "below-floor" });
  });

  it("is independent of input arrival order on both paths", () => {
    const a = quote("maker-a", [{ a: 1n, b: 2n }, { a: 6n, b: 12n }]);
    const b = quote("maker-b", [{ a: 1n, b: 3n }, { a: 6n, b: 18n }]);
    const c = quote("maker-c", [{ a: 1n, b: 2n }, { a: 5n, b: 10n }]);
    const run = (quotes: readonly SolverQuoteV3[]) => {
      const result = selectFillsV3({
        quotes,
        exactSellAmount: 12n,
        floorBuyAmount: 0n,
      });
      return selectedFills(result).map((fill) => ({
        solverId: fill.quote.solverId,
        amountA: fill.amountA,
        amountB: fill.amountB,
      }));
    };
    expect(run([a, b, c])).toEqual(run([c, a, b]));
    expect(run([b, c, a])).toEqual(run([a, b, c]));
  });

  it("validates the contract fill cap and u128 exact amount", () => {
    const value = quote("maker-a", [{ a: 1n, b: 1n }]);
    expect(() =>
      selectFillsV3({
        quotes: [value],
        exactSellAmount: 1n,
        floorBuyAmount: 0n,
        maxFills: 5,
      }),
    ).toThrow(/\[1, 4\]/);
    expect(() =>
      selectFillsV3({
        quotes: [value],
        exactSellAmount: 1n << 128n,
        floorBuyAmount: 0n,
      }),
    ).toThrow(/u128/);
  });
});
