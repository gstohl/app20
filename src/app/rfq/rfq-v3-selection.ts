import {
  createSelectionTranscript,
  digestPrivateRfqV2,
  evaluatePriceSchedule,
  importQuotePublicKey,
  scheduleUnitPriceE18,
  selectFillsV3,
  verifyCanonicalQuote,
  verifySolverQuoteV3,
  type PrivateRfqV2,
  type SelectionTranscriptRefusal,
  type SelectionTranscriptV1,
  type SelectFillsV3Result,
  type SolverQuoteV3,
} from "@app20/private-intents";
import { resolveLocalnetQuoteKey } from "@/lib/localnet-quote-authority";
import {
  readEscrowLock,
  type LocalnetEscrowLock,
} from "./localnet-private-intents";

export type VerifyQuotesV3Dependencies = Readonly<{
  readLock?: (lockId: string) => Promise<LocalnetEscrowLock>;
  importPublicKey?: (jwk: JsonWebKey) => Promise<CryptoKey>;
  verify?: (
    canonical: string,
    signature: string,
    publicKey: CryptoKey,
  ) => Promise<boolean>;
  resolveKey?: (
    solverId: string,
    quoteKeyId: string,
    at: number,
  ) => JsonWebKey | Promise<JsonWebKey>;
}>;

export type VerifiedQuoteV3 = Readonly<{
  quote: SolverQuoteV3;
  lock: LocalnetEscrowLock & Readonly<{ status: "open" }>;
}>;

/** Reads and cryptographically verifies every quote against its exact lock. */
export async function verifyQuotesV3(input: {
  rfq: PrivateRfqV2;
  quotes: readonly SolverQuoteV3[];
  now: number;
  dependencies?: VerifyQuotesV3Dependencies;
}): Promise<readonly VerifiedQuoteV3[]> {
  if (!Number.isSafeInteger(input.now) || input.now <= 0) {
    throw new Error(
      "Quote verification time must be a positive unix timestamp.",
    );
  }
  const makerIds = new Set<string>();
  const lockIds = new Set<string>();
  for (const quote of input.quotes) {
    if (makerIds.has(quote.solverId)) {
      throw new Error("RFQ v3 accepts at most one quote from each maker.");
    }
    if (lockIds.has(quote.lockId)) {
      throw new Error("RFQ v3 quotes must reference distinct lock ids.");
    }
    makerIds.add(quote.solverId);
    lockIds.add(quote.lockId);
  }
  const dependencies = input.dependencies ?? {};
  const readLock = dependencies.readLock ?? readEscrowLock;
  const verified = await Promise.all(
    input.quotes.map(async (quote): Promise<VerifiedQuoteV3> => {
      const lock = await readLock(quote.lockId);
      if (lock.status !== "open") {
        throw new Error(`Maker ${quote.solverId}'s escrow lock is not open.`);
      }
      await verifySolverQuoteV3(quote, input.now, {
        rfq: input.rfq,
        importPublicKey: dependencies.importPublicKey ?? importQuotePublicKey,
        verify: dependencies.verify ?? verifyCanonicalQuote,
        resolveKey: dependencies.resolveKey ?? resolveLocalnetQuoteKey,
        lockOnChain: {
          rfqId: lock.rfqId,
          takerCommitment: lock.takerCommitment,
          tokenA: lock.tokenA,
          tokenB: lock.tokenB,
          expiry: lock.expiry,
          schedule: lock.schedule,
          remainingB: lock.remainingB,
          status: "open",
        },
      });
      return Object.freeze({
        quote,
        lock: lock as LocalnetEscrowLock & Readonly<{ status: "open" }>,
      });
    }),
  );
  return Object.freeze(verified);
}

export type QuoteComparisonV3Outcome =
  | "selected"
  | "not-selected"
  | "does-not-cover";

export type QuoteComparisonV3Row = Readonly<{
  makerId: string;
  evaluatedReceiveAmount: bigint | "does not cover";
  unitPriceE18: bigint;
  rank: number;
  outcome: QuoteComparisonV3Outcome;
  rationale: readonly string[];
}>;

function quoteIdentity(quote: SolverQuoteV3): string {
  return `${quote.solverId}|${quote.lockId}|${quote.nonce}`;
}

