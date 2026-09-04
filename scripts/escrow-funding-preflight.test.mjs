import assert from "node:assert/strict";
import { test } from "node:test";
import {
  withEscrowFundingPreflight,
  withHelperFundingPreflight,
} from "./escrow-funding-preflight.mjs";

const escrow = "0xe5c";
const token = "0xaaa";
const poolCall = Object.freeze({
  contractAddress: "0x123",
  entrypoint: "apply_actions",
  calldata: ["0x1"],
});
const proof = Object.freeze({ data: undefined, proofFacts: ["0x2"] });
const prepared = Object.freeze({ call: poolCall, proof });
const fund = (operation = "0x0", contract = escrow, asset = token) => ({
  type: "invoke",
  contract,
  calldata: [operation, asset],
});

test("Fund, Fill, Lock and Take prepare before the proved pool call without changing the proof", () => {
  for (const operation of ["0x0", "0x1", "0x4", "0x5"]) {
    const result = withEscrowFundingPreflight(
      prepared,
      [fund(operation)],
      escrow,
    );
    assert.deepEqual(result.call, [
      {
        contractAddress: escrow,
        entrypoint: "prepare_funding",
        calldata: [token],
      },
      poolCall,
    ]);
    assert.equal(result.call[1], poolCall);
    assert.equal(result.proof, proof);
    assert.equal(prepared.call, poolCall);
  }
});

test("protected Take reads invoke_calldata, not compute_calldata", () => {
  const result = withEscrowFundingPreflight(
    prepared,
    [
      {
        type: "compute_and_invoke",
        contract: escrow,
        compute_calldata: [],
        invoke_calldata: ["0x5", token],
      },
    ],
    escrow,
  );
  assert.deepEqual(result.call[0].calldata, [token]);
});

test("settlements, deposits, and unrelated helpers need no preflight", () => {
  const actions = [
    ...["0x2", "0x3", "0x6", "0x7"].map((operation) => fund(operation)),
    fund("0x0", "0xabc"),
    { type: "deposit", token, amount: "0x10" },
    { type: "withdraw", token, amount: "0x10", recipient: escrow },
  ];
  assert.equal(withEscrowFundingPreflight(prepared, actions, escrow), prepared);
  assert.equal(withEscrowFundingPreflight(prepared, [], undefined), prepared);
});

test("canonical addresses match and distinct token preflights preserve an existing call array", () => {
  const result = withEscrowFundingPreflight(
    { ...prepared, call: [poolCall] },
    [fund("0x0", "0x0E5C", "2730"), fund("0x4", escrow, "0xbbb")],
    escrow,
  );
  assert.deepEqual(
    result.call.map((call) => call.entrypoint),
    ["prepare_funding", "prepare_funding", "apply_actions"],
  );
  assert.deepEqual(result.call[0].calldata, [token]);
  assert.deepEqual(result.call[1].calldata, ["0xbbb"]);
});

test("multiple funded operations for one token reject the unsupported batch", () => {
  assert.throws(
    () =>
      withEscrowFundingPreflight(
        prepared,
        [fund(), fund("0x4", escrow, "2730")],
        escrow,
      ),
    /one funded operation per helper\/token/,
  );
});

test("malformed funded calldata fails closed before submission", () => {
  for (const asset of [
    undefined,
    "0x0",
    "${openNoteIds[0]}",
    "-1",
    (1n << 251n).toString(),
  ]) {
    assert.throws(
      () =>
        withEscrowFundingPreflight(
          prepared,
          [{ type: "invoke", contract: escrow, calldata: ["0x0", asset] }],
          escrow,
        ),
      /Invalid funding token/,
    );
  }
  assert.throws(
    () =>
      withEscrowFundingPreflight(
        prepared,
        [{ type: "invoke", contract: escrow, calldata: [] }],
        escrow,
      ),
    /Missing escrow invocation/,
  );
  assert.throws(
    () => withEscrowFundingPreflight(prepared, [fund("not-a-felt")], escrow),
    /Invalid escrow operation/,
  );
});

test("Mail prepares only for a withdrawal to the configured helper and token", () => {
  const mail = "0xabc";
  for (const type of ["invoke", "compute_and_invoke"]) {
    const action = {
      type,
      contract: mail,
      ...(type === "invoke"
        ? { calldata: [token] }
        : { compute_calldata: [], invoke_calldata: [token] }),
    };
    const withdrawal = {
      type: "withdraw",
      recipient: mail,
      token,
      amount: "0x7",
    };
    const result = withHelperFundingPreflight(prepared, [withdrawal, action], {
      mailHelperAddress: mail,
    });
    assert.deepEqual(result.call[0], {
      contractAddress: mail,
      entrypoint: "prepare_funding",
      calldata: [token],
    });
    for (const actions of [
      [action],
      [{ ...withdrawal, recipient: escrow }, action],
      [{ ...withdrawal, token: "0xbbb" }, action],
    ]) {
      assert.equal(
        withHelperFundingPreflight(prepared, actions, {
          mailHelperAddress: mail,
        }),
        prepared,
      );
    }
  }
});

test("Mail and escrow snapshots for the same token are independent", () => {
  const mail = "0xabc";
  const result = withHelperFundingPreflight(
    prepared,
    [
      fund(),
      { type: "withdraw", recipient: mail, token, amount: "0x7" },
      { type: "invoke", contract: mail, calldata: [token] },
    ],
    { escrowAddress: escrow, mailHelperAddress: mail },
  );
  assert.deepEqual(
    result.call.map((call) => call.contractAddress),
    [escrow, mail, poolCall.contractAddress],
  );
});
