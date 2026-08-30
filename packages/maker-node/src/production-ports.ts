import {
  assertMakerReservationMutation,
  decodeStoredMakerReservation,
  transitionMakerReservation,
  type MakerReservationV1,
} from "@app20/private-intents";
import {
  type DurableReservationStore,
  MakerNodeError,
  type StoredMakerReservation,
} from "#index";

export type MakerAdminContext = Readonly<{
  principal: string;
  scope: "select" | "release" | "fill";
  authenticatedAt: number;
}>;
export interface MakerAdminAuth {
  authorize(input: {
    context: MakerAdminContext;
    makerId: string;
    reservationId: string;
    operation: MakerAdminContext["scope"];
  }): Promise<void>;
}

export type ReservationAttemptBinding = Readonly<{
  reservationId: string;
  expectedFence: bigint;
  idempotencyKey: string;
  payloadDigest: string;
  at: number;
}>;
export type ReservationAttemptOutcome =
  | Readonly<{ kind: "consumed"; transactionHash: string }>
  | Readonly<{ kind: "unknown"; reason: string }>;
export type ReservationAttemptBeginResult =
  | Readonly<{ kind: "claimed"; record: StoredMakerReservation }>
  | Readonly<{ kind: "replay"; outcome: ReservationAttemptOutcome }>;
export type ReservationAttemptCompleteResult = Readonly<{
  kind: "completed" | "replay";
  outcome: ReservationAttemptOutcome;
  record?: StoredMakerReservation;
}>;
export type RecoveredReservationAttempt = Readonly<{
  reservationId: string;
  idempotencyKey: string;
  outcome: Extract<ReservationAttemptOutcome, { kind: "unknown" }>;
  record: StoredMakerReservation;
}>;

export interface ReservationRepository {
  serializable<T>(
    operation: (tx: ReservationTransaction) => Promise<T>,
  ): Promise<T>;
  beginAttempt(
    input: ReservationAttemptBinding,
  ): Promise<ReservationAttemptBeginResult>;
  completeAttempt(
    input: ReservationAttemptBinding &
      Readonly<{ outcome: ReservationAttemptOutcome }>,
  ): Promise<ReservationAttemptCompleteResult>;
  recoverPendingAttempts(
    at: number,
  ): Promise<readonly RecoveredReservationAttempt[]>;
}
export interface ReservationTransaction {
  get(reservationId: string): Promise<StoredMakerReservation | null>;
  put(
    record: StoredMakerReservation,
    expectedFence: bigint | null,
  ): Promise<void>;
  nextFence(): Promise<bigint>;
}

export interface ReservationLedgerStub {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

type LedgerJsonValue =
  | null
  | string
  | number
  | boolean
  | LedgerJsonValue[]
  | { [key: string]: LedgerJsonValue };
type ReservationSnapshotWire = Readonly<{
  revision: number;
  highWater: string;
  records: readonly unknown[];
}>;
type AttemptBindingWire = Omit<ReservationAttemptBinding, "expectedFence"> &
  Readonly<{ expectedFence: string }>;
type AttemptBeginWire =
  | Readonly<{ kind: "claimed"; record: unknown }>
  | Readonly<{ kind: "replay"; outcome: ReservationAttemptOutcome }>;
type AttemptCompleteWire = Readonly<{
  kind: "completed" | "replay";
  outcome: ReservationAttemptOutcome;
  record?: unknown;
}>;
type AttemptRecoveryWire = Readonly<{
  recovered: readonly (AttemptBindingWire &
    Readonly<{
      outcome: Extract<ReservationAttemptOutcome, { kind: "unknown" }>;
      record: unknown;
    }>)[];
}>;

type ReservationMutationWire = Readonly<{
  record: unknown;
  expectedFence: string | null;
}>;

function ledgerStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? { $app20BigInt: item.toString() } : item,
  );
}

function ledgerParse<T>(value: string): T {
  return JSON.parse(value, (_key, item: unknown) => {
    if (
      item &&
      typeof item === "object" &&
      Object.keys(item).length === 1 &&
      "$app20BigInt" in item &&
      typeof (item as { $app20BigInt?: unknown }).$app20BigInt === "string" &&
      /^(0|[1-9][0-9]*)$/.test((item as { $app20BigInt: string }).$app20BigInt)
    )
      return BigInt((item as { $app20BigInt: string }).$app20BigInt);
    return item;
  }) as T;
}

