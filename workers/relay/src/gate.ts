import { RelayHttpError } from "./errors.ts";
import type { AtomicGate, DurableObjectNamespaceLike, GateAcquireRequest, GateBudget, GateLease } from "./types.ts";

interface RateEntry { startedAt: number; count: number }
interface LeaseEntry { expiresAt: number; dimensions: string[] }
interface GateSnapshot { rates: Record<string, RateEntry>; leases: Record<string, LeaseEntry> }
interface GatePolicy { sessionRate: number; sessionConcurrent: number; serviceRate: number; serviceConcurrent: number; leaseMs: number }

interface DurableStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(time: number): Promise<void>;
}
interface DurableStateLike { storage: DurableStorageLike; blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> }

const STATE_KEY = "gate-state-v1";
const WINDOW_MS = 60_000;
const GLOBAL_RATE = 2_000;
const GLOBAL_CONCURRENT = 200;

function policy(budget: GateBudget): GatePolicy {
  switch (budget) {
    case "ohttp-prover": return { sessionRate: 10, sessionConcurrent: 1, serviceRate: 500, serviceConcurrent: 40, leaseMs: 240_000 };
    case "ohttp-discovery": return { sessionRate: 120, sessionConcurrent: 4, serviceRate: 1_200, serviceConcurrent: 100, leaseMs: 60_000 };
    case "rpc-submit": return { sessionRate: 20, sessionConcurrent: 2, serviceRate: 300, serviceConcurrent: 40, leaseMs: 120_000 };
    case "rpc-costly": return { sessionRate: 60, sessionConcurrent: 4, serviceRate: 600, serviceConcurrent: 80, leaseMs: 120_000 };
    case "rpc-read": return { sessionRate: 300, sessionConcurrent: 8, serviceRate: 1_500, serviceConcurrent: 160, leaseMs: 120_000 };
  }
}

function validAcquire(value: unknown): value is GateAcquireRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.subject === "string" && item.subject.length > 0 && item.subject.length <= 200 &&
    typeof item.service === "string" && ["prover", "discovery", "starknet-sepolia", "starknet-mainnet"].includes(item.service) &&
    typeof item.budget === "string" && ["ohttp-prover", "ohttp-discovery", "rpc-read", "rpc-costly", "rpc-submit"].includes(item.budget);
}

export class RelayGateDurableObject {
  private readonly state: DurableStateLike;
  private snapshot: GateSnapshot = { rates: {}, leases: {} };
  private readonly ready: Promise<void>;
  private tail: Promise<void> = Promise.resolve();

  constructor(state: DurableStateLike) {
    this.state = state;
    this.ready = state.blockConcurrencyWhile(async () => {
      this.snapshot = (await state.storage.get<GateSnapshot>(STATE_KEY)) ?? { rates: {}, leases: {} };
      await this.cleanup(Date.now());
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/acquire") return this.exclusive(() => this.acquire(request));
    if (request.method === "POST" && url.pathname === "/release") return this.exclusive(() => this.release(request));
    return Response.json({ error: "Not found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  async alarm(): Promise<void> {
    await this.ready;
    await this.exclusive(() => this.cleanup(Date.now()));
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try { return await operation(); }
    finally { unlock(); }
  }

  private async acquire(request: Request): Promise<Response> {
    let input: unknown;
    try { input = await request.json(); } catch { input = null; }
    if (!validAcquire(input)) return Response.json({ error: "Invalid gate request." }, { status: 400 });
    const now = Date.now();
    await this.cleanup(now);
    const selected = policy(input.budget);
    const dimensions = ["global", `session:${input.subject}:${input.budget}`, `service:${input.service}:${input.budget}`];
    const limits = [
      { rate: GLOBAL_RATE, concurrent: GLOBAL_CONCURRENT },
      { rate: selected.sessionRate, concurrent: selected.sessionConcurrent },
      { rate: selected.serviceRate, concurrent: selected.serviceConcurrent },
    ];
    for (let index = 0; index < dimensions.length; index += 1) {
      const dimension = dimensions[index];
      const rate = this.currentRate(dimension, now);
      const concurrent = Object.values(this.snapshot.leases).filter((lease) => lease.dimensions.includes(dimension)).length;
      if (rate.count >= limits[index].rate || concurrent >= limits[index].concurrent) {
        return Response.json({ error: "Relay quota exceeded." }, { status: 429, headers: { "cache-control": "no-store" } });
      }
    }
    for (const dimension of dimensions) this.currentRate(dimension, now).count += 1;
    const leaseId = crypto.randomUUID();
    const expiresAt = now + selected.leaseMs;
    this.snapshot.leases[leaseId] = { expiresAt, dimensions };
    await this.persist(expiresAt);
    return Response.json({ leaseId }, { status: 201, headers: { "cache-control": "no-store" } });
  }

  private async release(request: Request): Promise<Response> {
    let input: unknown;
    try { input = await request.json(); } catch { input = null; }
    const leaseId = input && typeof input === "object" ? (input as Record<string, unknown>).leaseId : null;
    if (typeof leaseId !== "string" || leaseId.length > 100) return new Response(null, { status: 400 });
    delete this.snapshot.leases[leaseId];
    await this.persist();
    return new Response(null, { status: 204 });
  }

  private currentRate(dimension: string, now: number): RateEntry {
    const existing = this.snapshot.rates[dimension];
    if (!existing || now - existing.startedAt >= WINDOW_MS) {
      const fresh = { startedAt: now, count: 0 };
      this.snapshot.rates[dimension] = fresh;
      return fresh;
    }
    return existing;
  }

  private async cleanup(now: number): Promise<void> {
    for (const [key, lease] of Object.entries(this.snapshot.leases)) if (lease.expiresAt <= now) delete this.snapshot.leases[key];
    for (const [key, rate] of Object.entries(this.snapshot.rates)) if (now - rate.startedAt >= WINDOW_MS * 2) delete this.snapshot.rates[key];
    await this.persist();
  }

  private async persist(preferredAlarm?: number): Promise<void> {
    await this.state.storage.put(STATE_KEY, this.snapshot);
    const expiries = Object.values(this.snapshot.leases).map((lease) => lease.expiresAt);
    const next = Math.min(preferredAlarm ?? Number.POSITIVE_INFINITY, ...expiries);
    if (Number.isFinite(next)) await this.state.storage.setAlarm(next);
  }
}

export class DurableAtomicGate implements AtomicGate {
  private readonly stub: ReturnType<DurableObjectNamespaceLike["get"]>;

  constructor(namespace: DurableObjectNamespaceLike) {
    this.stub = namespace.get(namespace.idFromName("relay-global-v1"));
  }

  async acquire(input: GateAcquireRequest): Promise<GateLease> {
    const response = await this.stub.fetch("https://relay-gate.invalid/acquire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new RelayHttpError(response.status === 429 ? 429 : 503, response.status === 429 ? "Relay quota exceeded." : "Relay gate unavailable.");
    const output = await response.json() as { leaseId?: unknown };
    if (typeof output.leaseId !== "string") throw new RelayHttpError(503, "Relay gate unavailable.");
    let released = false;
    return {
      release: async (): Promise<void> => {
        if (released) return;
        released = true;
        await this.stub.fetch("https://relay-gate.invalid/release", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leaseId: output.leaseId }),
        });
      },
    };
  }
}
