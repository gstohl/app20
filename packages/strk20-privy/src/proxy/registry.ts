import { ConfigError } from "../errors.js";

export interface ProverTenant {
  /** Opaque routing ID sent as X-Strk20-Tenant. It may equal the Privy client ID. */
  tenantId: string;
  /** Privy app-client ID retained as enrollment metadata; it is not an authenticator. */
  privyClientId: string;
  /** Expected `aud` / app ID in Privy's signed access token. */
  privyAppId: string;
  /** Public Privy access-token verification keys; keep old + new during rotation. */
  verificationKeys: string[];
  /** Pool this tenant is allowed to prove against. */
  poolAddress: string;
  enabled: boolean;
}

export interface ProverTenantRegistry {
  getByTenantId(tenantId: string): Promise<ProverTenant | undefined>;
}

function validateTenant(tenant: ProverTenant): ProverTenant {
  if (!tenant.tenantId.trim()) throw new ConfigError("tenantId is required.");
  if (!tenant.privyClientId.trim()) {
    throw new ConfigError("privyClientId is required.");
  }
  if (!tenant.privyAppId.trim()) {
    throw new ConfigError("privyAppId is required.");
  }
  if (
    tenant.verificationKeys.length === 0 ||
    tenant.verificationKeys.some((key) => !key.trim())
  ) {
    throw new ConfigError(
      "At least one non-empty Privy verification key is required.",
    );
  }
  try {
    BigInt(tenant.poolAddress);
  } catch {
    throw new ConfigError("poolAddress must be a Starknet felt address.");
  }
  return {
    ...tenant,
    tenantId: tenant.tenantId.trim(),
    privyClientId: tenant.privyClientId.trim(),
    privyAppId: tenant.privyAppId.trim(),
    verificationKeys: tenant.verificationKeys.map((key) => key.trim()),
  };
}

/** In-memory/admin-managed registry for one proxy process. */
export class InMemoryProverTenantRegistry implements ProverTenantRegistry {
  private readonly tenants = new Map<string, ProverTenant>();

  constructor(tenants: ProverTenant[] = []) {
    for (const tenant of tenants) this.upsert(tenant);
  }

  upsert(input: ProverTenant): void {
    const tenant = validateTenant(input);
    for (const existing of this.tenants.values()) {
      if (
        existing.tenantId !== tenant.tenantId &&
        existing.privyAppId === tenant.privyAppId
      ) {
        throw new ConfigError(
          "A Privy App ID may be enrolled under only one tenant ID.",
        );
      }
    }
    this.tenants.set(tenant.tenantId, tenant);
  }

  remove(tenantId: string): boolean {
    return this.tenants.delete(tenantId);
  }

  async getByTenantId(tenantId: string): Promise<ProverTenant | undefined> {
    return this.tenants.get(tenantId);
  }
}
