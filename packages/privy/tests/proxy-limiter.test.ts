import { describe, expect, it } from "vitest";
import { InMemoryProverProxyLimiter } from "../src/proxy/limiter.js";

const userA = { tenantId: "tenant-a", userHash: "user-a" };
const userB = { tenantId: "tenant-a", userHash: "user-b" };

describe("InMemoryProverProxyLimiter", () => {
  it("does not consume a rate token when concurrency is full", async () => {
    const limiter = new InMemoryProverProxyLimiter({
      globalConcurrency: 1,
      tenantConcurrency: 1,
      tenantRequestsPerMinute: 5,
      userRequestsPerMinute: 5,
    });
    const first = await limiter.acquire(userA);
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error("expected lease");

    const busy = await limiter.acquire(userA);
    expect(busy).toEqual({ allowed: false, retryAfterSeconds: 1 });

    first.release();
    const afterRelease = await limiter.acquire(userA);
    expect(afterRelease.allowed).toBe(true);
  });

  it("does not burn tenant quota when a user is already over limit", async () => {
    const limiter = new InMemoryProverProxyLimiter({
      globalConcurrency: 2,
      tenantConcurrency: 2,
      tenantRequestsPerMinute: 2,
      userRequestsPerMinute: 1,
    });
    const first = await limiter.acquire(userA);
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error("expected lease");

    await expect(limiter.acquire(userA)).resolves.toMatchObject({
      allowed: false,
    });
    first.release();

    await expect(limiter.acquire(userB)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("releases concurrency so a later request can proceed", async () => {
    const limiter = new InMemoryProverProxyLimiter({
      globalConcurrency: 1,
      tenantConcurrency: 1,
      tenantRequestsPerMinute: 10,
      userRequestsPerMinute: 10,
    });
    const first = await limiter.acquire(userA);
    if (!first.allowed) throw new Error("expected lease");
    first.release();
    first.release();
    await expect(limiter.acquire(userA)).resolves.toMatchObject({
      allowed: true,
    });
  });
});
