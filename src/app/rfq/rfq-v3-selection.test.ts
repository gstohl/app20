import {
  PRIVATE_RFQ_V2_DOMAIN,
  QUOTE_V3_DOMAIN,
  RFQ_SELECTION_V3_RULE,
  digestPrivateRfqV2,
  type PrivateRfqV2,
  type SolverQuoteV3,
} from "@app20/private-intents";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import QuoteComparison from "./QuoteComparison";
import {
  buildQuoteComparisonV3,
  createV3Selection,
  verifyQuotesV3,
} from "./rfq-v3-selection";

const NOW = 1_900_000_010;
const SIGNATURE = `0x${"0".repeat(63)}1${"0".repeat(63)}1`;
const JWK: JsonWebKey = { kty: "EC", crv: "P-256", x: "x", y: "y" };

const rfq: PrivateRfqV2 = Object.freeze({
  version: 2,
  domain: PRIVATE_RFQ_V2_DOMAIN,
  rfqId: `0x${"11".repeat(32)}`,
  rfqFelt: "0x77",
  takerCommitment: "0x55",
  chainId: "starknet:APP20_LOCALNET",
  registryRevision: "registry-v1",
  directoryEpoch: 0,
  settlementHelper: "0x5",
  sellToken: "0x1",
  buyToken: "0x2",
  sellBucketMinBaseUnits: 50n,
  sellBucketMaxBaseUnits: 100n,
  createdAt: NOW - 10,
  responseDeadline: NOW + 10,
  expiresAt: NOW + 80,
  lockExpiresAt: NOW + 80,
});

async function quote(
  makerId: string,
  lockId: string,
  endB: bigint,
): Promise<SolverQuoteV3> {
  return Object.freeze({
    domain: QUOTE_V3_DOMAIN,
    version: 3,
    solverId: makerId,
    quoteKeyId: `${makerId}/key`,
    nonce: `0x${lockId.slice(2).padStart(64, "0")}`,
    pool: "starknet:APP20_LOCALNET",
    helper: "0x5",
    escrowAddress: "0x5",
    rfqDigest: await digestPrivateRfqV2(rfq),
    rfqFelt: "0x77",
    sellToken: "0x1",
    buyToken: "0x2",
    schedule: [
      { a: 50n, b: endB / 2n },
      { a: 100n, b: endB },
    ],
    lockId,
    lockTicket: `0x${(BigInt(lockId) + 100n).toString(16)}`,
    lockTransactionHash: `0x${(BigInt(lockId) + 200n).toString(16)}`,
    lockExpiresAt: NOW + 80,
    spreadBps: 20,
    pricingProvenance: "fixture",
    quotedAt: NOW - 1,
    quoteExpiresAt: NOW + 30,
    signature: SIGNATURE,
  });
}

function lockFor(candidate: SolverQuoteV3) {
  return Object.freeze({
    status: "open" as const,
    tokenA: "0x1",
    tokenB: "0x2",
    rfqId: "0x77",
    takerCommitment: "0x55",
    expiry: NOW + 80,
    schedule: candidate.schedule,
    remainingB: candidate.schedule.at(-1)!.b,
    earnedA: 0n,
    ticket: candidate.lockTicket,
    createdTransactionHash: candidate.lockTransactionHash,
    proceedsSettled: false,
    collateralReleased: false,
  });
}

const dependencies = {
  importPublicKey: vi.fn(async () => ({}) as CryptoKey),
  verify: vi.fn(async () => true),
  resolveKey: vi.fn(async () => JWK),
};

