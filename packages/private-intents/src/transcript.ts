import { PrivateIntentError } from "./index.ts";
import { digestSolverQuoteV3, type SolverQuoteV3 } from "./quote-v3.ts";
import {
  RFQ_SELECTION_V3_RULE,
  type SelectFillsV3Result,
} from "./selection-v3.ts";
import { evaluatePriceSchedule, scheduleUnitPriceE18 } from "./schedule.ts";

export const SELECTION_TRANSCRIPT_DOMAIN =
  "app20/rfq-selection-transcript/v1" as const;

export type SelectionTranscriptEntryV1 = Readonly<{
  makerId: string;
  quoteDigest: string;
  outcome: "won" | "lost" | "refused";
  rank: number;
  amountA?: string;
}>;

export type SelectionTranscriptV1 = Readonly<{
  version: 1;
  domain: typeof SELECTION_TRANSCRIPT_DOMAIN;
  rfqDigest: string;
  rule: typeof RFQ_SELECTION_V3_RULE;
  bucket: Readonly<{ min: string; max: string }>;
  createdAt: number;
  entries: readonly SelectionTranscriptEntryV1[];
  clearingUnitPriceE18: string;
  digest: string;
}>;

export type SelectionTranscriptV1Wire = SelectionTranscriptV1;
export type SelectionTranscriptRefusal = Readonly<{
  makerId: string;
  quoteDigest: string;
}>;
export type CreateSelectionTranscriptInput = Readonly<{
  rfqDigest: string;
  bucket: Readonly<{ min: bigint; max: bigint }>;
  createdAt: number;
  selection: SelectFillsV3Result;
  quotes: readonly SolverQuoteV3[];
  refusals: readonly SelectionTranscriptRefusal[];
}>;
export type TranscriptMakerVerification = Readonly<{
  makerId: string;
  ownQuoteDigest: string;
  ownUnitPriceE18: bigint;
}>;
export type TranscriptMakerVerificationResult = Readonly<{
  consistent: boolean;
  reason?: string;
}>;

const DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_DIGEST = `0x${"0".repeat(64)}`;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const TRANSCRIPT_FIELDS = new Set([
  "bucket",
  "clearingUnitPriceE18",
  "createdAt",
  "digest",
  "domain",
  "entries",
  "rfqDigest",
  "rule",
  "version",
]);
const BUCKET_FIELDS = new Set(["max", "min"]);
const ENTRY_FIELDS = new Set([
  "amountA",
  "makerId",
  "outcome",
  "quoteDigest",
  "rank",
]);

function requireDigest(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new PrivateIntentError(`${label} must be a 32-byte hex digest.`);
  }
  return normalized;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new PrivateIntentError(`${label} is required.`);
  return normalized;
}

function requireTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PrivateIntentError(
      `${label} must be a positive unix-seconds timestamp.`,
    );
  }
  return value;
}

function requireDecimal(value: string, label: string): string {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new PrivateIntentError(
      `${label} must be a canonical decimal string.`,
    );
  }
  return value;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalEntry(entry: SelectionTranscriptEntryV1, label: string) {
  const makerId = requireText(entry.makerId, `${label}.makerId`);
  const quoteDigest = requireDigest(entry.quoteDigest, `${label}.quoteDigest`);
  if (
    entry.outcome !== "won" &&
    entry.outcome !== "lost" &&
    entry.outcome !== "refused"
  ) {
    throw new PrivateIntentError(`${label}.outcome is unsupported.`);
  }
  if (!Number.isSafeInteger(entry.rank) || entry.rank <= 0) {
    throw new PrivateIntentError(`${label}.rank must be a positive integer.`);
  }
  if (entry.outcome !== "refused" && quoteDigest === ZERO_DIGEST) {
    throw new PrivateIntentError(
      "The zero quote digest sentinel is accepted only for refused makers.",
    );
  }
  if (entry.outcome === "won") {
    if (
      entry.amountA === undefined ||
      BigInt(requireDecimal(entry.amountA, `${label}.amountA`)) <= 0n
    ) {
      throw new PrivateIntentError(
        `${label}.amountA must be positive for a winner.`,
      );
    }
  } else if (entry.amountA !== undefined) {
    throw new PrivateIntentError(
      `${label}.amountA is accepted only for a winning fill.`,
    );
  }
  return {
    ...(entry.amountA === undefined ? {} : { amountA: entry.amountA }),
    makerId,
    outcome: entry.outcome,
    quoteDigest,
    rank: entry.rank,
  };
}

