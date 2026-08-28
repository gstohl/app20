import {
  reconcileRfqLifecycleWithLocalDeal,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";

/** One server-before-browser seam for every observation proving value movement. */
export async function reconcileFundingBeforeBrowserPersistence(
  record: RfqLifecycleRecord,
  observed: unknown,
  now: number,
  dependencies: Readonly<{
    authorize: (record: RfqLifecycleRecord) => Promise<RfqLifecycleRecord>;
    convergeServer: (
      next: RfqLifecycleRecord,
      status: 1 | 2 | 3 | 4,
      attemptId: string,
    ) => Promise<unknown>;
    persistBrowser: (next: RfqLifecycleRecord) => Promise<unknown>;
  }>,
): Promise<RfqLifecycleRecord> {
  let next = reconcileRfqLifecycleWithLocalDeal(record, observed, now);
  const preliminaryStatus = next.latestObservation?.status;
  if (preliminaryStatus !== undefined && preliminaryStatus !== 0) {
    const authorized = await dependencies.authorize(record);
    next = reconcileRfqLifecycleWithLocalDeal(authorized, observed, now);
    const status = next.latestObservation?.status;
    if (status === undefined || status === 0)
      throw new Error("Authorized convergence lost its value-bearing observation.");
    const attempt = next.attempts.funding;
    if (!attempt)
      throw new Error(
        "Value-bearing browser state cannot be persisted before the exact server funding attempt is bound.",
      );
    await dependencies.convergeServer(next, status, attempt.attemptId);
  }
  await dependencies.persistBrowser(next);
  return next;
}