describe("browser RFQ v3 verification and selection", () => {
  it("reads every lock before selecting and creates ranked presentation rows", async () => {
    const quotes = [
      await quote("maker-a", "0x41", 200n),
      await quote("maker-b", "0x42", 202n),
    ];
    const readLock = vi.fn(async (lockId: string) =>
      lockFor(quotes.find((candidate) => candidate.lockId === lockId)!),
    );
    const result = await createV3Selection({
      rfq,
      quotes,
      refusals: [
        {
          makerId: "maker-c",
          quoteDigest: `0x${"33".repeat(32)}`,
        },
      ],
      exactSellAmount: 75n,
      localFloor: 145n,
      now: NOW,
      dependencies: { ...dependencies, readLock },
    });
    expect(readLock).toHaveBeenCalledTimes(2);
    expect(result.selection).toMatchObject({
      kind: "selected",
      totalB: 151n,
      fills: [{ quote: { solverId: "maker-b" }, amountA: 75n }],
    });
    expect(result.comparison).toEqual([
      expect.objectContaining({
        makerId: "maker-b",
        evaluatedReceiveAmount: 151n,
        rank: 1,
        outcome: "selected",
      }),
      expect.objectContaining({
        makerId: "maker-a",
        evaluatedReceiveAmount: 150n,
        rank: 2,
        outcome: "not-selected",
      }),
    ]);
    expect(result.transcript.entries.map(({ makerId, outcome }) => [makerId, outcome])).toEqual([
      ["maker-b", "won"],
      ["maker-a", "lost"],
      ["maker-c", "refused"],
    ]);

    const markup = renderToStaticMarkup(
      QuoteComparison({
        quotes,
        comparison: result.comparison,
        refusals: [
          {
            makerId: "maker-c",
            quoteDigest: `0x${"33".repeat(32)}`,
            reason: "inventory unavailable",
          },
        ],
        selection: result.selection,
        exactSellAmount: 75n,
        sellDecimals: 0,
        buyDecimals: 0,
        sellSymbol: "STRK",
        buySymbol: "USDC",
      }),
    );
    expect(markup).toContain("SINGLE FILL SELECTED");
    expect(markup).toContain("Rank 1 · maker-b");
    expect(markup).toContain("Rank 2 · maker-a");
    expect(markup).toContain("151 USDC · 151 base units");
    expect(markup).toContain("150 USDC · 150 base units");
    expect(markup).toContain("maker-c · Refused");
    expect(markup).toContain("inventory unavailable");
  });

  it.each([
    ["ticket", { ticket: "0x999" }],
    ["creation transaction", { createdTransactionHash: "0x998" }],
  ])("fails closed on a signed lock %s mismatch", async (_field, mutation) => {
    const candidate = await quote("maker-a", "0x41", 200n);
    await expect(
      verifyQuotesV3({
        rfq,
        quotes: [candidate],
        now: NOW,
        dependencies: {
          ...dependencies,
          readLock: async () => ({ ...lockFor(candidate), ...mutation }),
        },
      }),
    ).rejects.toThrow(/open on-chain lock/i);
  });

  it("fails closed when two quotes reuse one lock", async () => {
    const first = await quote("maker-a", "0x41", 200n);
    const second = { ...(await quote("maker-b", "0x42", 202n)), lockId: "0x41" };
    await expect(
      verifyQuotesV3({
        rfq,
        quotes: [first, second],
        now: NOW,
        dependencies,
      }),
    ).rejects.toThrow(/distinct lock ids/i);
  });

  it("shows each selected maker's evaluated partial receive for a split", async () => {
    const first = await quote("maker-a", "0x41", 200n);
    const second = await quote("maker-b", "0x42", 202n);
    expect(
      buildQuoteComparisonV3({
        quotes: [first, second],
        exactSellAmount: 150n,
        selection: {
          kind: "selected",
          rule: RFQ_SELECTION_V3_RULE,
          totalB: 301n,
          fills: [
            { quote: second, amountA: 75n, amountB: 151n },
            { quote: first, amountA: 75n, amountB: 150n },
          ],
        },
      }).map(({ makerId, evaluatedReceiveAmount, outcome }) => ({
        makerId,
        evaluatedReceiveAmount,
        outcome,
      })),
    ).toEqual([
      { makerId: "maker-b", evaluatedReceiveAmount: 151n, outcome: "selected" },
      { makerId: "maker-a", evaluatedReceiveAmount: 150n, outcome: "selected" },
    ]);
  });

  it("marks a schedule outside the exact size as does not cover", async () => {
    const candidate = await quote("maker-a", "0x41", 200n);
    expect(
      buildQuoteComparisonV3({
        quotes: [candidate],
        exactSellAmount: 40n,
        selection: { kind: "refused", reason: "insufficient-depth" },
      }),
    ).toEqual([
      expect.objectContaining({
        evaluatedReceiveAmount: "does not cover",
        outcome: "does-not-cover",
      }),
    ]);
  });
});
