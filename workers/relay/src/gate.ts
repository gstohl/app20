import { RelayHttpError } from "./errors.ts";
import type {
  AtomicGate,
  DurableObjectNamespaceLike,
  GateAcquireRequest,
  GateBudget,
  GateLease,
} from "./types.ts";

interface RateEntry {
  startedAt: number;
  count: number;
}
interface LeaseEntry {
  expiresAt: number;
  dimensions: string[];
}
interface GateSnapshot {
  rates: Record<string, RateEntry>;
  leases: Record<string, LeaseEntry>;
}
interface GatePolicy {
  sessionRate: number;
  sessionConcurrent: number;
  serviceRate: number;
  serviceConcurrent: number;
  leaseMs: number;
}

interface DurableStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(time: number): Promise<void>;
}
interface DurableStateLike {
  storage: DurableStorageLike;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

const STATE_KEY = "gate-state-v1";
const WINDOW_MS = 60_000;
const GLOBAL_RATE = 2_000;
const GLOBAL_CONCURRENT = 200;
const MAX_RATE_KEYS = 8_192;
const MAX_SUBJECT_LENGTH = 200;
const MAX_LEASE_ID_LENGTH = 100;
const MAX_DIMENSION_LENGTH = 300;

const SERVICE_BUDGETS: Readonly<Record<string, readonly GateBudget[]>> = {
  "privy-bootstrap": ["privy-bootstrap"],
  prover: ["ohttp-prover"],
  discovery: ["ohttp-discovery"],
  "starknet-sepolia": ["rpc-read", "rpc-costly", "rpc-submit"],
  "starknet-mainnet": ["rpc-read", "rpc-costly", "rpc-submit"],
};

function policy(budget: GateBudget): GatePolicy {
  switch (budget) {
    case "privy-bootstrap":
      return {
        sessionRate: 20,
        sessionConcurrent: 2,
        serviceRate: 300,
        serviceConcurrent: 30,
        leaseMs: 30_000,
      };
    case "ohttp-prover":
      return {
        sessionRate: 10,
        sessionConcurrent: 1,
        serviceRate: 500,
        serviceConcurrent: 40,
        leaseMs: 240_000,
      };
    case "ohttp-discovery":
      return {
        sessionRate: 120,
        sessionConcurrent: 4,
        serviceRate: 1_200,
        serviceConcurrent: 100,
        leaseMs: 60_000,
      };
    case "rpc-submit":
      return {
        sessionRate: 20,
        sessionConcurrent: 2,
        serviceRate: 300,
        serviceConcurrent: 40,
        leaseMs: 120_000,
      };
    case "rpc-costly":
      return {
        sessionRate: 60,
        sessionConcurrent: 4,
        serviceRate: 600,
        serviceConcurrent: 80,
        leaseMs: 120_000,
      };
    case "rpc-read":
      return {
        sessionRate: 300,
        sessionConcurrent: 8,
        serviceRate: 1_500,
        serviceConcurrent: 160,
        leaseMs: 120_000,
      };
  }
}

function noStoreJson(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function gateUnavailable(): Response {
  return noStoreJson({ error: "Relay gate unavailable." }, 503);
}

function quotaExceeded(): Response {
  return noStoreJson({ error: "Relay quota exceeded." }, 429);
}

function isDangerousKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function validRateEntry(value: unknown): value is RateEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.startedAt === "number" &&
    Number.isSafeInteger(item.startedAt) &&
    item.startedAt > 0 &&
    typeof item.count === "number" &&
    Number.isSafeInteger(item.count) &&
    item.count >= 0
  );
}

function validLeaseEntry(value: unknown): value is LeaseEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.expiresAt === "number" &&
    Number.isSafeInteger(item.expiresAt) &&
    item.expiresAt > 0 &&
    Array.isArray(item.dimensions) &&
    item.dimensions.length > 0 &&
    item.dimensions.length <= 8 &&
    item.dimensions.every(
      (dimension) =>
        typeof dimension === "string" &&
        dimension.length > 0 &&
        dimension.length <= MAX_DIMENSION_LENGTH,
    )
  );
}

function emptySnapshot(): GateSnapshot {
  return { rates: {}, leases: {} };
}

