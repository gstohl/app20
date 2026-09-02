import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertLocalnetMutationGuards,
  assertLocalnetRuntimeEpoch,
  LocalnetMutationGuardError,
} from "./localnet-control-auth.mjs";

const ORIGIN = "http://127.0.0.1:5173";
const TOKEN = "control-token-with-at-least-thirty-two-bytes";

function request(headers = {}, method = "POST") {
  return { method, headers };
}

function statusOf(operation) {
  try {
    operation();
    return 200;
  } catch (error) {
    assert.ok(error instanceof LocalnetMutationGuardError);
    return error.status;
  }
}

test("text/plain and missing Origin mutations fail closed", () => {
  assert.equal(
    statusOf(() =>
      assertLocalnetMutationGuards(
        request({
          "content-type": "text/plain",
          origin: ORIGIN,
          "x-app20-localnet-control": TOKEN,
        }),
        { expectedOrigin: ORIGIN, controlToken: TOKEN },
      ),
    ),
    415,
  );
  assert.equal(
    statusOf(() =>
      assertLocalnetMutationGuards(
        request({
          "content-type": "application/json",
          "x-app20-localnet-control": TOKEN,
        }),
        { expectedOrigin: ORIGIN, controlToken: TOKEN },
      ),
    ),
    403,
  );
});

test("a forged Host does not compensate for the wrong Origin", () => {
  assert.equal(
    statusOf(() =>
      assertLocalnetMutationGuards(
        request({
          host: "127.0.0.1:5173",
          origin: "https://attacker.invalid",
          "content-type": "application/json",
          "x-app20-localnet-control": TOKEN,
        }),
        { expectedOrigin: ORIGIN, controlToken: TOKEN },
      ),
    ),
    403,
  );
});

test("same-origin proxied JSON with the per-run control header passes", () => {
  assert.doesNotThrow(() =>
    assertLocalnetMutationGuards(
      request({
        origin: ORIGIN,
        "content-type": "application/json; charset=utf-8",
        "sec-fetch-site": "same-origin",
        "x-app20-localnet-control": TOKEN,
      }),
      { expectedOrigin: ORIGIN, controlToken: TOKEN },
    ),
  );
  assert.equal(
    statusOf(() =>
      assertLocalnetMutationGuards(
        request({
          origin: ORIGIN,
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
          "x-app20-localnet-control": TOKEN,
        }),
        { expectedOrigin: ORIGIN, controlToken: TOKEN },
      ),
    ),
    403,
  );
});

test("prior runtime epochs reject every wallet, RFQ, and ticket sink before parsing", () => {
  const sinks = { identity: 0, execute: 0, privacy: 0, balances: 0 };
  const dispatch = (path, body, expectedEpoch) => {
    assertLocalnetRuntimeEpoch(path, body, expectedEpoch);
    sinks.identity += 1;
    if (path === "/invoke") sinks.execute += 1;
    if (path === "/privacy") sinks.privacy += 1;
    if (path === "/balances") sinks.balances += 1;
  };
  const paths = [
    "/invoke",
    "/privacy",
    "/balances",
    "/private-intents/solve",
    "/private-intents/converge",
    "/escrow/ensure-ticket",
    "/escrow/ensure-mail-ticket",
    "/escrow/lock",
    "/escrow/take",
    "/devnet/create-block",
    "/private-intents/transcript",
    "/private-intents/take-prepare",
    "/private-intents/take-converge",
    "/rfq/authority/verify",
  ];
  for (const path of paths) {
    assert.throws(
      () => dispatch(path, { runtimeEpoch: "prior" }, "current"),
      (error) =>
        error instanceof LocalnetMutationGuardError &&
        error.status === 409 &&
        /stale localnet runtime epoch/i.test(error.message),
    );
    assert.doesNotThrow(() =>
      dispatch(path, { runtimeEpoch: "current" }, "current"),
    );
  }
  assert.deepEqual(sinks, {
    identity: paths.length,
    execute: 1,
    privacy: 1,
    balances: 1,
  });
  assert.doesNotThrow(() =>
    assertLocalnetRuntimeEpoch("/escrow/deal", {}, "current"),
  );

  sinks.identity = sinks.execute = sinks.privacy = sinks.balances = 0;
  for (const path of ["/invoke", "/privacy", "/balances"])
    assert.throws(
      () =>
        dispatch(
          path,
          { runtimeEpoch: "epoch-a", identity: "alice" },
          "epoch-b",
        ),
      (error) =>
        error instanceof LocalnetMutationGuardError && error.status === 409,
    );
  assert.deepEqual(sinks, {
    identity: 0,
    execute: 0,
    privacy: 0,
    balances: 0,
  });
});

test("GET health/config requests cannot pass the mutation guard", () => {
  for (const path of ["/health", "/config", "/private-intents/release-quote"]) {
    const guarded = request(
      { origin: ORIGIN, "x-app20-localnet-control": TOKEN },
      "GET",
    );
    guarded.url = path;
    assert.equal(
      statusOf(() =>
        assertLocalnetMutationGuards(guarded, {
          expectedOrigin: ORIGIN,
          controlToken: TOKEN,
        }),
      ),
      405,
    );
  }
});
