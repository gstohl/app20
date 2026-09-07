import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hash,shortString} from 'starknet';
import {MAINNET_DEPLOYMENT as d} from '../src/lib/mainnet-deployment.ts';
import {MAINNET_PROOF_FORMAT,realProofConfigHash} from '../src/lib/mainnet-proof-format.ts';
import {validateMainnetProof} from './mainnet-proof-policy.mjs';
const domain=shortString.encodeShortString, recipient='0x123', chatAddress='0x456', escrow='0x789';
const write=['0','11','1','22'], note=['8','33','44'], used=['9','55'];
const callback=(address,data)=>['11',address,String(data.length),...data];
function record(stage,actions,extra) {
  const output=[d.settlement.poolClassHash,String(actions.length),...actions.flat()];
  const proofFacts=[domain(MAINNET_PROOF_FORMAT.version),domain('VIRTUAL_SNOS'),MAINNET_PROOF_FORMAT.virtualProgramHash,domain('VIRTUAL_SNOS0'),'14528000','0xabc',realProofConfigHash(d.chainId,d.sellToken.address),'1',hash.computePoseidonHashOnElements([d.settlement.pool,0,output.length,...output])];
  const suffix=extra?['0',String(extra.signature.issued_at),extra.signature.sig_r,extra.signature.sig_s]:['1'];
  return {chainId:d.chainId,mode:stage,submission:{proof:{data:Buffer.from('test boundary fixture, not a cryptographic proof').toString('base64'),output,proofFacts,...(extra?{additionalData:extra}:{})},call:{contractAddress:d.settlement.pool,entrypoint:'apply_actions',calldata:[...output.slice(1),...suffix]}}};
}
const check=(r,options={})=>validateMainnetProof({record:r,stage:r.mode,recipient,chatAddress,escrow,...options});
test('real-format registration binding accepts only the reviewed account and encrypted channels',()=>{
  const r=record('registerRecipientB',[write,['4',recipient,'77','0','0','0'],['1',recipient,'1','2','3']]);
  const result=check(r); assert.deepEqual(result.publicInputs,[]); assert.equal(result.baseBlock.number,14528000);
  assert.throws(()=>check(r,{recipient:'0x321'}),/identity|channel/);
  r.submission.call.calldata[1]='999'; assert.throws(()=>check(r),/differs/);
});
test('private Chat requires replay protection and exact final encrypted callback with no public value legs',()=>{
  const data=['11','22','33']; const good=record('chat',[write,note,used,callback(chatAddress,data)]);
  assert.equal(check(good,{expectedCallback:data}).publicActionKinds.length,4);
  assert.throws(()=>check(good,{expectedCallback:['11','22','34']}),/callback differs/);
  assert.throws(()=>check(record('chat',[callback(chatAddress,data)])),/replay/);
  assert.throws(()=>check(record('chat',[write,note,used,['3',recipient,d.sellToken.address,'1'],callback(chatAddress,data)])),/public or unsupported/);
  assert.throws(()=>check(record('chat',[write,callback(chatAddress,data),note,used])),/final action/);
});
test('settlement, refunds and funding reject withdrawal and unexpected callbacks',()=>{
  check(record('settle',[write,note,used,callback(escrow,[domain('APP20_JOINT_COMPUTE_V1'),'1'])]));
  check(record('fundA',[write,note,used]));
  assert.throws(()=>check(record('fundB',[write,note,used,callback(escrow,[domain('APP20_JOINT_COMPUTE_V1'),'1'])])),/unsupported/);
  assert.throws(()=>check(record('settle',[write,note,used,callback(escrow,[domain('APP20_JOINT_COMPUTE_V1'),'2'])])),/approved operation/);
});
test('shield requires exact reviewed deposit and screening in both proof and calldata',()=>{
  const input={owner:recipient,token:d.sellToken.address,amount:'20000000000000000'};
  const extra={signature:{issued_at:1788820000,sig_r:'0x1',sig_s:'0x2'}};
  const r=record('shield',[write,['2',input.owner,input.token,input.amount],['6',input.owner,input.token,input.amount],note],extra);
  assert.equal(check(r,{publicInput:input}).publicInputs[0].amount,input.amount);
  assert.throws(()=>check(r,{publicInput:{...input,amount:'1'}}),/reviewed amount/);
  const missing=structuredClone(r);delete missing.submission.proof.additionalData;assert.throws(()=>check(missing,{publicInput:input}),/screening/);
  r.submission.call.calldata.at(-1);r.submission.call.calldata[r.submission.call.calldata.length-1]='3';assert.throws(()=>check(r,{publicInput:input}),/differs/);
});
test('proof facts reject mock version, unsupported program, another chain and modified output',()=>{
  const original=record('fundA',[write,note,used]);
  for(const [index,value] of [[0,domain('PROOF0')],[2,'0x1'],[6,'0x2'],[8,'0x3']]) {
    const r=structuredClone(original);r.submission.proof.proofFacts[index]=value;assert.throws(()=>check(r),/bind/);
  }
  const r=structuredClone(original);r.chainId=domain('SN_SEPOLIA');assert.throws(()=>check(r),/network/);
  r.chainId=d.chainId;r.submission.proof.data='bad !';assert.throws(()=>check(r),/base64/);
});
