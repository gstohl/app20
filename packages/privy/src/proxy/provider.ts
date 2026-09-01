import { ConfigError } from "../errors.js";
import type { ProverContext, Strk20Prover } from "../prover.js";
import { loadPrivacySdk } from "../sdk.js";
import type { PrivyTokenRequest } from "../types.js";
import { PROVER_PROXY_TENANT_HEADER } from "./server.js";

/** True after the proxy rejected the previous token as invalid/expired. */
export type PrivyAccessTokenRequest = PrivyTokenRequest;

export type PrivyAccessTokenProvider = (
  request: PrivyAccessTokenRequest,
) => Promise<string> | string;

export type PrivyAccessTokenSource = string | PrivyAccessTokenProvider;

type BaseProofProvider = {
  getDefaultDetails(): Promise<unknown>;
  invalidateNonceCache(): void;
};

type ProofResult = {
  data: string;
  output: string[];
  proofFacts: string[];
  additionalData?: unknown;
};

export interface PrivyProxyProverOptions {
  /** Full proxy RPC URL, normally ending in `/rpc`. */
  url: string;
  tenantId: string;
  /** Prefer a callback so Privy can refresh its short-lived access token. */
  accessToken: PrivyAccessTokenSource;
  /** Optional per-proof cancellation source supplied by the calling app. */
  abortSignal?: AbortSignal | (() => AbortSignal | undefined);
  requestTimeoutMs?: number;
  retry?: { maxRetries?: number; baseDelayMs?: number };
  submittable?: boolean;
  fetch?: typeof fetch;
}

export class ProverProxyClientError extends Error {
  override readonly name = "ProverProxyClientError";

  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

type NormalizedBlockId = { block_number: number };

function normalizeBlockId(blockIdentifier: unknown): NormalizedBlockId {
  const blockNumber =
    typeof blockIdentifier === "bigint"
      ? blockIdentifier <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(blockIdentifier)
        : Number.NaN
      : blockIdentifier;
  if (
    typeof blockNumber !== "number" ||
    !Number.isSafeInteger(blockNumber) ||
    blockNumber < 0
  ) {
    throw new ProverProxyClientError(
      "A non-negative safe-integer proving block number is required by the proxy.",
    );
  }
  return { block_number: blockNumber };
}

function transient(error: unknown): boolean {
  return (
    error instanceof ProverProxyClientError &&
    (error.status === 503 || error.code === -32005)
  );
}

function callerAbortSignal(
  abortSignal: PrivyProxyProverOptions["abortSignal"],
): AbortSignal | undefined {
  return typeof abortSignal === "function" ? abortSignal() : abortSignal;
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new ProverProxyClientError("Prover proxy request aborted.");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Authenticated proof provider used internally by `privyProxyProver()`. */
export class PrivyProxyProofProvider {
  private requestId = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(
    private readonly base: BaseProofProvider,
    private readonly poolAddress: string,
    private readonly options: PrivyProxyProverOptions,
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 130_000;
    this.maxRetries = options.retry?.maxRetries ?? 3;
    this.baseDelayMs = options.retry?.baseDelayMs ?? 1_000;
  }

  getDefaultDetails(): Promise<unknown> {
    return this.base.getDefaultDetails();
  }

  invalidateNonceCache(): void {
    this.base.invalidateNonceCache();
  }

  private async accessToken(forceRefresh: boolean): Promise<string> {
    const value =
      typeof this.options.accessToken === "function"
        ? await this.options.accessToken({ forceRefresh })
        : this.options.accessToken;
    if (!value.trim())
      throw new ProverProxyClientError("Privy access token is empty.");
    return value;
  }

  private async callOnce(
    invocation: unknown,
    blockIdentifier: unknown,
    forceRefresh: boolean,
    callerSignal?: AbortSignal,
  ): Promise<ProofResult> {
    const token = await this.accessToken(forceRefresh);
    const body = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method: "starknet_proveTransaction",
      params: {
        block_id: normalizeBlockId(blockIdentifier),
        transaction: invocation,
      },
    };
    if (callerSignal?.aborted) throw abortError(callerSignal);
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(abortError(callerSignal));
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          [PROVER_PROXY_TENANT_HEADER]: this.options.tenantId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch (error) {
        throw new ProverProxyClientError(
          "Prover proxy returned invalid JSON.",
          response.status,
          undefined,
          { cause: error },
        );
      }
      const rpcError = payload.error as
        | { code?: number; message?: string }
        | undefined;
      if (!response.ok || rpcError) {
        throw new ProverProxyClientError(
          rpcError?.message ?? `Prover proxy HTTP ${response.status}.`,
          response.status,
          rpcError?.code,
        );
      }
      const result = payload.result as
        | {
            proof?: unknown;
            proof_facts?: unknown;
            l2_to_l1_messages?: unknown;
            additional_data?: unknown;
          }
        | undefined;
      if (
        !result ||
        typeof result.proof !== "string" ||
        !Array.isArray(result.proof_facts) ||
        !result.proof_facts.every((fact) => typeof fact === "string") ||
        !Array.isArray(result.l2_to_l1_messages)
      ) {
        throw new ProverProxyClientError(
          "Prover proxy returned an invalid proof response.",
          response.status,
        );
      }
      const pool = BigInt(this.poolAddress);
      const message = result.l2_to_l1_messages.find((candidate) => {
        if (!candidate || typeof candidate !== "object") return false;
        try {
          return (
            BigInt((candidate as { from_address: string }).from_address) ===
            pool
          );
        } catch {
          return false;
        }
      }) as { payload?: unknown } | undefined;
      if (!message || !Array.isArray(message.payload)) {
        throw new ProverProxyClientError(
          "Prover response did not contain the privacy-pool output.",
          response.status,
        );
      }
      if (!message.payload.every((felt) => typeof felt === "string")) {
        throw new ProverProxyClientError(
          "Privacy-pool output contains invalid felts.",
          response.status,
        );
      }
      return {
        data: result.proof,
        output: message.payload as string[],
        proofFacts: result.proof_facts as string[],
        additionalData: result.additional_data,
      };
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  async prove(
    invocation: unknown,
    blockIdentifier?: unknown,
  ): Promise<ProofResult> {
    if (blockIdentifier === undefined) {
      throw new ProverProxyClientError(
        "A numeric proving block identifier is required by the proxy.",
      );
    }
    const callerSignal = callerAbortSignal(this.options.abortSignal);
    let refreshedAuth = false;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.callOnce(
          invocation,
          blockIdentifier,
          refreshedAuth,
          callerSignal,
        );
      } catch (error) {
        if (callerSignal?.aborted) throw abortError(callerSignal);
        if (
          error instanceof ProverProxyClientError &&
          error.status === 401 &&
          error.code === -32001 &&
          typeof this.options.accessToken === "function" &&
          !refreshedAuth
        ) {
          refreshedAuth = true;
          continue;
        }
        if (attempt >= this.maxRetries || !transient(error)) throw error;
        await delay(
          Math.min(this.baseDelayMs * 2 ** attempt, 30_000),
          callerSignal,
        );
      }
    }
  }
}

