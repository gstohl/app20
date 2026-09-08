import { createPrivyWalletDirectory } from './bootstrap.ts';
import { RelayHttpError } from './errors.ts';
import { readBoundedRequest, readBoundedResponse } from './body.ts';
import type { AtomicGate, RelayDependencies, RelayEnv } from './types.ts';
import { authenticateReadyProofToken, READY_PROOF_TOKEN_PREFIX } from './ready-proof-auth.ts';
import { requireSameOrigin } from './origin.ts';
const upstream = 'https://api.starkscan.co/v1/SN_MAIN/prove';
const enc = new TextEncoder();
async function mac(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(input))), b => b.toString(16).padStart(2, '0')).join('');
}
function same(a: string, b: string): boolean {
  let v = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length,b.length); i++) v |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return v === 0;
}
export async function relayStarkscanProof(request: Request, env: RelayEnv, deps: RelayDependencies, gate: AtomicGate): Promise<Response> {
  if (!env.STARKSCAN_API_KEY || !env.PROOF_CAPABILITY_SECRET || env.PROOF_CAPABILITY_SECRET.length < 32) throw new RelayHttpError(503, 'Proving is not configured.');
  const bearer = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!bearer || bearer.length > 8192) throw new RelayHttpError(401, 'Authentication required.');
  let subject: string;
  const agents: Record<string,string> = JSON.parse(env.PROVER_AGENT_TOKEN_HASHES ?? '{}');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(bearer))),b=>b.toString(16).padStart(2,'0')).join('');
  if (bearer.startsWith(`${READY_PROOF_TOKEN_PREFIX}.`)) {
    if (request.method === 'POST' || request.headers.has('origin')) requireSameOrigin(request, env);
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new RelayHttpError(403, 'Cross-origin request rejected.');
    const claim = await authenticateReadyProofToken(bearer, new URL(request.url).origin, env, deps.now?.());
    subject = `ready:${claim.chainId}:${claim.account}`;
  } else if (agents[digest]) subject = `agent:${agents[digest]}`;
  else {
    try { subject = `privy:${(await (deps.privyDirectory ?? createPrivyWalletDirectory(env)).authenticateAndList(bearer)).subject}`; }
    catch { throw new RelayHttpError(401,'Authentication required.'); }
  }
  const sub = await mac(env.PROOF_CAPABILITY_SECRET, subject);
  const path = new URL(request.url).pathname;
  const isSubmit = path === '/api/privacy/prove';
  let url = upstream;
  const headers = new Headers({ 'X-Starkscan-Api-Key': env.STARKSCAN_API_KEY, 'content-type': 'application/json' });
  let body: Uint8Array | undefined;
  if (isSubmit) {
    if (request.method !== 'POST') throw new RelayHttpError(405,'Method not allowed.');
    const id = request.headers.get('idempotency-key') ?? '';
    if (!/^[\x21\x23-\x7e]{16,128}$/.test(id)) throw new RelayHttpError(400,'A stable Idempotency-Key is required.');
    body = await readBoundedRequest(request, 1024*1024, 'Proof request is too large.');
    let value;
    try { value = JSON.parse(new TextDecoder().decode(body)); } catch { throw new RelayHttpError(400,'Invalid proof request.'); }
    if (!value || value.transaction?.type !== 'INVOKE' || !value.block_id || typeof value.block_id !== 'object' || !('block_number' in value.block_id || 'block_hash' in value.block_id)) throw new RelayHttpError(400,'An INVOKE and explicit proving block are required.');
    headers.set('Idempotency-Key', await mac(env.PROOF_CAPABILITY_SECRET,`${sub}:${id}`));
  } else {
    if (request.method !== 'GET') throw new RelayHttpError(405,'Method not allowed.');
    const job = path.slice('/api/privacy/prove/'.length);
    if (!/^prv_[a-zA-Z0-9_-]{1,100}$/.test(job)) throw new RelayHttpError(400,'Invalid job.');
    const token = request.headers.get('x-app20-proof-capability') ?? '';
    if (!same(token, await mac(env.PROOF_CAPABILITY_SECRET,`${sub}:${job}`))) throw new RelayHttpError(403,'This proof job is not authorized.');
    url += '/'+job;
  }
  const lease = await gate.acquire({ subject: sub, service: 'prover', budget: 'ohttp-prover' });
  try {
    const response = await deps.fetch(url,{ method:isSubmit?'POST':'GET',headers,body:body as BodyInit|undefined,redirect:'manual',signal:AbortSignal.timeout(30000) });
    if (response.status >= 300 && response.status < 400) throw new RelayHttpError(502,'Prover redirect rejected.');
    const bytes = await readBoundedResponse(response,64*1024*1024,'Proof response too large.');
    let value;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new RelayHttpError(502,'Invalid prover response.'); }
    // Only documented fields; never propagate arbitrary upstream headers or diagnostics.
    if (!response.ok) return Response.json({ code: typeof value.code === 'string' ? value.code : 'prover_unavailable' },{status:response.status,headers:{'cache-control':'no-store',...(response.headers.has('retry-after')?{'retry-after':response.headers.get('retry-after')!}:{})}});
    if (!/^prv_[a-zA-Z0-9_-]{1,100}$/.test(value.jobId) || typeof value.terminal !== 'boolean') throw new RelayHttpError(502,'Invalid proof job response.');
    if (!isSubmit && url !== upstream+'/'+value.jobId) throw new RelayHttpError(502,'Proof job mismatch.');
    return Response.json({ ...value, capability: await mac(env.PROOF_CAPABILITY_SECRET,`${sub}:${value.jobId}`) },{status:response.status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
  } finally { await lease.release().catch(()=>{}); }
}
