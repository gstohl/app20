import type { TypedData } from 'starknet';
import { MAINNET_DEPLOYMENT } from './mainnet-deployment.ts';

export const READY_PROOF_SESSION_TTL = 15 * 60;
export const READY_PROOF_SESSION_PURPOSE = 'Authenticate confidential trading and proving';
export type ReadyProofSessionClaim = {
  account: string; chainId: string; origin: string; issuedAt: number; expiresAt: number; nonce: string;
};
const FIELD = 2n ** 251n + 17n * 2n ** 192n + 1n;
export function normalizeReadyProofSession(value: ReadyProofSessionClaim): ReadyProofSessionClaim {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'account,chainId,expiresAt,issuedAt,nonce,origin') throw new Error('Invalid wallet session.');
  const felt = (input: string, address = false) => {
    if (typeof input !== 'string' || !/^0x[0-9a-f]{1,64}$/i.test(input)) throw new Error('Invalid wallet session identity.');
    const n = BigInt(input);
    if (n <= 0n || n >= (address ? 2n ** 251n - 256n : FIELD)) throw new Error('Invalid wallet session identity.');
    return `0x${n.toString(16)}`;
  };
  const account = felt(value.account, true), chainId = felt(value.chainId), nonce = felt(value.nonce);
  if (BigInt(chainId) !== BigInt(MAINNET_DEPLOYMENT.chainId)) throw new Error('Mainnet wallet session required.');
  if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || value.issuedAt <= 0 || value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > READY_PROOF_SESSION_TTL) throw new Error('Invalid wallet session expiry.');
  const origin = new URL(value.origin);
  if (origin.origin !== value.origin || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error('Invalid wallet session origin.');
  return { account, chainId, origin: origin.origin, issuedAt: value.issuedAt, expiresAt: value.expiresAt, nonce };
}
export function buildReadyProofSessionTypedData(value: ReadyProofSessionClaim): TypedData {
  const claim = normalizeReadyProofSession(value);
  return {
    types: {
      StarknetDomain: [{ name: 'name', type: 'shortstring' }, { name: 'version', type: 'shortstring' }, { name: 'chainId', type: 'shortstring' }, { name: 'revision', type: 'shortstring' }],
      ProofSession: [{ name: 'purpose', type: 'string' }, { name: 'account', type: 'ContractAddress' }, { name: 'origin', type: 'string' }, { name: 'issuedAt', type: 'timestamp' }, { name: 'expiresAt', type: 'timestamp' }, { name: 'nonce', type: 'felt' }],
    },
    primaryType: 'ProofSession',
    domain: { name: 'APP20 Proof Session', version: '1', chainId: 'SN_MAIN', revision: '1' },
    message: { purpose: READY_PROOF_SESSION_PURPOSE, account: claim.account, origin: claim.origin, issuedAt: claim.issuedAt, expiresAt: claim.expiresAt, nonce: claim.nonce },
  };
}
