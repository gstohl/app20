import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,stat,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ec} from 'starknet';
import {loadMakerRuntime,normalizeMarkets,priceRequest,createMakerEngine,lockMakerDirectory,protectedMakerDirectory,makerAccessToken,makerMessageSignature} from './confidential-maker.mjs';
import {MAINNET_DEPLOYMENT as d} from '../src/lib/mainnet-deployment.ts';
const runtime=await loadMakerRuntime();
const market={sellToken:'0x10',buyToken:'0x20',rateNumerator:'3',rateDenominator:'2',minSellAmount:'2',maxSellAmount:'100',maxBuyAmount:'150',maxReservedBuyAmount:'200'};
const request={kind:'request',taker:'0xa',signerA:ec.starkCurve.getStarkKey('0x123'),sellToken:'0x10',buyToken:'0x20',sellAmount:'10',minimumAmount:'14'};
test('rates use exact floored integer amounts and explicit minimum/exposure caps',()=>{
 const markets=normalizeMarkets([market]);
 assert.equal(priceRequest({...request,sellAmount:'11'},markets).buyAmount,'16');
 for(const r of [{...request,minimumAmount:'16'},{...request,sellAmount:'101'},{...request,sellAmount:'1'},{...request,buyToken:'0x21'},{...request,sellAmount:'1.0'}])assert.throws(()=>priceRequest(r,markets));
 assert.throws(()=>priceRequest(request,markets,186n));
 assert.throws(()=>normalizeMarkets([{...market,rateDenominator:'0'}]));
 assert.throws(()=>normalizeMarkets([{...market,maxReservedBuyAmount:'1'}]));
});
test('explicit --run and private external adapter required before any config import',()=>{
 const result=spawnSync(process.execPath,['scripts/confidential-maker.mjs'],{encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/maker stopped/);
});
test('maker CLI loads an external adapter importing the wallet without a top-level await cycle',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'app20-maker-cli-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const adapter=join(directory,'adapter.mjs'),marker=join(directory,'loaded.json'),journal=join(directory,'rooms');
 await writeFile(adapter,`import {writeFile} from 'node:fs/promises';
 export async function createOptions(){
   const wallet=await import(${JSON.stringify(new URL('./confidential-maker-wallet.mjs',import.meta.url).href)});
   await writeFile(${JSON.stringify(marker)},JSON.stringify({walletImported:typeof wallet.createMakerWalletAdapter==='function'}),{mode:0o600});
   // Invalid markets stop startup before authentication, advertisement or any wallet operation.
   return {journalDirectory:${JSON.stringify(journal)},markets:[]};
 }`,{mode:0o600});
 const result=spawnSync(process.execPath,['scripts/confidential-maker.mjs','--run','--adapter',adapter],{encoding:'utf8',timeout:15000});
 assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,/maker stopped/);assert.doesNotMatch(result.stderr,/unsettled top-level await/i);
 assert.deepEqual(JSON.parse(await readFile(marker,'utf8')),{walletImported:true});
 assert.deepEqual(await readdir(journal),[]);
});
test('owner-only journal and exclusive maker lock',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'app20-maker-test-'));
 try{await chmod(dir,0o755);await assert.rejects(protectedMakerDirectory(dir));await chmod(dir,0o700);await protectedMakerDirectory(dir);const unlock=await lockMakerDirectory(dir);await assert.rejects(lockMakerDirectory(dir));await unlock();}finally{await rm(dir,{recursive:true,force:true});}
});
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'app20-maker-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let timestamp=1000, snapshot={block:100,timestamp,settled:false,registered:false,balanceA:'0',balanceB:'0',status:'setup'};
 const takerKey=await runtime.createRoomKey(), inbox=[], messages=new Map(), emitted=[], clients=[];
 let mature={balanceA:'0',balanceB:'0'};
 let failRead=false;
 let makerKey, transfers=0, preparations=0, failFunding=false;
 const provider={getChainId:async()=>d.chainId,getBlockWithTxHashes:async number=>({block_number:number,block_hash:'0x'+number.toString(16),status:'ACCEPTED_ON_L2'}),getTransactionReceipt:async()=>({execution_status:'SUCCEEDED',finality_status:'ACCEPTED_ON_L2',block_number:90,events:[{from_address:d.settlement.pool}]})};
 const api={advertise:async v=>{makerKey=v.publicKey;},inbox:async()=>inbox,messages:async(id,after)=>{if(failRead){failRead=false;throw Error('Temporary network failure');}return(messages.get(id)??[]).filter(m=>m.sequence>after);},send:async(id,envelope)=>{if(!emitted.some(e=>e.envelope.id===envelope.id))emitted.push({id,envelope});}};
 const options={journalDirectory:directory,account:{address:'0xb'},provider,proofProvider:{},markets:[market],name:'Bounded test maker',transfer:async p=>{transfers++;if(failFunding)throw Error('Unknown transport outcome');snapshot={...snapshot,balanceB:p.amount,status:'ready'};return {transaction_hash:'0xb01'};},submit:async()=>{throw Error('Maker must not submit joint operations');}};
 const deps={runtime:{...runtime,inspectConfidentialDeployment:async()=>snapshot},api,now:()=>timestamp,createClient:async opt=>{
  clients.push(opt);return {inspect:async()=>opt.provider===provider?snapshot:{...snapshot,...mature,block:snapshot.block-10,status:BigInt(mature.balanceA)>=10n&&BigInt(mature.balanceB)>=15n?'ready':'funding'},prepare:async mode=>{preparations++;return{agreement:opt.agreement,mode,digest:'0x1234'};},approve:async(prepared,role,sign)=>({role,digest:prepared.digest,signature:await sign(prepared.digest,{mode:prepared.mode,commitment:prepared.agreement.commitment})}),fund:async(role,transfer)=>{assert.equal(role,'b');return(await transfer({token:opt.agreement.terms.tokenB,recipient:opt.agreement.address,amount:opt.agreement.terms.amountB})).transaction_hash;},reconcile:async()=>{},execute:async(prepared,approvals)=>{assert.equal(opt.provider,provider);assert.equal(prepared.mode,'refundB');assert.deepEqual(approvals.map(a=>a.role),['b']);snapshot={...snapshot,balanceB:'0'};return '0xb02';}};
 }};
 let engine=await createMakerEngine(options,deps);await engine.tick();
 async function addRoom(payload={}){const id=runtime.roomId();inbox.push({id,expiresAt:timestamp+1800});messages.set(id,[]);await push(id,{...request,replyKey:takerKey.publicKey,...payload});return id;}
 async function push(id,payload){const list=messages.get(id);list.push({sequence:list.length+1,role:'taker',envelope:await runtime.sealRoomMessage(id,'taker',payload,makerKey)});}
 async function outgoing(id){return Promise.all(emitted.filter(m=>m.id===id).map(m=>runtime.openRoomMessage(id,{sequence:1,role:'maker',envelope:m.envelope},takerKey.pair)));}
 async function state(id){return JSON.parse(await readFile(join(directory,`room-${id}.json`),'utf8'));}
 return {directory,addRoom,push,outgoing,state,tick:()=>engine.tick(),refund:id=>engine.refundRoom(id),restart:async()=>{engine=await createMakerEngine(options,deps);},options,setTime:n=>{timestamp=n;snapshot={...snapshot,timestamp:n};},setSnapshot:s=>{snapshot={...snapshot,...s};},setMature:s=>{mature={...mature,...s};},failFunding:()=>{failFunding=true;},failRead:()=>{failRead=true;},counts:()=>({transfers,preparations}),clients};
}
test('quotes are encrypted, independently keyed, deterministic on duplicate request, with private disk mode',async t=>{
 const f=await fixture(t), a=await f.addRoom(),b=await f.addRoom();await f.tick();
 const qa=(await f.outgoing(a))[0],qb=(await f.outgoing(b))[0];
 assert.equal(qa.kind,'quote');assert.equal(qa.agreement.terms.amountB,'15');assert.equal(qa.expiresAt,1300);assert.equal(qa.agreement.deadline,2800);assert.notEqual(qa.viewingKey,qb.viewingKey);assert.notEqual(qa.agreement.signerB,qb.agreement.signerB);assert.notEqual(qa.agreement.address,qb.agreement.address);
 assert.equal((await stat(join(f.directory,`room-${a}.json`))).mode&0o777,0o600);
 const saved=await f.state(a);await f.push(a,saved.request);await f.restart();await f.tick();assert.equal((await f.outgoing(a)).length,1);assert.equal(f.counts().transfers,0);
});
test('changed request and expired acceptance cannot authorize setup or funding',async t=>{
 const f=await fixture(t),id=await f.addRoom();await f.tick();const q=(await f.outgoing(id))[0];
 await f.push(id,{...(await f.state(id)).request,sellAmount:'11'});await f.tick();assert.equal((await f.state(id)).status,'blocked');assert.equal(f.counts().preparations,0);
 const g=await fixture(t),other=await g.addRoom();await g.tick();const quote=(await g.outgoing(other))[0];g.setTime(1300);await g.push(other,{kind:'accepted',commitment:quote.agreement.commitment,deploymentHash:'0xd1'});await g.tick();assert.equal((await g.state(other)).status,'blocked');assert.equal(g.counts().transfers,0);
});
test('only actual mature A funding permits one B transfer, then mature B permits settlement approval',async t=>{
 const f=await fixture(t),id=await f.addRoom();await f.tick();const q=(await f.outgoing(id))[0];
 await f.push(id,{kind:'accepted',commitment:q.agreement.commitment,deploymentHash:'0xd1'});await f.tick();assert.equal(f.counts().preparations,1);
 await f.push(id,{kind:'confirmed',stage:'setup',hash:'0xa01'});await f.push(id,{kind:'confirmed',stage:'fundA',hash:'0xa02'});
 f.setSnapshot({registered:true,status:'funding',balanceA:'9'});await f.tick();assert.equal(f.counts().transfers,0);
 f.setSnapshot({balanceA:'10',block:99});await f.tick();assert.equal(f.counts().transfers,0);
 f.setSnapshot({block:100});f.setMature({balanceA:'10'});await f.tick();assert.equal(f.counts().transfers,1);assert.equal(f.counts().preparations,1);
 f.setMature({balanceB:'15'});await f.tick();assert.equal(f.counts().preparations,2);
 const outgoing=await f.outgoing(id);assert.deepEqual(outgoing.map(p=>p.kind),['quote','prepared','funded','prepared']);assert.equal(outgoing.at(-1).prepared.mode,'settle');
 await f.restart();await f.tick();assert.equal(f.counts().transfers,1);assert.equal(f.counts().preparations,2);
});
test('unknown funding outcome persists a fence across restart and never retries',async t=>{
 const f=await fixture(t),id=await f.addRoom();await f.tick();const q=(await f.outgoing(id))[0];await f.push(id,{kind:'accepted',commitment:q.agreement.commitment,deploymentHash:'0xd1'});await f.tick();
 await f.push(id,{kind:'confirmed',stage:'setup',hash:'0xa01'});await f.push(id,{kind:'confirmed',stage:'fundA',hash:'0xa02'});f.setSnapshot({registered:true,status:'funding',balanceA:'10'});f.setMature({balanceA:'10'});f.failFunding();await f.tick();
 assert.equal(f.counts().transfers,1);assert.equal((await f.state(id)).status,'blocked');assert.deepEqual((await f.state(id)).funding,{attempted:true});await f.restart();await f.tick();assert.equal(f.counts().transfers,1);
});
test('a quote reserves inventory across restart and refuses excessive exposure',async t=>{
 const f=await fixture(t),id=await f.addRoom({sellAmount:'100'});await f.tick();await f.restart();const second=await f.addRoom({sellAmount:'100'});await f.tick();assert.equal((await f.outgoing(second))[0].kind,'declined');assert.equal((await f.outgoing(id))[0].kind,'quote');
});
test('canonical message auth binds token to account, origin and expiry without transaction signing',async()=>{
 let signed, claim, calls=0;
 const options={account:{address:'0xb',signMessage:async value=>{signed=value;return['0x1','0x2'];}},baseUrl:'https://app20.io'};
 const token=makerAccessToken(options,runtime,async(url,init)=>{calls++;assert.equal(url,'https://app20.io/api/privacy/ready-proof-session');claim=JSON.parse(init.body).claim;return Response.json({token:'app20-ready-proof-v1.test',account:claim.account,expiresAt:claim.expiresAt,origin:claim.origin});},()=>1000);
 assert.equal(await token(),'app20-ready-proof-v1.test');await token();assert.equal(calls,1);assert.equal(signed.message.account,'0xb');assert.equal(claim.origin,'https://app20.io');assert.equal(claim.expiresAt,1900);
});

