import {
  assertMakerReservationMutation,
  decodeStoredMakerReservation,
  transitionMakerReservation,
  type CodecStoredMakerReservation,
  type MakerReservationV1,
} from "@app20/private-intents";
import { noStoreJson, readBoundedJson } from "./rfq-limits.ts";

type SqlCursor<T> = Iterable<T> & { one(): T };
interface SqlStorage {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): SqlCursor<T>;
}
interface LedgerStorage {
  sql: SqlStorage;
  transactionSync<T>(callback: () => T): T;
}
interface LedgerState {
  storage: LedgerStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };
type StoredReservation = CodecStoredMakerReservation;
type ReservationRow = Readonly<{
  reservation_id: string;
  record_json: string;
  fence: string;
  state: MakerReservationV1["state"];
}>;
type MetadataRow = Readonly<{ revision: number; high_water: string }>;
type AttemptRow = Readonly<{
  idempotency_key: string;
  reservation_id: string;
  selection_fence: string;
  payload_digest: string;
  status: "pending" | "completed";
  outcome_json: string | null;
}>;
type CommitInput = Readonly<{
  expectedRevision: number;
  mutations: readonly Readonly<{
    record: unknown;
    expectedFence: string | null;
  }>[];
}>;
type AttemptBinding = Readonly<{
  reservationId: string;
  expectedFence: string;
  idempotencyKey: string;
  payloadDigest: string;
  at: number;
}>;
type AttemptCompletion = AttemptBinding &
  Readonly<{
    outcome:
      | Readonly<{ kind: "consumed"; transactionHash: string }>
      | Readonly<{ kind: "unknown"; reason: string }>;
  }>;
type AttemptRecovery = Readonly<{ at: number }>;

const HEX_32 = /^0x[0-9a-f]{64}$/;

function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? { $app20BigInt: item.toString() } : item,
  );
}

function jsonParse<T>(value: string): T {
  return JSON.parse(value, (_key, item: unknown) => {
    if (
      item &&
      typeof item === "object" &&
      Object.keys(item).length === 1 &&
      "$app20BigInt" in item &&
      typeof (item as { $app20BigInt?: unknown }).$app20BigInt === "string" &&
      /^(0|[1-9][0-9]*)$/.test((item as { $app20BigInt: string }).$app20BigInt)
    ) {
      return BigInt((item as { $app20BigInt: string }).$app20BigInt);
    }
    return item;
  }) as T;
}

// Mirrors the jsonStringify replacer without a stringify/parse round trip, so
// BigInt-bearing records become plain JSON that Response.json can serialize.
function wire(value: unknown): JsonValue {
  if (typeof value === "bigint") return { $app20BigInt: value.toString() };
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && typeof item !== "function")
        .map(([key, item]) => [key, wire(item)]),
    );
  if (value === undefined || typeof value === "function")
    throw new Error("Reservation ledger cannot serialize a non-JSON value.");
  return value as JsonValue;
}

function metadata(sql: SqlStorage): MetadataRow {
  const row = [
    ...sql.exec<MetadataRow>(
      "SELECT revision, high_water FROM reservation_ledger_metadata WHERE singleton = 1",
    ),
  ][0];
  if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) {
    throw new Error("Reservation ledger metadata is unavailable.");
  }
  return row;
}

function reservationRow(
  sql: SqlStorage,
  reservationId: string,
): ReservationRow | undefined {
  return [
    ...sql.exec<ReservationRow>(
      "SELECT reservation_id, record_json, fence, state FROM reservation_ledger_records WHERE reservation_id = ?",
      reservationId,
    ),
  ][0];
}

function attemptRow(sql: SqlStorage, key: string): AttemptRow | undefined {
  return [
    ...sql.exec<AttemptRow>(
      "SELECT idempotency_key, reservation_id, selection_fence, payload_digest, status, outcome_json FROM reservation_ledger_attempts WHERE idempotency_key = ?",
      key,
    ),
  ][0];
}

function pendingAttemptRows(sql: SqlStorage): readonly AttemptRow[] {
  return [
    ...sql.exec<AttemptRow>(
      "SELECT idempotency_key, reservation_id, selection_fence, payload_digest, status, outcome_json FROM reservation_ledger_attempts WHERE status = 'pending' ORDER BY idempotency_key",
    ),
  ];
}

function requirePositiveBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive bigint string.`);
  }
  return BigInt(value);
}

function requireAttempt(input: AttemptBinding): AttemptBinding {
  if (
    !input ||
    typeof input.reservationId !== "string" ||
    !HEX_32.test(input.reservationId) ||
    typeof input.idempotencyKey !== "string" ||
    !HEX_32.test(input.idempotencyKey) ||
    typeof input.payloadDigest !== "string" ||
    !HEX_32.test(input.payloadDigest) ||
    !Number.isSafeInteger(input.at) ||
    input.at <= 0
  ) {
    throw new Error("Invalid value-moving attempt binding.");
  }
  requirePositiveBigInt(input.expectedFence, "expectedFence");
  return input;
}

function requireTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(`${label} must be a positive unix-seconds timestamp.`);
  return value as number;
}

function requireStoredRecord(value: unknown): StoredReservation {
  return decodeStoredMakerReservation(jsonParse<unknown>(jsonStringify(value)));
}

function saveRecord(sql: SqlStorage, record: StoredReservation): void {
  sql.exec(
    "INSERT INTO reservation_ledger_records (reservation_id, record_json, fence, state) VALUES (?, ?, ?, ?) ON CONFLICT(reservation_id) DO UPDATE SET record_json = excluded.record_json, fence = excluded.fence, state = excluded.state",
    record.reservation.reservationId,
    jsonStringify(record),
    record.reservation.fence.toString(),
    record.reservation.state,
  );
}

function advanceMetadata(
  sql: SqlStorage,
  current: MetadataRow,
  fence: bigint,
): MetadataRow {
  const highWater =
    fence > BigInt(current.high_water) ? fence : BigInt(current.high_water);
  const next = {
    revision: current.revision + 1,
    high_water: highWater.toString(),
  };
  sql.exec(
    "UPDATE reservation_ledger_metadata SET revision = ?, high_water = ? WHERE singleton = 1",
    next.revision,
    next.high_water,
  );
  return next;
}

function conflict(message: string): Response {
  return noStoreJson({ error: message }, { status: 409 });
}

/**
 * Thrown by the in-repo SQLite mock when a persisted write fails. Production
 * Durable Object storage would surface a platform error instead; both must
 * abort the transaction rather than commit a partial reservation transition.
 */
export const RESERVATION_LEDGER_STORAGE_WRITE_FAILED =
  "Reservation ledger storage write failed.";

function isRetryableStorageFailure(error: unknown): boolean {
  if (error == null) return false;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return true;
  }
  if (!(error instanceof Error)) return false;
  if (error.message === RESERVATION_LEDGER_STORAGE_WRITE_FAILED) return true;
  const name = error.name;
  if (/sqlite/i.test(name) || name === "DOMException") return true;
  if (/SQLITE_[A-Z0-9]+/i.test(error.message)) return true;
  if (/durable object storage/i.test(error.message)) return true;
  if (/storage (write |operation )?failed/i.test(error.message)) return true;
  if (error.cause !== undefined && error.cause !== error) {
    return isRetryableStorageFailure(error.cause);
  }
  return false;
}

function transactionFailure(error: unknown, fallback: string): Response {
  if (isRetryableStorageFailure(error)) {
    return noStoreJson(
      { error: RESERVATION_LEDGER_STORAGE_WRITE_FAILED },
      { status: 503 },
    );
  }
  return conflict(error instanceof Error ? error.message : fallback);
}

/**
 * Dormant SQLite Durable Object for maker reservation authority. It is exported
 * for a binding only; the relay fetch handler deliberately has no route to it.
 * Transport stays immutable-off and this class is not activated as a live
 * service in this slice.
 *
 * Durability posture (honest): process restart against persisted SQLite
 * proves crash restoration, fence monotonicity, idempotent attempt replay,
 * and atomic rollback when a storage write fails mid-transition. Cloudflare
 * Durable Object SQLite still lives in a single Cloudflare account, which is
 * one administrative domain. That is not independently administered backup,
 * operator-controlled PITR, retention, cross-region failover, or split-brain
 * resistance. This strengthens in-repo durability evidence; it does not make
 * P0-16 or the P1-04 / P1-06 partials closable.
 */
export class ReservationLedgerDurableObject {
  private readonly state: LedgerState;
  private readonly ready: Promise<void>;

  constructor(state: LedgerState) {
    this.state = state;
    this.ready = state.blockConcurrencyWhile(async () => {
      const sql = state.storage.sql;
      sql.exec(
        "CREATE TABLE IF NOT EXISTS reservation_ledger_metadata (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER NOT NULL, high_water TEXT NOT NULL)",
      );
      sql.exec(
        "INSERT OR IGNORE INTO reservation_ledger_metadata (singleton, revision, high_water) VALUES (1, 0, '0')",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS reservation_ledger_records (reservation_id TEXT PRIMARY KEY, record_json TEXT NOT NULL, fence TEXT NOT NULL, state TEXT NOT NULL)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS reservation_ledger_attempts (idempotency_key TEXT PRIMARY KEY, reservation_id TEXT NOT NULL, selection_fence TEXT NOT NULL, payload_digest TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','completed')), outcome_json TEXT, FOREIGN KEY (reservation_id) REFERENCES reservation_ledger_records(reservation_id))",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    try {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/snapshot")
        return this.snapshot();
      if (request.method === "POST" && path === "/commit") {
        return this.commit((await readBoundedJson(request)) as CommitInput);
      }
      if (request.method === "POST" && path === "/attempt/begin") {
        return this.beginAttempt(
          (await readBoundedJson(request)) as AttemptBinding,
        );
      }
      if (request.method === "POST" && path === "/attempt/complete") {
        return this.completeAttempt(
          (await readBoundedJson(request)) as AttemptCompletion,
        );
      }
      if (request.method === "POST" && path === "/attempt/recover") {
        return this.recoverPendingAttempts(
          (await readBoundedJson(request)) as AttemptRecovery,
        );
      }
      return noStoreJson({ error: "Not found." }, { status: 404 });
    } catch (error) {
      return noStoreJson(
        {
          error:
            error instanceof Error
              ? error.message
              : "Reservation ledger rejected the request.",
        },
        { status: 400 },
      );
    }
  }

  private snapshot(): Response {
    const result = this.state.storage.transactionSync(() => {
      const meta = metadata(this.state.storage.sql);
      const records = [
        ...this.state.storage.sql.exec<ReservationRow>(
          "SELECT reservation_id, record_json, fence, state FROM reservation_ledger_records ORDER BY reservation_id",
        ),
      ].map((row) =>
        wire(requireStoredRecord(jsonParse<unknown>(row.record_json))),
      );
      return { revision: meta.revision, highWater: meta.high_water, records };
    });
    return noStoreJson(result);
  }

  private commit(input: CommitInput): Response {
    if (
      !input ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !Array.isArray(input.mutations) ||
      input.mutations.length > 100
    ) {
      return noStoreJson(
        { error: "Invalid reservation transaction." },
        { status: 400 },
      );
    }
    try {
      const result = this.state.storage.transactionSync(() => {
        let meta = metadata(this.state.storage.sql);
        if (meta.revision !== input.expectedRevision) {
          throw new Error("Reservation transaction revision is stale.");
        }
        const seen = new Set<string>();
        let validationHighWater = BigInt(meta.high_water);
        const prepared = input.mutations.map((mutation) => {
          const next = requireStoredRecord(mutation.record);
          const id = next.reservation.reservationId;
          if (seen.has(id))
            throw new Error("Reservation transaction repeats a record.");
          seen.add(id);
          const row = reservationRow(this.state.storage.sql, id);
          const current = row
            ? requireStoredRecord(jsonParse<unknown>(row.record_json))
            : undefined;
          assertMakerReservationMutation(
            current?.reservation,
            next.reservation,
            mutation.expectedFence === null
              ? null
              : requirePositiveBigInt(mutation.expectedFence, "expectedFence"),
          );
          if (!current && next.reservation.fence !== validationHighWater + 1n) {
            throw new Error(
              "New reservation fence did not use the next durable high-water token.",
            );
          }
          if (next.reservation.fence > validationHighWater) {
            validationHighWater = next.reservation.fence;
          }
          return next;
        });
        for (const record of prepared) {
          saveRecord(this.state.storage.sql, record);
          meta = advanceMetadata(
            this.state.storage.sql,
            meta,
            record.reservation.fence,
          );
        }
        return meta;
      });
      return noStoreJson({ committed: true, revision: result.revision });
    } catch (error) {
      return transactionFailure(error, "Reservation commit conflicted.");
    }
  }

  private beginAttempt(raw: AttemptBinding): Response {
    let input: AttemptBinding;
    try {
      input = requireAttempt(raw);
    } catch (error) {
      return noStoreJson({ error: (error as Error).message }, { status: 400 });
    }
    try {
      const result = this.state.storage.transactionSync(() => {
        const sql = this.state.storage.sql;
        const prior = attemptRow(sql, input.idempotencyKey);
        if (prior) {
          if (
            prior.reservation_id !== input.reservationId ||
            prior.selection_fence !== input.expectedFence ||
            prior.payload_digest !== input.payloadDigest
          ) {
            throw new Error(
              "Idempotency key was reused with a conflicting payload.",
            );
          }
          if (prior.status === "completed" && prior.outcome_json) {
            return {
              kind: "replay",
              outcome: JSON.parse(prior.outcome_json) as unknown,
            };
          }
          const row = reservationRow(sql, input.reservationId);
          if (!row)
            throw new Error("Pending attempt lost its reservation tombstone.");
          const current = requireStoredRecord(
            jsonParse<unknown>(row.record_json),
          );
          if (
            current.reservation.state !== "filling" ||
            current.reservation.settlementAttemptId !== input.idempotencyKey
          ) {
            throw new Error(
              "Pending attempt does not match reservation state.",
            );
          }
          const outcome = {
            kind: "unknown",
            reason: "interrupted value-moving attempt has an unknown outcome",
          } as const;
          const quarantined = {
            ...current,
            reservation: transitionMakerReservation(current.reservation, {
              kind: "quarantine",
              expectedFence: current.reservation.fence,
              at: Math.max(input.at, current.reservation.updatedAt),
              reason: outcome.reason,
            }),
          };
          saveRecord(sql, quarantined);
          const meta = metadata(sql);
          advanceMetadata(sql, meta, quarantined.reservation.fence);
          sql.exec(
            "UPDATE reservation_ledger_attempts SET status = 'completed', outcome_json = ? WHERE idempotency_key = ?",
            JSON.stringify(outcome),
            input.idempotencyKey,
          );
          return { kind: "replay", outcome };
        }
        const row = reservationRow(sql, input.reservationId);
        if (!row) throw new Error("Reservation does not exist.");
        const current = requireStoredRecord(
          jsonParse<unknown>(row.record_json),
        );
        const expectedFence = requirePositiveBigInt(
          input.expectedFence,
          "expectedFence",
        );
        if (current.reservation.fence !== expectedFence) {
          throw new Error(
            "Reservation fence compare-and-swap failed: stale fence.",
          );
        }
        const filling = {
          ...current,
          reservation: transitionMakerReservation(current.reservation, {
            kind: "begin-fill",
            expectedFence,
            at: input.at,
            settlementAttemptId: input.idempotencyKey,
          }),
        };
        saveRecord(sql, filling);
        const meta = metadata(sql);
        advanceMetadata(sql, meta, filling.reservation.fence);
        sql.exec(
          "INSERT INTO reservation_ledger_attempts (idempotency_key, reservation_id, selection_fence, payload_digest, status, outcome_json) VALUES (?, ?, ?, ?, 'pending', NULL)",
          input.idempotencyKey,
          input.reservationId,
          input.expectedFence,
          input.payloadDigest,
        );
        return { kind: "claimed", record: wire(filling) };
      });
      return noStoreJson(result, {
        status: result.kind === "claimed" ? 201 : 200,
      });
    } catch (error) {
      return transactionFailure(error, "Attempt claim conflicted.");
    }
  }

  private recoverPendingAttempts(raw: AttemptRecovery): Response {
    let at: number;
    try {
      at = requireTimestamp(raw?.at, "attempt recovery at");
    } catch (error) {
      return noStoreJson({ error: (error as Error).message }, { status: 400 });
    }
    try {
      const recovered = this.state.storage.transactionSync(() => {
        const sql = this.state.storage.sql;
        const results: Array<{
          idempotencyKey: string;
          reservationId: string;
          expectedFence: string;
          payloadDigest: string;
          outcome: { kind: "unknown"; reason: string };
          record: JsonValue;
        }> = [];
        for (const pending of pendingAttemptRows(sql)) {
          const row = reservationRow(sql, pending.reservation_id);
          if (!row)
            throw new Error("Pending attempt lost its reservation tombstone.");
          const current = requireStoredRecord(
            jsonParse<unknown>(row.record_json),
          );
          if (
            current.reservation.state !== "filling" ||
            current.reservation.settlementAttemptId !== pending.idempotency_key
          )
            throw new Error(
              "Pending attempt does not match reservation state.",
            );
          const outcome = {
            kind: "unknown" as const,
            reason: "interrupted value-moving attempt has an unknown outcome",
          };
          const quarantined: StoredReservation = {
            ...current,
            reservation: transitionMakerReservation(current.reservation, {
              kind: "quarantine",
              expectedFence: current.reservation.fence,
              at: Math.max(at, current.reservation.updatedAt),
              reason: outcome.reason,
            }),
          };
          saveRecord(sql, quarantined);
          advanceMetadata(sql, metadata(sql), quarantined.reservation.fence);
          sql.exec(
            "UPDATE reservation_ledger_attempts SET status = 'completed', outcome_json = ? WHERE idempotency_key = ?",
            JSON.stringify(outcome),
            pending.idempotency_key,
          );
          results.push({
            idempotencyKey: pending.idempotency_key,
            reservationId: pending.reservation_id,
            expectedFence: pending.selection_fence,
            payloadDigest: pending.payload_digest,
            outcome,
            record: wire(quarantined),
          });
        }
        return results;
      });
      return noStoreJson({ recovered });
    } catch (error) {
      return transactionFailure(error, "Pending attempt recovery conflicted.");
    }
  }

  private completeAttempt(raw: AttemptCompletion): Response {
    let input: AttemptCompletion;
    try {
      input = requireAttempt(raw) as AttemptCompletion;
      if (
        !raw.outcome ||
        (raw.outcome.kind !== "consumed" && raw.outcome.kind !== "unknown")
      ) {
        throw new Error("Attempt outcome must be consumed or unknown.");
      }
    } catch (error) {
      return noStoreJson({ error: (error as Error).message }, { status: 400 });
    }
    try {
      const result = this.state.storage.transactionSync(() => {
        const sql = this.state.storage.sql;
        const prior = attemptRow(sql, input.idempotencyKey);
        if (!prior) throw new Error("Value-moving attempt was not claimed.");
        if (
          prior.reservation_id !== input.reservationId ||
          prior.selection_fence !== input.expectedFence ||
          prior.payload_digest !== input.payloadDigest
        ) {
          throw new Error(
            "Idempotency key was reused with a conflicting payload.",
          );
        }
        if (prior.status === "completed" && prior.outcome_json) {
          return {
            kind: "replay",
            outcome: JSON.parse(prior.outcome_json) as unknown,
          };
        }
        const row = reservationRow(sql, input.reservationId);
        if (!row)
          throw new Error("Pending attempt lost its reservation tombstone.");
        const current = requireStoredRecord(
          jsonParse<unknown>(row.record_json),
        );
        if (
          current.reservation.state !== "filling" ||
          current.reservation.settlementAttemptId !== input.idempotencyKey
        ) {
          throw new Error(
            "Attempt completion does not match reservation state.",
          );
        }
        const outcome =
          input.outcome.kind === "consumed"
            ? {
                kind: "consumed" as const,
                transactionHash: input.outcome.transactionHash,
              }
            : {
                kind: "unknown" as const,
                reason:
                  input.outcome.reason?.trim() ||
                  "value-moving outcome is unknown",
              };
        const next = {
          ...current,
          reservation:
            outcome.kind === "consumed"
              ? transitionMakerReservation(current.reservation, {
                  kind: "consume",
                  expectedFence: current.reservation.fence,
                  at: input.at,
                  settlementTransactionHash: outcome.transactionHash,
                })
              : transitionMakerReservation(current.reservation, {
                  kind: "quarantine",
                  expectedFence: current.reservation.fence,
                  at: input.at,
                  reason: outcome.reason,
                }),
        };
        saveRecord(sql, next);
        const meta = metadata(sql);
        advanceMetadata(sql, meta, next.reservation.fence);
        sql.exec(
          "UPDATE reservation_ledger_attempts SET status = 'completed', outcome_json = ? WHERE idempotency_key = ?",
          JSON.stringify(outcome),
          input.idempotencyKey,
        );
        return { kind: "completed", outcome, record: wire(next) };
      });
      return noStoreJson(result);
    } catch (error) {
      return transactionFailure(error, "Attempt completion conflicted.");
    }
  }
}