/**
 * Use the shared Privy-authenticated prover proxy. The returned source plugs
 * into `Strk20Privy` exactly like `serviceProver()`.
 */
export function privyProxyProver(
  options: PrivyProxyProverOptions,
): Strk20Prover {
  if (!options.tenantId.trim()) throw new ConfigError("tenantId is required.");
  let url: string;
  try {
    const parsed = new URL(options.url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    url = parsed.toString();
  } catch (error) {
    throw new ConfigError("Proxy URL must be a valid HTTP(S) URL.", {
      cause: error,
    });
  }
  const resolvedOptions = { ...options, url };
  return {
    kind: "service",
    submittable: options.submittable ?? true,
    async resolve(context: ProverContext) {
      const sdk = await loadPrivacySdk();
      const Constructor = sdk.ProvingServiceProofProvider;
      if (!Constructor) {
        throw new ConfigError(
          "Installed privacy SDK does not export ProvingServiceProofProvider.",
        );
      }
      const base = new Constructor(url, context.chainId, {
        nodeUrl: context.nodeUrl,
        poolAddress: context.poolAddress,
        requestTimeoutMs: options.requestTimeoutMs,
      });
      return new PrivyProxyProofProvider(
        base,
        context.poolAddress,
        resolvedOptions,
      );
    },
  };
}

/** Structural helper for tests and custom integrations. */
export function createPrivyProxyProofProvider(
  base: BaseProofProvider,
  poolAddress: string,
  options: PrivyProxyProverOptions,
): PrivyProxyProofProvider {
  return new PrivyProxyProofProvider(base, poolAddress, options);
}
