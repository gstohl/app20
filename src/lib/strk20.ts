import type { WALLET_API } from "@starknet-io/types-js";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import type { ProviderInterface, WalletAccountV6 } from "starknet";
import { walletV6 } from "starknet";

export const MIN_STRK20_WALLET_API = "0.10";
export const STRK20_WAIT_TIMEOUT_MS = 20 * 60 * 1_000;

export type Strk20Capability = {
  supported: boolean;
  walletApiVersions: string[];
  specVersions: string[];
};

/** STRK20 wallet methods landed in Wallet API 0.10. */
export function supportsWalletApi010(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)/i.exec(version.trim());
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || (major === 0 && minor >= 10);
}

/**
 * Detect STRK20 support from the wallet's declared API/spec versions. This must
 * stay metadata-only: querying private balances as a feature probe can prompt,
 * fail for unrelated reasons, and leaks an unnecessary request.
 */
export async function detectStrk20Capability(
  wallet: WalletWithStarknetFeatures
): Promise<Strk20Capability> {
  const [walletApiResult, specsResult] = await Promise.allSettled([
    walletV6.supportedWalletApi(wallet),
    walletV6.supportedSpecs(wallet),
  ]);

  const walletApiVersions =
    walletApiResult.status === "fulfilled"
      ? walletApiResult.value.map(String)
      : [];
  const specVersions =
    specsResult.status === "fulfilled" ? specsResult.value.map(String) : [];

  return {
    supported: [...walletApiVersions, ...specVersions].some(
      supportsWalletApi010
    ),
    walletApiVersions,
    specVersions,
  };
}

export class Strk20WaitTimeoutError extends Error {
  readonly transactionHash: string;

  constructor(transactionHash: string, timeoutMs: number) {
    super(
      `Transaction confirmation exceeded ${Math.round(timeoutMs / 60_000)} minutes.`
    );
    this.name = "Strk20WaitTimeoutError";
    this.transactionHash = transactionHash;
  }
}

export async function waitForStrk20Transaction(
  provider: ProviderInterface,
  transactionHash: string,
  timeoutMs = STRK20_WAIT_TIMEOUT_MS
): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      provider.waitForTransaction(transactionHash, {
        retries: 400,
        retryInterval: 3_000,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Strk20WaitTimeoutError(transactionHash, timeoutMs)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export type SubmitActionsOptions = {
  timeoutMs?: number;
  onSubmitted?: (transactionHash: string) => void;
};

/** Submit exactly one STRK20 action batch and wait with a bounded timeout. */
export async function submitActions(
  account: WalletAccountV6,
  provider: ProviderInterface,
  actions: WALLET_API.STRK20_ACTION[],
  options: SubmitActionsOptions = {}
): Promise<{ transactionHash: string; receipt: unknown }> {
  const { transaction_hash: transactionHash } =
    await account.strk20InvokeTransaction(actions);

  options.onSubmitted?.(transactionHash);
  const receipt = await waitForStrk20Transaction(
    provider,
    transactionHash,
    options.timeoutMs
  );

  return { transactionHash, receipt };
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const parts = [value.code, value.message, value.reason]
      .filter((part) => typeof part === "string" || typeof part === "number")
      .map(String);
    if (parts.length) return parts.join(": ");
  }
  return "The wallet did not complete the action.";
}

/** Convert wallet/protocol rejections into UI state instead of uncaught errors. */
export function strk20ErrorMessage(error: unknown): string {
  const details = errorDetails(error);

  if (/screen|sanction|compliance|blocked depositor|privacy_leak/i.test(details)) {
    return "The deposit was declined by STRK20 protocol screening. No privacy action was submitted.";
  }
  if (/user.*(refus|reject)|rejected by user/i.test(details)) {
    return "The wallet request was declined.";
  }

  return details;
}
