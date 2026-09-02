import { describe, expect, it } from "vitest";
import {
  QUOTE_V3_DOMAIN,
  digestSolverQuoteV3,
  type SolverQuoteV3,
} from "./quote-v3.ts";
import { selectFillsV3 } from "./selection-v3.ts";
import {
  createSelectionTranscript,
  decodeSelectionTranscript,
  encodeSelectionTranscript,
  verifySelectionTranscriptForMaker,
} from "./transcript.ts";

const NOW = 1_900_000_000;
const D = `0x${"11".repeat(32)}`;
const ZERO = `0x${"0".repeat(64)}`;
const SIGNATURE = `0x${"00".repeat(31)}01${"00".repeat(31)}01`;

function quote(
  solverId: string,
  schedule: readonly { a: bigint; b: bigint }[],
): SolverQuoteV3 {
  const suffix = solverId.charCodeAt(solverId.length - 1);
  return {
    domain: QUOTE_V3_DOMAIN,
    version: 3,
    solverId,
    quoteKeyId: `${solverId}/q1`,
    nonce: `0x${suffix.toString(16).padStart(2, "0").repeat(32)}`,
    pool: "starknet:APP20_LOCALNET",
    helper: "0x1",
    escrowAddress: "0x1",
    rfqDigest: D,
    rfqFelt: "0x2",
    sellToken: "0x3",
    buyToken: "0x4",
    schedule,
    lockId: `0x${suffix.toString(16)}`,
    lockTicket: "0x6",
    lockTransactionHash: "0x7",
    lockExpiresAt: NOW + 90,
    spreadBps: 1,
    pricingProvenance: "fixture",
    quotedAt: NOW - 5,
    quoteExpiresAt: NOW + 30,
    signature: SIGNATURE,
  };
}

async function singleTranscript(quotesInOrder?: readonly SolverQuoteV3[]) {
  const winner = quote("maker-a", [
    { a: 1n, b: 3n },
    { a: 10n, b: 30n },
  ]);
  const partial = quote("maker-b", [
    { a: 1n, b: 4n },
    { a: 6n, b: 24n },
  ]);
  const coveringLoser = quote("maker-c", [
    { a: 1n, b: 2n },
    { a: 10n, b: 25n },
  ]);
  const quotes = quotesInOrder ?? [partial, coveringLoser, winner];
  const selection = selectFillsV3({
    quotes,
    exactSellAmount: 10n,
    floorBuyAmount: 0n,
  });
  const transcript = await createSelectionTranscript({
    rfqDigest: D,
    bucket: { min: 1n, max: 10n },
    createdAt: NOW,
    selection,
    quotes,
    refusals: [{ makerId: "maker-d", quoteDigest: ZERO }],
  });
  return { transcript, winner, partial, coveringLoser };
}

