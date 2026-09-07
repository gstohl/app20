import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalnetSettlementActions, assertLocalnetSettlementRoute } from "./localnet-settlement-policy.mjs";

const scope = { escrowAddress: "0xe5c", mailHelperAddress: "0xc4a7", strkAddress: "0x4718" };
const open = { type: "transfer", token: scope.strkAddress, amount: "OPEN", recipient: "0xa11ce" };
const payment = { type: "transfer", token: "0xa55e7", amount: "0x19", recipient: "0xb0b" };
const memo = { type: "compute_and_invoke", contract: scope.mailHelperAddress, compute_calldata: [scope.strkAddress, "0x0"], invoke_calldata: [scope.strkAddress, "${poolAddress}", "0x0"] };
const fund = { type: "withdraw", token: scope.strkAddress, recipient: scope.mailHelperAddress, amount: "0x7" };
const legacyMessage = { type: "invoke", contract: scope.mailHelperAddress, calldata: [scope.strkAddress, "${poolAddress}", "${openNoteIds[0]}"] };
const check = actions => assertLocalnetSettlementActions(actions, scope);

test("raw start routes reject before request parsing, quotes, ticket deployment or funding", () => {
  for (const route of ["/escrow/ensure-mail-ticket", "/escrow/ensure-ticket", "/private-intents/quotes",
    "/private-intents/select-quote", "/private-intents/transcript", "/private-intents/sign-quote",
    "/private-intents/funding-prepare", "/private-intents/take-prepare", "/private-intents/solve"]) {
    assert.throws(() => assertLocalnetSettlementRoute(route), /Confidential settlement is required/);
  }
});

test("raw recovery and observation routes remain available", () => {
  for (const route of ["/private-intents/expire", "/private-intents/release-intent",
    "/private-intents/funding-observe", "/private-intents/take-converge", "/escrow/deal", "/privacy"]) {
    assertLocalnetSettlementRoute(route);
  }
});

for (const operation of [0, 1, 4, 5]) {
  for (const type of ["invoke", "compute_and_invoke"]) {
    test(`raw ${type} rejects public escrow operation ${operation}`, () => {
      const call = { type, contract: "0x0e5c", [type === "invoke" ? "calldata" : "invoke_calldata"]: [String(operation)] };
      assert.throws(() => check([call]), /Confidential settlement is required/);
    });
  }
}

for (const operation of [2, 3, 6, 7]) {
  test(`historical payout operation ${operation} remains available`, () => {
    check([{ type: "withdraw", token: "0x71c", amount: "0x1", recipient: scope.escrowAddress }, open,
      { type: "invoke", contract: scope.escrowAddress, calldata: [String(operation)] }]);
  });
}

test("zero-valued historical lock recovery needs no OPEN note", () => {
  check([{ type: "withdraw", token: "0x71c", amount: "0x1", recipient: scope.escrowAddress },
    { type: "invoke", contract: scope.escrowAddress, calldata: ["0x6"] }]);
});

test("private payments and unfunded message helpers remain available", () => {
  check([payment]);
  check([payment, memo]);
  check([memo]);
  check([fund, open, legacyMessage]);
  check([{ type: "deposit", token: scope.strkAddress, amount: "0x19" }]);
  check([{ type: "withdraw", token: scope.strkAddress, amount: "0x19", recipient: "0xa11ce" }]);
});

test("a numeric payment cannot acquire public funding or OPEN output", () => {
  for (const extra of [fund, open, { type: "deposit", token: payment.token, amount: payment.amount }]) {
    assert.throws(() => check([payment, extra, memo]), /encrypted notes only/);
  }
});

test("public helper parameters cannot disclose the payment asset", () => {
  assert.throws(() => check([payment, { ...memo, invoke_calldata: [payment.token, "${poolAddress}", "0x0"] }]), /Unsupported legacy settlement/);
  assert.throws(() => check([payment, { ...memo, compute_calldata: [payment.token, "0x0"] }]), /Unsupported legacy settlement/);
});

test("message allowance cannot fund arbitrary contracts or amounts", () => {
  assert.throws(() => check([{ ...fund, amount: "0x19" }, open, legacyMessage]), /Unsupported legacy settlement/);
  assert.throws(() => check([fund, open, { ...legacyMessage, contract: "0x999" }]), /Unsupported legacy settlement/);
  assert.throws(() => check([payment, { ...memo, contract: "0x999" }]), /Unsupported legacy settlement/);
  assert.throws(() => check([fund, open, legacyMessage, memo]), /Unsupported legacy settlement/);
});

test("a recovery label cannot hide additional funding or numeric payments", () => {
  const ticket = { type: "withdraw", token: "0x71c", amount: "0x1", recipient: scope.escrowAddress };
  const claim = { type: "invoke", contract: scope.escrowAddress, calldata: ["0x2"] };
  assert.throws(() => check([{ ...ticket, amount: "0x19" }, open, claim]), /Unsupported legacy settlement/);
  assert.throws(() => check([ticket, fund, open, claim]), /Unsupported legacy settlement/);
  assert.throws(() => check([payment, claim]), /encrypted notes only/);
});