function ledgerWire(value: unknown): LedgerJsonValue {
  return JSON.parse(ledgerStringify(value)) as LedgerJsonValue;
}

const HEX_32 = /^0x[0-9a-f]{64}$/;

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new MakerNodeError(`${label} is required.`);
  return value.trim();
}

function requireTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new MakerNodeError(`${label} must be a positive timestamp.`);
  return value as number;
}

export function requireStoredMakerReservation(
  value: unknown,
): StoredMakerReservation {
  return decodeStoredMakerReservation(value);
}

function attemptWire(input: ReservationAttemptBinding): AttemptBindingWire {
  if (
    !HEX_32.test(input.reservationId) ||
    !HEX_32.test(input.idempotencyKey) ||
    !HEX_32.test(input.payloadDigest) ||
    input.expectedFence <= 0n
  )
    throw new MakerNodeError("Invalid value-moving attempt binding.");
  requireTimestamp(input.at, "attempt at");
  return { ...input, expectedFence: input.expectedFence.toString() };
}

function requireAttemptOutcome(value: unknown): ReservationAttemptOutcome {
  if (!value || typeof value !== "object")
    throw new MakerNodeError("Value-moving attempt outcome is invalid.");
  const outcome = value as Record<string, unknown>;
  if (outcome.kind === "consumed")
    return {
      kind: "consumed",
      transactionHash: requireText(outcome.transactionHash, "transactionHash"),
    };
  if (outcome.kind === "unknown")
    return { kind: "unknown", reason: requireText(outcome.reason, "reason") };
  throw new MakerNodeError("Value-moving attempt outcome is invalid.");
}

async function requireLedgerResponse<T>(
  response: Response,
  operation: string,
): Promise<T> {
  const body = await response.text();
  if (!response.ok) {
    let detail = "";
    try {
      const decoded = JSON.parse(body) as { error?: unknown };
      if (typeof decoded.error === "string") detail = ` ${decoded.error}`;
    } catch {
      // A malformed remote error is still fail-closed.
    }
    throw new MakerNodeError(
      `Durable reservation ledger ${operation} failed.${detail}`,
    );
  }
  try {
    return ledgerParse<T>(body);
  } catch (error) {
    throw new MakerNodeError(
      `Durable reservation ledger ${operation} returned invalid JSON.`,
      { cause: error },
    );
  }
}

/**
 * Explicitly configured adapter for the dormant SQLite Durable Object binding.
 * It never discovers a public endpoint and does not retry an uncertain commit.
 */
