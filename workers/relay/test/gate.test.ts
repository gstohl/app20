import test from "node:test";
import assert from "node:assert/strict";
import { DurableAtomicGate, RelayGateDurableObject } from "../src/gate.ts";
import { RelayHttpError } from "../src/errors.ts";
import type {
  DurableObjectNamespaceLike,
  GateAcquireRequest,
} from "../src/types.ts";

type GateSnapshot = {
  rates: Record<string, { startedAt: number; count: number }>;
  leases: Record<string, { expiresAt: number; dimensions: string[] }>;
};

function createGate(initial?: unknown): {
  state: ConstructorParameters<typeof RelayGateDurableObject>[0];
  get stored(): unknown;
  get putCount(): number;
  setFailPut(value: boolean): void;
} {
  let stored: unknown =
    initial === undefined ? undefined : structuredClone(initial);
  let putCount = 0;
  let failPut = false;
  const state = {
    storage: {
      async get<T>(): Promise<T | undefined> {
        return stored as T | undefined;
      },
      async put<T>(_key: string, value: T): Promise<void> {
        putCount += 1;
        if (failPut) throw new Error("Durable Object storage write failed.");
        stored = structuredClone(value);
      },
      async setAlarm(): Promise<void> {},
    },
    async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      return callback();
    },
  };
  return {
    state,
    get stored() {
      return stored;
    },
    get putCount() {
      return putCount;
    },
    setFailPut(value: boolean) {
      failPut = value;
    },
  };
}

function acquireRequest(body: unknown): Request {
  return new Request("https://gate.invalid/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function releaseRequest(leaseId: unknown): Request {
  return new Request("https://gate.invalid/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leaseId }),
  });
}

const prover: GateAcquireRequest = {
  subject: "same-session",
  service: "prover",
  budget: "ohttp-prover",
};

function namespaceFor(
  object: RelayGateDurableObject,
): DurableObjectNamespaceLike {
  return {
    idFromName: (name) => name,
    get: () => ({
      fetch: (request: Request | string, init?: RequestInit) =>
        object.fetch(
          typeof request === "string" ? new Request(request, init) : request,
        ),
    }),
  };
}

async function readyGate(initial?: unknown): Promise<{
  harness: ReturnType<typeof createGate>;
  object: RelayGateDurableObject;
}> {
  const harness = createGate(initial);
  const object = new RelayGateDurableObject(harness.state);
  await object.fetch(new Request("https://gate.invalid/missing"));
  return { harness, object };
}

test("Durable Object atomically rejects concurrent prover lease and admits after release", async () => {
  const harness = createGate();
  const object = new RelayGateDurableObject(harness.state);
  const acquire = () => object.fetch(acquireRequest(prover));
  const [first, second] = await Promise.all([acquire(), acquire()]);
  assert.deepEqual([first.status, second.status].sort(), [201, 429]);
  const leaseId = (first.status === 201 ? first : second).json() as Promise<{
    leaseId: string;
  }>;
  const released = await object.fetch(releaseRequest((await leaseId).leaseId));
  assert.equal(released.status, 204);
  assert.equal((await acquire()).status, 201);
});

test("rejected and invalid acquires do not create attacker-keyed rate entries or rewrite state", async () => {
  const { harness, object } = await readyGate();
  const admitted = await object.fetch(acquireRequest(prover));
  assert.equal(admitted.status, 201);
  const sameSubject = await object.fetch(acquireRequest(prover));
  assert.equal(sameSubject.status, 429);

  for (let index = 0; index < 39; index += 1) {
    const filled = await object.fetch(
      acquireRequest({
        subject: `holder-${index}`,
        service: "prover",
        budget: "ohttp-prover",
      }),
    );
    assert.equal(filled.status, 201);
  }
  const afterFill = harness.stored as GateSnapshot;
  const rateKeys = Object.keys(afterFill.rates).sort();
  const putCount = harness.putCount;
  assert.equal(Object.keys(afterFill.leases).length, 40);

  for (let index = 0; index < 12; index += 1) {
    const rejected = await object.fetch(
      acquireRequest({
        subject: `attacker-${index}`,
        service: "prover",
        budget: "ohttp-prover",
      }),
    );
    assert.equal(rejected.status, 429);
  }

  const unbound = await object.fetch(
    acquireRequest({
      subject: "attacker-budget",
      service: "prover",
      budget: "rpc-read",
    }),
  );
  assert.equal(unbound.status, 400);

  const oversized = await object.fetch(
    acquireRequest({
      subject: "x".repeat(201),
      service: "prover",
      budget: "ohttp-prover",
    }),
  );
  assert.equal(oversized.status, 400);

  assert.equal(harness.putCount, putCount);
  assert.deepEqual(
    Object.keys((harness.stored as GateSnapshot).rates).sort(),
    rateKeys,
  );
  assert.equal(Object.keys((harness.stored as GateSnapshot).leases).length, 40);
  assert.equal(afterFill.rates["session:attacker-0:ohttp-prover"], undefined);
});

