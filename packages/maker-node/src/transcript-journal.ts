import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  decodeSelectionTranscript,
  encodeSelectionTranscript,
  type SelectionTranscriptV1,
} from "@app20/private-intents";

const TRANSCRIPT_JOURNAL_DOMAIN = "app20/maker-transcripts/v1" as const;
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;

export type MakerTranscriptRecord = Readonly<{
  transcript: SelectionTranscriptV1;
  consistent: boolean;
  reason?: string;
  receivedAt: number;
}>;

type TranscriptJournalWire = Readonly<{
  domain: typeof TRANSCRIPT_JOURNAL_DOMAIN;
  transcripts: readonly MakerTranscriptRecord[];
}>;

export class MakerTranscriptConflictError extends Error {
  constructor(
    message = "A different transcript digest is already journaled for this RFQ.",
  ) {
    super(message);
    this.name = "MakerTranscriptConflictError";
  }
}

function requireTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Transcript receivedAt must be a positive timestamp.");
  }
  return value;
}

function canonicalRecord(value: unknown): MakerTranscriptRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Maker transcript journal record must be an object.");
  }
  const record = value as Record<string, unknown>;
  const fields = new Set(["consistent", "reason", "receivedAt", "transcript"]);
  for (const field of Object.keys(record)) {
    if (!fields.has(field)) {
      throw new Error(
        `Maker transcript journal field ${field} is unsupported.`,
      );
    }
  }
  if (typeof record.consistent !== "boolean") {
    throw new Error("Maker transcript journal consistent flag is invalid.");
  }
  if (
    record.reason !== undefined &&
    (typeof record.reason !== "string" || !record.reason.trim())
  ) {
    throw new Error("Maker transcript journal reason is invalid.");
  }
  const transcript = decodeSelectionTranscript(record.transcript);
  return Object.freeze({
    transcript,
    consistent: record.consistent,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    receivedAt: requireTimestamp(record.receivedAt as number),
  });
}

function cloneRecord(record: MakerTranscriptRecord): MakerTranscriptRecord {
  return Object.freeze({
    transcript: encodeSelectionTranscript(record.transcript),
    consistent: record.consistent,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    receivedAt: record.receivedAt,
  });
}

export class DurableMakerTranscriptJournal {
  readonly #path: string;
  #records = new Map<string, MakerTranscriptRecord>();
  #failed = false;

  private constructor(path: string) {
    this.#path = path;
    this.#load();
  }

  static open(path: string): DurableMakerTranscriptJournal {
    if (typeof path !== "string" || !path.trim() || path.includes("\0")) {
      throw new Error("Maker transcript journal path is invalid.");
    }
    return new DurableMakerTranscriptJournal(path);
  }

  list(): readonly MakerTranscriptRecord[] {
    return [...this.#records.values()]
      .sort((left, right) =>
        left.transcript.rfqDigest.localeCompare(right.transcript.rfqDigest),
      )
      .map(cloneRecord);
  }

  append(
    transcript: SelectionTranscriptV1,
    verification: Readonly<{ consistent: boolean; reason?: string }>,
    receivedAt: number,
  ): MakerTranscriptRecord {
    if (this.#failed) {
      throw new Error(
        "Maker transcript journal is fail-stopped after uncertain persistence.",
      );
    }
    const canonicalTranscript = encodeSelectionTranscript(transcript);
    if (typeof verification.consistent !== "boolean") {
      throw new Error("Transcript verification result is invalid.");
    }
    if (
      verification.reason !== undefined &&
      (typeof verification.reason !== "string" || !verification.reason.trim())
    ) {
      throw new Error("Transcript verification reason is invalid.");
    }
    const prior = this.#records.get(canonicalTranscript.rfqDigest);
    if (prior) {
      if (prior.transcript.digest !== canonicalTranscript.digest) {
        throw new MakerTranscriptConflictError();
      }
      return cloneRecord(prior);
    }
    const next = Object.freeze({
      transcript: canonicalTranscript,
      consistent: verification.consistent,
      ...(verification.reason === undefined
        ? {}
        : { reason: verification.reason }),
      receivedAt: requireTimestamp(receivedAt),
    });
    const candidate = new Map(this.#records).set(
      canonicalTranscript.rfqDigest,
      next,
    );
    try {
      this.#persist(candidate);
    } catch (error) {
      this.#failed = true;
      throw new Error(
        "Maker transcript journal persistence became uncertain; the journal is fail-stopped.",
        { cause: error },
      );
    }
    this.#records = candidate;
    return cloneRecord(next);
  }

  #load(): void {
    const directory = dirname(this.#path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!existsSync(this.#path)) return;
    if (statSync(this.#path).size > MAX_JOURNAL_BYTES) {
      throw new Error("Maker transcript journal exceeds the bounded size.");
    }
    chmodSync(this.#path, 0o600);
    let wire: unknown;
    try {
      wire = JSON.parse(readFileSync(this.#path, "utf8"));
    } catch (error) {
      throw new Error("Maker transcript journal is not valid JSON.", {
        cause: error,
      });
    }
    if (!wire || typeof wire !== "object" || Array.isArray(wire)) {
      throw new Error("Maker transcript journal schema is invalid.");
    }
    const journal = wire as Record<string, unknown>;
    if (
      Object.keys(journal).length !== 2 ||
      journal.domain !== TRANSCRIPT_JOURNAL_DOMAIN ||
      !Array.isArray(journal.transcripts)
    ) {
      throw new Error("Maker transcript journal schema is invalid.");
    }
    for (const raw of journal.transcripts) {
      const record = canonicalRecord(raw);
      const key = record.transcript.rfqDigest;
      if (this.#records.has(key)) {
        throw new Error("Maker transcript journal repeats an RFQ digest.");
      }
      this.#records.set(key, record);
    }
  }

  #persist(records: ReadonlyMap<string, MakerTranscriptRecord>): void {
    const directory = dirname(this.#path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    const wire: TranscriptJournalWire = {
      domain: TRANSCRIPT_JOURNAL_DOMAIN,
      transcripts: [...records.values()]
        .sort((left, right) =>
          left.transcript.rfqDigest.localeCompare(right.transcript.rfqDigest),
        )
        .map(cloneRecord),
    };
    let file: number | undefined;
    let directoryFile: number | undefined;
    try {
      writeFileSync(temporary, `${JSON.stringify(wire, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      file = openSync(temporary, "r");
      fsyncSync(file);
      closeSync(file);
      file = undefined;
      renameSync(temporary, this.#path);
      chmodSync(this.#path, 0o600);
      directoryFile = openSync(directory, "r");
      fsyncSync(directoryFile);
      closeSync(directoryFile);
      directoryFile = undefined;
    } finally {
      if (file !== undefined) closeSync(file);
      if (directoryFile !== undefined) closeSync(directoryFile);
      rmSync(temporary, { force: true });
    }
  }
}
