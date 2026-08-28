import assert from "node:assert/strict";
import test from "node:test";
import { dispatchLocalnetMakerFill } from "./localnet-maker-http.mjs";
import { validateLocalnetDealObservation } from "./localnet-deal-validator.mjs";
import { runLocalnetSolve } from "./localnet-solve-handler.mjs";

const target = Object.freeze({
  reservationId: `0x${"11".repeat(32)}`,
  intentDigest: `0x${"22".repeat(32)}`,
  fence: "7",
  quoteDigest: `0x${"33".repeat(32)}`,
  dealId: "0x77",
  sellToken: "0x1",
  sellAmount: 100n,
  buyToken: "0x2",
  buyAmount: 200n,
  deadline: 1_900_000_600,
  ticketAddress: "0xabc",
});

function deal(status) {
  return {
    status,
    legAToken: "0x1",
    legAAmount: 100n,
    legBToken: "0x2",
    legBTerms: 200n,
    legBAmount: status === 2 || status === 3 ? 200n : 0n,
    deadline: target.deadline,
    ticket: "0xabc",
  };
}

function makerExactlyOnce() {
  let effectCalls = 0;
  let completed;
  return {
    maker: {
      async fill(request) {
        const canonical = JSON.stringify(request, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        );
        if (completed) {
          if (completed.canonical !== canonical)
            throw new Error("exact fill retry changed immutable terms");
          return completed.result;
        }
        effectCalls += 1;
        const result = { transactionHash: "0xf11" };
        completed = { canonical, result };
        return result;
      },
    },
    effects: () => effectCalls,
  };
}

test("production /solve composition reconciles committed status 2 and claimed status 3 without another maker effect", async () => {
  const exactMaker = makerExactlyOnce();
  let coordinatorState = "funded";
  const invoke = (status) =>
    runLocalnetSolve({
      target,
      observed: deal(status),
      validateObservation: (exact, observed, expectedStatus) =>
        validateLocalnetDealObservation(observed, exact, expectedStatus),
      bind: async () => undefined,
      submitExact: (exact) =>
        dispatchLocalnetMakerFill(
          exactMaker.maker,
          {
            ...exact,
            sellAmount: exact.sellAmount.toString(),
            buyAmount: exact.buyAmount.toString(),
          },
          1_900_000_001,
        ),
      reconcileCommitted: async (_exact, observedStatus) => {
        coordinatorState = observedStatus === 3 ? "settled" : "filled";
      },
    });

  assert.deepEqual(await invoke(1), { transactionHash: "0xf11" });
  assert.equal(exactMaker.effects(), 1);
  assert.equal(coordinatorState, "filled");

  // The first response can be lost after the on-chain fill. Exact retries see
  // status 2, and after the user claim they may see status 3.
  assert.deepEqual(await invoke(2), { transactionHash: "0xf11" });
  assert.deepEqual(await invoke(3), { transactionHash: "0xf11" });
  assert.equal(coordinatorState, "settled");
  assert.equal(exactMaker.effects(), 1);
});

test("production /solve composition rejects refund status and mutated output before maker dispatch", async () => {
  const exactMaker = makerExactlyOnce();
  const submitExact = (exact) =>
    dispatchLocalnetMakerFill(
      exactMaker.maker,
      {
        ...exact,
        sellAmount: exact.sellAmount.toString(),
        buyAmount: exact.buyAmount.toString(),
      },
      1_900_000_001,
    );
  const common = {
    target,
    validateObservation: (exact, observed, expectedStatus) =>
      validateLocalnetDealObservation(observed, exact, expectedStatus),
    bind: async () => undefined,
    submitExact,
    reconcileCommitted: async () => undefined,
  };
  await assert.rejects(
    runLocalnetSolve({ ...common, observed: deal(4) }),
    /neither awaiting fill nor.*retry/i,
  );
  await assert.rejects(
    runLocalnetSolve({
      ...common,
      observed: { ...deal(2), legBAmount: 199n },
    }),
    /filled output amount/i,
  );
  assert.equal(exactMaker.effects(), 0);
});
