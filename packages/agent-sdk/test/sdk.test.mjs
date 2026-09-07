import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from 'starknet';
import { App20Client, MAINNET, createTransportKey, createOperatorConfig, units, runMaker } from '../dist/index.js';
import { keyCoordinates, seal, publicKey, open, decodeRequest } from '../../private-intents/src/starknet-maker.ts';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'app20-sdk-'));
  const makerKeys = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'}, true, ['deriveBits']);
  const makerKey = await crypto.subtle.exportKey('jwk', makerKeys.publicKey);
  const now = Math.floor(Date.now()/1000);
  const state = { chain: MAINNET.chainId, blocked: '0x0', fee: '6', quoteStatus: '0x1', receipt: 'pending', record: undefined, answer: undefined, ciphertext: undefined };
  const provider = {
    getChainId: async()=>state.chain,
    getBlockWithTxHashes: async()=>({block_hash:'0x123',block_number:MAINNET.fromBlock+1,timestamp:now}),
    getClassHashAt: async address => address === MAINNET.address ? MAINNET.classHash : address === MAINNET.settlement.address ? MAINNET.settlement.classHash : MAINNET.settlement.poolClassHash,
    callContract: async ({entrypoint}) => {
      if(entrypoint==='pool')return [MAINNET.settlement.pool];
      if(entrypoint==='book')return [MAINNET.address];
      if(entrypoint==='is_open_note_depositor_blocked')return [state.blocked];
      if(entrypoint==='maker_count')return ['0x1'];
      if(entrypoint==='maker_at')return ['0xabc'];
      if(entrypoint==='maker')return [...keyCoordinates(makerKey),'0x1',String(now+3600)];
      if(entrypoint==='available')return ['0x7','0x1'];
      if(entrypoint==='get_request')return ['0xdef','0xabc','0x1',String(state.record.scope.expiresAt),state.answer?'0x2':'0x1'];
      if(entrypoint==='quote')return ['0xabc',state.record.terms.sellToken,state.record.terms.buyToken,state.record.terms.sellAmount,state.answer.buyAmount,state.answer.commitment,String(state.answer.expiresAt),state.quoteStatus];
      if(entrypoint==='get_fee_amount')return [state.fee];
      throw Error('Unexpected entrypoint '+entrypoint);
    },
    getEvents: async()=>({events:[{from_address:MAINNET.address,keys:[hash.getSelectorFromName('Responded'),state.record.scope.id,'0xabc'],data:[String(state.ciphertext.length),...state.ciphertext]}]}),
    getTransactionReceipt: async()=>({isSuccess:()=>state.receipt==='success',isReverted:()=>state.receipt==='reverted'})
  };
  const client=new App20Client({provider});
  const file=join(dir,'request.json');
  const input={file,maker:'0xabc',taker:'0xdef',terms:{sellToken:MAINNET.sellToken.address,buyToken:MAINNET.buyToken.address,sellAmount:'1000000000000000000',minBuyAmount:'100000'}};
  async function answer() {
    state.record=JSON.parse(await readFile(file,'utf8'));
    const payload=state.record.call.calldata.slice(5); // request's payload includes serialized Span length
    // Construct response from the exact persisted scope and fresh commitment.
    const {d,...replyKey}=state.record.privateKey;
    const body=await decodeRequest(await open(state.record.scope,'request',payload,makerKeys));
    state.answer={kind:'executable',buyAmount:'250000',expiresAt:now+600,settlement:MAINNET.settlement.address,quoteId:state.record.scope.id,commitment:body.settlementCommitment};
    state.ciphertext=await seal(state.record.scope,'quote',state.answer,await publicKey(replyKey));
  }
  return {dir,client,state,input,file,answer,provider};
}

