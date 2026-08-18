import type { PrivacyCoordinator } from "./coordination.js";
import { ConfigError } from "./errors.js";
import {
  NETWORK_DEFAULTS,
  READY_ACCOUNT_CLASS_HASH_V0_5_0,
  alchemyRpcUrl,
  type StarknetNetwork,
} from "./constants.js";
import {
  contractDiscovery,
  serviceDiscovery,
  type Strk20Discovery,
} from "./discovery.js";
import { mockProver, serviceProver, type Strk20Prover } from "./prover.js";
import type { PrivacySdkModule } from "./sdk.js";
import type { Strk20Config } from "./types.js";

export interface LoadConfigInput {
  network?: StarknetNetwork;
  rpcUrl?: string;
  alchemyApiKey?: string;
  privyAppId?: string;
  privyAppSecret?: string;
  readyClassHash?: string;
  poolAddress?: string;
  provingUrl?: string;
  discoveryUrl?: string;
  prover?: Strk20Prover;
  discovery?: Strk20Discovery;
  proverMode?: "service" | "mock";
  privacySdk?: PrivacySdkModule;
  privacyCoordinator?: PrivacyCoordinator;
  paymasterUrl?: string;
  paymasterApiKey?: string;
  paymasterMode?: "sponsored" | "default";
  authorizationPrivateKey?: string;
  tip?: bigint;
  maturityPollMs?: number;
  maturityTimeoutMs?: number;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function asNetwork(value: string | undefined): StarknetNetwork {
  if (!value || value === "sepolia") return "sepolia";
  if (value === "mainnet") return "mainnet";
  throw new ConfigError(
    `Unsupported STARKNET_NETWORK "${value}". Use "sepolia" or "mainnet".`,
  );
}

function asPositiveNumber(
  name: string,
  value: number | string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive number.`);
  }
  return parsed;
}

function asProverMode(
  value: string | undefined,
): "service" | "mock" | undefined {
  if (!value) return undefined;
  if (value === "service" || value === "mock") return value;
  throw new ConfigError(
    `Unsupported STRK20_PROVER_MODE "${value}". Use "service" or "mock".`,
  );
}

export function loadConfig(overrides: LoadConfigInput = {}): Strk20Config {
  const network = overrides.network ?? asNetwork(readEnv("STARKNET_NETWORK"));
  const defaults = NETWORK_DEFAULTS[network];
  const alchemyApiKey = overrides.alchemyApiKey ?? readEnv("ALCHEMY_API_KEY");
  const rpcUrl =
    overrides.rpcUrl ??
    readEnv("RPC_URL") ??
    (alchemyApiKey ? alchemyRpcUrl(network, alchemyApiKey) : undefined);

  const privyAppId = overrides.privyAppId ?? readEnv("PRIVY_APP_ID");
  const privyAppSecret =
    overrides.privyAppSecret ?? readEnv("PRIVY_APP_SECRET");
  if (!privyAppId || !privyAppSecret) {
    throw new ConfigError("PRIVY_APP_ID and PRIVY_APP_SECRET are required.");
  }
  if (!rpcUrl) {
    throw new ConfigError("Provide RPC_URL or ALCHEMY_API_KEY.");
  }

  const paymasterModeRaw =
    overrides.paymasterMode ??
    (readEnv("PAYMASTER_MODE") as "sponsored" | "default" | undefined);
  const provingUrl = overrides.provingUrl ?? readEnv("STRK20_PROVING_URL");
  const discoveryUrl =
    overrides.discoveryUrl ?? readEnv("STRK20_DISCOVERY_URL");
  const proverMode =
    overrides.proverMode ?? asProverMode(readEnv("STRK20_PROVER_MODE"));
  if (proverMode === "service" && !overrides.prover && !provingUrl) {
    throw new ConfigError(
      "STRK20_PROVING_URL is required when STRK20_PROVER_MODE=service.",
    );
  }
  if (proverMode === "mock" && overrides.prover?.submittable === true) {
    throw new ConfigError(
      "STRK20_PROVER_MODE=mock cannot be combined with a submittable prover.",
    );
  }
  const prover =
    overrides.prover ??
    (proverMode === "mock"
      ? provingUrl
        ? serviceProver({ url: provingUrl, submittable: false })
        : mockProver()
      : provingUrl
        ? serviceProver({ url: provingUrl })
        : undefined);
  const discovery =
    overrides.discovery ??
    (discoveryUrl
      ? serviceDiscovery(discoveryUrl)
      : prover?.submittable === false
        ? contractDiscovery()
        : undefined);
  const maturityPollMs = asPositiveNumber(
    "STRK20_MATURITY_POLL_MS",
    overrides.maturityPollMs ?? readEnv("STRK20_MATURITY_POLL_MS"),
  );
  const maturityTimeoutMs = asPositiveNumber(
    "STRK20_MATURITY_TIMEOUT_MS",
    overrides.maturityTimeoutMs ?? readEnv("STRK20_MATURITY_TIMEOUT_MS"),
  );

  const config: Strk20Config = {
    network,
    rpcUrl,
    privyAppId,
    privyAppSecret,
    readyClassHash:
      overrides.readyClassHash ??
      readEnv("READY_CLASSHASH") ??
      READY_ACCOUNT_CLASS_HASH_V0_5_0,
    poolAddress:
      overrides.poolAddress ??
      readEnv("STRK20_POOL_ADDRESS") ??
      defaults.poolAddress,
    provingUrl,
    discoveryUrl,
    prover,
    discovery,
    proverMode,
    privacySdk: overrides.privacySdk,
    privacyCoordinator: overrides.privacyCoordinator,
    paymasterUrl:
      overrides.paymasterUrl ??
      readEnv("PAYMASTER_URL") ??
      defaults.paymasterUrl,
    paymasterApiKey: overrides.paymasterApiKey ?? readEnv("PAYMASTER_API_KEY"),
    paymasterMode:
      paymasterModeRaw === "default" ? "default" : paymasterModeRaw,
    authorizationPrivateKey:
      overrides.authorizationPrivateKey ??
      readEnv("PRIVY_WALLET_AUTH_PRIVATE_KEY"),
    tip: overrides.tip,
    maturityPollMs,
    maturityTimeoutMs,
  };
  return config;
}
