import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  buildLocalnetMakerLockActions,
  buildLocalnetMakerSettlementActions,
  parseLocalnetEscrowLockResult,
  requestLocalnetMakerGet,
} from "./localnet-maker-http.mjs";

const ESCROW = "0xe";
const RECOVERY = "0xf";

const lockRequest = Object.freeze({
  lockId: "0x7",
  ticket: "0x9",
  rfqFelt: "0x3",
  takerCommitment: "0x4",
  tokenA: "0x1",
  tokenB: "0x2",
  schedule: Object.freeze([
    Object.freeze({ a: 10n, b: 20n }),
    Object.freeze({ a: 30n, b: 40n }),
  ]),
  expiry: 100,
});

test("maker lock actions preserve the Cairo v3 calldata order and zero padding", () => {
  assert.deepEqual(
    buildLocalnetMakerLockActions(lockRequest, {
      escrowAddress: ESCROW,
      recoveryAddress: RECOVERY,
    }),
    [
      {
        type: "withdraw",
        token: "0x2",
        amount: "0x28",
        recipient: ESCROW,
      },
      {
        type: "transfer",
        token: "0x9",
        amount: "OPEN",
        recipient: RECOVERY,
      },
      {
        type: "invoke",
        contract: ESCROW,
        calldata: [
          "0x4",
          "0x2",
          "0x1",
          "0x3",
          "0x4",
          "0x64",
          "0x2",
          "0xa",
          "0x14",
          "0x1e",
          "0x28",
          "0x0",
          "0x0",
          "0x0",
          "0x0",
          "0x7",
          "${poolAddress}",
          "${openNoteIds[0]}",
        ],
      },
    ],
  );
});

test("maker settlement actions spend one LockTicket and select operations 6 and 7", () => {
  for (const [operation, outputToken] of [
    ["0x6", "0x1"],
    ["0x7", "0x2"],
  ]) {
    assert.deepEqual(
      buildLocalnetMakerSettlementActions(
        {
          operation,
          lockId: "0x7",
          ticket: "0x9",
          outputToken,
        },
        { escrowAddress: ESCROW, recoveryAddress: RECOVERY },
      ),
      [
        {
          type: "withdraw",
          token: "0x9",
          amount: "0x1",
          recipient: ESCROW,
        },
        {
          type: "transfer",
          token: outputToken,
          amount: "OPEN",
          recipient: RECOVERY,
        },
        {
          type: "invoke",
          contract: ESCROW,
          calldata: [
            operation,
            "0x7",
            "${poolAddress}",
            "${openNoteIds[0]}",
          ],
        },
      ],
    );
  }
});

test("maker GET helper preserves top-level v3 response contracts and Bearer auth", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer fixture-token");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ locks: [{ lockId: "0x7" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    await assert.doesNotReject(async () => {
      assert.deepEqual(
        await requestLocalnetMakerGet(
          {
            endpoint: `http://127.0.0.1:${address.port}`,
            authToken: "fixture-token",
            solverId: "maker-a",
          },
          "/v1/locks",
        ),
        { locks: [{ lockId: "0x7" }] },
      );
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("get_lock parser maps all 20 Cairo fields and rejects malformed state", () => {
  const result = [
    "0x1",
    "0x2",
    "0x3",
    "0x4",
    "0x64",
    "0x2",
    "0xa",
    "0x14",
    "0x1e",
    "0x28",
    "0x0",
    "0x0",
    "0x0",
    "0x0",
    "0x28",
    "0x0",
    "0x9",
    "0x0",
    "0x0",
    "0x1",
  ];
  assert.deepEqual(parseLocalnetEscrowLockResult(result), {
    tokenA: "0x1",
    tokenB: "0x2",
    rfqId: "0x3",
    takerCommitment: "0x4",
    expiry: 100,
    schedule: [
      { a: 10n, b: 20n },
      { a: 30n, b: 40n },
    ],
    remainingB: 40n,
    earnedA: 0n,
    ticket: "0x9",
    proceedsSettled: false,
    collateralReleased: false,
    status: "open",
  });
  assert.throws(
    () => parseLocalnetEscrowLockResult(result.slice(0, 19)),
    /exactly 20 felts/i,
  );
  assert.throws(
    () =>
      parseLocalnetEscrowLockResult(
        result.map((value, index) => (index === 17 ? "0x2" : value)),
      ),
    /Cairo boolean/i,
  );
  assert.throws(
    () =>
      buildLocalnetMakerLockActions(
        { ...lockRequest, schedule: [{ a: 10n, b: 0n }] },
        { escrowAddress: ESCROW, recoveryAddress: RECOVERY },
      ),
    /BAD_SCHEDULE/i,
  );
});