test('an old unrelated pool receipt cannot make newly created A notes mature',async t=>{
 const f=await fixture(t),id=await f.addRoom();await f.tick();const q=(await f.outgoing(id))[0];await f.push(id,{kind:'accepted',commitment:q.agreement.commitment,deploymentHash:'0xd1'});await f.tick();
 await f.push(id,{kind:'confirmed',stage:'setup',hash:'0xa01'});await f.push(id,{kind:'confirmed',stage:'fundA',hash:'0x999'});
 f.setSnapshot({registered:true,status:'funding',balanceA:'10',block:200});await f.tick();assert.equal(f.counts().transfers,0);assert.equal((await f.state(id)).funding,undefined);
});

test('private timeout recovery is explicit, bound to B and fenced across restart',async t=>{
 const f=await fixture(t),id=await f.addRoom();await f.tick();const q=(await f.outgoing(id))[0];await f.push(id,{kind:'accepted',commitment:q.agreement.commitment,deploymentHash:'0xd1'});await f.tick();
 f.setSnapshot({registered:true,status:'funding',balanceA:'10',balanceB:'15',block:200});f.setMature({balanceA:'10',balanceB:'15'});
 await assert.rejects(f.refund(id),/Expired/);f.setTime(2900);await f.tick();assert.equal((await f.state(id)).refund,undefined);
 const result=await f.refund(id);assert.equal(result.transaction,'0xb02');assert.equal((await f.state(id)).status,'refunded');assert.deepEqual((await f.state(id)).refund,{attempted:true,hash:'0xb02'});
 await f.restart();assert.equal((await f.refund(id)).reused,true);
});

