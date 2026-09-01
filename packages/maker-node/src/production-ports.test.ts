import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMakerReservation,
  transitionMakerReservation,
  type MakerReservationV1,
} from "@app20/private-intents";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryAtomicEnvelopeReservationStore } from "./hpke-ingress";
import { createReservationLedgerHarness } from "../../../workers/relay/test/reservation-ledger-harness.ts";
import { DurableReservationStore, type StoredMakerReservation } from "./index";
import {
  DurableObjectReservationRepository,
  LocalnetWalReservationRepository,
  type ReservationRepository,
  UnavailableProductionCustody,
  UnavailableProductionRepository,
  failClosedReconciler,
  requireAuthenticatedMakerOperation,
} from "./production-ports";

const NOW = 1_800_000_000;
const RESERVATION_ID = `0x${"11".repeat(32)}`;
const INTENT_DIGEST = `0x${"22".repeat(32)}`;
const RFQ_DIGEST = `0x${"33".repeat(32)}`;
const QUOTE_DIGEST = `0x${"44".repeat(32)}`;
const ATTEMPT_ID = `0x${"55".repeat(32)}`;
const PAYLOAD_DIGEST = `0x${"66".repeat(32)}`;
const temporaryDirectories: string[] = [];
const stores: DurableReservationStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function stored(reservation: MakerReservationV1): StoredMakerReservation {
  return {
    reservation,
    nonce: `0x${"77".repeat(32)}`,
    solverId: "maker-a",
    solverKey: "solver-key-a",
    spreadBps: 25,
    sellToken: "0x123",
    sellAmount: 100n,
    buyToken: "0x456",
    grossBuyAmount: 120n,
    buyAmount: 117n,
    minBuyAmount: 110n,
    rfqExpiresAt: NOW + 200,
    pricingProvenance: "test-price-v1",
  };
}

function openStore(): DurableReservationStore {
  const directory = mkdtempSync(join(tmpdir(), "app20-ports-"));
  temporaryDirectories.push(directory);
  const store = DurableReservationStore.open(join(directory, "ledger.wal"));
  stores.push(store);
  return store;
}

function durableRepository(): DurableObjectReservationRepository {
  const { target } = createReservationLedgerHarness();
  return new DurableObjectReservationRepository({
    fetch: (request, init) => target.fetch(new Request(request, init)),
  });
}

async function seedSelected(
  repository: ReservationRepository,
  reservationId = RESERVATION_ID,
): Promise<void> {
  const reserved = createMakerReservation({
    reservationId,
    makerId: "maker-a",
    intentDigest: INTENT_DIGEST,
    rfqDigest: RFQ_DIGEST,
    asset: "0x123",
    amountBaseUnits: 100n,
    createdAt: NOW,
    expiresAt: NOW + 300,
    fence: 1n,
  });
  await repository.serializable((tx) => tx.put(stored(reserved), null));
  const selected = transitionMakerReservation(reserved, {
    kind: "select",
    expectedFence: 1n,
    at: NOW + 1,
    quoteDigest: QUOTE_DIGEST,
  });
  await repository.serializable((tx) => tx.put(stored(selected), 1n));
}

async function expectTerminalReleaseRejected(
  repository: ReservationRepository,
  expectedState: "consumed" | "quarantined",
): Promise<void> {
  await expect(
    repository.serializable(async (tx) => {
      const current = await tx.get(RESERVATION_ID);
      if (!current) throw new Error("Contract reservation is missing.");
      const reconstructed: MakerReservationV1 = {
        ...current.reservation,
        state: "released",
        updatedAt: current.reservation.updatedAt + 1,
        fence: current.reservation.fence + 1n,
        terminalReason: "illegal terminal rewrite",
      };
      await tx.put(
        { ...current, reservation: reconstructed },
        current.reservation.fence,
      );
    }),
  ).rejects.toThrow(/terminal reservation state cannot transition/i);
  await expect(
    repository.serializable(
      async (tx) => (await tx.get(RESERVATION_ID))?.reservation.state,
    ),
  ).resolves.toBe(expectedState);
}

