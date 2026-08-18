import type { PrivyClient } from "@privy-io/node";
import { PrivyError } from "./errors.js";
import {
  normalizeStarknetHash,
  splitStarkSignature,
  StarknetHashSigner,
  verifyStarkSignature,
} from "./hash-signer.js";
import { extractSignature, requireAuthorizationAsync } from "./privy.js";
import type { AuthorizationOptions } from "./types.js";

export interface PrivySignerOptions {
  privy: PrivyClient;
  walletId: string;
  publicKey: string;
  authorization?: AuthorizationOptions;
  fallbackAuthorizationKey?: string;
}

/**
 * starknet.js `SignerInterface` that never holds a Stark private key.
 * Transaction / SNIP-12 hashes are computed locally; only the final hash is
 * sent to Privy `rawSign`.
 */
export class PrivySigner extends StarknetHashSigner {
  constructor(private readonly options: PrivySignerOptions) {
    super(options.publicKey);
  }

  private async requestRawSignature(
    messageHash: string,
    forceRefresh: boolean,
  ): Promise<[string, string]> {
    const authorization_context = await requireAuthorizationAsync(
      this.options.authorization,
      this.options.fallbackAuthorizationKey,
      forceRefresh,
    );
    const normalizedHash = normalizeStarknetHash(messageHash);
    const result = await this.options.privy
      .wallets()
      .rawSign(this.options.walletId, {
        params: { hash: normalizedHash },
        authorization_context,
      });
    const signature = extractSignature(result);
    if (
      !verifyStarkSignature(signature, normalizedHash, this.options.publicKey)
    ) {
      throw new PrivyError(
        "Privy rawSign returned a signature that does not match the wallet public key.",
      );
    }
    return splitStarkSignature(signature);
  }

  async signRaw(messageHash: string): Promise<[string, string]> {
    try {
      return await this.requestRawSignature(messageHash, false);
    } catch (error) {
      if (this.options.authorization?.userJwtProvider && isAuthError(error)) {
        try {
          return await this.requestRawSignature(messageHash, true);
        } catch (refreshedError) {
          throw privySigningError(refreshedError);
        }
      }
      throw privySigningError(error);
    }
  }
}

function isAuthError(error: unknown): boolean {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : undefined;
  const status = record?.status ?? record?.statusCode;
  const message = error instanceof Error ? error.message : String(error);
  return (
    status === 401 ||
    /invalid auth(?:entication)? token|unauthori[sz]ed|token expired/i.test(
      message,
    )
  );
}

function privySigningError(error: unknown): PrivyError {
  const message = error instanceof Error ? error.message : String(error);
  return new PrivyError(`Privy rawSign failed: ${message}`, {
    cause: error,
  });
}
