export type RelayService = "prover" | "discovery" | "starknet-sepolia" | "starknet-mainnet";
export type GateBudget = "ohttp-prover" | "ohttp-discovery" | "rpc-read" | "rpc-costly" | "rpc-submit";

export interface DurableObjectStubLike {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface RelayEnv {
  ENVIRONMENT?: "production" | "development";
  ALLOW_LOCAL_DEVELOPMENT?: "true";
  ALLOW_LOOPBACK_HTTP?: "true";
  TRUST_FORWARDED_ORIGIN?: "true";
  TRUST_CLIENT_IP_HEADERS?: "true";

  PROVER_UPSTREAM_URL: string;
  DISCOVERY_UPSTREAM_URL: string;
  STARKNET_SEPOLIA_RPC_URL: string;
  STARKNET_MAINNET_RPC_URL: string;

  PROVER_UPSTREAM_AUTHORIZATION?: string;
  DISCOVERY_UPSTREAM_AUTHORIZATION?: string;
  STARKNET_SEPOLIA_AUTHORIZATION?: string;
  STARKNET_MAINNET_AUTHORIZATION?: string;
  OHTTP_SESSION_SECRET: string;
  RELAY_GATE: DurableObjectNamespaceLike;

  PRIVY_FRAME_ORIGINS?: string;
  PRIVY_CONNECT_ORIGINS?: string;
}

export interface GateAcquireRequest {
  subject: string;
  service: RelayService;
  budget: GateBudget;
}

export interface GateLease {
  release(): Promise<void>;
}

export interface AtomicGate {
  acquire(request: GateAcquireRequest): Promise<GateLease>;
}

export interface SpaSecurityConfig {
  privyFrameOrigins: readonly string[];
  privyConnectOrigins: readonly string[];
}

export interface RelayDependencies {
  fetch: typeof fetch;
  now?: () => number;
  gate?: AtomicGate;
}