export class DurableObjectReservationRepository
  implements ReservationRepository
{
  private readonly stub: ReservationLedgerStub;

  constructor(stub: ReservationLedgerStub) {
    this.stub = stub;
  }

  async serializable<T>(
    operation: (tx: ReservationTransaction) => Promise<T>,
  ): Promise<T> {
    const snapshot = await requireLedgerResponse<ReservationSnapshotWire>(
      await this.stub.fetch("https://reservation-ledger.invalid/snapshot"),
      "snapshot",
    );
    if (
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 ||
      !/^(0|[1-9][0-9]*)$/.test(snapshot.highWater) ||
      !Array.isArray(snapshot.records)
    )
      throw new MakerNodeError(
        "Durable reservation ledger snapshot is invalid.",
      );
    const records = new Map<string, StoredMakerReservation>();
    for (const wireRecord of snapshot.records) {
      const record = requireStoredMakerReservation(wireRecord);
      const id = record?.reservation?.reservationId;
      if (!id || records.has(id))
        throw new MakerNodeError(
          "Durable reservation ledger snapshot contains invalid or duplicate records.",
        );
      records.set(id, record);
    }
    const mutations = new Map<string, ReservationMutationWire>();
    const tx: ReservationTransaction = {
      get: async (id) => records.get(id) ?? null,
      nextFence: async () => BigInt(snapshot.highWater) + 1n,
      put: async (rawRecord, expectedFence) => {
        const record = requireStoredMakerReservation(rawRecord);
        const id = record.reservation.reservationId;
        const current = records.get(id);
        if (
          expectedFence === null
            ? current !== undefined
            : current?.reservation.fence !== expectedFence
        ) {
          throw new MakerNodeError(
            "Reservation fence compare-and-swap failed.",
          );
        }
        const first = mutations.get(id);
        mutations.set(id, {
          record: ledgerWire(record),
          expectedFence:
            first?.expectedFence ??
            (expectedFence === null ? null : expectedFence.toString()),
        });
        records.set(id, record);
      },
    };
    const value = await operation(tx);
    if (mutations.size === 0) return value;
    await requireLedgerResponse(
      await this.stub.fetch("https://reservation-ledger.invalid/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: snapshot.revision,
          mutations: [...mutations.values()],
        }),
      }),
      "commit",
    );
    return value;
  }

  async beginAttempt(
    input: ReservationAttemptBinding,
  ): Promise<ReservationAttemptBeginResult> {
    const result = await requireLedgerResponse<AttemptBeginWire>(
      await this.stub.fetch(
        "https://reservation-ledger.invalid/attempt/begin",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: ledgerStringify(attemptWire(input)),
        },
      ),
      "attempt begin",
    );
    if (result.kind === "claimed") {
      const record = requireStoredMakerReservation(result.record);
      if (
        record.reservation.state !== "filling" ||
        record.reservation.reservationId !== input.reservationId ||
        record.reservation.settlementAttemptId !== input.idempotencyKey
      )
        throw new MakerNodeError(
          "Durable reservation ledger attempt claim is not bound to its request.",
        );
      return { kind: "claimed", record };
    }
    if (result.kind === "replay")
      return { kind: "replay", outcome: requireAttemptOutcome(result.outcome) };
    throw new MakerNodeError(
      "Durable reservation ledger attempt result is invalid.",
    );
  }

  async completeAttempt(
    input: ReservationAttemptBinding &
      Readonly<{ outcome: ReservationAttemptOutcome }>,
  ): Promise<ReservationAttemptCompleteResult> {
    const result = await requireLedgerResponse<AttemptCompleteWire>(
      await this.stub.fetch(
        "https://reservation-ledger.invalid/attempt/complete",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: ledgerStringify({
            ...attemptWire(input),
            outcome: input.outcome,
          }),
        },
      ),
      "attempt complete",
    );
    if (result.kind !== "completed" && result.kind !== "replay")
      throw new MakerNodeError(
        "Durable reservation ledger attempt completion is invalid.",
      );
    const outcome = requireAttemptOutcome(result.outcome);
    const record =
      result.record === undefined
        ? undefined
        : requireStoredMakerReservation(result.record);
    if (
      result.kind === "completed" &&
      (!record ||
        record.reservation.reservationId !== input.reservationId ||
        record.reservation.settlementAttemptId !== input.idempotencyKey ||
        (outcome.kind === "consumed"
          ? record.reservation.state !== "consumed"
          : record.reservation.state !== "quarantined"))
    )
      throw new MakerNodeError(
        "Durable reservation ledger attempt completion is not bound to its request.",
      );
    return {
      kind: result.kind,
      outcome,
      ...(record === undefined ? {} : { record }),
    };
  }

  async recoverPendingAttempts(
    at: number,
  ): Promise<readonly RecoveredReservationAttempt[]> {
    requireTimestamp(at, "attempt recovery at");
    const result = await requireLedgerResponse<AttemptRecoveryWire>(
      await this.stub.fetch(
        "https://reservation-ledger.invalid/attempt/recover",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ at }),
        },
      ),
      "attempt recovery",
    );
    if (!Array.isArray(result.recovered))
      throw new MakerNodeError(
        "Durable reservation ledger attempt recovery is invalid.",
      );
    return result.recovered.map((item) => {
      attemptWire({
        reservationId: item.reservationId,
        expectedFence: BigInt(item.expectedFence),
        idempotencyKey: item.idempotencyKey,
        payloadDigest: item.payloadDigest,
        at,
      });
      const outcome = requireAttemptOutcome(item.outcome);
      const record = requireStoredMakerReservation(item.record);
      if (
        outcome.kind !== "unknown" ||
        record.reservation.state !== "quarantined" ||
        record.reservation.reservationId !== item.reservationId ||
        record.reservation.settlementAttemptId !== item.idempotencyKey
      )
        throw new MakerNodeError(
          "Durable reservation ledger recovered attempt is not bound to its record.",
        );
      return {
        reservationId: item.reservationId,
        idempotencyKey: item.idempotencyKey,
        outcome,
        record,
      };
    });
  }
}

