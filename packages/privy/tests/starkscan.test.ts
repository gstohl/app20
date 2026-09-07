import {test,expect,vi} from 'vitest';
import { starkscanProver, type ProofJob } from '../src/starkscan.js';
vi.mock('../src/sdk.js',()=>({loadPrivacySdk:async()=>({ProvingServiceProofProvider:class{getDefaultDetails(){return Promise.resolve({nonce:1n});}invalidateNonceCache(){}}})}));
const context={network:'mainnet',chainId:'0x1',nodeUrl:'https://rpc.invalid',poolAddress:'0x123',provider:{getChainId:async()=>'0x1',getBlockWithTxHashes:async()=>({block_hash:'0x456'})}} as never;
test('persists complete proof including screening data and reuses result without HTTP',async()=>{
 const entries=new Map<string,ProofJob>();let sends=0;
 const provider=await starkscanProver({relayUrl:'https://app20.io/api/privacy/prove',accessToken:async()=>'TOKEN',journal:{runExclusive:fn=>fn(),load:async key=>entries.get(key),save:async(key,v)=>{entries.set(key,structuredClone(v));}},fetch:async()=>{sends++;return Response.json({jobId:'prv_test',capability:'CAP',status:'succeeded',terminal:true,result:{proof:'0xabc',proof_facts:['0x1'],l2_to_l1_messages:[{from_address:'0x123',payload:['0x2']}],additional_data:{signature:{issued_at:1}}}});}}).resolve(context) as {prove:(inv:unknown,block:unknown)=>Promise<{additionalData:unknown}>};
 const result=await provider.prove({type:'INVOKE',sender_address:'0x123'},123);
 expect(result.additionalData).toEqual({signature:{issued_at:1}});
 expect([...entries.values()][0]!.phase).toBe('complete');
 await provider.prove({type:'INVOKE',sender_address:'0x123'},123);
 expect(sends).toBe(1);
});
test('uncertain polling remains fenced and never creates a replacement job',async()=>{
 let sends=0;
 const provider=await starkscanProver({relayUrl:'https://app20.io/api/privacy/prove',accessToken:async()=>'TOKEN',journal:{runExclusive:fn=>fn(),load:async()=>({phase:'polling',idempotencyKey:'id',jobId:'prv_test'}),save:async()=>{}},fetch:async()=>{sends++;throw Error('should not send');}}).resolve(context) as {prove:(inv:unknown)=>Promise<unknown>};
 await expect(provider.prove({type:'INVOKE',sender_address:'0x123'})).rejects.toThrow('uncertain');expect(sends).toBe(0);
});
