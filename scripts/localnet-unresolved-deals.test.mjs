import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listBrowserSafeUnresolvedLocalnetDeals,
  listBrowserSafeUnresolvedLocalnetV3Deals,
} from "./localnet-unresolved-deals.mjs";

const digest = `0x${"11".repeat(32)}`;
const reservationId = `0x${"22".repeat(32)}`;
const quoteDigest = `0x${"33".repeat(32)}`;
const account = "0xa11ce";
const chainId = "0x123";
const market = "0x1/0x2";
const request = {
  intentDigest: digest,
  rfqId: "0x77",
  account,
  chainId,
  market,
  createdAt: 100,
  expiresAt: 200,
  state: "funded",
  fundingAttemptId: "fund-attempt",
  selection: {
    reservationId,
    makerId: "maker-a",
    fence: "7",
    quoteDigest,
  },
  settlementTerms: {
    sellToken: "0x1",
    sellAmount: "100",
    buyToken: "0x2",
    buyAmount: "99",
    deadline: 200,
    ticketAddress: "0x44",
  },
  // These server-only fields must never be projected.
  rawInventory: "secret inventory",
  privateKey: "secret key",
};
const deal = {
  intentDigest: digest,
  rfqId: "0x77",
  account,
  chainId,
  dealId: "0x77",
  reservationId,
  makerId: "maker-a",
  fence: "7",
  quoteDigest,
};

function observation(status) {
  return {
    status,
    legAToken: "0x1",
    legAAmount: 100n,
    legBToken: "0x2",
    legBTerms: 99n,
    legBAmount: status === 2 ? 99n : 0n,
    deadline: 200,
    ticket: "0x44",
  };
}

test("projects only account-bound unresolved deal recovery metadata", async () => {
  let validated = false;
  const result = await listBrowserSafeUnresolvedLocalnetDeals({
    requests: [request, { ...request, account: "0xb0b" }],
    deals: [deal],
    account,
    chainId,
    market,
    escrowAddress: "0xe5c",
    observeEscrow: async () => observation(2),
    validateObservation: (_observed, terms, status) => {
      validated = true;
      assert.equal(status, 2);
      assert.equal(terms.ticketAddress, "0x44");
    },
  });
  assert.equal(validated, true);
  assert.equal(result.length, 1);
  assert.equal(result[0].authority, "server-derived-resume-only");
  assert.equal(result[0].observation.legBAmount, "99");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /rawInventory|privateKey|secret inventory|secret key/);
});

test("projects exact v3 take leases without lock secrets and validates any observed take", async () => {
  let validated = 0;
  const result = await listBrowserSafeUnresolvedLocalnetV3Deals({
    requests: [
      {
        lifecycle: "v3",
        rfqDigest: `0x${"44".repeat(32)}`,
        intentDigest: digest,
        rfqId: "0x88",
        account,
        chainId,
        market,
        createdAt: 100,
        expiresAt: 200,
        state: "take-unknown",
        takeAttemptId: "take-attempt",
        takeTransactionHash: "0xabc",
        expected: {
          tokenA: "0x1",
          totalA: "100",
          tokenB: "0x2",
          totalB: "200",
          fills: [{ lockId: "0xa", amountA: "100", amountB: "200" }],
        },
        takerSecret: "must never be projected",
      },
    ],
    account,
    chainId,
    market,
    escrowAddress: "0xe5c",
    observeTake: async () => ({
      tokenA: "0x1",
      totalA: 100n,
      tokenB: "0x2",
      totalB: 200n,
      fillCount: 1,
      takenAt: 150,
    }),
    validateObservation: (_observed, expected) => {
      validated += 1;
      assert.equal(expected.fills[0].lockId, "0xa");
    },
  });
  assert.equal(validated, 1);
  assert.equal(result[0].lifecycle, "v3");
  assert.equal(result[0].transactions.take, "0xabc");
  assert.equal(result[0].take.totalB, "200");
  assert.doesNotMatch(JSON.stringify(result), /takerSecret|must never/);
});

test("omits empty and already-terminal escrow rows", async () => {
  for (const status of [0, 3, 4]) {
    const result = await listBrowserSafeUnresolvedLocalnetDeals({
      requests: [request],
      deals: [deal],
      account,
      chainId,
      market,
      escrowAddress: "0xe5c",
      observeEscrow: async () => observation(status),
      validateObservation: () => {
        throw new Error("terminal observations must not be projected");
      },
    });
    assert.deepEqual(result, []);
  }
});