describe("RFQ v3 selection transcripts", () => {
  it("ranks winners, exact-cover losers, partial losers, then refusals", async () => {
    const { transcript } = await singleTranscript();
    expect(transcript.entries).toMatchObject([
      { makerId: "maker-a", outcome: "won", rank: 1, amountA: "10" },
      { makerId: "maker-c", outcome: "lost", rank: 2 },
      { makerId: "maker-b", outcome: "lost", rank: 3 },
      { makerId: "maker-d", outcome: "refused", rank: 4, quoteDigest: ZERO },
    ]);
    expect(transcript.clearingUnitPriceE18).toBe("3000000000000000000");
    expect(transcript.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Object.isFrozen(transcript.entries)).toBe(true);
  });

  it("puts multiple winners first in deterministic fill order", async () => {
    const a = quote("maker-a", [
      { a: 1n, b: 2n },
      { a: 6n, b: 12n },
    ]);
    const b = quote("maker-b", [
      { a: 1n, b: 3n },
      { a: 6n, b: 18n },
    ]);
    const selection = selectFillsV3({
      quotes: [a, b],
      exactSellAmount: 10n,
      floorBuyAmount: 0n,
    });
    const transcript = await createSelectionTranscript({
      rfqDigest: D,
      bucket: { min: 1n, max: 10n },
      createdAt: NOW,
      selection,
      quotes: [a, b],
      refusals: [],
    });
    expect(transcript.entries).toMatchObject([
      { makerId: "maker-b", outcome: "won", rank: 1, amountA: "6" },
      { makerId: "maker-a", outcome: "won", rank: 2, amountA: "4" },
    ]);
    expect(transcript.clearingUnitPriceE18).toBe("3000000000000000000");
  });

  it("is deterministic regardless of quote and refusal arrival order", async () => {
    const base = await singleTranscript();
    const reordered = await singleTranscript([
      base.winner,
      base.coveringLoser,
      base.partial,
    ]);
    expect(reordered.transcript).toEqual(base.transcript);
  });

  it("round-trips a closed wire shape and limits the zero sentinel to refusals", async () => {
    const { transcript } = await singleTranscript();
    const wire = encodeSelectionTranscript(transcript);
    expect(decodeSelectionTranscript(wire)).toEqual(transcript);
    expect(() =>
      decodeSelectionTranscript({ ...wire, exactSize: "10" }),
    ).toThrow(/unsupported/);
    expect(() =>
      decodeSelectionTranscript({
        ...wire,
        bucket: { ...wire.bucket, symbol: "STRK" },
      }),
    ).toThrow(/unsupported/);
    const entries = wire.entries.map((entry) =>
      entry.outcome === "lost" ? { ...entry, quoteDigest: ZERO } : entry,
    );
    expect(() => decodeSelectionTranscript({ ...wire, entries })).toThrow(
      /only for refused/,
    );
  });

  it("verifies the maker's own digest and fair-loss clearing price", async () => {
    const { transcript, coveringLoser } = await singleTranscript();
    const ownQuoteDigest = await digestSolverQuoteV3(coveringLoser);
    await expect(
      verifySelectionTranscriptForMaker(transcript, {
        makerId: coveringLoser.solverId,
        ownQuoteDigest,
        ownUnitPriceE18: 2_500_000_000_000_000_000n,
      }),
    ).resolves.toEqual({ consistent: true });
    await expect(
      verifySelectionTranscriptForMaker(transcript, {
        makerId: coveringLoser.solverId,
        ownQuoteDigest,
        ownUnitPriceE18: 3_000_000_000_000_000_001n,
      }),
    ).resolves.toMatchObject({
      consistent: false,
      reason: expect.stringMatching(/below the maker's losing quote/),
    });
    await expect(
      verifySelectionTranscriptForMaker(transcript, {
        makerId: coveringLoser.solverId,
        ownQuoteDigest: `0x${"ff".repeat(32)}`,
        ownUnitPriceE18: 1n,
      }),
    ).resolves.toMatchObject({ consistent: false });
  });

  it("detects transcript body tampering before maker outcome checks", async () => {
    const { transcript, winner } = await singleTranscript();
    await expect(
      verifySelectionTranscriptForMaker(
        { ...transcript, createdAt: transcript.createdAt + 1 },
        {
          makerId: winner.solverId,
          ownQuoteDigest: await digestSolverQuoteV3(winner),
          ownUnitPriceE18: 3_000_000_000_000_000_000n,
        },
      ),
    ).resolves.toMatchObject({
      consistent: false,
      reason: expect.stringMatching(/digest does not match/),
    });
  });

  it("supports a no-winner transcript with zero clearing price", async () => {
    const transcript = await createSelectionTranscript({
      rfqDigest: D,
      bucket: { min: 1n, max: 10n },
      createdAt: NOW,
      selection: { kind: "refused", reason: "no-quotes" },
      quotes: [],
      refusals: [{ makerId: "maker-a", quoteDigest: ZERO }],
    });
    expect(transcript.clearingUnitPriceE18).toBe("0");
    expect(transcript.entries).toEqual([
      {
        makerId: "maker-a",
        quoteDigest: ZERO,
        outcome: "refused",
        rank: 1,
      },
    ]);
  });
});
