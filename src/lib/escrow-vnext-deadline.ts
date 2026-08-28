export type CommitmentDeadlineWindows = Readonly<{
  quoteExpiresAt: number;
  reservationExpiresAt: number;
  rfqExpiresAt: number;
  directoryValidUntil: number;
  now: number;
}>;

/** Derives the single on-chain deadline from every off-chain authorization window. */
export function deriveCommitmentDeadline(input: CommitmentDeadlineWindows): number {
  for (const [label, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be non-negative safe-integer unix seconds.`);
    }
  }
  const deadline = Math.min(
    input.quoteExpiresAt,
    input.reservationExpiresAt,
    input.rfqExpiresAt,
    input.directoryValidUntil,
  );
  if (deadline <= input.now) {
    throw new Error("The derived commitment deadline must be later than now.");
  }
  return deadline;
}