function canonicalBody(transcript: Omit<SelectionTranscriptV1, "digest">) {
  if (
    transcript.version !== 1 ||
    transcript.domain !== SELECTION_TRANSCRIPT_DOMAIN
  ) {
    throw new PrivateIntentError("Only selection transcript v1 is supported.");
  }
  if (transcript.rule !== RFQ_SELECTION_V3_RULE) {
    throw new PrivateIntentError(
      "Selection transcript must use the RFQ selection v3 rule.",
    );
  }
  const min = requireDecimal(transcript.bucket.min, "bucket.min");
  const max = requireDecimal(transcript.bucket.max, "bucket.max");
  if (BigInt(min) <= 0n || BigInt(max) <= BigInt(min)) {
    throw new PrivateIntentError(
      "Selection transcript bucket must have positive ordered bounds.",
    );
  }
  const clearingUnitPriceE18 = requireDecimal(
    transcript.clearingUnitPriceE18,
    "clearingUnitPriceE18",
  );
  const entries = transcript.entries
    .map((entry, index) => canonicalEntry(entry, `entries[${index}]`))
    .sort((left, right) =>
      left.rank === right.rank
        ? compareText(left.makerId, right.makerId)
        : left.rank - right.rank,
    );
  if (
    new Set(entries.map((entry) => entry.makerId)).size !== entries.length ||
    new Set(entries.map((entry) => entry.rank)).size !== entries.length ||
    entries.some((entry, index) => entry.rank !== index + 1)
  ) {
    throw new PrivateIntentError(
      "Selection transcript makers and contiguous ranks must be unique.",
    );
  }
  return {
    bucket: { max, min },
    clearingUnitPriceE18,
    createdAt: requireTimestamp(transcript.createdAt, "createdAt"),
    domain: transcript.domain,
    entries,
    rfqDigest: requireDigest(transcript.rfqDigest, "rfqDigest"),
    rule: transcript.rule,
    version: transcript.version,
  };
}

export function canonicalSelectionTranscriptBody(
  transcript: Omit<SelectionTranscriptV1, "digest">,
): string {
  return JSON.stringify(canonicalBody(transcript));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digestBody(
  transcript: Omit<SelectionTranscriptV1, "digest">,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalSelectionTranscriptBody(transcript)),
  );
  return `0x${bytesToHex(new Uint8Array(digest))}`;
}

function freezeTranscript(
  transcript: SelectionTranscriptV1,
): SelectionTranscriptV1 {
  return Object.freeze({
    ...transcript,
    bucket: Object.freeze({ ...transcript.bucket }),
    entries: Object.freeze(
      transcript.entries.map((entry) => Object.freeze({ ...entry })),
    ),
  });
}