function parseSnapshot(value: unknown): GateSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptySnapshot();
  }
  const item = value as Record<string, unknown>;
  if (
    !item.rates ||
    typeof item.rates !== "object" ||
    Array.isArray(item.rates) ||
    !item.leases ||
    typeof item.leases !== "object" ||
    Array.isArray(item.leases)
  ) {
    return emptySnapshot();
  }
  const rates: Record<string, RateEntry> = {};
  for (const [key, rate] of Object.entries(
    item.rates as Record<string, unknown>,
  )) {
    if (
      isDangerousKey(key) ||
      key.length === 0 ||
      key.length > MAX_DIMENSION_LENGTH
    ) {
      return emptySnapshot();
    }
    if (!validRateEntry(rate)) return emptySnapshot();
    rates[key] = { startedAt: rate.startedAt, count: rate.count };
  }
  const leases: Record<string, LeaseEntry> = {};
  for (const [key, lease] of Object.entries(
    item.leases as Record<string, unknown>,
  )) {
    if (
      isDangerousKey(key) ||
      key.length === 0 ||
      key.length > MAX_LEASE_ID_LENGTH
    ) {
      return emptySnapshot();
    }
    if (!validLeaseEntry(lease)) return emptySnapshot();
    leases[key] = {
      expiresAt: lease.expiresAt,
      dimensions: lease.dimensions.slice(),
    };
  }
  return { rates, leases };
}

function pruneSnapshot(snapshot: GateSnapshot, now: number): GateSnapshot {
  const rates: Record<string, RateEntry> = {};
  for (const [key, rate] of Object.entries(snapshot.rates)) {
    if (now - rate.startedAt < WINDOW_MS * 2) {
      rates[key] = { startedAt: rate.startedAt, count: rate.count };
    }
  }
  const leases: Record<string, LeaseEntry> = {};
  for (const [key, lease] of Object.entries(snapshot.leases)) {
    if (lease.expiresAt > now) {
      leases[key] = {
        expiresAt: lease.expiresAt,
        dimensions: lease.dimensions.slice(),
      };
    }
  }
  return { rates, leases };
}

function rateCount(
  rates: Record<string, RateEntry>,
  dimension: string,
  now: number,
): number {
  const existing = rates[dimension];
  if (!existing || now - existing.startedAt >= WINDOW_MS) return 0;
  return existing.count;
}

function incrementRate(
  rates: Record<string, RateEntry>,
  dimension: string,
  now: number,
): void {
  const existing = rates[dimension];
  if (!existing || now - existing.startedAt >= WINDOW_MS) {
    rates[dimension] = { startedAt: now, count: 1 };
    return;
  }
  rates[dimension] = {
    startedAt: existing.startedAt,
    count: existing.count + 1,
  };
}

function missingRateKeys(
  rates: Record<string, RateEntry>,
  dimensions: readonly string[],
): number {
  let extra = 0;
  for (const dimension of dimensions) {
    if (!Object.hasOwn(rates, dimension)) extra += 1;
  }
  return extra;
}

function validAcquire(value: unknown): value is GateAcquireRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.subject !== "string" ||
    item.subject.length === 0 ||
    item.subject.length > MAX_SUBJECT_LENGTH ||
    typeof item.service !== "string" ||
    typeof item.budget !== "string"
  ) {
    return false;
  }
  const allowed = SERVICE_BUDGETS[item.service];
  if (!allowed || !allowed.includes(item.budget as GateBudget)) return false;
  return true;
}

export class RelayGateDurableObject {
  private readonly state: DurableStateLike;
  private snapshot: GateSnapshot = emptySnapshot();
  private readonly ready: Promise<void>;
  private tail: Promise<void> = Promise.resolve();

  constructor(state: DurableStateLike) {
    this.state = state;
    this.ready = state.blockConcurrencyWhile(async () => {
      this.snapshot = parseSnapshot(
        await state.storage.get<unknown>(STATE_KEY),
      );
      const pruned = pruneSnapshot(this.snapshot, Date.now());
      await this.persistSnapshot(pruned);
      this.snapshot = pruned;
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return noStoreJson({ error: "Invalid request URL." }, 400);
    }
    if (request.method === "POST" && pathname === "/acquire")
      return this.exclusive(() => this.acquire(request));
    if (request.method === "POST" && pathname === "/release")
      return this.exclusive(() => this.release(request));
    return noStoreJson({ error: "Not found." }, 404);
  }

  async alarm(): Promise<void> {
    await this.ready;
    await this.exclusive(async () => {
      const pruned = pruneSnapshot(this.snapshot, Date.now());
      await this.persistSnapshot(pruned);
      this.snapshot = pruned;
    });
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
    }
  }

