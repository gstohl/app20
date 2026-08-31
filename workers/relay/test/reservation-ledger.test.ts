import test from "node:test";
import assert from "node:assert/strict";
import {
  createMakerReservation,
  transitionMakerReservation,
  type MakerReservationV1,
} from "@app20/private-intents";
import type { ReservationLedgerDurableObject } from "../src/reservation-ledger-do.ts";
import {
  createReservationLedgerHarness as durableObject,
  restartReservationLedgerHarness,
} from "./reservation-ledger-harness.ts";

const RESERVATION_ID = `0x${"11".repeat(32)}`;
const SECOND_RESERVATION_ID = `0x${"aa".repeat(32)}`;
const INTENT_DIGEST = `0x${"22".repeat(32)}`;
const RFQ_DIGEST = `0x${"33".repeat(32)}`;
const QUOTE_DIGEST = `0x${"44".repeat(32)}`;
const ATTEMPT_ID = `0x${"55".repeat(32)}`;
const PAYLOAD_DIGEST = `0x${"66".repeat(32)}`;
const NOW = 1_800_000_000;

function stored(reservation: MakerReservationV1) {
  return {
    reservation,
    nonce: `0x${"77".repeat(32)}`,
    solverId: "maker-a",
    solverKey: "solver-key-a",
    spreadBps: 25,
    sellToken: "0x123",
    sellAmount: 12345678901234567890n,
    buyToken: "0x456",
    grossBuyAmount: 120n,
    buyAmount: 117n,
    minBuyAmount: 110n,
    rfqExpiresAt: NOW + 200,
    pricingProvenance: "test-price-v1",
  };
}

function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? { $app20BigInt: item.toString() } : item,
  );
}