export async function createSelectionTranscript(
  input: CreateSelectionTranscriptInput,
): Promise<SelectionTranscriptV1> {
  const rfqDigest = requireDigest(input.rfqDigest, "rfqDigest");
  if (
    typeof input.bucket.min !== "bigint" ||
    typeof input.bucket.max !== "bigint" ||
    input.bucket.min <= 0n ||
    input.bucket.max <= input.bucket.min
  ) {
    throw new PrivateIntentError(
      "Selection transcript bucket must have positive ordered bigint bounds.",
    );
  }
  requireTimestamp(input.createdAt, "createdAt");

  const quoteRecords = await Promise.all(
    input.quotes.map(async (quote) => {
      if (requireDigest(quote.rfqDigest, "quote.rfqDigest") !== rfqDigest) {
        throw new PrivateIntentError(
          "Selection transcript quote belongs to a different RFQ.",
        );
      }
      return { quote, quoteDigest: await digestSolverQuoteV3(quote) };
    }),
  );
  const makerIds = [
    ...quoteRecords.map((record) =>
      requireText(record.quote.solverId, "solverId"),
    ),
    ...input.refusals.map((refusal) => requireText(refusal.makerId, "makerId")),
  ];
  if (new Set(makerIds).size !== makerIds.length) {
    throw new PrivateIntentError(
      "Selection transcript requires one outcome per invited maker.",
    );
  }

  const winners =
    input.selection.kind === "selected"
      ? await Promise.all(
          input.selection.fills.map(async (fill) => ({
            fill,
            quoteDigest: await digestSolverQuoteV3(fill.quote),
          })),
        )
      : [];
  const availableDigests = new Set(
    quoteRecords.map((record) => record.quoteDigest),
  );
  if (
    new Set(winners.map((winner) => winner.quoteDigest)).size !==
      winners.length ||
    winners.some((winner) => !availableDigests.has(winner.quoteDigest))
  ) {
    throw new PrivateIntentError(
      "Selection transcript winners must be distinct members of all quotes.",
    );
  }
  const winningDigests = new Set(winners.map((winner) => winner.quoteDigest));
  const exactSellAmount = winners.reduce(
    (total, winner) => total + winner.fill.amountA,
    0n,
  );
  const losingRecords = quoteRecords
    .filter((record) => !winningDigests.has(record.quoteDigest))
    .map((record) => {
      const first = record.quote.schedule[0]!;
      const last = record.quote.schedule[record.quote.schedule.length - 1]!;
      const coversExact =
        exactSellAmount > 0n &&
        first.a <= exactSellAmount &&
        exactSellAmount <= last.a;
      return {
        ...record,
        coversExact,
        score: coversExact
          ? evaluatePriceSchedule(record.quote.schedule, exactSellAmount)
          : scheduleUnitPriceE18(record.quote.schedule, last.a),
      };
    })
    .sort((left, right) => {
      if (left.coversExact !== right.coversExact) {
        return left.coversExact ? -1 : 1;
      }
      if (left.score !== right.score) return left.score > right.score ? -1 : 1;
      return compareText(left.quote.solverId, right.quote.solverId);
    });

  let rank = 1;
  const entries: SelectionTranscriptEntryV1[] = [];
  for (const winner of winners) {
    entries.push({
      makerId: winner.fill.quote.solverId,
      quoteDigest: winner.quoteDigest,
      outcome: "won",
      rank,
      amountA: winner.fill.amountA.toString(),
    });
    rank += 1;
  }
  for (const loser of losingRecords) {
    entries.push({
      makerId: loser.quote.solverId,
      quoteDigest: loser.quoteDigest,
      outcome: "lost",
      rank,
    });
    rank += 1;
  }
  for (const refusal of [...input.refusals].sort((left, right) =>
    compareText(left.makerId, right.makerId),
  )) {
    entries.push({
      makerId: requireText(refusal.makerId, "refusal.makerId"),
      quoteDigest: requireDigest(refusal.quoteDigest, "refusal.quoteDigest"),
      outcome: "refused",
      rank,
    });
    rank += 1;
  }

  const clearingUnitPriceE18 = winners.reduce((best, winner) => {
    const unitPrice = (winner.fill.amountB * 10n ** 18n) / winner.fill.amountA;
    return unitPrice > best ? unitPrice : best;
  }, 0n);
  const body: Omit<SelectionTranscriptV1, "digest"> = {
    version: 1,
    domain: SELECTION_TRANSCRIPT_DOMAIN,
    rfqDigest,
    rule: RFQ_SELECTION_V3_RULE,
    bucket: {
      min: input.bucket.min.toString(),
      max: input.bucket.max.toString(),
    },
    createdAt: input.createdAt,
    entries,
    clearingUnitPriceE18: clearingUnitPriceE18.toString(),
  };
  const normalizedBody = canonicalBody(body);
  return freezeTranscript({
    ...normalizedBody,
    digest: await digestBody(normalizedBody),
  });
}

