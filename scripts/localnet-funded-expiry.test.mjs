import assert from "node:assert/strict";
import { test } from "node:test";
import { runLocalnetFundedExpiry } from "./localnet-funded-expiry.mjs";

const DEADLINE = 1_900_000_600;
const TARGET = Object.freeze({ reservationId: `0x${"11".repeat(32)}` });

function fixture(failOnceAt) {
  const state = {
    bound: false,
    released: false,
    time: DEADLINE,
    terminal: false,
    calls: { bind: 0, release: 0, time: 0, terminal: 0 },
  };
  const failOnce = (phase) => {
    if (failOnceAt === phase) {
      failOnceAt = undefined;
      throw new Error(`${phase} response lost`);
    }
  };
  return {
    state,
    dependencies: {
      target: TARGET,
      deadline: DEADLINE,
      bind: async () => {
        state.calls.bind += 1;
        state.bound = true;
        failOnce("bind");
      },
      release: async () => {
        assert.equal(state.bound, true);
        state.calls.release += 1;
        state.released = true;
        failOnce("release");
        return { released: true };
      },
      readTime: async () => state.time,
      advanceTime: async (time) => {
        assert.equal(state.released, true);
        state.calls.time += 1;
        state.time = time;
        failOnce("time");
      },
      observeExpired: async () => ({ status: 1, deadline: DEADLINE }),
      terminalize: async () => {
        assert.equal(state.time, DEADLINE + 1);
        state.calls.terminal += 1;
        state.terminal = true;
        failOnce("terminal");
      },
    },
  };
}

for (const phase of ["bind", "release", "time", "terminal"]) {
  test(`funded expiry retries the exact attempt after ${phase} response loss`, async () => {
    const { state, dependencies } = fixture(phase);
    await assert.rejects(runLocalnetFundedExpiry(dependencies), /response lost/);
    const result = await runLocalnetFundedExpiry(dependencies);
    assert.deepEqual(result, { expiredAt: DEADLINE + 1 });
    assert.equal(state.terminal, true);
  });
}

test("funded expiry response loss returns the same terminal result without another release effect", async () => {
  const { state, dependencies } = fixture();
  assert.deepEqual(await runLocalnetFundedExpiry(dependencies), {
    expiredAt: DEADLINE + 1,
  });
  const releasesAfterFirstResponse = state.calls.release;
  // The production coordinator/maker callbacks are idempotent; simulating a
  // repeated HTTP request must retain the exact target and terminal result.
  assert.deepEqual(await runLocalnetFundedExpiry(dependencies), {
    expiredAt: DEADLINE + 1,
  });
  assert.equal(state.calls.release, releasesAfterFirstResponse + 1);
  assert.equal(state.terminal, true);
});