async function post(
  target: ReservationLedgerDurableObject,
  path: string,
  body: unknown,
): Promise<Response> {
  return target.fetch(
    new Request(`https://reservation-ledger.invalid${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: encode(body),
    }),
  );
}

type LedgerSnapshot = {
  revision: number;
  highWater: string;
  records: Array<{
    reservation: { state: string; fence: Record<string, string> };
  }>;
};

async function snapshot(
  target: ReservationLedgerDurableObject,
): Promise<LedgerSnapshot> {
  const response = await target.fetch(
    new Request("https://reservation-ledger.invalid/snapshot"),
  );
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body) as LedgerSnapshot;
}

function newReservation(reservationId: string, fence: bigint) {
  return createMakerReservation({
    reservationId,
    makerId: reservationId === RESERVATION_ID ? "maker-a" : "maker-b",
    intentDigest: INTENT_DIGEST,
    rfqDigest: RFQ_DIGEST,
    asset: "0x123",
    amountBaseUnits:
      reservationId === RESERVATION_ID ? 12345678901234567890n : 1n,
    createdAt: NOW,
    expiresAt: NOW + 300,
    fence,
  });
}

async function createAndSelect(target: ReservationLedgerDurableObject) {
  const reserved = createMakerReservation({
    reservationId: RESERVATION_ID,
    makerId: "maker-a",
    intentDigest: INTENT_DIGEST,
    rfqDigest: RFQ_DIGEST,
    asset: "0x123",
    amountBaseUnits: 12345678901234567890n,
    createdAt: NOW,
    expiresAt: NOW + 300,
    fence: 1n,
  });
  const createResponse = await post(target, "/commit", {
    expectedRevision: 0,
    mutations: [{ record: stored(reserved), expectedFence: null }],
  });
  assert.equal(createResponse.status, 200, await createResponse.text());
  const selected = transitionMakerReservation(reserved, {
    kind: "select",
    expectedFence: 1n,
    at: NOW + 1,
    quoteDigest: QUOTE_DIGEST,
  });
  const selectResponse = await post(target, "/commit", {
    expectedRevision: 1,
    mutations: [{ record: stored(selected), expectedFence: "1" }],
  });
  assert.equal(selectResponse.status, 200, await selectResponse.text());
  return selected;
}

const attempt = {
  reservationId: RESERVATION_ID,
  expectedFence: "2",
  idempotencyKey: ATTEMPT_ID,
  payloadDigest: PAYLOAD_DIGEST,
  at: NOW + 2,
};

test("SQLite reservation ledger rejects a stale fence instead of accepting it", async () => {
  const { target } = durableObject();
  const selected = await createAndSelect(target);
  const released = transitionMakerReservation(selected, {
    kind: "release",
    expectedFence: selected.fence,
    at: NOW + 2,
    reason: "declined",
  });
  const response = await post(target, "/commit", {
    expectedRevision: 2,
    mutations: [{ record: stored(released), expectedFence: "1" }],
  });
  assert.equal(response.status, 409);
  assert.match(await response.text(), /stale fence|compare-and-swap/i);
});

test("the ledger rejects an incomplete stored maker reservation", async () => {
  const { target } = durableObject();
  const reservation = createMakerReservation({
    reservationId: RESERVATION_ID,
    makerId: "maker-a",
    intentDigest: INTENT_DIGEST,
    rfqDigest: RFQ_DIGEST,
    asset: "0x123",
    amountBaseUnits: 10n,
    createdAt: NOW,
    expiresAt: NOW + 300,
    fence: 1n,
  });
  const response = await post(target, "/commit", {
    expectedRevision: 0,
    mutations: [
      {
        record: {
          reservation,
          nonce: `0x${"77".repeat(32)}`,
          solverId: "maker-a",
          spreadBps: 25,
        },
        expectedFence: null,
      },
    ],
  });
  assert.equal(response.status, 409);
  assert.match(await response.text(), /solverKey is required/i);
});

test("value-moving attempt replay returns the original outcome exactly once", async () => {
  const { target } = durableObject();
  await createAndSelect(target);
  assert.equal((await post(target, "/attempt/begin", attempt)).status, 201);
  const completion = {
    ...attempt,
    at: NOW + 3,
    outcome: { kind: "consumed", transactionHash: "0x1234" },
  };
  const first = await post(target, "/attempt/complete", completion);
  assert.equal(first.status, 200);
  assert.deepEqual(((await first.json()) as { outcome: unknown }).outcome, {
    kind: "consumed",
    transactionHash: "0x1234",
  });
  const replay = await post(target, "/attempt/complete", {
    ...completion,
    outcome: { kind: "unknown", reason: "must not replace original" },
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(((await replay.json()) as { outcome: unknown }).outcome, {
    kind: "consumed",
    transactionHash: "0x1234",
  });
});

test("an idempotency key reused for a conflicting payload fails loudly", async () => {
  const { target } = durableObject();
  await createAndSelect(target);
  assert.equal((await post(target, "/attempt/begin", attempt)).status, 201);
  const conflictResponse = await post(target, "/attempt/begin", {
    ...attempt,
    payloadDigest: `0x${"99".repeat(32)}`,
  });
  assert.equal(conflictResponse.status, 409);
  assert.match(await conflictResponse.text(), /conflicting payload/i);
});

test("an explicitly unknown value-moving outcome durably quarantines", async () => {
  const { target, sql } = durableObject();
  await createAndSelect(target);
  assert.equal((await post(target, "/attempt/begin", attempt)).status, 201);
  const response = await post(target, "/attempt/complete", {
    ...attempt,
    at: NOW + 3,
    outcome: { kind: "unknown", reason: "RPC result ambiguous" },
  });
  assert.equal(response.status, 200);
  assert.equal(sql.records.get(RESERVATION_ID)?.state, "quarantined");
  assert.ok(
    sql.records.has(RESERVATION_ID),
    "terminal tombstone must remain durable",
  );
});

test("restart recovery quarantines a pending attempt and never reclaims it", async () => {
  const first = durableObject();
  await createAndSelect(first.target);
  assert.equal(
    (await post(first.target, "/attempt/begin", attempt)).status,
    201,
  );
  assert.equal(first.sql.records.get(RESERVATION_ID)?.state, "filling");

  const restarted = durableObject(first.sql);
  // A fresh caller has no copy of the begin request or its payload binding.
  const recovery = await post(restarted.target, "/attempt/recover", {
    at: NOW + 10,
  });
  assert.equal(recovery.status, 200);
  assert.deepEqual(await recovery.json(), {
    recovered: [
      {
        idempotencyKey: ATTEMPT_ID,
        reservationId: RESERVATION_ID,
        expectedFence: "2",
        payloadDigest: PAYLOAD_DIGEST,
        outcome: {
          kind: "unknown",
          reason: "interrupted value-moving attempt has an unknown outcome",
        },
        record: JSON.parse(
          encode({
            ...stored(
              transitionMakerReservation(
                transitionMakerReservation(
                  transitionMakerReservation(
                    createMakerReservation({
                      reservationId: RESERVATION_ID,
                      makerId: "maker-a",
                      intentDigest: INTENT_DIGEST,
                      rfqDigest: RFQ_DIGEST,
                      asset: "0x123",
                      amountBaseUnits: 12345678901234567890n,
                      createdAt: NOW,
                      expiresAt: NOW + 300,
                      fence: 1n,
                    }),
                    {
                      kind: "select",
                      expectedFence: 1n,
                      at: NOW + 1,
                      quoteDigest: QUOTE_DIGEST,
                    },
                  ),
                  {
                    kind: "begin-fill",
                    expectedFence: 2n,
                    at: NOW + 2,
                    settlementAttemptId: ATTEMPT_ID,
                  },
                ),
                {
                  kind: "quarantine",
                  expectedFence: 3n,
                  at: NOW + 10,
                  reason:
                    "interrupted value-moving attempt has an unknown outcome",
                },
              ),
            ),
          }),
        ),
      },
    ],
  });
  assert.equal(first.sql.records.get(RESERVATION_ID)?.state, "quarantined");
  assert.equal(first.sql.attempts.get(ATTEMPT_ID)?.status, "completed");
});

test("pending recovery rolls back atomically if durable state is inconsistent", async () => {
  const first = durableObject();
  await createAndSelect(first.target);
  assert.equal(
    (await post(first.target, "/attempt/begin", attempt)).status,
    201,
  );
  const invalidAttemptId = `0x${"ff".repeat(32)}`;
  first.sql.attempts.set(invalidAttemptId, {
    idempotency_key: invalidAttemptId,
    reservation_id: `0x${"ee".repeat(32)}`,
    selection_fence: "9",
    payload_digest: `0x${"dd".repeat(32)}`,
    status: "pending",
    outcome_json: null,
  });

  const restarted = durableObject(first.sql);
  const response = await post(restarted.target, "/attempt/recover", {
    at: NOW + 10,
  });
  assert.equal(response.status, 409);
  assert.equal(first.sql.records.get(RESERVATION_ID)?.state, "filling");
  assert.equal(first.sql.attempts.get(ATTEMPT_ID)?.status, "pending");
  assert.equal(first.sql.metadata.revision, 3);
});

// Restore / failover / resume evidence. These tests prove in-repo Durable Object
// SQLite semantics. A single Cloudflare account is one administrative domain, so
// this strengthens durability evidence without closing P0-16 or the P1-04 / P1-06
// partials. There is no operator-controlled PITR, retention, cross-region failover,
// or independently administered replica in this repository.

test("crash restoration reloads committed records and high-water from persisted SQLite", async () => {
  const first = durableObject();
  await createAndSelect(first.target);
  const beforeCrash = await snapshot(first.target);
  assert.equal(beforeCrash.revision, 2);
  assert.equal(beforeCrash.highWater, "2");
  assert.equal(beforeCrash.records.length, 1);
  assert.equal(beforeCrash.records[0]?.reservation.state, "selected");
  assert.deepEqual(beforeCrash.records[0]?.reservation.fence, {
    $app20BigInt: "2",
  });

  const restarted = restartReservationLedgerHarness(first.sql);
  assert.notEqual(restarted.sql, first.sql);
  const restored = await snapshot(restarted.target);
  assert.deepEqual(restored, beforeCrash);
  assert.equal(restarted.sql.metadata.revision, 2);
  assert.equal(restarted.sql.metadata.high_water, "2");
  assert.equal(restarted.sql.records.get(RESERVATION_ID)?.state, "selected");
});

test("fence high-water stays monotonic across a crash restart", async () => {
  const first = durableObject();
  await createAndSelect(first.target);
  const restarted = restartReservationLedgerHarness(first.sql);

  const reused = await post(restarted.target, "/commit", {
    expectedRevision: 2,
    mutations: [
      {
        record: stored(newReservation(SECOND_RESERVATION_ID, 1n)),
        expectedFence: null,
      },
    ],
  });
  assert.equal(reused.status, 409);
  assert.match(await reused.text(), /next durable high-water token/i);

  const collision = await post(restarted.target, "/commit", {
    expectedRevision: 2,
    mutations: [
      {
        record: stored(newReservation(SECOND_RESERVATION_ID, 2n)),
        expectedFence: null,
      },
    ],
  });
  assert.equal(collision.status, 409);
  assert.match(await collision.text(), /next durable high-water token/i);

  const accepted = await post(restarted.target, "/commit", {
    expectedRevision: 2,
    mutations: [
      {
        record: stored(newReservation(SECOND_RESERVATION_ID, 3n)),
        expectedFence: null,
      },
    ],
  });
  assert.equal(accepted.status, 200, await accepted.text());
  const restored = await snapshot(restarted.target);
  assert.equal(restored.revision, 3);
  assert.equal(restored.highWater, "3");
  assert.equal(first.sql.metadata.high_water, "2");
});

test("duplicate attempt IDs replay the original consumed outcome after crash restoration", async () => {
  const first = durableObject();
  await createAndSelect(first.target);
  assert.equal(
    (await post(first.target, "/attempt/begin", attempt)).status,
    201,
  );
  const completion = {
    ...attempt,
    at: NOW + 3,
    outcome: { kind: "consumed", transactionHash: "0x1234" },
  };
  assert.equal(
    (await post(first.target, "/attempt/complete", completion)).status,
    200,
  );

  const restarted = restartReservationLedgerHarness(first.sql);
  const replayComplete = await post(restarted.target, "/attempt/complete", {
    ...completion,
    outcome: { kind: "unknown", reason: "must not replace original" },
  });
  assert.equal(replayComplete.status, 200);
  assert.deepEqual(
    ((await replayComplete.json()) as { outcome: unknown }).outcome,
    { kind: "consumed", transactionHash: "0x1234" },
  );

  const replayBegin = await post(restarted.target, "/attempt/begin", attempt);
  assert.equal(replayBegin.status, 200);
  assert.deepEqual(
    ((await replayBegin.json()) as { outcome: unknown }).outcome,
    { kind: "consumed", transactionHash: "0x1234" },
  );
  const restored = await snapshot(restarted.target);
  assert.equal(restored.records[0]?.reservation.state, "consumed");
});

test("duplicate begin of a pending attempt after restart quarantines and never reclaims", async () => {
  const first = durableObject();
  await createAndSelect(first.target);
  assert.equal(
    (await post(first.target, "/attempt/begin", attempt)).status,
    201,
  );

  const restarted = restartReservationLedgerHarness(first.sql);
  const replay = await post(restarted.target, "/attempt/begin", attempt);
  assert.equal(replay.status, 200);
  const body = (await replay.json()) as {
    kind: string;
    outcome: { kind: string; reason: string };
  };
  assert.equal(body.kind, "replay");
  assert.equal(body.outcome.kind, "unknown");
  assert.match(body.outcome.reason, /unknown outcome/i);

  const restored = await snapshot(restarted.target);
  assert.equal(restored.records[0]?.reservation.state, "quarantined");
  assert.equal(restarted.sql.attempts.get(ATTEMPT_ID)?.status, "completed");
  const reclaim = await post(restarted.target, "/attempt/begin", attempt);
  assert.equal(reclaim.status, 200);
  assert.deepEqual(
    ((await reclaim.json()) as { outcome: unknown }).outcome,
    body.outcome,
  );
});

test("explicit release remains durable across crash restoration and cannot be rewritten", async () => {
  const first = durableObject();
  const selected = await createAndSelect(first.target);
  const released = transitionMakerReservation(selected, {
    kind: "release",
    expectedFence: selected.fence,
    at: NOW + 2,
    reason: "cancelled",
  });
  const releaseResponse = await post(first.target, "/commit", {
    expectedRevision: 2,
    mutations: [{ record: stored(released), expectedFence: "2" }],
  });
  assert.equal(releaseResponse.status, 200, await releaseResponse.text());

  const restarted = restartReservationLedgerHarness(first.sql);
  const restored = await snapshot(restarted.target);
  assert.equal(restored.records[0]?.reservation.state, "released");
  assert.equal(restored.highWater, "3");

  const resurrected = {
    ...released,
    state: "selected" as const,
    updatedAt: NOW + 3,
    fence: 4n,
    terminalReason: undefined,
  };
  const rewrite = await post(restarted.target, "/commit", {
    expectedRevision: 3,
    mutations: [{ record: stored(resurrected), expectedFence: "3" }],
  });
  assert.equal(rewrite.status, 409);
  assert.match(
    await rewrite.text(),
    /terminal reservation state cannot transition/i,
  );
  assert.equal(
    (await snapshot(restarted.target)).records[0]?.reservation.state,
    "released",
  );
});

test("a storage write failure mid-commit rolls back atomically and remains retryable", async () => {
  const { target, sql } = durableObject();
  sql.failAfterSuccessfulMutations(1);
  const failed = await post(target, "/commit", {
    expectedRevision: 0,
    mutations: [
      {
        record: stored(newReservation(RESERVATION_ID, 1n)),
        expectedFence: null,
      },
    ],
  });
  assert.equal(failed.status, 503);
  assert.match(await failed.text(), /storage write failed/i);
  assert.equal(sql.metadata.revision, 0);
  assert.equal(sql.metadata.high_water, "0");
  assert.equal(sql.records.size, 0);

  const retry = await post(target, "/commit", {
    expectedRevision: 0,
    mutations: [
      {
        record: stored(newReservation(RESERVATION_ID, 1n)),
        expectedFence: null,
      },
    ],
  });
  assert.equal(retry.status, 200, await retry.text());
  assert.equal(sql.metadata.revision, 1);
  assert.equal(sql.records.get(RESERVATION_ID)?.state, "reserved");
});

test("a storage write failure mid-attempt does not claim the reservation", async () => {
  const { target, sql } = durableObject();
  await createAndSelect(target);
  sql.failAfterSuccessfulMutations(1);
  const failed = await post(target, "/attempt/begin", attempt);
  assert.equal(failed.status, 503);
  assert.equal(sql.records.get(RESERVATION_ID)?.state, "selected");
  assert.equal(sql.attempts.size, 0);
  assert.equal(sql.metadata.revision, 2);

  const retry = await post(target, "/attempt/begin", attempt);
  assert.equal(retry.status, 201, await retry.text());
  assert.equal(sql.records.get(RESERVATION_ID)?.state, "filling");
  assert.equal(sql.attempts.get(ATTEMPT_ID)?.status, "pending");
});

test("a storage write failure mid-completion leaves the attempt pending and does not consume", async () => {
  const { target, sql } = durableObject();
  await createAndSelect(target);
  assert.equal((await post(target, "/attempt/begin", attempt)).status, 201);
  sql.failAfterSuccessfulMutations(1);
  const completion = {
    ...attempt,
    at: NOW + 3,
    outcome: { kind: "consumed", transactionHash: "0x1234" },
  };
  const failed = await post(target, "/attempt/complete", completion);
  assert.equal(failed.status, 503);
  assert.equal(sql.records.get(RESERVATION_ID)?.state, "filling");
  assert.equal(sql.attempts.get(ATTEMPT_ID)?.status, "pending");
  assert.equal(sql.attempts.get(ATTEMPT_ID)?.outcome_json, null);

  const retry = await post(target, "/attempt/complete", completion);
  assert.equal(retry.status, 200, await retry.text());
  assert.equal(sql.records.get(RESERVATION_ID)?.state, "consumed");
  assert.equal(sql.attempts.get(ATTEMPT_ID)?.status, "completed");
});
