import { describe, expect, it, vi } from "vitest";
import { createMemoryAtomicEnvelopeReservationStore } from "./hpke-ingress";
import { UnavailableProductionCustody, UnavailableProductionRepository, failClosedReconciler, requireAuthenticatedMakerOperation } from "./production-ports";

describe("production maker fail-closed ports", () => {
  it("does not claim an unconfigured repository or HSM", async () => {
    await expect(new UnavailableProductionRepository().serializable(async () => 1)).rejects.toThrow(/not configured/);
    await expect(new UnavailableProductionCustody().authorizeAndSubmitFill()).rejects.toThrow(/not configured/);
  });
  it("requires authenticated select/release/fill context, not a reservation id", async () => {
    const authorize = vi.fn(async () => undefined);
    await expect(requireAuthenticatedMakerOperation({ authorize }, undefined, "maker", "reservation", "release")).rejects.toThrow(/Authenticated/);
    await expect(requireAuthenticatedMakerOperation({ authorize }, { principal: "ops", scope: "select", authenticatedAt: 1 }, "maker", "reservation", "release")).rejects.toThrow(/Authenticated/);
    expect(authorize).not.toHaveBeenCalled();
  });
  it("does not burn replay state when reserve crashes and returns one terminal result", async () => {
    const store = createMemoryAtomicEnvelopeReservationStore<string>();
    const input = { replayNonce: `0x${"11".repeat(32)}`, envelopeDigest: `0x${"22".repeat(32)}`, directoryDigest: `0x${"33".repeat(32)}`, makerId: "maker", now: 1, envelopeId: `0x${"44".repeat(32)}`, rfqDigest: `0x${"55".repeat(32)}` };
    await expect(store.consumeAndReserve(input, async () => { throw new Error("crash"); })).rejects.toThrow(/crash/);
    await expect(store.consumeAndReserve(input, async () => "reservation")).resolves.toEqual({ kind: "accepted", reservation: "reservation" });
    await expect(store.consumeAndReserve(input, async () => "duplicate")).resolves.toEqual({ kind: "idempotent", reservation: "reservation" });
  });
  it("atomically rejects nonce and semantic-RFQ equivocation", async () => {
    const store = createMemoryAtomicEnvelopeReservationStore<string>();
    const base = { replayNonce: "nonce-a", envelopeDigest: "envelope-a", directoryDigest: "directory", makerId: "maker", now: 1, envelopeId: "id-a", rfqDigest: "rfq-a" };
    await expect(store.consumeAndReserve(base, async () => "reservation-a")).resolves.toMatchObject({ kind: "accepted" });
    await expect(store.consumeAndReserve({ ...base, replayNonce: "nonce-b", envelopeDigest: "envelope-b", envelopeId: "id-b" }, async () => "bad")).resolves.toEqual({ kind: "conflict" });
    await expect(store.consumeAndReserve({ ...base, rfqDigest: "rfq-b", envelopeDigest: "envelope-c", envelopeId: "id-c" }, async () => "bad")).resolves.toEqual({ kind: "conflict" });
    await expect(Promise.all([
      store.consumeAndReserve({ ...base, replayNonce: "nonce-c", rfqDigest: "rfq-c", envelopeDigest: "envelope-d", envelopeId: "id-d" }, async () => "reservation-d"),
      store.consumeAndReserve({ ...base, replayNonce: "nonce-c", rfqDigest: "rfq-d", envelopeDigest: "envelope-e", envelopeId: "id-e" }, async () => "bad"),
    ])).resolves.toEqual([{ kind: "accepted", reservation: "reservation-d" }, { kind: "conflict" }]);
  });
  it("quarantines duplicate/unknown or custody-chain disagreement", async () => {
    const reconciler = failClosedReconciler();
    await expect(reconciler.reconcile({ reservation: {} as never, custodyTransactionHash: "0x1" })).resolves.toMatchObject({ action: "quarantine" });
    await expect(reconciler.reconcile({ reservation: {} as never, custodyTransactionHash: "0x1", chainTransactionHash: "0x2" })).resolves.toMatchObject({ action: "quarantine" });
  });
});
