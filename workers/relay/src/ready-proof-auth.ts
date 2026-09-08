import { hash, shortString, typedData } from 'starknet';
import { buildReadyProofSessionTypedData, normalizeReadyProofSession, type ReadyProofSessionClaim } from '../../../src/lib/ready-proof-session.ts';
import { MAINNET_DEPLOYMENT } from '../../../src/lib/mainnet-deployment.ts';
import { RelayHttpError } from './errors.ts';
import { readBoundedRequest, readBoundedResponse } from './body.ts';
import { requireSameOrigin, validateUpstreamUrl } from './origin.ts';
import type { AtomicGate, RelayDependencies, RelayEnv } from './types.ts';

export const READY_PROOF_TOKEN_PREFIX = 'app20-ready-proof-v1';
const enc = new TextEncoder();
function base64(bytes: Uint8Array): string { return btoa(Array.from(bytes, v => String.fromCharCode(v)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decode(value: string): Uint8Array { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding.'); return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
async function signature(payload: string, env: RelayEnv): Promise<Uint8Array> {
  if (!env.PROOF_CAPABILITY_SECRET || enc.encode(env.PROOF_CAPABILITY_SECRET).length < 32) throw new RelayHttpError(503, 'Wallet proof sessions are not configured.');
  const key = await crypto.subtle.importKey('raw', enc.encode(env.PROOF_CAPABILITY_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${READY_PROOF_TOKEN_PREFIX}.${payload}`)));
}
export async function authenticateReadyProofToken(token: string, origin: string, env: RelayEnv, now = Date.now()): Promise<ReadyProofSessionClaim> {
  try {
    if (token.length > 4096) throw new Error();
    const [prefix, payload, mac, extra] = token.split('.');
    if (prefix !== READY_PROOF_TOKEN_PREFIX || !payload || !mac || extra) throw new Error();
    const supplied = decode(mac), expected = await signature(payload, env);
    let mismatch = supplied.length ^ expected.length;
    for (let i = 0; i < expected.length; i++) mismatch |= expected[i]! ^ (supplied[i] ?? 0);
    if (mismatch) throw new Error();
    const claim = normalizeReadyProofSession(JSON.parse(new TextDecoder().decode(decode(payload))));
    const seconds = Math.floor(now / 1000);
    if (claim.origin !== origin || claim.issuedAt > seconds + 30 || claim.expiresAt <= seconds) throw new Error();
    return claim;
  } catch (error) {
    if (error instanceof RelayHttpError && error.status === 503) throw error;
    throw new RelayHttpError(401, 'Wallet proof session is invalid or expired.');
  }
}
/** Wallet message authentication only: this handler never signs or broadcasts a transaction. */
export async function handleReadyProofSession(request: Request, env: RelayEnv, deps: RelayDependencies, gate: AtomicGate): Promise<Response> {
  requireSameOrigin(request, env);
  if (request.method !== 'POST') throw new RelayHttpError(405, 'Method not allowed.');
  if ((request.headers.get('content-type') ?? '').split(';')[0]?.trim() !== 'application/json') throw new RelayHttpError(415, 'Expected application/json.');
  let claim: ReadyProofSessionClaim, walletSignature: string[];
  try {
    const value = JSON.parse(new TextDecoder().decode(await readBoundedRequest(request, 16384, 'Wallet session request is too large.')));
    if (!value || Object.keys(value).sort().join(',') !== 'claim,signature') throw new Error();
    claim = normalizeReadyProofSession(value.claim);
    walletSignature = value.signature;
    if (!Array.isArray(walletSignature) || walletSignature.length < 2 || walletSignature.length > 64 || walletSignature.some(v => typeof v !== 'string' || !/^0x[0-9a-f]{1,64}$/i.test(v) || BigInt(v) >= 2n ** 251n + 17n * 2n ** 192n + 1n)) throw new Error();
  } catch (error) { if (error instanceof RelayHttpError) throw error; throw new RelayHttpError(400, 'Invalid signed wallet session.'); }
  const now = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  if (claim.origin !== (request.headers.get('origin') ?? new URL(request.url).origin) || claim.issuedAt < now - 120 || claim.issuedAt > now + 30 || claim.expiresAt <= now) throw new RelayHttpError(401, 'Wallet session is expired or for another origin.');
  // Replaying the same signed claim remints the same token and never extends its deadline.
  const payload = base64(enc.encode(JSON.stringify(claim)));
  const tokenMac = await signature(payload, env);
  const upstream = validateUpstreamUrl(env.STARKNET_MAINNET_RPC_URL, env);
  const lease = await gate.acquire({ subject: `ready-auth:${claim.account}`, service: 'starknet-mainnet', budget: 'rpc-read' });
  try {
    const rpc = async (method: string, params: unknown) => {
      const headers = new Headers({ 'content-type': 'application/json' });
      if (env.STARKNET_MAINNET_AUTHORIZATION) headers.set('authorization', env.STARKNET_MAINNET_AUTHORIZATION);
      const response = await deps.fetch(upstream, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if (!response.ok || response.status >= 300) { await response.body?.cancel(); throw new RelayHttpError(502, 'Wallet verification is unavailable.'); }
      let reply;
      try { reply = JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, 16384, 'Wallet verification response is too large.'))); } catch { throw new RelayHttpError(502, 'Wallet verification is unavailable.'); }
      if (reply.jsonrpc !== '2.0' || reply.id !== 1 || reply.error || reply.result === undefined) throw new RelayHttpError(401, 'Wallet signature could not be verified.');
      return reply.result;
    };
    const chain = await rpc('starknet_chainId', {});
    if (typeof chain !== 'string' || chain.toLowerCase() !== MAINNET_DEPLOYMENT.chainId) throw new RelayHttpError(502, 'Wallet verification network mismatch.');
    const digest = typedData.getMessageHash(buildReadyProofSessionTypedData(claim), claim.account);
    const result = await rpc('starknet_call', { block_id: 'latest', request: { contract_address: claim.account, entry_point_selector: hash.getSelectorFromName('is_valid_signature'), calldata: [digest, `0x${walletSignature.length.toString(16)}`, ...walletSignature] } });
    if (!Array.isArray(result) || result.length !== 1 || typeof result[0] !== 'string' || !/^0x[0-9a-f]+$/i.test(result[0]) || BigInt(result[0]) !== BigInt(shortString.encodeShortString('VALID'))) throw new RelayHttpError(401, 'Wallet signature could not be verified.');
    return Response.json({ token: `${READY_PROOF_TOKEN_PREFIX}.${payload}.${base64(tokenMac)}`, account: claim.account, expiresAt: claim.expiresAt, origin: claim.origin }, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  } finally { await lease.release().catch(() => {}); }
}