async function reservationLifecycleContract(
  repository: ReservationRepository,
): Promise<void> {
  await seedSelected(repository);
  const binding = {
    reservationId: RESERVATION_ID,
    expectedFence: 2n,
    idempotencyKey: ATTEMPT_ID,
    payloadDigest: PAYLOAD_DIGEST,
    at: NOW + 2,
  };
  await expect(repository.beginAttempt(binding)).resolves.toMatchObject({
    kind: "claimed",
    record: { reservation: { state: "filling" } },
  });
  await expect(
    repository.completeAttempt({
      ...binding,
      at: NOW + 3,
      outcome: { kind: "consumed", transactionHash: "0x1234" },
    }),
  ).resolves.toMatchObject({
    kind: "completed",
    outcome: { kind: "consumed", transactionHash: "0x1234" },
    record: { reservation: { state: "consumed" } },
  });
  await expect(
    repository.completeAttempt({
      ...binding,
      at: NOW + 4,
      outcome: { kind: "unknown", reason: "must not replace original" },
    }),
  ).resolves.toEqual({
    kind: "replay",
    outcome: { kind: "consumed", transactionHash: "0x1234" },
  });
  await expect(repository.recoverPendingAttempts(NOW + 5)).resolves.toEqual([]);
  await expectTerminalReleaseRejected(repository, "consumed");
}

async function reservationRecoveryContract(
  repository: ReservationRepository,
): Promise<void> {
  await seedSelected(repository);
  await repository.beginAttempt({
    reservationId: RESERVATION_ID,
    expectedFence: 2n,
    idempotencyKey: ATTEMPT_ID,
    payloadDigest: PAYLOAD_DIGEST,
    at: NOW + 2,
  });
  await expect(repository.recoverPendingAttempts(NOW + 10)).resolves.toEqual([
    expect.objectContaining({
      reservationId: RESERVATION_ID,
      idempotencyKey: ATTEMPT_ID,
      outcome: {
        kind: "unknown",
        reason: "interrupted value-moving attempt has an unknown outcome",
      },
      record: expect.objectContaining({
        reservation: expect.objectContaining({ state: "quarantined" }),
      }),
    }),
  ]);
  await expect(repository.recoverPendingAttempts(NOW + 11)).resolves.toEqual(
    [],
  );
  await expectTerminalReleaseRejected(repository, "quarantined");
}

