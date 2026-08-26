import {
  LOCALNET_SECONDARY_SOLVER_KEY_ID,
  LOCALNET_SOLVER_KEY_ID,
  importQuotePublicKey,
  verifyCanonicalQuote,
} from "@app20/private-intents";

/** Localnet-only verifier material. The matching private key stays in the solver. */
export const LOCALNET_SOLVER_PUBLIC_JWKS: Readonly<Record<string, JsonWebKey>> =
  Object.freeze({
    [LOCALNET_SOLVER_KEY_ID]: {
      kty: "EC",
      crv: "P-256",
      x: "_PVrZccj13YPKpQkB1C9uwEGgiur1zisJ5si_91tPWg",
      y: "PyKzfsm_Se2XRYdW3-HVvKhpEqMJAqJ4RhgIMe2Bi_k",
      ext: true,
      key_ops: ["verify"],
    },
    [LOCALNET_SECONDARY_SOLVER_KEY_ID]: {
      kty: "EC",
      crv: "P-256",
      x: "dtUmuk6yzQNMRSDwXxx4zAKKFGdot76QVsPJ-8JIBuE",
      y: "qd3MkASTsLKXlWATLvBhvKap5s6jSkFv6t5-DJGx3L4",
      ext: true,
      key_ops: ["verify"],
    },
  });

export const LOCALNET_SOLVER_PUBLIC_JWK = LOCALNET_SOLVER_PUBLIC_JWKS[
  LOCALNET_SOLVER_KEY_ID
] as JsonWebKey;

const cachedPublicKeys = new Map<string, CryptoKey>();

export async function verifyLocalnetSolverQuote(
  canonical: string,
  signature: string,
  solverKey: string,
): Promise<boolean> {
  const publicJwk = LOCALNET_SOLVER_PUBLIC_JWKS[solverKey];
  if (!publicJwk) return false;
  let publicKey = cachedPublicKeys.get(solverKey);
  if (!publicKey) {
    publicKey = await importQuotePublicKey(publicJwk);
    cachedPublicKeys.set(solverKey, publicKey);
  }
  return verifyCanonicalQuote(canonical, signature, publicKey);
}