export type CustodyFillAuthorization = Readonly<{
  reservationId: string;
  fence: bigint;
  settlementAttemptId: string;
  quoteDigest: string;
  chainId: string;
  escrowAddress: string;
  escrowClassHash: string;
  sellToken: string;
  sellAmountBaseUnits: bigint;
  buyToken: string;
  buyAmountBaseUnits: bigint;
}>;
export interface Custody {
  authorizeAndSubmitFill(
    input: CustodyFillAuthorization,
  ): Promise<{ transactionHash: string; idempotent: boolean }>;
}
export interface QuoteSigner {
  sign(input: {
    quoteKeyId: string;
    canonicalQuote: string;
    reservationId: string;
    fence: bigint;
  }): Promise<string>;
}
export interface Reconciler {
  reconcile(input: {
    reservation: MakerReservationV1;
    custodyTransactionHash?: string;
    chainTransactionHash?: string;
  }): Promise<{ action: "consistent" | "quarantine"; reason?: string }>;
}

/** Truthful single-process localnet adapter. It is not a production replication implementation. */
export class LocalnetWalReservationRepository implements ReservationRepository {
  private readonly store: DurableReservationStore;
  private readonly attempts = new Map<
    string,
    {
      binding: ReservationAttemptBinding;
      outcome?: ReservationAttemptOutcome;
    }
  >();

  constructor(store: DurableReservationStore) {
    this.store = store;
  }

  async serializable<T>(
    operation: (tx: ReservationTransaction) => Promise<T>,
  ): Promise<T> {
    return this.store.transaction(async (draft, sequence) => {
      const tx: ReservationTransaction = {
        get: async (id) => {
          const record = draft.get(id);
          return record ? requireStoredMakerReservation(record) : null;
        },
        nextFence: async () => BigInt(sequence),
        put: async (rawRecord, expectedFence) => {
          const record = requireStoredMakerReservation(rawRecord);
          const current = draft.get(record.reservation.reservationId);
          assertMakerReservationMutation(
            current?.reservation,
            record.reservation,
            expectedFence,
          );
          draft.set(record.reservation.reservationId, record);
        },
      };
      return operation(tx);
    });
  }

  async beginAttempt(
    input: ReservationAttemptBinding,
  ): Promise<ReservationAttemptBeginResult> {
    attemptWire(input);
    const prior = this.attempts.get(input.idempotencyKey);
    if (prior) {
      if (
        prior.binding.reservationId !== input.reservationId ||
        prior.binding.expectedFence !== input.expectedFence ||
        prior.binding.payloadDigest !== input.payloadDigest
      )
        throw new MakerNodeError(
          "Idempotency key was reused with a conflicting payload.",
        );
      if (prior.outcome) return { kind: "replay", outcome: prior.outcome };
      const outcome = {
        kind: "unknown" as const,
        reason: "interrupted value-moving attempt has an unknown outcome",
      };
      await this.quarantinePending(
        input.reservationId,
        input.idempotencyKey,
        input.at,
        outcome.reason,
      );
      this.attempts.set(input.idempotencyKey, { binding: input, outcome });
      return { kind: "replay", outcome };
    }
    const record = await this.store.transaction((draft) => {
      const current = draft.get(input.reservationId);
      if (!current) throw new MakerNodeError("Reservation does not exist.");
      requireStoredMakerReservation(current);
      if (
        current.reservation.state === "filling" &&
        current.reservation.settlementAttemptId === input.idempotencyKey
      )
        throw new MakerNodeError(
          "Pending attempt must be recovered before it can be replayed.",
        );
      if (current.reservation.fence !== input.expectedFence)
        throw new MakerNodeError(
          "Reservation fence compare-and-swap failed: stale fence.",
        );
      const filling: StoredMakerReservation = {
        ...current,
        reservation: transitionMakerReservation(current.reservation, {
          kind: "begin-fill",
          expectedFence: input.expectedFence,
          at: input.at,
          settlementAttemptId: input.idempotencyKey,
        }),
      };
      draft.set(input.reservationId, filling);
      return filling;
    });
    this.attempts.set(input.idempotencyKey, { binding: input });
    return { kind: "claimed", record };
  }

