import type { RpcProvider } from "starknet";
import type { StarknetNetwork } from "./constants.js";
import { ConfigError } from "./errors.js";
import type { OhttpTransportOption } from "./ohttp.js";
import { loadPrivacySdkTesting } from "./sdk.js";

export type ProverKind = "service" | "mock" | "custom";

/** Context available when a prover is attached to a Privy Starknet session. */
export interface ProverContext {
  provider: RpcProvider;
  network: StarknetNetwork;
  chainId: string;
  nodeUrl: string;
  poolAddress: string;
}

/**
 * Stable package-owned seam around the official SDK's proving-provider input.
 * `submittable` is a safety property: mock proofs are built but never sent.
 */
export interface Strk20Prover {
  readonly kind: ProverKind;
  readonly submittable: boolean;
  resolve(context: ProverContext): Promise<unknown>;
}

/** Structural type accepted by `customProver`; official SDK providers satisfy it. */
export interface PrivacyProofProvider {
  getDefaultDetails(...args: never[]): Promise<unknown>;
  prove(...args: unknown[]): Promise<{
    data?: string;
    output: readonly string[];
    proofFacts: readonly string[];
    additionalData?: unknown;
  }>;
  invalidateNonceCache?(): void;
}

export interface ServiceProverOptions {
  url: string;
  requestTimeoutMs?: number;
  blockIdentifier?: unknown;
  ohttp?: OhttpTransportOption;
  retry?: { maxRetries?: number; baseDelayMs?: number };
  /**
   * Set false only for an HTTP mock implementing the prover protocol. The
   * resulting call is returned to the app and cannot be submitted by this SDK.
   */
  submittable?: boolean;
}

/** Connect to a Starknet `starknet_proveTransaction` JSON-RPC service. */
export function serviceProver(options: ServiceProverOptions): Strk20Prover {
  if (!options.url.trim()) {
    throw new ConfigError("A non-empty proving service URL is required.");
  }
  const submittable = options.submittable ?? true;
  return {
    kind: "service",
    submittable,
    async resolve(context) {
      return {
        url: options.url,
        chainId: context.chainId,
        nodeUrl: context.nodeUrl,
        requestTimeoutMs: options.requestTimeoutMs,
        blockIdentifier: options.blockIdentifier,
        ohttp: options.ohttp,
        retry: options.retry,
      };
    },
  };
}

export interface MockProverOptions {
  /** Validate the proof-invocation signature while simulating. Default false. */
  validateSignature?: boolean;
}

/**
 * Use the official SDK's call-based mock provider. It compiles actions against
 * RPC but does not generate a STARK proof and is never safe to submit to a
 * public Starknet network.
 */
export function mockProver(options: MockProverOptions = {}): Strk20Prover {
  return {
    kind: "mock",
    submittable: false,
    async resolve(context) {
      const testing = await loadPrivacySdkTesting();
      return new testing.CallMockProofProvider(
        context.provider,
        context.chainId,
        { validateSignature: options.validateSignature ?? false },
      );
    },
  };
}

/** Attach an application-owned proving-provider implementation. */
export function customProver(
  provider: PrivacyProofProvider,
  options: { submittable: boolean },
): Strk20Prover {
  if (
    !provider ||
    typeof provider.getDefaultDetails !== "function" ||
    typeof provider.prove !== "function"
  ) {
    throw new ConfigError(
      "A custom prover must implement getDefaultDetails() and prove().",
    );
  }
  return {
    kind: "custom",
    submittable: options.submittable,
    async resolve() {
      return provider;
    },
  };
}
