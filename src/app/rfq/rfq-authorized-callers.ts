import type { RfqLifecycleRecord } from "./rfq-lifecycle";

type Authorize = (record: RfqLifecycleRecord) => Promise<RfqLifecycleRecord>;

async function authorizeBeforeSink<T>(
  record: RfqLifecycleRecord,
  authorize: Authorize,
  sink: (authorized: RfqLifecycleRecord) => Promise<T>,
): Promise<Readonly<{ authorized: RfqLifecycleRecord; result: T }>> {
  const authorized = await authorize(record);
  const result = await sink(authorized);
  return Object.freeze({ authorized, result });
}

/**
 * Production accept/ticket caller. Quote acceptance is an awaited TOCTOU
 * boundary, so storage authority and live execution context are both checked
 * again immediately before the ticket sink.
 */
export async function runAuthorizedTicketAcceptance<T>(
  record: RfqLifecycleRecord,
  dependencies: Readonly<{
    authorize: Authorize;
    accept: (authorized: RfqLifecycleRecord) => Promise<void>;
    beforeEnsureTicket: (authorized: RfqLifecycleRecord) => void;
    ensureTicket: (authorized: RfqLifecycleRecord) => Promise<T>;
  }>,
): Promise<Readonly<{ authorized: RfqLifecycleRecord; result: T }>> {
  const accepted = await dependencies.authorize(record);
  await dependencies.accept(accepted);
  const authorized = await dependencies.authorize(accepted);
  dependencies.beforeEnsureTicket(authorized);
  const result = await dependencies.ensureTicket(authorized);
  return Object.freeze({ authorized, result });
}

/** Production initial-fill caller: browser CAS precedes the maker request. */
export function runAuthorizedInitialMakerFill<T>(
  record: RfqLifecycleRecord,
  dependencies: Readonly<{
    authorize: Authorize;
    beforeSubmit: (authorized: RfqLifecycleRecord) => void;
    submit: (authorized: RfqLifecycleRecord) => Promise<T>;
  }>,
): Promise<Readonly<{ authorized: RfqLifecycleRecord; result: T }>> {
  return authorizeBeforeSink(
    record,
    dependencies.authorize,
    async (authorized) => {
      dependencies.beforeSubmit(authorized);
      return dependencies.submit(authorized);
    },
  );
}

/** Production claim/refund caller: browser CAS precedes the wallet boundary. */
export function runAuthorizedPayout<T>(
  record: RfqLifecycleRecord,
  dependencies: Readonly<{
    authorize: Authorize;
    submitWallet: (authorized: RfqLifecycleRecord) => Promise<T>;
  }>,
): Promise<Readonly<{ authorized: RfqLifecycleRecord; result: T }>> {
  return authorizeBeforeSink(
    record,
    dependencies.authorize,
    dependencies.submitWallet,
  );
}