test('Node and wallet message signatures normalize without changing signed scalar values',()=>{
 const node=ec.starkCurve.sign('0x123','0x456');
 assert.deepEqual(makerMessageSignature(node),['0x'+node.r.toString(16),'0x'+node.s.toString(16)]);
 assert.deepEqual(makerMessageSignature(['1','0x02','0']),['0x1','0x2','0x0']);
 for(const invalid of [null,{},['0x1'],{r:0n,s:1n},{r:ec.starkCurve.CURVE.n,s:1n},['-1','1'],[2n**252n,1n]])assert.throws(()=>makerMessageSignature(invalid));
});
test('canonical maker authentication accepts the official Node Signature object',async()=>{
 const signature=ec.starkCurve.sign('0x123','0x456');
 const access=makerAccessToken({account:{address:'0xb',signMessage:async()=>signature},baseUrl:'https://app20.io'},runtime,async(_url,init)=>{
  const body=JSON.parse(init.body);assert.deepEqual(body.signature,makerMessageSignature(signature));
  return Response.json({token:'app20-ready-proof-v1.test',...body.claim});
 },()=>1000);
 assert.equal(await access(),'app20-ready-proof-v1.test');
});

test('a transient room read failure preserves a healthy quote and retries idempotently',async t=>{
 const f=await fixture(t),id=await f.addRoom();await f.tick();const before=await f.state(id);f.failRead();await f.tick();
 assert.equal((await f.state(id)).status,'quoted');assert.equal((await f.state(id)).cursor,before.cursor);
 const q=(await f.outgoing(id))[0];await f.push(id,{kind:'accepted',commitment:q.agreement.commitment,deploymentHash:'0xd1'});await f.tick();
 assert.equal((await f.state(id)).status,'accepted');assert.equal(f.counts().preparations,1);assert.equal((await f.outgoing(id)).filter(p=>p.kind==='quote').length,1);
});
test('explicit maker refund can recover new late notes after an earlier refund and settlement',async t=>{
 const f=await fixture(t),id=await f.addRoom();await f.tick();const q=(await f.outgoing(id))[0];await f.push(id,{kind:'accepted',commitment:q.agreement.commitment,deploymentHash:'0xd1'});await f.tick();
 f.setTime(2900);f.setSnapshot({registered:true,status:'refundable',balanceA:'0',balanceB:'15',block:200});f.setMature({balanceA:'0',balanceB:'15'});await f.refund(id);
 f.setSnapshot({settled:true,balanceB:'5'});f.setMature({balanceB:'5'});const before=f.counts().preparations;const result=await f.refund(id);
 assert.equal(result.reused,false);assert.equal(f.counts().preparations,before+1);assert.equal((await f.state(id)).refundHistory.length,1);
});
