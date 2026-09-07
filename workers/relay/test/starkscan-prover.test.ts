import test from 'node:test';
import assert from 'node:assert/strict';
import { relayStarkscanProof } from '../src/starkscan-prover.ts';
import type { RelayEnv, RelayDependencies } from '../src/types.ts';
const env={STARKSCAN_API_KEY:'UPSTREAM_SECRET',PROOF_CAPABILITY_SECRET:'a'.repeat(64)} as RelayEnv;
const gate={acquire:async()=>({release:async()=>{}})};
const body=JSON.stringify({block_id:{block_number:123},transaction:{type:'INVOKE'}});
const request=(path='',token='alice',cap='')=>new Request('https://app20.io/api/privacy/prove'+path,{method:path?'GET':'POST',headers:{authorization:`Bearer ${token}`,'idempotency-key':'a-unique-logical-job','x-app20-proof-capability':cap},...(!path?{body}:{})});
test('proof relay protects credentials, scopes idempotency and binds polling to owner',async()=>{
  const seen:{url:string;init:RequestInit}[]=[];
  const deps={privyDirectory:{authenticateAndList:async(token:string)=>({subject:token,wallets:[]})},fetch:async(url:unknown,init:RequestInit)=>{seen.push({url:String(url),init});return Response.json({jobId:'prv_test',status:'queued',terminal:false,pollAfterSeconds:10},{status:202});}} as RelayDependencies;
  const a=await(await relayStarkscanProof(request(),env,deps,gate)).json() as {capability:string};
  assert.equal(new Headers(seen[0].init.headers).get('X-Starkscan-Api-Key'),'UPSTREAM_SECRET');
  assert.equal(JSON.stringify(a).includes('UPSTREAM_SECRET'),false);
  const idem=new Headers(seen[0].init.headers).get('Idempotency-Key');
  await relayStarkscanProof(request(),env,deps,gate);
  assert.equal(new Headers(seen[1].init.headers).get('Idempotency-Key'),idem);
  await assert.rejects(()=>relayStarkscanProof(request('/prv_test','bob',a.capability),env,deps,gate),/not authorized/);
  assert.equal(seen.length,2);
  await relayStarkscanProof(request('/prv_test','alice',a.capability),env,deps,gate);
  assert.equal(seen[2].url,'https://api.starkscan.co/v1/SN_MAIN/prove/prv_test');
});
test('unauthenticated, unpinned and redirect requests fail closed',async()=>{
  const deps={privyDirectory:{authenticateAndList:async()=>({subject:'a',wallets:[]})},fetch:async()=>new Response(null,{status:302,headers:{location:'https://evil.invalid'}})} as unknown as RelayDependencies;
  await assert.rejects(()=>relayStarkscanProof(new Request('https://app20.io/api/privacy/prove'),env,deps,gate),/Authentication/);
  await assert.rejects(()=>relayStarkscanProof(request(),env,deps,gate),/redirect/);
  const malformed=new Request('https://app20.io/api/privacy/prove',{method:'POST',headers:{authorization:'Bearer alice','idempotency-key':'a-unique-logical-job'},body:'{"transaction":{"type":"INVOKE"},"block_id":"latest"}'});
  await assert.rejects(()=>relayStarkscanProof(malformed,env,deps,gate),/explicit proving block/);
});
test('Worker handler returns authentication errors rather than rejecting its fetch promise',async()=>{
 const {createRelayHandler}=await import('../src/index.ts');
 const response=await createRelayHandler({gate})(new Request('https://app20.io/api/privacy/prove'),env);
 assert.equal(response.status,401);
});
