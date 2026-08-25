import {
  LOCALNET_SOLVER_KEY_ID,
  importQuotePublicKey,
  verifyCanonicalQuote,
} from "@app20/private-intents";

/** Localnet-only verifier material. The matching private key stays in the solver. */
export const LOCALNET_SOLVER_PUBLIC_JWK: JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "_PVrZccj13YPKpQkB1C9uwEGgiur1zisJ5si_91tPWg",
  y: "PyKzfsm_Se2XRYdW3-HVvKhpEqMJAqJ4RhgIMe2Bi_k",
  ext: true,
  key_ops: ["verify"],
};

let cachedPublicKey: CryptoKey | undefined;

export async function verifyLocalnetSolverQuote(
  canonical: string,
  signature: string,
  solverKey: string,
): Promise<boolean> {
  if (solverKey !== LOCALNET_SOLVER_KEY_ID) return false;
  cachedPublicKey ??= await importQuotePublicKey(LOCALNET_SOLVER_PUBLIC_JWK);
  return verifyCanonicalQuote(canonical, signature, cachedPublicKey);
}
