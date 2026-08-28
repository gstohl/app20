import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocalnetDealImmutableTerms,
  assertLocalnetDealPhase,
  validateLocalnetDealObservation,
} from "./localnet-deal-validator.mjs";

const terms = Object.freeze({
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
    deadline: 1_900_000_600,
    ticket: "0xabc",
  };
}

test("production validator accepts exact statuses 1/2/3/4", () => {
  for (const status of [1, 2, 3, 4]) {
    assert.equal(
      validateLocalnetDealObservation(deal(status), terms, status).status,
      status,
    );
  }
});

test("immutable term and phase checks are independent", () => {
  assert.doesNotThrow(() => assertLocalnetDealImmutableTerms(deal(3), terms));
  assert.doesNotThrow(() => assertLocalnetDealPhase(deal(3), 3));
  assert.throws(() => assertLocalnetDealPhase(deal(3), 2), /phase mismatch/i);
  assert.throws(
    () =>
      assertLocalnetDealImmutableTerms(
        { ...deal(3), deadline: terms.deadline + 1 },
        terms,
      ),
    /immutable terms/i,
  );
});

test("status 2 and 3 require the exact committed output amount", () => {
  for (const status of [2, 3]) {
    assert.throws(
      () =>
        validateLocalnetDealObservation(
          { ...deal(status), legBAmount: 199n },
          terms,
          status,
        ),
      /filled output amount/i,
    );
  }
  assert.doesNotThrow(() =>
    validateLocalnetDealObservation(
      { ...deal(4), legBAmount: 0n },
      terms,
      4,
    ),
  );
});
