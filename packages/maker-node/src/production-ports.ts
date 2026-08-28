import type { MakerReservationV1 } from "@app20/private-intents";
import { type DurableReservationStore, MakerNodeError, type StoredMakerReservation } from "#index";

export type MakerAdminContext = Readonly<{ principal: string; scope: "select" | "release" | "fill"; authenticatedAt: number }>;
export interface MakerAdminAuth { authorize(input: { context: MakerAdminContext; makerId: string; reservationId: string; operation: MakerAdminContext["scope"] }): Promise<void>; }

export interface ReservationRepository {
  serializable<T>(operation: (tx: ReservationTransaction) => Promise<T>): Promise<T>;
}
export interface ReservationTransaction {
  get(reservationId: string): Promise<StoredMakerReservation | null>;
  put(record: StoredMakerReservation, expectedFence: bigint | null): Promise<void>;
  nextFence(): Promise<bigint>;
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
export interface Custody { authorizeAndSubmitFill(input: CustodyFillAuthorization): Promise<{ transactionHash: string; idempotent: boolean }>; }
export interface QuoteSigner { sign(input: { quoteKeyId: string; canonicalQuote: string; reservationId: string; fence: bigint }): Promise<string>; }
export interface Reconciler { reconcile(input: { reservation: MakerReservationV1; custodyTransactionHash?: string; chainTransactionHash?: string }): Promise<{ action: "consistent" | "quarantine"; reason?: string }>; }

/** Truthful single-process localnet adapter. It is not a production replication implementation. */
export class LocalnetWalReservationRepository implements ReservationRepository {
  private readonly store: DurableReservationStore;
  constructor(store: DurableReservationStore) {
    this.store = store;
  }
  async serializable<T>(operation: (tx: ReservationTransaction) => Promise<T>): Promise<T> {
    return this.store.transaction(async (draft, sequence) => {
      const tx: ReservationTransaction = {
        get: async (id) => draft.get(id) ?? null,
        nextFence: async () => BigInt(sequence),
        put: async (record, expectedFence) => {
          const current = draft.get(record.reservation.reservationId);
          if (expectedFence === null ? current !== undefined : current?.reservation.fence !== expectedFence) throw new MakerNodeError("Reservation fence compare-and-swap failed.");
          if (record.reservation.fence <= 0n || (current && record.reservation.fence <= current.reservation.fence)) throw new MakerNodeError("Reservation fence must advance monotonically.");
          draft.set(record.reservation.reservationId, record);
        },
      };
      return operation(tx);
    });
  }
}

export class UnavailableProductionRepository implements ReservationRepository {
  async serializable<T>(_operation: (tx: ReservationTransaction) => Promise<T>): Promise<T> {
    throw new MakerNodeError("Production reservation adapter is not configured.");
  }
}

export class UnavailableProductionCustody implements Custody {
  async authorizeAndSubmitFill(): Promise<never> {
    throw new MakerNodeError("Production HSM/KMS custody adapter is not configured.");
  }
}

export async function requireAuthenticatedMakerOperation(auth: MakerAdminAuth, context: MakerAdminContext | undefined, makerId: string, reservationId: string, operation: MakerAdminContext["scope"]): Promise<void> {
  if (!context || context.scope !== operation || !context.principal.trim()) throw new MakerNodeError("Authenticated maker administration context is required.");
  await auth.authorize({ context, makerId, reservationId, operation });
}

export function failClosedReconciler(): Reconciler {
  return {
    async reconcile(_input) {
      return { action: "quarantine", reason: "No configured-chain authority adapter is wired; matching hash strings alone never release inventory." };
    },
  };
}