  async completeAttempt(
    input: ReservationAttemptBinding &
      Readonly<{ outcome: ReservationAttemptOutcome }>,
  ): Promise<ReservationAttemptCompleteResult> {
    attemptWire(input);
    const prior = this.attempts.get(input.idempotencyKey);
    if (!prior)
      throw new MakerNodeError("Value-moving attempt was not claimed.");
    if (
      prior.binding.reservationId !== input.reservationId ||
      prior.binding.expectedFence !== input.expectedFence ||
      prior.binding.payloadDigest !== input.payloadDigest
    )
      throw new MakerNodeError(
        "Idempotency key was reused with a conflicting payload.",
      );
    if (prior.outcome) return { kind: "replay", outcome: prior.outcome };
    const outcome: ReservationAttemptOutcome =
      input.outcome.kind === "consumed"
        ? {
            kind: "consumed",
            transactionHash: requireText(
              input.outcome.transactionHash,
              "transactionHash",
            ),
          }
        : {
            kind: "unknown",
            reason:
              input.outcome.reason.trim() || "value-moving outcome is unknown",
          };
    const record = await this.store.transaction((draft) => {
      const current = draft.get(input.reservationId);
      if (
        !current ||
        current.reservation.state !== "filling" ||
        current.reservation.settlementAttemptId !== input.idempotencyKey
      )
        throw new MakerNodeError(
          "Attempt completion does not match reservation state.",
        );
      const next: StoredMakerReservation = {
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
      draft.set(input.reservationId, next);
      return next;
    });
    this.attempts.set(input.idempotencyKey, {
      binding: prior.binding,
      outcome,
    });
    return { kind: "completed", outcome, record };
  }

  async recoverPendingAttempts(
    at: number,
  ): Promise<readonly RecoveredReservationAttempt[]> {
    requireTimestamp(at, "attempt recovery at");
    const recovered = await this.store.transaction((draft) => {
      const results: RecoveredReservationAttempt[] = [];
      for (const [reservationId, current] of draft) {
        const idempotencyKey = current.reservation.settlementAttemptId;
        if (current.reservation.state !== "filling" || !idempotencyKey)
          continue;
        const outcome = {
          kind: "unknown" as const,
          reason: "interrupted value-moving attempt has an unknown outcome",
        };
        const record: StoredMakerReservation = {
          ...current,
          reservation: transitionMakerReservation(current.reservation, {
            kind: "quarantine",
            expectedFence: current.reservation.fence,
            at: Math.max(at, current.reservation.updatedAt),
            reason: outcome.reason,
          }),
        };
        draft.set(reservationId, record);
        results.push({ reservationId, idempotencyKey, outcome, record });
      }
      return results;
    });
    for (const item of recovered) {
      const prior = this.attempts.get(item.idempotencyKey);
      if (prior)
        this.attempts.set(item.idempotencyKey, {
          binding: prior.binding,
          outcome: item.outcome,
        });
    }
    return recovered;
  }

  private async quarantinePending(
    reservationId: string,
    idempotencyKey: string,
    at: number,
    reason: string,
  ): Promise<void> {
    await this.store.transaction((draft) => {
      const current = draft.get(reservationId);
      if (
        !current ||
        current.reservation.state !== "filling" ||
        current.reservation.settlementAttemptId !== idempotencyKey
      )
        throw new MakerNodeError(
          "Pending attempt does not match reservation state.",
        );
      draft.set(reservationId, {
        ...current,
        reservation: transitionMakerReservation(current.reservation, {
          kind: "quarantine",
          expectedFence: current.reservation.fence,
          at: Math.max(at, current.reservation.updatedAt),
          reason,
        }),
      });
    });
  }
}

export class UnavailableProductionRepository implements ReservationRepository {
  async serializable<T>(
    _operation: (tx: ReservationTransaction) => Promise<T>,
  ): Promise<T> {
    return this.unavailable();
  }

  async beginAttempt(): Promise<never> {
    return this.unavailable();
  }

  async completeAttempt(): Promise<never> {
    return this.unavailable();
  }

  async recoverPendingAttempts(): Promise<never> {
    return this.unavailable();
  }

  private unavailable(): never {
    throw new MakerNodeError(
      "Production reservation adapter is not configured.",
    );
  }
}

export class UnavailableProductionCustody implements Custody {
  async authorizeAndSubmitFill(): Promise<never> {
    throw new MakerNodeError(
      "Production HSM/KMS custody adapter is not configured.",
    );
  }
}

export async function requireAuthenticatedMakerOperation(
  auth: MakerAdminAuth,
  context: MakerAdminContext | undefined,
  makerId: string,
  reservationId: string,
  operation: MakerAdminContext["scope"],
): Promise<void> {
  if (!context || context.scope !== operation || !context.principal.trim())
    throw new MakerNodeError(
      "Authenticated maker administration context is required.",
    );
  await auth.authorize({ context, makerId, reservationId, operation });
}

export function failClosedReconciler(): Reconciler {
  return {
    async reconcile(_input) {
      return {
        action: "quarantine",
        reason:
          "No configured-chain authority adapter is wired; matching hash strings alone never release inventory.",
      };
    },
  };
}