describe("production maker fail-closed ports", () => {
  it("refuses oversize ledger bodies before JSON parse", async () => {
    const repository = new DurableObjectReservationRepository({
      fetch: async () =>
        new Response("{}", {
          headers: { "content-length": String(1_048_577) },
        }),
    });
    await expect(repository.serializable(async () => 1)).rejects.toThrow(
      /bounded size/i,
    );
  });
  it("does not claim an unconfigured repository or HSM", async () => {
    await expect(
      new UnavailableProductionRepository().serializable(async () => 1),
    ).rejects.toThrow(/not configured/);
    await expect(
      new UnavailableProductionCustody().authorizeAndSubmitFill(),
    ).rejects.toThrow(/not configured/);
  });
  it("adapts the existing repository transaction port to an explicitly supplied Durable Object stub", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const repository = new DurableObjectReservationRepository({
      fetch: async (request, init) => {
        requests.push({
          url: String(request),
          ...(init === undefined ? {} : { init }),
        });
        return String(request).endsWith("/snapshot")
          ? Response.json({ revision: 0, highWater: "0", records: [] })
          : Response.json({ committed: true, revision: 1 });
      },
    });
    const fence = await repository.serializable(async (tx) => {
      const allocated = await tx.nextFence();
      await tx.put(
        stored(
          createMakerReservation({
            reservationId: RESERVATION_ID,
            makerId: "maker-a",
            intentDigest: INTENT_DIGEST,
            rfqDigest: RFQ_DIGEST,
            asset: "0x123",
            amountBaseUnits: 100n,
            createdAt: NOW,
            expiresAt: NOW + 300,
            fence: allocated,
          }),
        ),
        null,
      );
      return allocated;
    });
    expect(fence).toBe(1n);
    expect(requests.map((request) => request.url)).toEqual([
      "https://reservation-ledger.invalid/snapshot",
      "https://reservation-ledger.invalid/commit",
    ]);
    expect(requests[1]?.init?.body).toContain("$app20BigInt");
  });
  it("runs one lifecycle contract against the WAL repository and actual Durable Object class", async () => {
    for (const repository of [
      new LocalnetWalReservationRepository(openStore()),
      durableRepository(),
    ])
      await reservationLifecycleContract(repository);

    for (const repository of [
      new LocalnetWalReservationRepository(openStore()),
      durableRepository(),
    ])
      await reservationRecoveryContract(repository);
  });
  it("requires authenticated select/release/fill context, not a reservation id", async () => {
    const authorize = vi.fn(async () => undefined);
    await expect(
      requireAuthenticatedMakerOperation(
        { authorize },
        undefined,
        "maker",
        "reservation",
        "release",
      ),
    ).rejects.toThrow(/Authenticated/);
    await expect(
      requireAuthenticatedMakerOperation(
        { authorize },
        { principal: "ops", scope: "select", authenticatedAt: 1 },
        "maker",
        "reservation",
        "release",
      ),
    ).rejects.toThrow(/Authenticated/);
    expect(authorize).not.toHaveBeenCalled();
  });
  it("does not burn replay state when reserve crashes and returns one terminal result", async () => {
    const store = createMemoryAtomicEnvelopeReservationStore<string>();
    const input = {
      replayNonce: `0x${"11".repeat(32)}`,
      envelopeDigest: `0x${"22".repeat(32)}`,
      directoryDigest: `0x${"33".repeat(32)}`,
      makerId: "maker",
      now: 1,
      envelopeId: `0x${"44".repeat(32)}`,
      rfqDigest: `0x${"55".repeat(32)}`,
    };
    await expect(
      store.consumeAndReserve(input, async () => {
        throw new Error("crash");
      }),
    ).rejects.toThrow(/crash/);
    await expect(
      store.consumeAndReserve(input, async () => "reservation"),
    ).resolves.toEqual({ kind: "accepted", reservation: "reservation" });
    await expect(
      store.consumeAndReserve(input, async () => "duplicate"),
    ).resolves.toEqual({ kind: "idempotent", reservation: "reservation" });
  });
  it("atomically rejects nonce and semantic-RFQ equivocation", async () => {
    const store = createMemoryAtomicEnvelopeReservationStore<string>();
    const base = {
      replayNonce: "nonce-a",
      envelopeDigest: "envelope-a",
      directoryDigest: "directory",
      makerId: "maker",
      now: 1,
      envelopeId: "id-a",
      rfqDigest: "rfq-a",
    };
    await expect(
      store.consumeAndReserve(base, async () => "reservation-a"),
    ).resolves.toMatchObject({ kind: "accepted" });
    await expect(
      store.consumeAndReserve(
        {
          ...base,
          replayNonce: "nonce-b",
          envelopeDigest: "envelope-b",
          envelopeId: "id-b",
        },
        async () => "bad",
      ),
    ).resolves.toEqual({ kind: "conflict" });
    await expect(
      store.consumeAndReserve(
        {
          ...base,
          rfqDigest: "rfq-b",
          envelopeDigest: "envelope-c",
          envelopeId: "id-c",
        },
        async () => "bad",
      ),
    ).resolves.toEqual({ kind: "conflict" });
    await expect(
      Promise.all([
        store.consumeAndReserve(
          {
            ...base,
            replayNonce: "nonce-c",
            rfqDigest: "rfq-c",
            envelopeDigest: "envelope-d",
            envelopeId: "id-d",
          },
          async () => "reservation-d",
        ),
        store.consumeAndReserve(
          {
            ...base,
            replayNonce: "nonce-c",
            rfqDigest: "rfq-d",
            envelopeDigest: "envelope-e",
            envelopeId: "id-e",
          },
          async () => "bad",
        ),
      ]),
    ).resolves.toEqual([
      { kind: "accepted", reservation: "reservation-d" },
      { kind: "conflict" },
    ]);
  });
  it("quarantines duplicate/unknown or custody-chain disagreement", async () => {
    const reconciler = failClosedReconciler();
    const reservation = createMakerReservation({
      reservationId: RESERVATION_ID,
      makerId: "maker-a",
      intentDigest: INTENT_DIGEST,
      rfqDigest: RFQ_DIGEST,
      asset: "0x123",
      amountBaseUnits: 100n,
      createdAt: NOW,
      expiresAt: NOW + 300,
      fence: 1n,
    });
    await expect(
      reconciler.reconcile({
        reservation,
        custodyTransactionHash: "0x1",
      }),
    ).resolves.toMatchObject({ action: "quarantine" });
    await expect(
      reconciler.reconcile({
        reservation,
        custodyTransactionHash: "0x1",
        chainTransactionHash: "0x2",
      }),
    ).resolves.toMatchObject({ action: "quarantine" });
  });
});
