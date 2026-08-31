import type { MakerReservationV1 } from "@app20/private-intents";
import {
  ReservationLedgerDurableObject,
  RESERVATION_LEDGER_STORAGE_WRITE_FAILED,
} from "../src/reservation-ledger-do.ts";

type Metadata = { revision: number; high_water: string };
type RecordRow = {
  reservation_id: string;
  record_json: string;
  fence: string;
  state: MakerReservationV1["state"];
};
type AttemptRow = {
  idempotency_key: string;
  reservation_id: string;
  selection_fence: string;
  payload_digest: string;
  status: "pending" | "completed";
  outcome_json: string | null;
};

export type ReservationLedgerPersistedSnapshot = {
  metadata: Metadata;
  records: Map<string, RecordRow>;
  attempts: Map<string, AttemptRow>;
};

function isSchemaQuery(query: string): boolean {
  return (
    query.startsWith("CREATE TABLE IF NOT EXISTS reservation_ledger_") ||
    query.startsWith("INSERT OR IGNORE INTO reservation_ledger_metadata")
  );
}

function isPersistedMutation(query: string): boolean {
  return (
    query.startsWith("INSERT INTO reservation_ledger_records") ||
    query.startsWith("UPDATE reservation_ledger_metadata") ||
    query.startsWith("INSERT INTO reservation_ledger_attempts") ||
    query.startsWith("UPDATE reservation_ledger_attempts")
  );
}

/**
 * In-memory SQLite stand-in for the dormant reservation ledger Durable Object.
 *
 * `transactionSync` models atomic commit/rollback. It is not a no-op wrapper
 * around the callback: a thrown write or conflict restores the pre-transaction
 * snapshot, so a mid-transition failure cannot leak a partial fence, record, or
 * attempt row.
 *
 * This is single-process evidence of Durable Object SQLite semantics inside one
 * Cloudflare account (one administrative domain). It is not operator-controlled
 * PITR, independently administered backup, or cross-region failover.
 */
export class ReservationLedgerTestSql {
  metadata: Metadata = { revision: 0, high_water: "0" };
  records = new Map<string, RecordRow>();
  attempts = new Map<string, AttemptRow>();
  private mutationsUntilWriteFailure: number | null = null;

  /**
   * Fail the Nth subsequent persisted mutation (0 = the next write). Schema
   * bootstrap statements are not counted; only reservation/attempt/metadata
   * writes that participate in a ledger transition are.
   */
  failAfterSuccessfulMutations(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(
        "failAfterSuccessfulMutations count must be a non-negative integer.",
      );
    }
    this.mutationsUntilWriteFailure = count;
  }

  exec<T>(query: string, ...bindings: unknown[]): Iterable<T> & { one(): T } {
    if (isPersistedMutation(query)) this.assertWritable();
    let output: unknown[] = [];
    if (isSchemaQuery(query)) {
      output = [];
    } else if (query.startsWith("SELECT revision, high_water")) {
      output = [this.metadata];
    } else if (
      query.startsWith("SELECT reservation_id, record_json") &&
      query.includes("WHERE reservation_id")
    ) {
      const row = this.records.get(String(bindings[0]));
      output = row ? [row] : [];
    } else if (query.startsWith("SELECT reservation_id, record_json")) {
      output = [...this.records.values()].sort((left, right) =>
        left.reservation_id.localeCompare(right.reservation_id),
      );
    } else if (query.startsWith("INSERT INTO reservation_ledger_records")) {
      const row: RecordRow = {
        reservation_id: String(bindings[0]),
        record_json: String(bindings[1]),
        fence: String(bindings[2]),
        state: bindings[3] as MakerReservationV1["state"],
      };
      this.records.set(row.reservation_id, row);
    } else if (query.startsWith("UPDATE reservation_ledger_metadata")) {
      this.metadata = {
        revision: Number(bindings[0]),
        high_water: String(bindings[1]),
      };
    } else if (
      query.startsWith("SELECT idempotency_key") &&
      query.includes("WHERE status = 'pending'")
    ) {
      output = [...this.attempts.values()]
        .filter((row) => row.status === "pending")
        .sort((left, right) =>
          left.idempotency_key.localeCompare(right.idempotency_key),
        );
    } else if (query.startsWith("SELECT idempotency_key")) {
      const row = this.attempts.get(String(bindings[0]));
      output = row ? [row] : [];
    } else if (query.startsWith("INSERT INTO reservation_ledger_attempts")) {
      const row: AttemptRow = {
        idempotency_key: String(bindings[0]),
        reservation_id: String(bindings[1]),
        selection_fence: String(bindings[2]),
        payload_digest: String(bindings[3]),
        status: "pending",
        outcome_json: null,
      };
      this.attempts.set(row.idempotency_key, row);
    } else if (query.startsWith("UPDATE reservation_ledger_attempts")) {
      const row = this.attempts.get(String(bindings[1]));
      if (row) {
        row.status = "completed";
        row.outcome_json = String(bindings[0]);
      }
    } else {
      throw new Error(`Unhandled reservation-ledger SQL: ${query}`);
    }
    const cursor = output as unknown as Iterable<T> & { one(): T };
    Object.defineProperty(cursor, "one", {
      value: () => output[0] as T,
    });
    return cursor;
  }

  snapshot(): ReservationLedgerPersistedSnapshot {
    return {
      metadata: { ...this.metadata },
      records: new Map(
        [...this.records].map(([key, row]) => [key, { ...row }]),
      ),
      attempts: new Map(
        [...this.attempts].map(([key, row]) => [key, { ...row }]),
      ),
    };
  }

  restore(snapshot: ReservationLedgerPersistedSnapshot): void {
    this.metadata = { ...snapshot.metadata };
    this.records = new Map(
      [...snapshot.records].map(([key, row]) => [key, { ...row }]),
    );
    this.attempts = new Map(
      [...snapshot.attempts].map(([key, row]) => [key, { ...row }]),
    );
  }

  private assertWritable(): void {
    if (this.mutationsUntilWriteFailure === null) return;
    if (this.mutationsUntilWriteFailure === 0) {
      this.mutationsUntilWriteFailure = null;
      throw new Error(RESERVATION_LEDGER_STORAGE_WRITE_FAILED);
    }
    this.mutationsUntilWriteFailure -= 1;
  }
}

export function createReservationLedgerHarness(
  sql = new ReservationLedgerTestSql(),
): {
  sql: ReservationLedgerTestSql;
  target: ReservationLedgerDurableObject;
} {
  let transactionDepth = 0;
  const storage = {
    sql,
    transactionSync: <T>(callback: () => T): T => {
      if (transactionDepth !== 0) {
        throw new Error(
          "Reservation ledger storage does not nest transactionSync.",
        );
      }
      transactionDepth += 1;
      const before = sql.snapshot();
      try {
        return callback();
      } catch (error) {
        sql.restore(before);
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
  };
  const state = {
    storage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> =>
      callback(),
  };
  return {
    sql,
    target: new ReservationLedgerDurableObject(state),
  };
}

/**
 * Crash/failover restart: a new Durable Object instance is constructed from a
 * copy of persisted SQLite rows, not from the live in-memory object identity.
 */
export function restartReservationLedgerHarness(
  source: ReservationLedgerTestSql,
): ReturnType<typeof createReservationLedgerHarness> {
  const sql = new ReservationLedgerTestSql();
  sql.restore(source.snapshot());
  return createReservationLedgerHarness(sql);
}
