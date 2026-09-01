import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  resolveUiTestPlan,
  runUiTests,
  waitForLocalnet,
} from "../../scripts/ui-test.mjs";

class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;

  finish(code = 0) {
    this.exitCode = code;
    this.emit("exit", code, null);
  }

  kill(signal) {
    this.signalCode = signal;
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}

function readyResponse() {
  return new Response(
    JSON.stringify({
      result: {
        walletName: "Localnet (dev)",
        runtimeEpoch: "fixture-epoch",
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

test("managed UI runs retain a fresh localnet lifecycle", () => {
  assert.deepEqual(resolveUiTestPlan({ APP20_LOCALNET_VITE_PORT: "6173" }), {
    baseUrl: "http://127.0.0.1:6173",
    configUrl: "http://127.0.0.1:6173/__app20_localnet_wallet/config",
    managesLocalnet: true,
  });
});

test("an explicit test base URL reuses the caller-managed localnet", () => {
  assert.deepEqual(
    resolveUiTestPlan({
      APP20_LOCALNET_VITE_PORT: "6173",
      APP20_TEST_BASE_URL: "http://localhost:7173/",
    }),
    {
      baseUrl: "http://localhost:7173",
      configUrl: "http://localhost:7173/__app20_localnet_wallet/config",
      managesLocalnet: false,
    },
  );
});

test("caller-managed runs never stop or spawn a replacement localnet", async () => {
  const spawnCalls = [];
  const playwright = new FakeChild();
  const exitCode = await runUiTests({
    args: ["rfq-m11-acceptance.spec.ts"],
    env: { APP20_TEST_BASE_URL: "http://localhost:7173" },
    fetchImpl: async () => readyResponse(),
    spawnImpl: (...args) => {
      spawnCalls.push(args);
      queueMicrotask(() => playwright.finish(0));
      return playwright;
    },
    spawnSyncImpl: () => {
      throw new Error("caller-managed localnet must not be stopped");
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(spawnCalls.length, 1);
  assert.match(spawnCalls[0][1][0], /playwright\/cli\.js$/);
  assert.equal(
    spawnCalls[0][2].env.APP20_TEST_BASE_URL,
    "http://localhost:7173",
  );
});

test("managed runs stop stale state once and gracefully own their new process", async () => {
  const localnet = new FakeChild();
  const playwright = new FakeChild();
  let spawnCount = 0;
  let stopCount = 0;
  const exitCode = await runUiTests({
    env: { APP20_LOCALNET_VITE_PORT: "6173" },
    fetchImpl: async () => readyResponse(),
    spawnImpl: () => {
      spawnCount += 1;
      if (spawnCount === 1) return localnet;
      queueMicrotask(() => playwright.finish(0));
      return playwright;
    },
    spawnSyncImpl: () => {
      stopCount += 1;
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(spawnCount, 2);
  assert.equal(stopCount, 1);
  assert.equal(localnet.signalCode, "SIGTERM");
});

test("UI base URL validation rejects ambiguous roots and invalid managed ports", () => {
  assert.throws(
    () =>
      resolveUiTestPlan({
        APP20_TEST_BASE_URL: "http://localhost:5173/nested",
      }),
    /server root/,
  );
  assert.throws(
    () => resolveUiTestPlan({ APP20_LOCALNET_VITE_PORT: "0" }),
    /valid TCP port/,
  );
});

test("readiness works without a child process for caller-managed localnet", async () => {
  let requestedUrl;
  const config = await waitForLocalnet({
    configUrl: "http://localhost:7173/__app20_localnet_wallet/config",
    timeoutMs: 100,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return readyResponse();
    },
  });

  assert.equal(
    requestedUrl,
    "http://localhost:7173/__app20_localnet_wallet/config",
  );
  assert.equal(config.runtimeEpoch, "fixture-epoch");
});

test("readiness fails immediately when the owned localnet exits", async () => {
  const processHandle = Object.assign(new EventEmitter(), {
    exitCode: 17,
    signalCode: null,
  });
  await assert.rejects(
    waitForLocalnet({
      configUrl: "http://127.0.0.1:5173/config",
      processHandle,
      timeoutMs: 100,
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
    }),
    /exited before the UI suite \(code 17\)/,
  );
});
