import { describe, expect, it } from "vitest";
import {
  RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE,
  RfqQuoteScopeInvalidatedError,
} from "../rfq-quote-scope";
import {
  assertQuoteProgressMayPersist,
  createLocalnetQuoteRequestRegistry,
  decideLocalnetQuoteRequestFailure,
} from "./quote-request-controller";

const ALICE = Object.freeze({
  account: "0xa11ce",
  chainId: "starknet:APP20_LOCALNET",
  providerIndex: 3,
});
const BOB = Object.freeze({
  account: "0xb0b",
  chainId: "starknet:APP20_LOCALNET",
  providerIndex: 3,
});
const SEPOLIA = Object.freeze({
  account: "0xa11ce",
  chainId: "starknet:SN_SEPOLIA",
  providerIndex: 3,
});
const OTHER_PROVIDER = Object.freeze({
  ...ALICE,
  providerIndex: 2,
});

describe("localnet quote request generation", () => {
  it("aborts the previous generation when a newer request starts", () => {
    const registry = createLocalnetQuoteRequestRegistry(ALICE);
    const first = registry.start(ALICE);
    const second = registry.start(ALICE);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(registry.isActive(first)).toBe(false);
    expect(registry.isActive(second)).toBe(true);
    expect(() => registry.assertActive(first)).toThrow(
      RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE,
    );
  });

  it("aborts in-flight work when the account, chain, or provider changes", () => {
    const registry = createLocalnetQuoteRequestRegistry(ALICE);
    const request = registry.start(ALICE);
    registry.setCurrentScope(BOB);
    expect(registry.invalidateIfScopeChanged()).toMatchObject({
      token: request.token,
    });
    expect(request.signal.aborted).toBe(true);
    expect(registry.active()).toBeNull();
    expect(() => registry.assertActive(request)).toThrow(
      RfqQuoteScopeInvalidatedError,
    );

    const chainRequest = createLocalnetQuoteRequestRegistry(ALICE).start(ALICE);
    const chainRegistry = createLocalnetQuoteRequestRegistry(ALICE);
    const live = chainRegistry.start(ALICE);
    chainRegistry.setCurrentScope(SEPOLIA);
    expect(chainRegistry.invalidateIfScopeChanged()?.token).toBe(live.token);
    expect(live.signal.aborted).toBe(true);
    expect(chainRequest.signal.aborted).toBe(false);

    const providerRegistry = createLocalnetQuoteRequestRegistry(ALICE);
    const providerRequest = providerRegistry.start(ALICE);
    providerRegistry.setCurrentScope(OTHER_PROVIDER);
    expect(providerRegistry.invalidateIfScopeChanged()?.token).toBe(
      providerRequest.token,
    );
    expect(providerRequest.signal.aborted).toBe(true);
  });

  it("does not abort a live request whose captured scope still matches", () => {
    const registry = createLocalnetQuoteRequestRegistry(ALICE);
    const request = registry.start(ALICE);
    registry.setCurrentScope({ ...ALICE });
    expect(registry.invalidateIfScopeChanged()).toBeNull();
    expect(request.signal.aborted).toBe(false);
    expect(() => registry.assertActive(request)).not.toThrow();
  });

  it("refuses quote-completion persistence after cancellation, before any save", async () => {
    const registry = createLocalnetQuoteRequestRegistry(ALICE);
    const request = registry.start(ALICE);
    const saved: string[] = [];
    const persistQuoted = async () => {
      assertQuoteProgressMayPersist(request, registry, {
        selectedQuote: { reservationId: "reservation-1" },
      });
      await Promise.resolve();
      assertQuoteProgressMayPersist(request, registry, {
        selectedQuote: { reservationId: "reservation-1" },
      });
      saved.push("quoted");
    };
    const pending = persistQuoted();
    registry.setCurrentScope(BOB);
    registry.invalidateIfScopeChanged();
    await expect(pending).rejects.toThrow(RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE);
    expect(saved).toEqual([]);
  });

  it("allows a requesting row to persist only while the generation is live", async () => {
    const registry = createLocalnetQuoteRequestRegistry(ALICE);
    const request = registry.start(ALICE);
    const saved: string[] = [];
    assertQuoteProgressMayPersist(request, registry, {});
    saved.push("requesting");
    registry.cancelActive();
    expect(() => assertQuoteProgressMayPersist(request, registry, {})).toThrow(
      RfqQuoteScopeInvalidatedError,
    );
    expect(saved).toEqual(["requesting"]);
  });

  it("ignores a superseded request's late completion after a newer start", async () => {
    const registry = createLocalnetQuoteRequestRegistry(ALICE);
    const obsolete = registry.start(ALICE);
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lateCompletion = (async () => {
      await delayed;
      registry.assertActive(obsolete);
      return "quoted";
    })();
    const current = registry.start(ALICE);
    registry.assertActive(current);
    release();
    await expect(lateCompletion).rejects.toThrow(RfqQuoteScopeInvalidatedError);
    expect(obsolete.signal.aborted).toBe(true);
    expect(registry.isActive(current)).toBe(true);
  });
});

describe("localnet quote request failure disposition", () => {
  const token = Symbol("request");
  const request = Object.freeze({ token, scope: ALICE });

  it("releases reservations only for a still-current requesting failure", () => {
    expect(
      decideLocalnetQuoteRequestFailure({
        request,
        activeToken: token,
        currentScope: ALICE,
        error: new Error("No private maker inventory can cover this RFQ."),
        requestingPersisted: true,
      }),
    ).toEqual({
      releaseReservations: true,
      applyUi: true,
      discardedForScope: false,
      completeActive: true,
    });
  });

  it("does not release or render under a changed account, chain, or provider", () => {
    expect(
      decideLocalnetQuoteRequestFailure({
        request,
        activeToken: null,
        currentScope: BOB,
        error: new RfqQuoteScopeInvalidatedError(),
        requestingPersisted: true,
      }),
    ).toEqual({
      releaseReservations: false,
      applyUi: false,
      discardedForScope: true,
      completeActive: false,
    });
  });

  it("does not apply UI for a superseded generation even if the error is unrelated", () => {
    expect(
      decideLocalnetQuoteRequestFailure({
        request,
        activeToken: Symbol("newer"),
        currentScope: ALICE,
        error: new Error("timeout"),
        requestingPersisted: true,
      }),
    ).toMatchObject({
      releaseReservations: false,
      applyUi: false,
      discardedForScope: true,
      completeActive: false,
    });
  });

  it("treats a caller-aborted generation as a scope discard so it cannot release under the live wallet", () => {
    const abort = new Error("The operation was aborted.");
    abort.name = "AbortError";
    expect(
      decideLocalnetQuoteRequestFailure({
        request,
        activeToken: token,
        currentScope: ALICE,
        error: abort,
        requestingPersisted: true,
        requestAborted: true,
      }),
    ).toMatchObject({
      releaseReservations: false,
      discardedForScope: true,
      applyUi: true,
      completeActive: false,
    });
  });

  it("still releases after a transport timeout that did not cancel the generation", () => {
    const timeout = new Error("The operation was aborted.");
    timeout.name = "AbortError";
    expect(
      decideLocalnetQuoteRequestFailure({
        request,
        activeToken: token,
        currentScope: ALICE,
        error: timeout,
        requestingPersisted: true,
        requestAborted: false,
      }),
    ).toMatchObject({
      releaseReservations: true,
      discardedForScope: false,
      applyUi: true,
    });
  });
});
