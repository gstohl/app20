import test from 'node:test';
import assert from 'node:assert/strict';
import { ec, shortString, typedData } from 'starknet';
import { handleReadyProofSession, authenticateReadyProofToken } from '../src/ready-proof-auth.ts';
import { buildReadyProofSessionTypedData, READY_PROOF_SESSION_PURPOSE, type ReadyProofSessionClaim } from '../../../src/lib/ready-proof-session.ts';
import type { RelayDependencies, RelayEnv } from '../src/types.ts';
const now = 1_800_000_000_000, key = '0x1234567890', publicKey = ec.starkCurve.getPublicKey(key);
const env = { PROOF_CAPABILITY_SECRET: 'a'.repeat(64), STARKNET_MAINNET_RPC_URL: 'https://pinned-rpc.example/mainnet', STARKNET_MAINNET_AUTHORIZATION: 'PRIVATE_RPC_TOKEN' } as RelayEnv;
const claim: ReadyProofSessionClaim = { account: '0x123', chainId: '0x534e5f4d41494e', origin: 'https://app20.io', issuedAt: now / 1000, expiresAt: now / 1000 + 900, nonce: '0x123abc' };
function sign(value = claim) { const sig = ec.starkCurve.sign(typedData.getMessageHash(buildReadyProofSessionTypedData(value), value.account), key); return [sig.r, sig.s].map(v => `0x${v.toString(16)}`); }
function request(value = claim, signature = sign(value), origin = value.origin) { return new Request('https://app20.io/api/privacy/ready-proof-session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ claim: value, signature }) }); }
function harness(overrides: { chain?: string; verification?: string; redirect?: boolean } = {}) {
  let calls = 0, releases = 0;
  const gate = { acquire: async () => ({ release: async () => { releases++; } }) };
  const deps = { now: () => now, fetch: async (url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(String(url), env.STARKNET_MAINNET_RPC_URL);
    assert.equal(new Headers(init.headers).get('authorization'), 'PRIVATE_RPC_TOKEN');
    assert.equal(init.redirect, 'manual');
    if (overrides.redirect) return new Response(null, { status: 302 });
    const body = JSON.parse(String(init.body));
    if (body.method === 'starknet_chainId') return Response.json({ jsonrpc: '2.0', id: 1, result: overrides.chain ?? claim.chainId });
    assert.equal(body.params.block_id, 'latest');
    assert.equal(body.params.request.contract_address, claim.account);
    const [digest, count, r, s] = body.params.request.calldata;
    assert.equal(BigInt(count), 2n);
    const valid = ec.starkCurve.verify(new ec.starkCurve.Signature(BigInt(r), BigInt(s)), digest, publicKey);
    return Response.json({ jsonrpc: '2.0', id: 1, result: [overrides.verification ?? (valid ? shortString.encodeShortString('VALID') : '0x0')] });
  } } as RelayDependencies;
  return { deps, gate, calls: () => calls, releases: () => releases };
}
test('SNIP-12 service authentication uses the account contract and mints reproducible bounded tokens', async () => {
  assert.equal((buildReadyProofSessionTypedData(claim).message as { purpose: string }).purpose, READY_PROOF_SESSION_PURPOSE);
  const h = harness();
  const a = await handleReadyProofSession(request(), env, h.deps, h.gate);
  assert.equal(a.headers.get('cache-control'), 'no-store');
  const first = await a.json() as { token: string };
  const second = await (await handleReadyProofSession(request(), env, h.deps, h.gate)).json() as { token: string };
  assert.equal(first.token, second.token, 'Replays cannot extend the expiry or create a new principal');
  assert.deepEqual(await authenticateReadyProofToken(first.token, claim.origin, env, now), claim);
  assert.equal(h.calls(), 4); assert.equal(h.releases(), 2);
  assert.equal(first.token.includes('PRIVATE_RPC_TOKEN'), false);
  await assert.rejects(() => authenticateReadyProofToken(first.token, 'https://evil.example', env, now), /invalid or expired/);
  await assert.rejects(() => authenticateReadyProofToken(first.token, claim.origin, env, now + 900_000), /invalid or expired/);
  const fields = first.token.split('.'); fields[1] = btoa(JSON.stringify({ ...claim, account: '0x456' })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  await assert.rejects(() => authenticateReadyProofToken(fields.join('.'), claim.origin, env, now), /invalid or expired/);
});
test('tampered signed claims, non-VALID responses and a wrong pinned chain fail closed', async () => {
  const altered = { ...claim, nonce: '0x321' }, h = harness();
  await assert.rejects(() => handleReadyProofSession(request(altered, sign(claim)), env, h.deps, h.gate), /signature could not/);
  assert.equal(h.releases(), 1);
  for (const overrides of [{ verification: '0x1' }, { chain: '0x534e5f5345504f4c4941' }, { redirect: true }]) {
    const h = harness(overrides);
    await assert.rejects(() => handleReadyProofSession(request(), env, h.deps, h.gate), /signature|network|unavailable/);
    assert.equal(h.releases(), 1);
  }
});
test('cross-origin, stale, oversized and overlong claims never reach RPC', async () => {
  const h = harness();
  await assert.rejects(() => handleReadyProofSession(request(claim, sign(), 'https://evil.example'), env, h.deps, h.gate), /origin/i);
  await assert.rejects(() => handleReadyProofSession(request({ ...claim, issuedAt: claim.issuedAt - 200, expiresAt: claim.expiresAt - 200 }), env, h.deps, h.gate), /expired/);
  const overlong = new Request('https://app20.io/api/privacy/ready-proof-session', { method: 'POST', headers: { origin: claim.origin, 'content-type': 'application/json' }, body: JSON.stringify({ claim: { ...claim, expiresAt: claim.expiresAt + 1 }, signature: sign() }) });
  await assert.rejects(() => handleReadyProofSession(overlong, env, h.deps, h.gate), /Invalid signed/);
  const big = new Request('https://app20.io/api/privacy/ready-proof-session', { method: 'POST', headers: { origin: claim.origin, 'content-type': 'application/json' }, body: 'x'.repeat(17000) });
  await assert.rejects(() => handleReadyProofSession(big, env, h.deps, h.gate), /too large/);
  assert.equal(h.calls(), 0);
});
test('Ready proof jobs remain owned across renewal and reject cross-origin service use', async () => {
  const { relayStarkscanProof } = await import('../src/starkscan-prover.ts');
  const h = harness();
  const mint = async (value = claim) => (await (await handleReadyProofSession(request(value), env, h.deps, h.gate)).json() as { token: string }).token;
  const token = await mint(), renewed = await mint({ ...claim, nonce: '0x999' });
  let upstreamCalls = 0;
  const dependencies = { now: () => now, privyDirectory: { authenticateAndList: async () => { throw new Error('Ready tokens must not be sent to Privy'); } }, fetch: async () => { upstreamCalls++; return Response.json({ jobId: 'prv_ready', terminal: false, status: 'queued' }); } } as unknown as RelayDependencies;
  const proofEnv = { ...env, STARKSCAN_API_KEY: 'PRIVATE_PROVER_KEY' };
  const post = (origin = claim.origin) => new Request('https://app20.io/api/privacy/prove', { method: 'POST', headers: { origin, authorization: `Bearer ${token}`, 'idempotency-key': 'unique-ready-proof-job' }, body: JSON.stringify({ transaction: { type: 'INVOKE' }, block_id: { block_number: 123 } }) });
  const result = await (await relayStarkscanProof(post(), proofEnv, dependencies, h.gate)).json() as { capability: string };
  const poll = new Request('https://app20.io/api/privacy/prove/prv_ready', { headers: { authorization: `Bearer ${renewed}`, 'x-app20-proof-capability': result.capability } });
  await relayStarkscanProof(poll, proofEnv, dependencies, h.gate);
  assert.equal(upstreamCalls, 2);
  await assert.rejects(() => relayStarkscanProof(post('https://evil.example'), proofEnv, dependencies, h.gate), /origin/i);
  assert.equal(upstreamCalls, 2);
});
