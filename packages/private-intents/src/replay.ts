export type ReplayConsumeResult =
  | Readonly<{ kind: "accepted" }>
  | Readonly<{ kind: "idempotent"; envelopeDigest: string }>
  | Readonly<{ kind: "conflict" }>;

export type ReplayConsumeInput = Readonly<{
  replayNonce: string;
  envelopeDigest: string;
  directoryDigest: string;
  makerId: string;
  now: number;
}>;

export interface AsyncEnvelopeReplayStore {
  consume(input: ReplayConsumeInput): Promise<ReplayConsumeResult>;
}

/** Test/local adapter only. Production callers must inject a durable CAS/UNIQUE store. */
export function createMemoryAsyncReplayStore(): AsyncEnvelopeReplayStore {
  const entries = new Map<string, string>();
  return {
    async consume(input) {
      const key = `${input.directoryDigest}:${input.makerId}:${input.replayNonce}`;
      const previous = entries.get(key);
      if (previous === undefined) {
        entries.set(key, input.envelopeDigest);
        return { kind: "accepted" };
      }
      return previous === input.envelopeDigest
        ? { kind: "idempotent", envelopeDigest: previous }
        : { kind: "conflict" };
    },
  };
}
