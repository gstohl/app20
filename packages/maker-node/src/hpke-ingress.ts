import {
  acceptEncryptedRfqEnvelope,
  type AcceptedEncryptedRfqEnvelope,
  type EncryptedRfqEnvelopeV1,
  type ReplayConsumeInput,
  type RfqEnvelopeOpener,
  type VerifiedMakerDirectoryEpochV1,
} from "@app20/private-intents";

export type OpenEnvelopeReservationResult<T> = Readonly<{ accepted: AcceptedEncryptedRfqEnvelope; reservation: T; idempotent: boolean }>;
export interface AtomicEnvelopeReservationStore<T> {
  /** Must atomically enforce nonce + semantic RFQ uniqueness and persist the terminal reservation result. */
  consumeAndReserve(input: ReplayConsumeInput & { envelopeId: string; rfqDigest: string }, reserve: () => Promise<T>): Promise<
    | { kind: "accepted"; reservation: T }
    | { kind: "idempotent"; reservation: T }
    | { kind: "conflict" }
  >;
}

/** Unit/local adapter proving recoverable semantics; production must use its repository transaction. */
export function createMemoryAtomicEnvelopeReservationStore<T>(): AtomicEnvelopeReservationStore<T> {
  type Terminal = { digest: string; reservation: T };
  const byNonce = new Map<string, Terminal>();
  const byRfq = new Map<string, Terminal>();
  let tail = Promise.resolve();
  return {
    async consumeAndReserve(input, reserve) {
      let complete!: (value: { kind: "accepted" | "idempotent" | "conflict"; reservation?: T }) => void;
      let fail!: (reason: unknown) => void;
      const output = new Promise<{ kind: "accepted" | "idempotent" | "conflict"; reservation?: T }>((resolve, reject) => { complete = resolve; fail = reject; });
      const run = tail.then(async () => {
        const prefix = `${input.directoryDigest}:${input.makerId}:`;
        const nonceKey = `${prefix}nonce:${input.replayNonce}`;
        const rfqKey = `${prefix}rfq:${input.rfqDigest}`;
        const noncePrior = byNonce.get(nonceKey);
        const rfqPrior = byRfq.get(rfqKey);
        if (noncePrior || rfqPrior) {
          if (noncePrior && rfqPrior && noncePrior === rfqPrior && noncePrior.digest === input.envelopeDigest) complete({ kind: "idempotent", reservation: noncePrior.reservation });
          else complete({ kind: "conflict" });
          return;
        }
        try {
          const reservation = await reserve();
          const terminal = { digest: input.envelopeDigest, reservation };
          byNonce.set(nonceKey, terminal);
          byRfq.set(rfqKey, terminal);
          complete({ kind: "accepted", reservation });
        } catch (error) { fail(error); }
      });
      tail = run.catch(() => undefined);
      await run;
      return output as Promise<{ kind: "accepted"; reservation: T } | { kind: "idempotent"; reservation: T } | { kind: "conflict" }>;
    },
  };
}

/** Authenticate/open first, then atomically consume replay state and persist reservation/result. */
export async function openEnvelopeThenReserve<T>(input: {
  envelope: EncryptedRfqEnvelopeV1; now: number; directory: VerifiedMakerDirectoryEpochV1; opener: RfqEnvelopeOpener;
  atomicStore: AtomicEnvelopeReservationStore<T>;
  reserve: (accepted: AcceptedEncryptedRfqEnvelope) => Promise<T>;
}): Promise<OpenEnvelopeReservationResult<T>> {
  let replayInput: ReplayConsumeInput | undefined;
  const capture = { async consume(value: ReplayConsumeInput) { replayInput = value; return { kind: "accepted" as const }; } };
  const accepted = await acceptEncryptedRfqEnvelope(input.envelope, input.now, input.directory, capture, input.opener);
  if (!replayInput) throw new Error("Authenticated envelope replay context was not captured.");
  const result = await input.atomicStore.consumeAndReserve({ ...replayInput, envelopeId: input.envelope.aad.envelopeId, rfqDigest: input.envelope.aad.rfqDigest }, () => input.reserve(accepted));
  if (result.kind === "conflict") throw new Error("Authenticated envelope/RFQ replay conflict was refused.");
  return { accepted, reservation: result.reservation, idempotent: result.kind === "idempotent" };
}
