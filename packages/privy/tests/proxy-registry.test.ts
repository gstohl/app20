import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import {
  InMemoryProverTenantRegistry,
  type ProverTenant,
} from "../src/proxy/registry.js";

const POOL =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

function tenant(overrides: Partial<ProverTenant> = {}): ProverTenant {
  return {
    tenantId: "tenant-a",
    privyClientId: "client-a",
    privyAppId: "app-a",
    verificationKeys: ["public-key"],
    poolAddress: POOL,
    enabled: true,
    ...overrides,
  };
}

describe("InMemoryProverTenantRegistry", () => {
  it("allows updating the same tenant enrollment", async () => {
    const registry = new InMemoryProverTenantRegistry([tenant()]);
    registry.upsert(tenant({ privyClientId: "client-rotated" }));
    await expect(registry.getByTenantId("tenant-a")).resolves.toMatchObject({
      privyClientId: "client-rotated",
    });
  });

  it("rejects two tenant IDs sharing one Privy App ID", () => {
    const registry = new InMemoryProverTenantRegistry([tenant()]);
    expect(() =>
      registry.upsert(
        tenant({ tenantId: "tenant-b", privyClientId: "client-b" }),
      ),
    ).toThrow(ConfigError);
  });
});