test("service and budget pairs are bound at the durable gate", async () => {
  const { harness, object } = await readyGate();
  const putCount = harness.putCount;
  const rejectedPairs: Array<Record<string, string>> = [
    { subject: "s", service: "prover", budget: "rpc-read" },
    { subject: "s", service: "privy-bootstrap", budget: "ohttp-prover" },
    { subject: "s", service: "discovery", budget: "ohttp-prover" },
    { subject: "s", service: "starknet-sepolia", budget: "ohttp-discovery" },
    { subject: "s", service: "rfq-ingress", budget: "rpc-read" },
    { subject: "", service: "prover", budget: "ohttp-prover" },
  ];
  for (const body of rejectedPairs) {
    const response = await object.fetch(acquireRequest(body));
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(harness.putCount, putCount);

  const allowed: GateAcquireRequest[] = [
    {
      subject: "s",
      service: "privy-bootstrap",
      budget: "privy-bootstrap",
    },
    { subject: "s", service: "discovery", budget: "ohttp-discovery" },
    { subject: "s", service: "starknet-sepolia", budget: "rpc-read" },
    { subject: "s", service: "starknet-mainnet", budget: "rpc-submit" },
    { subject: "x".repeat(200), service: "prover", budget: "ohttp-prover" },
  ];
  for (const body of allowed) {
    const response = await object.fetch(acquireRequest(body));
    assert.equal(response.status, 201, JSON.stringify(body));
    const lease = (await response.json()) as { leaseId: string };
    assert.equal(
      (await object.fetch(releaseRequest(lease.leaseId))).status,
      204,
    );
  }
});

test("session rate boundary rejects the next request without persisting", async () => {
  const harness = createGate();
  const object = new RelayGateDurableObject(harness.state);
  for (let index = 0; index < 10; index += 1) {
    const response = await object.fetch(acquireRequest(prover));
    assert.equal(response.status, 201);
    const lease = (await response.json()) as { leaseId: string };
    assert.equal(
      (await object.fetch(releaseRequest(lease.leaseId))).status,
      204,
    );
  }
  const putCount = harness.putCount;
  const rejected = await object.fetch(acquireRequest(prover));
  assert.equal(rejected.status, 429);
  assert.equal(harness.putCount, putCount);
  assert.equal(
    (harness.stored as GateSnapshot).rates["session:same-session:ohttp-prover"]
      ?.count,
    10,
  );
});

test("restart restores a valid snapshot and keeps the live lease", async () => {
  const first = await readyGate();
  const admitted = await first.object.fetch(acquireRequest(prover));
  assert.equal(admitted.status, 201);
  const snapshot = structuredClone(first.harness.stored);

  const restarted = await readyGate(snapshot);
  const concurrent = await restarted.object.fetch(acquireRequest(prover));
  assert.equal(concurrent.status, 429);
  const lease = (await admitted.json()) as { leaseId: string };
  assert.equal(
    (await restarted.object.fetch(releaseRequest(lease.leaseId))).status,
    204,
  );
  assert.equal(
    (await restarted.object.fetch(acquireRequest(prover))).status,
    201,
  );
});

test("malformed persisted snapshots are discarded instead of honored", async () => {
  const cases: unknown[] = [
    null,
    { garbage: true },
    { rates: null, leases: {} },
    { rates: { global: { startedAt: "nope", count: 1 } }, leases: {} },
    {
      rates: { global: { startedAt: Date.now(), count: 1 } },
      leases: { "not-a-lease": { expiresAt: "later", dimensions: ["global"] } },
    },
    JSON.parse(
      `{"rates":{"__proto__":{"startedAt":${Date.now()},"count":99}},"leases":{}}`,
    ),
  ];
  for (const initial of cases) {
    const harness = createGate(initial);
    const object = new RelayGateDurableObject(harness.state);
    const response = await object.fetch(acquireRequest(prover));
    assert.equal(response.status, 201, JSON.stringify(initial));
    const stored = harness.stored as GateSnapshot;
    assert.equal(stored.rates.global?.count, 1);
    assert.equal(stored.rates["session:same-session:ohttp-prover"]?.count, 1);
    const lease = (await response.json()) as { leaseId: string };
    assert.equal(
      (await object.fetch(releaseRequest(lease.leaseId))).status,
      204,
    );
  }
});

test("expired leases are dropped on restart and do not consume concurrency", async () => {
  const first = await readyGate();
  assert.equal((await first.object.fetch(acquireRequest(prover))).status, 201);
  const snapshot = structuredClone(first.harness.stored) as GateSnapshot;
  const leaseId = Object.keys(snapshot.leases)[0];
  assert.ok(leaseId);
  snapshot.leases[leaseId]!.expiresAt = 1;
  const restarted = await readyGate(snapshot);
  const stored = restarted.harness.stored as GateSnapshot;
  assert.deepEqual(stored.leases, {});
  assert.equal(
    (await restarted.object.fetch(acquireRequest(prover))).status,
    201,
  );
});

test("rate-key growth is bounded and does not persist a rejected overflow", async () => {
  const now = Date.now();
  const rates: Record<string, { startedAt: number; count: number }> = {
    global: { startedAt: now, count: 1 },
    "service:prover:ohttp-prover": { startedAt: now, count: 1 },
  };
  for (let index = 0; index < 8_190; index += 1) {
    rates[`session:flood-${index}:ohttp-prover`] = { startedAt: now, count: 1 };
  }
  assert.equal(Object.keys(rates).length, 8_192);
  const { harness, object } = await readyGate({ rates, leases: {} });
  const putCount = harness.putCount;
  const overflow = await object.fetch(
    acquireRequest({
      subject: "new-attacker",
      service: "prover",
      budget: "ohttp-prover",
    }),
  );
  assert.equal(overflow.status, 429);
  assert.equal(harness.putCount, putCount);
  assert.equal(
    Object.keys((harness.stored as GateSnapshot).rates).length,
    8_192,
  );

  const existing = await object.fetch(
    acquireRequest({
      subject: "flood-0",
      service: "prover",
      budget: "ohttp-prover",
    }),
  );
  assert.equal(existing.status, 201);
});

test("platform write failures on acquire and release are retryable 503s", async () => {
  const harness = createGate();
  const object = new RelayGateDurableObject(harness.state);
  await object.fetch(new Request("https://gate.invalid/missing"));
  harness.setFailPut(true);
  const failedAcquire = await object.fetch(acquireRequest(prover));
  assert.equal(failedAcquire.status, 503);
  assert.match(await failedAcquire.text(), /unavailable/i);
  assert.deepEqual((harness.stored as GateSnapshot).leases, {});

  harness.setFailPut(false);
  const admitted = await object.fetch(acquireRequest(prover));
  assert.equal(admitted.status, 201);
  const lease = (await admitted.json()) as { leaseId: string };
  const snapshot = structuredClone(harness.stored);
  harness.setFailPut(true);
  const failedRelease = await object.fetch(releaseRequest(lease.leaseId));
  assert.equal(failedRelease.status, 503);
  assert.deepEqual(harness.stored, snapshot);

  harness.setFailPut(false);
  assert.equal((await object.fetch(releaseRequest(lease.leaseId))).status, 204);
  assert.equal(Object.keys((harness.stored as GateSnapshot).leases).length, 0);
});

test("DurableAtomicGate leaves a failed release retryable until acknowledged", async () => {
  const harness = createGate();
  const object = new RelayGateDurableObject(harness.state);
  await object.fetch(new Request("https://gate.invalid/missing"));
  const gate = new DurableAtomicGate(namespaceFor(object));
  const lease = await gate.acquire(prover);
  harness.setFailPut(true);
  await assert.rejects(
    () => lease.release(),
    (error: unknown) => {
      assert.ok(error instanceof RelayHttpError);
      assert.equal(error.status, 503);
      return true;
    },
  );
  assert.equal(Object.keys((harness.stored as GateSnapshot).leases).length, 1);
  harness.setFailPut(false);
  await lease.release();
  assert.equal(Object.keys((harness.stored as GateSnapshot).leases).length, 0);
  await lease.release();
});