/** Builds deterministic exact-size ranks without leaking the size to a maker. */
export function buildQuoteComparisonV3(input: {
  quotes: readonly SolverQuoteV3[];
  exactSellAmount: bigint;
  selection: SelectFillsV3Result;
}): readonly QuoteComparisonV3Row[] {
  if (
    typeof input.exactSellAmount !== "bigint" ||
    input.exactSellAmount <= 0n
  ) {
    throw new Error("Exact sell amount must be positive.");
  }
  const winners =
    input.selection.kind === "selected"
      ? new Map(
          input.selection.fills.map((fill, index) => [
            quoteIdentity(fill.quote),
            { index, fill },
          ]),
        )
      : new Map<string, never>();
  const scored = input.quotes.map((quote) => {
    const first = quote.schedule[0]!;
    const last = quote.schedule[quote.schedule.length - 1]!;
    const winner = winners.get(quoteIdentity(quote));
    const evaluationAmount = winner?.fill.amountA ?? input.exactSellAmount;
    const covers = first.a <= evaluationAmount && evaluationAmount <= last.a;
    const evaluated = covers
      ? evaluatePriceSchedule(quote.schedule, evaluationAmount)
      : undefined;
    const unitPriceE18 = covers
      ? (evaluated! * 10n ** 18n) / evaluationAmount
      : scheduleUnitPriceE18(quote.schedule, last.a);
    return { quote, covers, evaluated, unitPriceE18 };
  });
  const winnerRows = [...winners.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ fill }) =>
      scored.find(
        ({ quote }) => quoteIdentity(quote) === quoteIdentity(fill.quote),
      ),
    )
    .filter((row): row is (typeof scored)[number] => row !== undefined);
  const winnerIds = new Set(
    winnerRows.map(({ quote }) => quoteIdentity(quote)),
  );
  const loserRows = scored
    .filter(({ quote }) => !winnerIds.has(quoteIdentity(quote)))
    .sort((left, right) => {
      if (left.covers !== right.covers) return left.covers ? -1 : 1;
      const leftScore = left.covers ? left.evaluated! : left.unitPriceE18;
      const rightScore = right.covers ? right.evaluated! : right.unitPriceE18;
      if (leftScore !== rightScore) return leftScore > rightScore ? -1 : 1;
      return left.quote.solverId.localeCompare(right.quote.solverId);
    });
  return Object.freeze(
    [...winnerRows, ...loserRows].map((row, index) => {
      const selected = winnerIds.has(quoteIdentity(row.quote));
      const split =
        input.selection.kind === "selected" && input.selection.fills.length > 1;
      const rationale = selected
        ? [
            split
              ? "Selected by the deterministic multi-maker depth rule."
              : "Selected for the best exact-size receive amount.",
            "The signed schedule matches an open on-chain lock.",
          ]
        : row.covers
          ? [
              input.selection.kind === "refused"
                ? `Not executable because selection refused: ${input.selection.reason}.`
                : "A higher-ranked quote won at the exact size.",
              "The signed schedule covers the exact sell amount.",
            ]
          : [
              "The signed schedule does not cover the exact sell amount.",
              "Ranked by unit price at the schedule maximum for split-depth comparison.",
            ];
      return Object.freeze({
        makerId: row.quote.solverId,
        evaluatedReceiveAmount: row.covers
          ? row.evaluated!
          : ("does not cover" as const),
        unitPriceE18: row.unitPriceE18,
        rank: index + 1,
        outcome: selected
          ? ("selected" as const)
          : row.covers
            ? ("not-selected" as const)
            : ("does-not-cover" as const),
        rationale: Object.freeze(rationale),
      });
    }),
  );
}

export type V3SelectionResult = Readonly<{
  verifiedQuotes: readonly VerifiedQuoteV3[];
  selection: SelectFillsV3Result;
  transcript: SelectionTranscriptV1;
  comparison: readonly QuoteComparisonV3Row[];
}>;

/** Verifies, evaluates, selects, and creates the fair-loss transcript locally. */
export async function createV3Selection(input: {
  rfq: PrivateRfqV2;
  quotes: readonly SolverQuoteV3[];
  refusals: readonly SelectionTranscriptRefusal[];
  exactSellAmount: bigint;
  localFloor: bigint;
  now: number;
  dependencies?: VerifyQuotesV3Dependencies;
}): Promise<V3SelectionResult> {
  const verifiedQuotes = await verifyQuotesV3({
    rfq: input.rfq,
    quotes: input.quotes,
    now: input.now,
    dependencies: input.dependencies,
  });
  const quotes = verifiedQuotes.map(({ quote }) => quote);
  const selection = selectFillsV3({
    quotes,
    exactSellAmount: input.exactSellAmount,
    floorBuyAmount: input.localFloor,
  });
  const transcript = await createSelectionTranscript({
    rfqDigest: await digestPrivateRfqV2(input.rfq),
    bucket: {
      min: input.rfq.sellBucketMinBaseUnits,
      max: input.rfq.sellBucketMaxBaseUnits,
    },
    createdAt: input.now,
    selection,
    quotes,
    refusals: input.refusals,
  });
  return Object.freeze({
    verifiedQuotes,
    selection,
    transcript,
    comparison: buildQuoteComparisonV3({
      quotes,
      exactSellAmount: input.exactSellAmount,
      selection,
    }),
  });
}

export const selectQuotesV3 = createV3Selection;
