import { hash, shortString } from 'starknet';

/** Observed in the successful L1-confirmed APP20 transaction
 * 0x1e364ca1c778fd304fae9506dabade0f2c958e0e867465db9a7ceb0f13af36d
 * using starknet_getTransactionByHash with INCLUDE_PROOF_FACTS.
 * These are real recursive-prover pins; the devnet mock uses different identities.
 */
export const MAINNET_PROOF_FORMAT = Object.freeze({
  version: 'PROOF1',
  virtualProgramHash: '0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1',
});

// Starknet >=0.14.3 uses Blake/StarknetOsConfig4. The old mock uses Pedersen/V3.
// Source: starkware-libs/sequencer crates/starknet_api/src/core.rs.
export function realProofConfigHash(chainId: string, strkFeeToken: string): string {
  return `0x${hash.blake2sHashMany([shortString.encodeShortString('StarknetOsConfig4'), chainId, strkFeeToken].map(BigInt)).toString(16)}`;
}
