import {
  assertRfqQuoteScopeMatches,
  rfqQuoteScopeMatches,
  RfqQuoteScopeInvalidatedError,
  type CurrentRfqQuoteScope,
  type RfqQuoteRequestScope,
} from "../rfq-quote-scope";

export type LocalnetQuoteRequestHandle = Readonly<{
  token: symbol;
  scope: RfqQuoteRequestScope;
  signal: AbortSignal;
}>;

type ActiveQuoteRequest = {
  token: symbol;
  scope: RfqQuoteRequestScope;
  controller: AbortController;
};

export type LocalnetQuoteRequestFailureDisposition = Readonly<{
  releaseReservations: boolean;
  applyUi: boolean;
  discardedForScope: boolean;
  completeActive: boolean;
}>;

export type LocalnetQuoteRequestRegistry = Readonly<{
  setCurrentScope: (scope: CurrentRfqQuoteScope) => void;
  currentScope: () => CurrentRfqQuoteScope;
  start: (scope: RfqQuoteRequestScope) => LocalnetQuoteRequestHandle;
  active: () => LocalnetQuoteRequestHandle | null;
  assertActive: (request: LocalnetQuoteRequestHandle) => void;
  isActive: (request: LocalnetQuoteRequestHandle) => boolean;
  invalidateIfScopeChanged: () => LocalnetQuoteRequestHandle | null;
  cancelActive: () => void;
  complete: (request: LocalnetQuoteRequestHandle) => void;
}>;

function toHandle(active: ActiveQuoteRequest): LocalnetQuoteRequestHandle {
  return Object.freeze({
    token: active.token,
    scope: active.scope,
    signal: active.controller.signal,
  });
}

function abortActive(active: ActiveQuoteRequest | null): void {
  if (!active || active.controller.signal.aborted) return;
  active.controller.abort();
}

/**
 * Generation-scoped quote request registry. A newer start, wallet-scope
 * change, or unmount aborts obsolete async work before any quote completion
 * may be persisted or rendered.
 */
export function createLocalnetQuoteRequestRegistry(
  initialScope: CurrentRfqQuoteScope,
): LocalnetQuoteRequestRegistry {
  let currentScope: CurrentRfqQuoteScope = initialScope;
  let active: ActiveQuoteRequest | null = null;

  const registry: LocalnetQuoteRequestRegistry = {
    setCurrentScope(scope) {
      currentScope = scope;
    },
    currentScope() {
      return currentScope;
    },
    start(scope) {
      abortActive(active);
      active = {
        token: Symbol("rfq-quote-request"),
        scope,
        controller: new AbortController(),
      };
      return toHandle(active);
    },
    active() {
      return active ? toHandle(active) : null;
    },
    assertActive(request) {
      if (
        request.signal.aborted ||
        active?.token !== request.token ||
        !rfqQuoteScopeMatches(request.scope, currentScope)
      ) {
        throw new RfqQuoteScopeInvalidatedError();
      }
      assertRfqQuoteScopeMatches(request.scope, currentScope);
    },
    isActive(request) {
      return (
        !request.signal.aborted &&
        active?.token === request.token &&
        rfqQuoteScopeMatches(request.scope, currentScope)
      );
    },
    invalidateIfScopeChanged() {
      if (!active) return null;
      if (rfqQuoteScopeMatches(active.scope, currentScope)) return null;
      const previous = toHandle(active);
      abortActive(active);
      active = null;
      return previous;
    },
    cancelActive() {
      abortActive(active);
      active = null;
    },
    complete(request) {
      if (active?.token !== request.token) return;
      active = null;
    },
  };
  return Object.freeze(registry);
}

export function decideLocalnetQuoteRequestFailure(
  input: Readonly<{
    request: Pick<LocalnetQuoteRequestHandle, "token" | "scope">;
    activeToken: symbol | null;
    currentScope: CurrentRfqQuoteScope;
    error: unknown;
    requestingPersisted: boolean;
    requestAborted?: boolean;
  }>,
): LocalnetQuoteRequestFailureDisposition {
  const tokenMismatch = input.activeToken !== input.request.token;
  const scopeMismatch = !rfqQuoteScopeMatches(
    input.request.scope,
    input.currentScope,
  );
  const discardedForScope =
    input.error instanceof RfqQuoteScopeInvalidatedError ||
    scopeMismatch ||
    tokenMismatch ||
    Boolean(input.requestAborted);
  const stillCurrent = !tokenMismatch;
  return Object.freeze({
    // Cross-account/provider work must not release with the live wallet.
    // The persisted requesting row is recovered by the original scope.
    releaseReservations: !discardedForScope && input.requestingPersisted,
    applyUi: stillCurrent,
    discardedForScope,
    // Leave a discarded generation in place so the wallet-scope effect can
    // abort it and keep the discard message instead of resetting to idle.
    completeActive: stillCurrent && !discardedForScope,
  });
}

/**
 * Quote completions and requesting rows may persist only while the generation
 * is live. A cancelled request cannot write either progress or a completion.
 */
export function assertQuoteProgressMayPersist(
  request: LocalnetQuoteRequestHandle | undefined,
  registry: Pick<LocalnetQuoteRequestRegistry, "assertActive">,
  _record?: Readonly<{ selectedQuote?: unknown }>,
): void {
  if (!request) return;
  registry.assertActive(request);
}