export function encodeSelectionTranscript(
  transcript: SelectionTranscriptV1,
): SelectionTranscriptV1Wire {
  const { digest, ...body } = transcript;
  const normalizedBody = canonicalBody(body);
  return freezeTranscript({
    ...normalizedBody,
    digest: requireDigest(digest, "digest"),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function decodeSelectionTranscript(
  value: unknown,
): SelectionTranscriptV1 {
  if (!isRecord(value)) {
    throw new PrivateIntentError(
      "Selection transcript wire payload must be an object.",
    );
  }
  for (const field of TRANSCRIPT_FIELDS) {
    if (!(field in value)) {
      throw new PrivateIntentError(
        `Selection transcript ${field} is required.`,
      );
    }
  }
  for (const field of Object.keys(value)) {
    if (!TRANSCRIPT_FIELDS.has(field)) {
      throw new PrivateIntentError(
        `Selection transcript field ${field} is unsupported.`,
      );
    }
  }
  if (!isRecord(value.bucket)) {
    throw new PrivateIntentError(
      "Selection transcript bucket must be an object.",
    );
  }
  for (const field of BUCKET_FIELDS) {
    if (!(field in value.bucket)) {
      throw new PrivateIntentError(
        `Selection transcript bucket.${field} is required.`,
      );
    }
  }
  for (const field of Object.keys(value.bucket)) {
    if (!BUCKET_FIELDS.has(field)) {
      throw new PrivateIntentError(
        `Selection transcript bucket field ${field} is unsupported.`,
      );
    }
  }
  if (!Array.isArray(value.entries)) {
    throw new PrivateIntentError(
      "Selection transcript entries must be an array.",
    );
  }
  const entries = value.entries.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new PrivateIntentError(
        `Selection transcript entry ${index} must be an object.`,
      );
    }
    for (const field of ["makerId", "outcome", "quoteDigest", "rank"]) {
      if (!(field in entry)) {
        throw new PrivateIntentError(
          `Selection transcript entry ${index}.${field} is required.`,
        );
      }
    }
    for (const field of Object.keys(entry)) {
      if (!ENTRY_FIELDS.has(field)) {
        throw new PrivateIntentError(
          `Selection transcript entry field ${field} is unsupported.`,
        );
      }
    }
    return { ...entry } as SelectionTranscriptEntryV1;
  });
  const transcript: SelectionTranscriptV1 = {
    version: value.version as 1,
    domain: value.domain as typeof SELECTION_TRANSCRIPT_DOMAIN,
    rfqDigest: value.rfqDigest as string,
    rule: value.rule as typeof RFQ_SELECTION_V3_RULE,
    bucket: {
      min: value.bucket.min as string,
      max: value.bucket.max as string,
    },
    createdAt: value.createdAt as number,
    entries,
    clearingUnitPriceE18: value.clearingUnitPriceE18 as string,
    digest: value.digest as string,
  };
  const { digest, ...body } = transcript;
  const normalizedBody = canonicalBody(body);
  return freezeTranscript({
    ...normalizedBody,
    digest: requireDigest(digest, "digest"),
  });
}

function inconsistent(reason: string): TranscriptMakerVerificationResult {
  return Object.freeze({ consistent: false, reason });
}

export async function verifySelectionTranscriptForMaker(
  transcript: SelectionTranscriptV1,
  input: TranscriptMakerVerification,
): Promise<TranscriptMakerVerificationResult> {
  try {
    const { digest, ...body } = transcript;
    const expectedDigest = await digestBody(body);
    if (requireDigest(digest, "digest") !== expectedDigest) {
      return inconsistent(
        "Selection transcript digest does not match its body.",
      );
    }
    const makerId = requireText(input.makerId, "makerId");
    const ownQuoteDigest = requireDigest(
      input.ownQuoteDigest,
      "ownQuoteDigest",
    );
    if (
      typeof input.ownUnitPriceE18 !== "bigint" ||
      input.ownUnitPriceE18 < 0n
    ) {
      return inconsistent("Maker unit price must be a non-negative bigint.");
    }
    const ownEntry = transcript.entries.find(
      (entry) => entry.makerId === makerId,
    );
    if (!ownEntry || ownEntry.quoteDigest.toLowerCase() !== ownQuoteDigest) {
      return inconsistent("Maker's own quote digest is not present.");
    }
    if (
      ownEntry.outcome === "lost" &&
      BigInt(transcript.clearingUnitPriceE18) < input.ownUnitPriceE18
    ) {
      return inconsistent(
        "Winning clearing unit price is below the maker's losing quote.",
      );
    }
    return Object.freeze({ consistent: true });
  } catch (error) {
    return inconsistent(
      error instanceof Error
        ? error.message
        : "Selection transcript verification failed.",
    );
  }
}
