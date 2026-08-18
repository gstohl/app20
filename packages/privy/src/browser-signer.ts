import { PrivyError } from "./errors.js";
import {
  normalizeStarknetHash,
  splitStarkSignature,
  StarknetHashSigner,
  verifyStarkSignature,
} from "./hash-signer.js";

export type BrowserRawSignResult = string | { signature: string };
export type BrowserRawSign = (
  hash: `0x${string}`,
) => Promise<BrowserRawSignResult>;

/**
 * Browser-safe Starknet signer adapter for Privy's `useSignRawHash` hook.
 * The callback is supplied by React code, so this module never imports a
 * backend Privy client or application secret.
 */
export class BrowserPrivySigner extends StarknetHashSigner {
  constructor(
    private readonly signingPublicKey: string,
    private readonly rawSign: BrowserRawSign,
  ) {
    super(signingPublicKey);
  }

  async signRaw(messageHash: string): Promise<[string, string]> {
    try {
      const normalizedHash = normalizeStarknetHash(messageHash);
      const result = await this.rawSign(normalizedHash);
      const signature = typeof result === "string" ? result : result.signature;
      if (typeof signature !== "string") {
        throw new Error("Signing callback did not return a signature.");
      }
      if (
        !verifyStarkSignature(signature, normalizedHash, this.signingPublicKey)
      ) {
        throw new PrivyError(
          "Browser rawSign returned a signature that does not match the wallet public key.",
        );
      }
      return splitStarkSignature(signature);
    } catch (error) {
      if (error instanceof PrivyError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new PrivyError(`Browser rawSign failed: ${message}`, {
        cause: error,
      });
    }
  }
}