  private async acquire(request: Request): Promise<Response> {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      input = null;
    }
    if (!validAcquire(input))
      return noStoreJson({ error: "Invalid gate request." }, 400);
    const now = Date.now();
    const working = pruneSnapshot(this.snapshot, now);
    const selected = policy(input.budget);
    const dimensions = [
      "global",
      `session:${input.subject}:${input.budget}`,
      `service:${input.service}:${input.budget}`,
    ];
    const limits = [
      { rate: GLOBAL_RATE, concurrent: GLOBAL_CONCURRENT },
      { rate: selected.sessionRate, concurrent: selected.sessionConcurrent },
      { rate: selected.serviceRate, concurrent: selected.serviceConcurrent },
    ];
    for (let index = 0; index < dimensions.length; index += 1) {
      const dimension = dimensions[index];
      const concurrent = Object.values(working.leases).filter((lease) =>
        lease.dimensions.includes(dimension),
      ).length;
      if (
        rateCount(working.rates, dimension, now) >= limits[index].rate ||
        concurrent >= limits[index].concurrent
      ) {
        return quotaExceeded();
      }
    }
    if (
      Object.keys(working.rates).length +
        missingRateKeys(working.rates, dimensions) >
      MAX_RATE_KEYS
    ) {
      return quotaExceeded();
    }
    for (const dimension of dimensions)
      incrementRate(working.rates, dimension, now);
    const leaseId = crypto.randomUUID();
    const expiresAt = now + selected.leaseMs;
    working.leases[leaseId] = { expiresAt, dimensions };
    try {
      await this.persistSnapshot(working, expiresAt);
    } catch {
      return gateUnavailable();
    }
    this.snapshot = working;
    return noStoreJson({ leaseId }, 201);
  }

  private async release(request: Request): Promise<Response> {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      input = null;
    }
    const leaseId =
      input && typeof input === "object"
        ? (input as Record<string, unknown>).leaseId
        : null;
    if (
      typeof leaseId !== "string" ||
      leaseId.length === 0 ||
      leaseId.length > MAX_LEASE_ID_LENGTH
    )
      return new Response(null, { status: 400 });
    if (!Object.hasOwn(this.snapshot.leases, leaseId)) {
      return new Response(null, { status: 204 });
    }
    const next: GateSnapshot = {
      rates: this.snapshot.rates,
      leases: { ...this.snapshot.leases },
    };
    delete next.leases[leaseId];
    try {
      await this.persistSnapshot(next);
    } catch {
      return gateUnavailable();
    }
    this.snapshot = next;
    return new Response(null, { status: 204 });
  }

  private async persistSnapshot(
    snapshot: GateSnapshot,
    preferredAlarm?: number,
  ): Promise<void> {
    await this.state.storage.put(STATE_KEY, snapshot);
    const expiries = Object.values(snapshot.leases).map(
      (lease) => lease.expiresAt,
    );
    const next = Math.min(
      preferredAlarm ?? Number.POSITIVE_INFINITY,
      ...expiries,
    );
    if (Number.isFinite(next)) await this.state.storage.setAlarm(next);
  }
}

export class DurableAtomicGate implements AtomicGate {
  private readonly stub: ReturnType<DurableObjectNamespaceLike["get"]>;

  constructor(namespace: DurableObjectNamespaceLike) {
    this.stub = namespace.get(namespace.idFromName("relay-global-v1"));
  }

  async acquire(input: GateAcquireRequest): Promise<GateLease> {
    const response = await this.stub.fetch(
      "https://relay-gate.invalid/acquire",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok)
      throw new RelayHttpError(
        response.status === 429 ? 429 : 503,
        response.status === 429
          ? "Relay quota exceeded."
          : "Relay gate unavailable.",
      );
    const output = (await response.json()) as { leaseId?: unknown };
    if (typeof output.leaseId !== "string")
      throw new RelayHttpError(503, "Relay gate unavailable.");
    let released = false;
    return {
      release: async (): Promise<void> => {
        if (released) return;
        let releaseResponse: Response;
        try {
          releaseResponse = await this.stub.fetch(
            "https://relay-gate.invalid/release",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ leaseId: output.leaseId }),
            },
          );
        } catch {
          throw new RelayHttpError(503, "Relay gate unavailable.");
        }
        if (releaseResponse.status === 204) {
          released = true;
          return;
        }
        await releaseResponse.body?.cancel();
        throw new RelayHttpError(503, "Relay gate unavailable.");
      },
    };
  }
}