test('owner-only key generation, no overwrite, public registration and exact inventory',async()=>{
  const f=await fixture();
  try {
    const path=join(f.dir,'key.json');const key=await createTransportKey(path);
    assert.equal(key.d,undefined);assert.equal((await stat(path)).mode&0o777,0o600);
    await assert.rejects(()=>createTransportKey(path),/EEXIST/);
    const privateKey=JSON.parse(await readFile(path,'utf8'));
    await assert.rejects(()=>f.client.registrationCall(privateKey,7),/Confidential settlement/);
    await assert.rejects(()=>f.client.registrationCall(key,7),/Confidential settlement/);
    await assert.rejects(()=>f.client.inventoryCalls('fund',MAINNET.buyToken.address,'1.25'),/Confidential settlement/);
    const calls=await f.client.inventoryCalls('withdraw',MAINNET.buyToken.address,'1.25');
    assert.deepEqual(calls.map(c=>c.entrypoint),['withdraw_inventory']);
    assert.equal(calls[0].calldata[1],'1250000');
    assert.equal(await f.client.availableInventory('0xabc',MAINNET.buyToken.address),((1n<<128n)+7n).toString());
    assert.equal((await f.client.listMakers()).makers[0].address,'0xabc');
    f.state.chain='0x123';
    await assert.rejects(()=>f.client.availableInventory('0xabc',MAINNET.buyToken.address),/network/);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('decimal-aware configuration, explicit budgets and no website dependency',()=>{
  const config=createOperatorConfig({account:'0xabc',reverse:false,price:'0.25',spread:50,maxSell:'10',maxBuy:'5',priceHours:1,maxFee:'0.1',totalFees:'1',keyValidUntil:2000000000},1900000000);
  assert.equal(config.markets[0].numerator,'250000');
  assert.equal(config.markets[0].denominator,'1000000000000000000');
  assert.equal(config.markets[0].maxBuyAmount,'5000000');
  assert.throws(()=>units('1.0000001',6),/decimal places/);
  assert.throws(()=>units('1',100),/Decimals/);
  assert.throws(()=>new App20Client({rpcUrl:'http://example.com'}),/HTTPS/);
});

test('public RFQ methods fail before RPC, file creation, signing or submission', async () => {
  const dir=await mkdtemp(join(tmpdir(),'app20-sdk-closed-'));
  let touched=0;
  const tripwire=()=>{touched++;throw Error('External action called');};
  const client=new App20Client({provider:new Proxy({}, {get:()=>tripwire})});
  const file=join(dir,'never-created.json');
  const executor={address:'0xdef',chainId:MAINNET.chainId,execute:tripwire};
  try {
    await assert.rejects(()=>client.prepareQuote({file,maker:'0xabc',taker:'0xdef',terms:{sellToken:'0x1',buyToken:'0x2',sellAmount:'1',minBuyAmount:'1'}}),/Confidential settlement/);
    await assert.rejects(()=>client.submitRequest(file,executor),/Confidential settlement/);
    await assert.rejects(()=>client.settle(file,executor,'6'),/Confidential settlement/);
    for(const command of ['register','fund','run']) await assert.rejects(()=>runMaker({configFile:file,command}),/Confidential settlement/);
    await assert.rejects(()=>stat(file),/ENOENT/);
    await assert.rejects(()=>stat(file+'.lock'),/ENOENT/);
    assert.equal(touched,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('historical pending receipts remain reconcilable without another settlement',async()=>{
  const f=await fixture();
  try {
    const scope={chainId:MAINNET.chainId,book:MAINNET.address,id:'0x77',maker:'0xabc',taker:'0xdef',revision:1,expiresAt:Math.floor(Date.now()/1000)+600};
    const answer={kind:'executable',quoteId:scope.id,settlement:MAINNET.settlement.address,buyAmount:'250000',expiresAt:scope.expiresAt,commitment:'0x88'};
    f.state.answer=answer;
    f.state.record={version:1,scope,terms:f.input.terms,secret:'0x99',privateKey:{},call:{},request:{status:'submitted',transactionHash:'0x111'},settlement:{status:'submitted',transactionHash:'0x222'},answer};
    await writeFile(f.file,JSON.stringify(f.state.record),{mode:0o600});
    f.state.receipt='success';f.state.quoteStatus='0x2';
    const recovered=await f.client.reconcile(f.file);
    assert.equal(recovered.request.status,'confirmed');
    assert.equal(recovered.settlement.status,'confirmed');
    const saved=await readFile(f.file,'utf8');
    await assert.rejects(()=>f.client.settle(f.file,{address:'0xdef',chainId:MAINNET.chainId,execute:()=>{throw Error('must not submit');}},'6'),/Confidential settlement/);
    assert.equal(await readFile(f.file,'utf8'),saved);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});
