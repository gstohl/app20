import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
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
    await assert.rejects(()=>f.client.registrationCall(privateKey,7),/private key/);
    assert.equal((await f.client.registrationCall(key,7)).entrypoint,'register');
    const calls=await f.client.inventoryCalls('fund',MAINNET.buyToken.address,'1.25');
    assert.deepEqual(calls.map(c=>c.entrypoint),['approve','deposit_inventory']);
    assert.equal(calls[0].calldata[1],'1250000');
    assert.equal(calls[1].calldata[1],'1250000');
    assert.equal(await f.client.availableInventory('0xabc',MAINNET.buyToken.address),((1n<<128n)+7n).toString());
    assert.equal((await f.client.listMakers()).makers[0].address,'0xabc');
    f.state.chain='0x123';
    await assert.rejects(()=>f.client.registrationCall(key,7),/network/);
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

test('persisted encrypted quote, settlement fee cap, atomic actions and receipt recovery',async()=>{
  const f=await fixture();
  try {
    const prepared=await f.client.prepareQuote(f.input);
    assert.equal((await stat(f.file)).mode&0o777,0o600);
    await assert.rejects(()=>f.client.prepareQuote(f.input),/EEXIST/);
    let requestCount=0;
    const requestExecutor={address:'0xdef',chainId:MAINNET.chainId,execute:async calls=>{requestCount++;assert.deepEqual(calls,[prepared.call]);return {transaction_hash:'0x111'};}};
    await assert.rejects(()=>f.client.submitRequest(f.file,{...requestExecutor,address:'0xaaa'}),/Executor/);
    await f.client.submitRequest(f.file,requestExecutor);
    await assert.rejects(()=>f.client.submitRequest(f.file,requestExecutor),/already attempted/);
    assert.equal(requestCount,1);
    await f.answer();
    assert.equal((await f.client.readQuote(f.file)).buyAmount,'250000');
    let settled=0;
    const executor={address:'0xdef',chainId:MAINNET.chainId,execute:async actions=>{settled++;assert.deepEqual(actions.map(a=>a.type),['withdraw','transfer','invoke']);assert.equal(actions[1].amount,'OPEN');return {transaction_hash:'0x222'};}};
    await assert.rejects(()=>f.client.settle(f.file,executor,'5'),/Pool fee/);
    assert.equal(settled,0);
    await f.client.settle(f.file,executor,'6');
    const reloaded=new App20Client({provider:f.provider});
    await assert.rejects(()=>reloaded.settle(f.file,executor,'6'),/already attempted/);
    assert.equal(settled,1);
    f.state.receipt='success';f.state.quoteStatus='0x2';
    assert.equal((await reloaded.reconcile(f.file)).settlement.status,'confirmed');
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('uncertain submission and concurrent processes cannot send a duplicate',async()=>{
  const f=await fixture();
  try {
    await f.client.prepareQuote(f.input);
    let release;const wait=new Promise(r=>release=r);let entered;const started=new Promise(r=>entered=r);
    const executor={address:'0xdef',chainId:MAINNET.chainId,execute:async()=>{entered();await wait;throw Error('Connection lost after broadcast');}};
    const first=f.client.submitRequest(f.file,executor);const rejected=assert.rejects(first,/Connection lost/);
    await started;
    await assert.rejects(()=>new App20Client({provider:f.provider}).submitRequest(f.file,executor),/EEXIST/);
    release();await rejected;
    await assert.rejects(()=>f.client.submitRequest(f.file,executor),/already attempted/);
    assert.equal((await f.client.reconcile(f.file)).request.status,'prepared');
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('changed deployment or blocked pool prevents request preparation',async()=>{
  const f=await fixture();
  try {
    f.state.blocked='0x1';
    await assert.rejects(()=>f.client.prepareQuote(f.input),/does not currently accept/);
    await assert.rejects(()=>stat(f.file),/ENOENT/);
    await assert.rejects(()=>runMaker({configFile:'operator.json',command:'made-up'}),/Unsupported/);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('included Node wallet rejects unsafe relay URLs, missing gas budgets and unrelated action batches',async()=>{
  const {createPrivacyWallet}=await import('../dist/index.js');
  const dir=await mkdtemp(join(tmpdir(),'app20-node-wallet-'));
  let calls=0;
  const options={account:{address:'0xabc'},provider:{getChainId:async()=>{calls++;return MAINNET.chainId;}},viewingKeyProvider:{getViewingKey:async()=>1n},stateDirectory:dir,relayUrl:'https://app20.io/api/privacy/prove',relayToken:'local-fixture',maxFeePerTransaction:1n,maxTotalFees:2n};
  try {
    await assert.rejects(()=>createPrivacyWallet({...options,relayUrl:'http://example.com'}),/HTTPS/);
    await assert.rejects(()=>createPrivacyWallet({...options,maxTotalFees:0n}),/gas limits/);
    const wallet=await createPrivacyWallet(options);
    await assert.rejects(()=>wallet.executor.execute([{type:'invoke',contract:'0x777',calldata:[]}]),/Unsupported/);
    assert.equal(calls,0,'Constructing a wallet or rejecting arbitrary actions must not start chain activity');
  } finally {await rm(dir,{recursive:true,force:true});}
});
