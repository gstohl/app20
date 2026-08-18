import type { RpcProvider } from "starknet";
import { PrivacySdkMissingError } from "./errors.js";
import type { OhttpTransportOption } from "./ohttp.js";

/** Minimal runtime surface used from the optional official privacy SDK. */
export interface PrivacySdkModule {
  Open?: symbol;
  createPrivateTransfers(params: Record<string, unknown>): unknown;
  ProvingServiceProofProvider?: new (
    url: string,
    chainId: string,
    options?: {
      requestTimeoutMs?: number;
      nodeUrl?: string;
      poolAddress?: string;
      blockIdentifier?: unknown;
      ohttp?: OhttpTransportOption;
      retry?: { maxRetries?: number; baseDelayMs?: number };
    },
  ) => {
    getDefaultDetails(): Promise<unknown>;
    invalidateNonceCache(): void;
  };
  IndexerDiscoveryProvider?: new (
    url: string,
    poolAddress: string,
    options?: { ohttp?: OhttpTransportOption },
  ) => unknown;
  classifyTransaction?(tx: unknown): { actions: unknown[] };
}

/** Development-only providers exported by the SDK's `testing` entrypoint. */
export interface PrivacySdkTestingModule {
  CallMockProofProvider: new (
    node: RpcProvider,
    chainId: string,
    options?: { validateSignature?: boolean },
  ) => unknown;
  ContractDiscoveryProvider: new (
    pool: unknown,
    options?: {
      rateLimit?: {
        concurrency?: number;
        maxRetries?: number;
        baseDelayMs?: number;
      };
    },
  ) => unknown;
}

/** Privacy-pool ABI module exported by the SDK's `abi` entrypoint. */
export interface PrivacySdkAbiModule {
  PrivacyPoolABI: readonly unknown[];
}

let cachedSdk: PrivacySdkModule | undefined;
let cachedTestingSdk: PrivacySdkTestingModule | undefined;
let cachedAbi: PrivacySdkAbiModule | undefined;

function missingSdk(error: unknown, installHint: string): never {
  throw new PrivacySdkMissingError(installHint, { cause: error });
}

export async function loadPrivacySdk(): Promise<PrivacySdkModule> {
  if (cachedSdk) return cachedSdk;
  try {
    cachedSdk = (await import(
      "@starkware-libs/starknet-privacy-sdk"
    )) as unknown as PrivacySdkModule;
  } catch (error) {
    missingSdk(
      error,
      "Install @starkware-libs/starknet-privacy-sdk to run STRK20 private flows. " +
        "The package is currently published to GitHub Packages; see README.md.",
    );
  }
  return cachedSdk;
}

export async function loadPrivacySdkTesting(): Promise<PrivacySdkTestingModule> {
  if (cachedTestingSdk) return cachedTestingSdk;
  try {
    cachedTestingSdk = (await import(
      "@starkware-libs/starknet-privacy-sdk/testing"
    )) as unknown as PrivacySdkTestingModule;
  } catch (error) {
    missingSdk(
      error,
      "Install @starkware-libs/starknet-privacy-sdk@0.14.3-rc.5 to use the mock prover or contract discovery.",
    );
  }
  return cachedTestingSdk;
}

export async function loadPrivacyPoolAbi(): Promise<PrivacySdkAbiModule> {
  if (cachedAbi) return cachedAbi;
  try {
    cachedAbi = (await import(
      "@starkware-libs/starknet-privacy-sdk/abi"
    )) as unknown as PrivacySdkAbiModule;
  } catch (error) {
    missingSdk(
      error,
      "Install @starkware-libs/starknet-privacy-sdk@0.14.3-rc.5 to use contract discovery.",
    );
  }
  return cachedAbi;
}
