import type { MakerReservationV1 } from "@app20/private-intents";
import { ReservationLedgerDurableObject } from "../src/reservation-ledger-do.ts";

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

/** Minimal in-memory SQLite behavior for exercising the actual DO class. */
export class ReservationLedgerTestSql {
  metadata: Metadata = { revision: 0, high_water: "0" };
  records = new Map<string, RecordRow>();
  attempts = new Map<string, AttemptRow>();

  exec<T>(query: string, ...bindings: unknown[]): Iterable<T> & { one(): T } {
    let output: unknown[] = [];
    if (query.startsWith("SELECT revision, high_water")) {
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
    }
    const cursor = output as unknown as Iterable<T> & { one(): T };
    Object.defineProperty(cursor, "one", {
      value: () => output[0] as T,
    });
    return cursor;
  }

  snapshot(): {
    metadata: Metadata;
    records: Map<string, RecordRow>;
    attempts: Map<string, AttemptRow>;
  } {
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

  restore(snapshot: ReturnType<ReservationLedgerTestSql["snapshot"]>): void {
    this.metadata = snapshot.metadata;
    this.records = snapshot.records;
    this.attempts = snapshot.attempts;
  }
}

export function createReservationLedgerHarness(
  sql = new ReservationLedgerTestSql(),
): {
  sql: ReservationLedgerTestSql;
  target: ReservationLedgerDurableObject;
} {
  const storage = {
    sql,
    transactionSync: <T>(callback: () => T): T => {
      const before = sql.snapshot();
      try {
        return callback();
      } catch (error) {
        sql.restore(before);
        throw error;
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
