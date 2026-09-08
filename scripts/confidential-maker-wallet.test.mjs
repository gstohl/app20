import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ec,hash,shortString} from 'starknet';
import {createMakerWalletAdapter,normalizeMakerPayment,validateMakerTransferInvocation,makerResourceMaximum} from './confidential-maker-wallet.mjs';
import {MAINNET_DEPLOYMENT as d} from '../src/lib/mainnet-deployment.ts';
import {MAINNET_PROOF_FORMAT,realProofConfigHash} from '../src/lib/mainnet-proof-format.ts';
import {CONFIDENTIAL_RFQ_CONTRACT} from '../src/lib/confidential-rfq-deployment.ts';
const owner='0xbeef',target='0xcafe',viewing=0x123n,domain=shortString.encodeShortString;
const write=['0','11','1','22'],note=['8','33','44'],used=['9','55'];
function submission(mode='refundB',recipient=target,revision=0){
 const actions=[write,['8','33',String(44+revision)],used,...(mode==='refundB'?[['11',recipient,'2',domain('APP20_JOINT_COMPUTE_V1'),'3']]:[])];
 const output=[d.settlement.poolClassHash,String(actions.length),...actions.flat()];
 const proofFacts=[domain(MAINNET_PROOF_FORMAT.version),domain('VIRTUAL_SNOS'),MAINNET_PROOF_FORMAT.virtualProgramHash,domain('VIRTUAL_SNOS0'),'100','0xabc',realProofConfigHash(d.chainId,d.sellToken.address),'1',hash.computePoseidonHashOnElements([d.settlement.pool,0,output.length,...output])];
 return{proof:{data:Buffer.from('unit-test structural fixture; not a cryptographic proof').toString('base64'),output,proofFacts},call:{contractAddress:d.settlement.pool,entrypoint:'apply_actions',calldata:[...output.slice(1),'1']}};
}
const bounds={l1_gas:{max_amount:'0x0',max_price_per_unit:'0x1'},l2_gas:{max_amount:'0xa',max_price_per_unit:'0xa'},l1_data_gas:{max_amount:'0x0',max_price_per_unit:'0x1'}};
function invocation(payment={token:d.sellToken.address,recipient:target,amount:'7'},outgoing=payment.amount){
 const inner=[owner,viewing,3,6,1,payment.token,1,3,payment.recipient,1,payment.token,outgoing,1,1,3,owner,1,payment.token,3,1,1].map(String);
 return{sender_address:d.settlement.pool,calldata:['1',d.settlement.pool,hash.getSelectorFromName('compile_actions'),String(inner.length),...inner],signature:['0x1','0x2']};
}
async function fixture(t,overrides={}){
 const directory=await mkdtemp(join(tmpdir(),'app20-maker-wallet-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let settled='0';
 let nonce=5n,head=110,deadline=1700000000,allowance=0n,balance=10000n,poolFee=6n,failExecute=false,invalidSimulation=false,changedNonce=false,estimates=0,simulations=0,executions=0,proofs=0,discoveryBlock;
 const calls=[],details=[],receipts=new Map();
 const provider={channel:{nodeUrl:'https://starknet-rpc.publicnode.com'},getChainId:async()=>d.chainId,getClassHashAt:async address=>BigInt(address)===BigInt(d.settlement.pool)?d.settlement.poolClassHash:CONFIDENTIAL_RFQ_CONTRACT.classHash,getBlockWithTxHashes:async block=>({block_number:typeof block==='number'?block:block==='0xabc'?100:head,block_hash:typeof block==='number'||block==='0xabc'?'0xabc':'0xdef',status:'ACCEPTED_ON_L2',timestamp:1800000000}),getNonceForAddress:async()=>nonce,callContract:async request=>{
  switch(request.entrypoint){case 'configuration':return[d.settlement.pool,d.settlement.poolClassHash,'0x1','0x2','0x3',String(deadline)];case'is_settled':return[settled];case'get_proof_validity_blocks':return['100'];case'get_fee_amount':return[String(poolFee)];case'allowance':return[String(allowance),'0'];case'balance_of':return[String(balance),'0'];case'get_public_key':return[ec.starkCurve.getStarkKey('0x123')];default:throw Error('Unexpected read '+request.entrypoint);}
 },getTransactionReceipt:async hash=>receipts.get(hash),waitForTransaction:async hash=>receipts.get(hash)};
 const account={address:owner,signer:{},estimateInvokeFee:async(c,d)=>{estimates++;calls.push(structuredClone(c));details.push(structuredClone(d));return{resourceBounds:bounds};},simulateTransaction:async(c,d)=>{simulations++;details.push(structuredClone(d));if(changedNonce)nonce++;return{simulated_transactions:[{transaction_trace:{validate_invocation:invalidSimulation?undefined:{},execute_invocation:{}}}]};},execute:async(c,d)=>{executions++;details.push(structuredClone(d));if(failExecute)throw Error('Ambiguous RPC delivery');const transaction_hash='0x'+(0x100+executions).toString(16);receipts.set(transaction_hash,{execution_status:'SUCCEEDED',finality_status:'ACCEPTED_ON_L2',actual_fee:{amount:'20',unit:'FRI'},block_number:111});nonce++;return{transaction_hash};}};
 const runtime={starkscanProver:()=>({resolve:async()=>({getDefaultDetails:async()=>({}),invalidateNonceCache:()=>{},prove:async()=>{proofs++;return submission('fundB').proof;}})}),contractDiscovery:()=>({resolve:async context=>{await context.provider.callContract({entrypoint:'get_public_key'});discoveryBlock=context.provider;return{};}})};
 const options={account,provider,viewingKeyProvider:{getViewingKey:async()=>viewing},relayUrl:'https://app20.io/api/privacy/prove',accessToken:async()=> 'test-session',stateDirectory:directory,maxFeePerTransaction:110n,maxTotalFees:1000n,maxPoolFee:6n,...overrides};
 const dependencies={runtime,createPrivateTransfers:()=>({build:()=>{let payment;const builder={with:token=>{const leg={surplusTo:(who,withdraw)=>{assert.equal(who,owner);assert.equal(withdraw,false);return leg;},transfer:p=>{payment={token,recipient:p.recipient,amount:p.amount.toString()};return leg;}};return leg;},createProofInvocation:async()=>({invocation:invocation(payment)})};return builder;},executeWithInvocation:async({invocation:input},block)=>{assert.equal(block.block_hash,'0xabc');assert.equal(input.calldata[4],owner);proofs++;return{callAndProof:submission('fundB')};}})};
 let adapter=await createMakerWalletAdapter(options,dependencies);
 return{adapter,options,dependencies,provider,directory,calls,details,receipts,counts:()=>({estimates,simulations,executions,proofs}),restart:async()=>{adapter=await createMakerWalletAdapter(options,dependencies);return adapter;},set:(values)=>{if(values.settled!==undefined)settled=values.settled;({nonce,head,deadline,allowance,balance,poolFee,failExecute,invalidSimulation,changedNonce}={nonce,head,deadline,allowance,balance,poolFee,failExecute,invalidSimulation,changedNonce,...values});},discovery:()=>discoveryBlock,ledger:async()=>JSON.parse(await readFile(join(directory,'wallet-ledger.json'),'utf8'))};
}
test('private compile review rejects altered economic legs, public actions and unrelated channels',()=>{
 const p=normalizeMakerPayment({token:d.sellToken.address,recipient:target,amount:'7'},owner);assert.equal(validateMakerTransferInvocation(invocation(p),p,owner,viewing),true);
 assert.throws(()=>validateMakerTransferInvocation(invocation(p,'8'),p,owner,viewing),/exact payment/);
 assert.throws(()=>validateMakerTransferInvocation(invocation(p),{...p,token:d.buyToken.address},owner,viewing),/asset/);
 assert.throws(()=>validateMakerTransferInvocation(invocation(p),{...p,recipient:'0x999'},owner,viewing),/recipient/);
 const publicAction=invocation(p);publicAction.calldata[7]='4';assert.throws(()=>validateMakerTransferInvocation(publicAction,p,owner,viewing),/Only encrypted/);
 assert.throws(()=>normalizeMakerPayment({...p,amount:'0'},owner));assert.throws(()=>normalizeMakerPayment({...p,recipient:owner},owner));assert.throws(()=>normalizeMakerPayment({...p,token:'0x999'},owner));
});
test('resource limits require all v3 dimensions and a positive bounded fee',()=>{
 assert.equal(makerResourceMaximum(bounds),100n);
 assert.throws(()=>makerResourceMaximum({}),/Complete/);
 assert.throws(()=>makerResourceMaximum({...bounds,l2_gas:{max_amount:'0',max_price_per_unit:'10'}}),/Nonzero/);
 assert.throws(()=>makerResourceMaximum({...bounds,l2_gas:{max_amount:'-1',max_price_per_unit:'10'}}),/range/);
});
test('real-format proof and facts survive discovery, full simulation and exact-fee approval',async t=>{
 const h=await fixture(t),proof=submission();const tx=await h.adapter.submit(proof);
 assert.equal(tx.transaction_hash,'0x101');assert.deepEqual(h.counts(),{estimates:1,simulations:1,executions:1,proofs:0});
 assert.deepEqual(h.calls[0][0],{contractAddress:d.sellToken.address,entrypoint:'approve',calldata:[d.settlement.pool,'0x6','0x0']});
 assert.equal(h.details[0].skipValidate,true);assert.equal(h.details[1].skipValidate,false);assert.equal(h.details[1].skipExecute,false);assert.deepEqual(h.details[1].resourceBounds,bounds);
 for(const details of h.details){assert.equal(details.proof,proof.proof.data);assert.deepEqual(details.proofFacts,proof.proof.proofFacts.map(v=>'0x'+BigInt(v).toString(16)));}
 assert.equal((await h.ledger()).pending,null);assert.equal((await h.ledger()).confirmed[0].poolFee,'6');
 await (await h.restart()).submit(proof);assert.equal(h.counts().executions,1);
});
test('gas plus pool fee, remaining total budget and public balance all constrain execution',async t=>{
 const a=await fixture(t,{maxFeePerTransaction:105n});await assert.rejects(a.adapter.submit(submission()),/budget/);assert.equal(a.counts().executions,0);
 const b=await fixture(t,{maxTotalFees:130n});await b.adapter.submit(submission());await assert.rejects(b.adapter.submit(submission('refundB','0xcaf1')),/budget/);assert.equal(b.counts().executions,1);
 const c=await fixture(t);c.set({balance:105n});await assert.rejects(c.adapter.submit(submission()),/Insufficient/);assert.equal(c.counts().executions,0);
 const e=await fixture(t);e.set({poolFee:7n});await assert.rejects(e.adapter.submit(submission()),/ceiling/);assert.equal(e.counts().estimates,0);
});
test('full account validation failure or nonce changes stop before a pending broadcast',async t=>{
 for(const values of [{invalidSimulation:true},{changedNonce:true}]){const h=await fixture(t);h.set(values);await assert.rejects(h.adapter.submit(submission()),/validation|nonce/);assert.equal(h.counts().executions,0);assert.equal((await h.ledger()).pending,null);}
});
test('unknown delivery persists a global fence across restarts and cannot consume another nonce',async t=>{
 const h=await fixture(t);h.set({failExecute:true});await assert.rejects(h.adapter.submit(submission()),/unknown/);assert.equal((await h.ledger()).pending.hash,null);
 const restarted=await h.restart();await assert.rejects(restarted.submit(submission()),/Unknown/);await assert.rejects(restarted.transfer({token:d.sellToken.address,recipient:target,amount:'7'}),/Unknown/);assert.equal(h.counts().executions,1);
});
test('mature discovery and encrypted-only exact transfer persist a sealed invocation and reuse success',async t=>{
 const h=await fixture(t);h.set({deadline:1800001800});const payment={token:d.sellToken.address,recipient:target,amount:'7'};
 await h.adapter.transfer(payment);assert.equal(h.counts().proofs,1);assert.ok(h.discovery());
 const file=(await readdir(h.directory)).find(name=>name.startsWith('transfer-'));const saved=JSON.parse(await readFile(join(h.directory,file),'utf8'));assert.equal(saved.block.number,100);assert.ok(saved.sealed.ciphertext);assert.equal(saved.invocation,undefined);
 await (await h.restart()).transfer(payment);assert.equal(h.counts().proofs,1);assert.equal(h.counts().executions,1);
});
test('submit cannot become a generic payer for private transfer or other escrow modes',async t=>{
 const h=await fixture(t);await assert.rejects(h.adapter.submit(submission('fundB')),/refund/);
 const changed=submission();changed.call.entrypoint='other';await assert.rejects(h.adapter.submit(changed),/differs/);
 h.set({deadline:1800001800});await assert.rejects(h.adapter.submit(submission()),/deadline/);assert.equal(h.counts().executions,0);
});
test('expired proofs and changed budget scope are refused without signing a transaction',async t=>{
 const h=await fixture(t);h.set({head:201});await assert.rejects(h.adapter.submit(submission()),/expired/);assert.equal(h.counts().estimates,0);
 await assert.rejects(createMakerWalletAdapter({...h.options,maxTotalFees:999n},h.dependencies),/scope changed/);
});

test('two distinct refund proofs for the same escrow are executable while each proof is idempotent',async t=>{
 const h=await fixture(t);const first=submission(),later=submission('refundB',target,1);
 await h.adapter.submit(first);await h.adapter.submit(later);await h.adapter.submit(first);await h.adapter.submit(later);
 assert.equal(h.counts().executions,2);assert.equal((await h.ledger()).confirmed.length,2);
});
test('expired late notes remain refundable after settlement while new funding is blocked',async t=>{
 const h=await fixture(t);h.set({settled:'1'});await h.adapter.submit(submission());assert.equal(h.counts().executions,1);
 h.set({deadline:1800001800});await assert.rejects(h.adapter.transfer({token:d.sellToken.address,recipient:target,amount:'7'}),/settled/);
 await assert.rejects(h.adapter.submit(submission('refundB',target,2)),/deadline/);assert.equal(h.counts().executions,1);
});
