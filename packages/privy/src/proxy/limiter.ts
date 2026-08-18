export interface ProverProxyLimitInput {
  tenantId: string;
  userHash: string;
}

export type ProverProxyLimitLease =
  | {
      allowed: true;
      release(): Promise<void> | void;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

export interface ProverProxyLimiter {
  acquire(input: ProverProxyLimitInput): Promise<ProverProxyLimitLease>;
}

export interface InMemoryProverProxyLimiterOptions {
  globalConcurrency?: number;
  tenantConcurrency?: number;
  tenantRequestsPerMinute?: number;
  userRequestsPerMinute?: number;
}

type Window = { startedAt: number; count: number };

/**
 * Single-process limiter for development/small deployments. Replicated proxies
 * should supply a distributed limiter with the same interface.
 */
export class InMemoryProverProxyLimiter implements ProverProxyLimiter {
  private readonly options: Required<InMemoryProverProxyLimiterOptions>;
  private readonly tenantWindows = new Map<string, Window>();
  private readonly userWindows = new Map<string, Window>();
  private readonly tenantActive = new Map<string, number>();
  private globalActive = 0;
  private lastCleanup = 0;

  constructor(options: InMemoryProverProxyLimiterOptions = {}) {
    this.options = {
      globalConcurrency: options.globalConcurrency ?? 8,
      tenantConcurrency: options.tenantConcurrency ?? 2,
      tenantRequestsPerMinute: options.tenantRequestsPerMinute ?? 60,
      userRequestsPerMinute: options.userRequestsPerMinute ?? 10,
    };
    for (const [name, value] of Object.entries(this.options)) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer.`);
      }
    }
  }

  private consumeWindow(
    windows: Map<string, Window>,
    key: string,
    limit: number,
    now: number,
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const existing = windows.get(key);
    const window =
      !existing || now - existing.startedAt >= 60_000
        ? { startedAt: now, count: 0 }
        : existing;
    windows.set(key, window);
    if (window.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((60_000 - (now - window.startedAt)) / 1_000),
        ),
      };
    }
    window.count += 1;
    return { allowed: true };
  }

  private cleanup(now: number): void {
    if (now - this.lastCleanup < 60_000) return;
    this.lastCleanup = now;
    for (const [key, window] of this.tenantWindows) {
      if (now - window.startedAt >= 60_000) this.tenantWindows.delete(key);
    }
    for (const [key, window] of this.userWindows) {
      if (now - window.startedAt >= 60_000) this.userWindows.delete(key);
    }
  }

  async acquire(input: ProverProxyLimitInput): Promise<ProverProxyLimitLease> {
    const now = Date.now();
    this.cleanup(now);
    const tenantWindow = this.consumeWindow(
      this.tenantWindows,
      input.tenantId,
      this.options.tenantRequestsPerMinute,
      now,
    );
    if (!tenantWindow.allowed) return tenantWindow;
    const userWindow = this.consumeWindow(
      this.userWindows,
      `${input.tenantId}:${input.userHash}`,
      this.options.userRequestsPerMinute,
      now,
    );
    if (!userWindow.allowed) return userWindow;

    const activeForTenant = this.tenantActive.get(input.tenantId) ?? 0;
    if (
      this.globalActive >= this.options.globalConcurrency ||
      activeForTenant >= this.options.tenantConcurrency
    ) {
      return { allowed: false, retryAfterSeconds: 1 };
    }

    this.globalActive += 1;
    this.tenantActive.set(input.tenantId, activeForTenant + 1);
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        this.globalActive -= 1;
        const remaining = (this.tenantActive.get(input.tenantId) ?? 1) - 1;
        if (remaining === 0) this.tenantActive.delete(input.tenantId);
        else this.tenantActive.set(input.tenantId, remaining);
      },
    };
  }
}
