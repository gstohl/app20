import test from "node:test";
import assert from "node:assert/strict";
import { RelayGateDurableObject } from "../src/gate.ts";

test("Durable Object atomically rejects concurrent prover lease and admits after release", async () => {
  let stored: unknown;
  const state = {
    storage: {
      async get<T>(): Promise<T | undefined> { return stored as T | undefined; },
      async put<T>(_key: string, value: T): Promise<void> { stored = structuredClone(value); },
      async setAlarm(): Promise<void> {},
    },
    async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> { return callback(); },
  };
  const object = new RelayGateDurableObject(state);
  const acquire = () => object.fetch(new Request("https://gate.invalid/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: "same-session", service: "prover", budget: "ohttp-prover" }),
  }));
  const [first, second] = await Promise.all([acquire(), acquire()]);
  assert.deepEqual([first.status, second.status].sort(), [201, 429]);
  const leaseId = ((first.status === 201 ? first : second).json() as Promise<{ leaseId: string }>);
  const released = await object.fetch(new Request("https://gate.invalid/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leaseId: (await leaseId).leaseId }),
  }));
  assert.equal(released.status, 204);
  assert.equal((await acquire()).status, 201);
});
