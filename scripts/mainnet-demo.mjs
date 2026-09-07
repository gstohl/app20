#!/usr/bin/env node
// Explicit, bounded operator smoke test. No secrets are written to the repository.
import {readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {scryptSync,createDecipheriv,timingSafeEqual,randomBytes} from 'node:crypto';
import {keccak_256} from '@noble/hashes/sha3.js';
import {Account,RpcProvider,hash,CallData,ec} from 'starknet';
import {App20Client,createPrivacyWallet,createTransportKey,MAINNET as d} from '../packages/agent-sdk/dist/index.js';
import {open as decryptRequest,decodeRequest,publicKey,responseCall,seal} from '../packages/private-intents/src/starknet-maker.ts';

const mode=process.argv[2]??'check';
if(!['check','shield','resume-shield','refresh-shield','acquire-usdc','maker-setup','trade-1','trade-2','trade-3','cleanup'].includes(mode))throw Error('Unsupported demo stage');
const execute=process.argv.includes('--execute');
if(mode!=='check'&&!execute)throw Error('Transaction stages require --execute');
const address='0x2baf5bf273ff0ecf729e1b9d455889a2dfbc831c944e48a124367295d2d6bc3';
const exchange='0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f';
const directory=resolve(homedir(),'.config/app20/mainnet-demo');
const deployerDirectory=resolve(homedir(),'.config/app20/mainnet-deployer');
const poolFeeCap=6n*10n**18n,totalFeeCap=65n*10n**18n,perTransactionGasCap=4n*10n**18n;
await mkdir(directory,{recursive:true,mode:0o700});
async function read(name){try{return JSON.parse(await readFile(resolve(directory,name),'utf8'));}catch(e){if(e.code==='ENOENT')return undefined;throw e;}}
async function save(name,value){const file=resolve(directory,name),temp=file+'.'+crypto.randomUUID()+'.next';const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,null,2)+'\n');await f.sync();}finally{await f.close();}await rename(temp,file);const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}
const provider=new RpcProvider({nodeUrl:'https://rpc.starknet.lava.build/rpc/v0_10',resourceBoundsOverhead:{l1_gas:{max_amount:20,max_price_per_unit:20},l2_gas:{max_amount:20,max_price_per_unit:20},l1_data_gas:{max_amount:20,max_price_per_unit:20}}});
const app=new App20Client({provider});
await app.verify();
const deployed=JSON.parse(await readFile(resolve(deployerDirectory,'deployment-ledger.json'),'utf8'));
if(deployed.pending||BigInt(deployed.address)!==BigInt(address)||BigInt(deployed.maximumFees)!==totalFeeCap)throw Error('Resolve deployment ledger or fee ceiling mismatch first');
const deploymentFees=deployed.transactions.reduce((sum,t)=>sum+BigInt(t.actualFee.amount),0n);
let ledger=await read('ledger.json')??{address,chainId:d.chainId,deploymentFees:deploymentFees.toString(),transactions:[],operations:{},pending:null};
if(ledger.address!==address||ledger.chainId!==d.chainId||BigInt(ledger.deploymentFees)!==deploymentFees)throw Error('Demo ledger scope changed');
if(ledger.pending)throw Error('A transaction outcome is pending; reconcile its saved hash before proceeding');
const fee=async()=>BigInt((await provider.callContract({contractAddress:d.settlement.pool,entrypoint:'get_fee_amount',calldata:[]}))[0]);
const balance=async token=>{const a=await provider.callContract({contractAddress:token,entrypoint:'balance_of',calldata:[address]});return BigInt(a[0])+(BigInt(a[1])<<128n);};
const currentFee=await fee();if(currentFee>poolFeeCap)throw Error('Pool fee exceeds 6 STRK cap');
console.log(JSON.stringify({stage:mode,chainId:await provider.getChainId(),block:await provider.getBlockNumber(),address,strkBaseUnits:String(await balance(d.sellToken.address)),usdcBaseUnits:String(await balance(d.buyToken.address)),poolFeeBaseUnits:String(currentFee),deploymentFees:String(deploymentFees),combinedFeeCeiling:String(totalFeeCap)}));
if(mode==='check')process.exit(0);
const lock=await open(resolve(directory,'operation.lock'),'wx',0o600);
try{
 const config=JSON.parse(await readFile(resolve(deployerDirectory,'account.json'),'utf8'));
 const ks=JSON.parse(await readFile(resolve(deployerDirectory,'keystore.json'),'utf8')).crypto;
 const password=(await readFile(resolve(deployerDirectory,'keystore.password'),'utf8')).trim();
 const derived=scryptSync(password,Buffer.from(ks.kdfparams.salt,'hex'),ks.kdfparams.dklen,{N:ks.kdfparams.n,r:ks.kdfparams.r,p:ks.kdfparams.p});
 const ciphertext=Buffer.from(ks.ciphertext,'hex');
 if(!timingSafeEqual(Buffer.from(keccak_256(Buffer.concat([derived.subarray(16,32),ciphertext]))),Buffer.from(ks.mac,'hex')))throw Error('Keystore authentication failed');
 const cipher=createDecipheriv(ks.cipher,derived.subarray(0,16),Buffer.from(ks.cipherparams.iv,'hex'));
 const secret=Buffer.concat([cipher.update(ciphertext),cipher.final()]);
 const key='0x'+secret.toString('hex');
 if(BigInt(ec.starkCurve.getStarkKey(key))!==BigInt(config.variant.public_key))throw Error('Signing public key mismatch');
 const calculated=hash.calculateContractAddressFromHash(config.deployment.salt,config.deployment.class_hash,CallData.compile({publicKey:config.variant.public_key}),0);
 if(BigInt(calculated)!==BigInt(address)||BigInt(await provider.getClassHashAt(address))!==BigInt(config.deployment.class_hash))throw Error('Unexpected signing account');
 const signer=new Account({provider,address,signer:key,cairoVersion:'1'});
 secret.fill(0);derived.fill(0);
 const spent=()=>deploymentFees+ledger.transactions.reduce((sum,t)=>sum+BigInt(t.actualFee)+BigInt(t.poolFee),0n);
 async function submit(calls,details={}){
  const list=Array.isArray(calls)?calls:[calls];
  if(ledger.pending)throw Error('Unresolved submission');
  const allowed=new Set([d.address,d.settlement.address,d.settlement.pool,d.sellToken.address,d.buyToken.address,...(mode==='acquire-usdc'?[exchange]:[])].map(a=>BigInt(a).toString()));
  if(list.some(c=>!allowed.has(BigInt(c.contractAddress).toString())))throw Error('Transaction target outside demo contracts');
  const poolCalls=list.filter(c=>BigInt(c.contractAddress)===BigInt(d.settlement.pool));
  if(poolCalls.some(c=>c.entrypoint!=='apply_actions')||poolCalls.length>1)throw Error('Unexpected pool execution');
  const protocolFee=poolCalls.length?await fee():0n;if(protocolFee>poolFeeCap)throw Error('Pool fee changed');
  const bounds=details.resourceBounds??(await signer.estimateInvokeFee(calls,{...details,tip:0n})).resourceBounds;
  const gasCap=Object.values(bounds).reduce((sum,v)=>sum+BigInt(v.max_amount)*BigInt(v.max_price_per_unit),0n);
  if(gasCap>perTransactionGasCap||spent()+gasCap+protocolFee>totalFeeCap)throw Error('Combined deployment/demo fee ceiling exceeded');
  ledger.pending={stage:mode,gasCap:String(gasCap),poolFee:String(protocolFee),calls:list.map(c=>({contractAddress:c.contractAddress,entrypoint:c.entrypoint})),hash:null};await save('ledger.json',ledger);
  console.log(JSON.stringify({submitting:mode,maximumGas:String(gasCap),poolFee:String(protocolFee)}));
  const tx=await signer.execute(calls,{...details,resourceBounds:bounds,tip:0n});
  ledger.pending.hash=tx.transaction_hash;await save('ledger.json',ledger);console.log(JSON.stringify({submitted:tx.transaction_hash}));
  const receipt=await provider.waitForTransaction(tx.transaction_hash,{retryInterval:3000});
  ledger.transactions.push({...ledger.pending,actualFee:receipt.actual_fee.amount,poolFee:receipt.isSuccess()?String(protocolFee):'0',block:receipt.block_number,success:receipt.isSuccess()});ledger.pending=null;await save('ledger.json',ledger);
  console.log(JSON.stringify({confirmed:tx.transaction_hash,success:receipt.isSuccess(),combinedFees:String(spent())}));
  if(!receipt.isSuccess())throw Error('Mainnet transaction reverted; inspect the saved receipt before continuing');
  return tx;
 }
 const account=new Proxy(signer,{get(target,prop){if(prop==='execute')return submit;const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;}});
 if(mode==='resume-shield'){
  if(ledger.operations.shield?.status!=='started'||ledger.transactions.some(t=>BigInt(t.poolFee)>0n))throw Error('Shield is not in a recoverable pre-broadcast state');
  let saved=await read('shield-estimate-request.json');
  if(!saved){const diagnostic=await read('last-error.json');const m=diagnostic.message;const params=JSON.parse(m.slice(m.indexOf('{'),m.lastIndexOf('\n\n')));saved=params.request[0];await save('shield-estimate-request.json',saved);}
  if(BigInt(saved.sender_address)!==BigInt(address)||BigInt(saved.nonce)!==BigInt(await provider.getNonceForAddress(address)))throw Error('Account nonce changed; investigate before resuming');
  const raw=saved.calldata;
  if(BigInt(raw[0])!==1n||BigInt(raw[1])!==BigInt(d.settlement.pool)||BigInt(raw[2])!==BigInt(hash.getSelectorFromName('apply_actions'))||Number(BigInt(raw[3]))!==raw.length-4)throw Error('Unexpected prepared shield call');
  const calls=[{contractAddress:d.settlement.pool,entrypoint:'apply_actions',calldata:raw.slice(4)}];
  const details={proof:saved.proof,proofFacts:saved.proof_facts,version:'0x3',skipValidate:false,tip:0n};
  const estimate=await signer.estimateInvokeFee(calls,details);
  console.log('Normal-version proof fee estimation succeeded.');
  const tx=await submit(calls,{...details,resourceBounds:estimate.resourceBounds});
  ledger.operations.shield={status:'confirmed',transactionHash:tx.transaction_hash};await save('ledger.json',ledger);
  console.log(JSON.stringify({shieldConfirmed:tx.transaction_hash}));
 }else{
 let viewing=await read('viewing-key.json');
 if(!viewing){const field=(1n<<251n)+17n*(1n<<192n)+1n;viewing={key:String(BigInt('0x'+randomBytes(32).toString('hex'))%(field-1n)+1n)};await save('viewing-key.json',viewing);}
 const token=(await readFile(resolve(homedir(),'.config/app20/prover-agent.token'),'utf8')).trim();
 const discoveryProvider=new RpcProvider({nodeUrl:'https://rpc.starknet.lava.build/rpc/v0_10'});
 const wallet=await createPrivacyWallet({account,provider:discoveryProvider,viewingKeyProvider:{getViewingKey:async()=>BigInt(viewing.key)},stateDirectory:resolve(directory,'privacy'),relayUrl:'https://app20.dokgst.workers.dev/api/privacy/prove',relayToken:token,maxFeePerTransaction:perTransactionGasCap,maxTotalFees:20n*10n**18n});
 if(mode==='shield'||mode==='refresh-shield'){
  if(mode==='shield'&&ledger.operations.shield)throw Error('Shield operation already started; inspect private journal before repeating');
  if(mode==='refresh-shield'){
   const previous=await read('shield-estimate-request.json');
   if(ledger.operations.shield?.status!=='started'||ledger.transactions.some(t=>BigInt(t.poolFee)>0n)||BigInt(previous.nonce)!==BigInt(await provider.getNonceForAddress(address)))throw Error('Cannot refresh after an unknown or successful execution');
   const diagnostic=await read('last-error.json');
   if(!diagnostic.message.includes('SCREENING_EXPIRED'))throw Error('Refresh is only for the inspected expired screening attestation');
   console.log('Refreshing an expired proof after confirming no shield transaction was broadcast.');
  }
  ledger.operations.shield={status:'started',amount:'30000000000000000'};await save('ledger.json',ledger);
  const transactionHash=await wallet.shield(d.sellToken.address,30000000000000000n);
  ledger.operations.shield={status:'confirmed',transactionHash};await save('ledger.json',ledger);
  console.log(JSON.stringify({shieldConfirmed:transactionHash}));
 }
 if(mode==='acquire-usdc'){
  if(ledger.operations.shield?.status!=='confirmed')throw Error('Verify real shielding before buying maker inventory');
  if(ledger.operations[mode])throw Error('Inventory acquisition already started');
  if(await balance(d.buyToken.address)>=3000n)throw Error('Native USDC already available; do not buy more');
  const sellAmount=500000000000000000n;
  const url=new URL('https://starknet.api.avnu.fi/swap/v3/quotes');url.search=new URLSearchParams({sellTokenAddress:d.sellToken.address,buyTokenAddress:d.buyToken.address,sellAmount:'0x'+sellAmount.toString(16),takerAddress:address,size:'1'});
  const qr=await fetch(url,{signal:AbortSignal.timeout(15000)}),quotes=await qr.json(),q=quotes[0];
  if(!qr.ok||!q||BigInt(q.chainId)!==BigInt(d.chainId)||BigInt(q.sellTokenAddress)!==BigInt(d.sellToken.address)||BigInt(q.buyTokenAddress)!==BigInt(d.buyToken.address)||BigInt(q.sellAmount)!==sellAmount||BigInt(q.buyAmount)<3100n)throw Error('Unexpected inventory quote');
  const builtResponse=await fetch('https://starknet.api.avnu.fi/swap/v3/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteId:q.quoteId,takerAddress:address,slippage:0.005,includeApprove:true}),signal:AbortSignal.timeout(15000)});
  const built=await builtResponse.json(),[approve,swap]=built.calls??[];
  const eq=(a,b)=>BigInt(a)===BigInt(b);
  if(!builtResponse.ok||!eq(built.chainId,d.chainId)||built.calls.length!==2||!eq(approve.contractAddress,d.sellToken.address)||approve.entrypoint!=='approve'||approve.calldata.length!==3||!eq(approve.calldata[0],exchange)||!eq(approve.calldata[1],sellAmount)||!eq(approve.calldata[2],0)||!eq(swap.contractAddress,exchange)||swap.entrypoint!=='multi_route_swap')throw Error('Unexpected AVNU calls');
  const c=swap.calldata;
  if(!eq(c[0],d.sellToken.address)||!eq(c[1],sellAmount)||!eq(c[2],0)||!eq(c[3],d.buyToken.address)||!eq(c[4],q.buyAmount)||!eq(c[5],0)||BigInt(c[6])<3000n||BigInt(c[6])*1000n<BigInt(q.buyAmount)*995n-1000n||!eq(c[7],0)||!eq(c[8],address)||!eq(c[9],0)||!eq(c[10],0))throw Error('Inventory swap amount, recipient or minimum changed');
  ledger.operations[mode]={status:'started',sellAmount:String(sellAmount),minimumUSDC:String(BigInt(c[6]))};await save('ledger.json',ledger);
  const tx=await submit(built.calls);
  if(await balance(d.buyToken.address)<BigInt(c[6]))throw Error('Expected native USDC was not received');
  ledger.operations[mode]={...ledger.operations[mode],status:'confirmed',transactionHash:tx.transaction_hash};await save('ledger.json',ledger);
 }
 if(mode==='maker-setup'){
  if(ledger.operations.shield?.status!=='confirmed'||ledger.operations[mode])throw Error('Maker setup is not ready or already attempted');
  if(await balance(d.buyToken.address)<3000n)throw Error('Need 0.003 native USDC inventory');
  const keyFile=resolve(directory,'maker-key.json');let jwk=await read('maker-key.json');
  const pub=jwk?(({d:secret,...publicPart})=>publicPart)(jwk):await createTransportKey(keyFile);
  const calls=[await app.registrationCall(pub,1),...await app.inventoryCalls('fund',d.buyToken.address,'0.003')];
  ledger.operations[mode]={status:'started'};await save('ledger.json',ledger);
  const tx=await submit(calls);
  if(BigInt(await app.availableInventory(address,d.buyToken.address))!==3000n)throw Error('Unexpected maker inventory');
  ledger.operations[mode]={status:'confirmed',transactionHash:tx.transaction_hash};await save('ledger.json',ledger);
 }
 if(mode.startsWith('trade-')){
  const round=Number(mode.slice(-1));
  if(ledger.operations['maker-setup']?.status!=='confirmed'||ledger.operations[mode]||(round>1&&ledger.operations['trade-'+(round-1)]?.status!=='confirmed'))throw Error('Round not ready or already attempted; reconcile first');
  const file=resolve(directory,mode+'.json');
  ledger.operations[mode]={status:'started'};await save('ledger.json',ledger);
  await app.prepareQuote({file,maker:address,taker:address,terms:{sellToken:d.sellToken.address,buyToken:d.buyToken.address,sellAmount:'10000000000000000',minBuyAmount:'1000'},ttlSeconds:1800});
  await app.submitRequest(file,{address,chainId:d.chainId,execute:submit});
  const record=await read(mode+'.json'),jwk=await read('maker-key.json');
  const {d:privatePart,...pub}=jwk;
  const pair={privateKey:await crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']),publicKey:await publicKey(pub)};
  const request=await decodeRequest(await decryptRequest(record.scope,'request',record.call.calldata.slice(5),pair));
  if(BigInt(request.sellToken)!==BigInt(d.sellToken.address)||BigInt(request.buyToken)!==BigInt(d.buyToken.address)||request.sellAmount!=='10000000000000000'||request.minBuyAmount!=='1000'||!request.settlementCommitment)throw Error('Decoded smoke-test terms changed');
  const answer={kind:'executable',buyAmount:'1000',expiresAt:record.scope.expiresAt,settlement:d.settlement.address,quoteId:record.scope.id,commitment:request.settlementCommitment};
  const encrypted=await seal(record.scope,'quote',answer,await publicKey(request.replyKey));
  await submit([{contractAddress:d.settlement.address,entrypoint:'reserve_quote',calldata:[record.scope.id,request.sellToken,request.buyToken,request.sellAmount,answer.buyAmount,request.settlementCommitment,String(answer.expiresAt)]},responseCall(record.scope,encrypted)]);
  await app.readQuote(file);
  const publicUSDC=await balance(d.buyToken.address);
  const tx=await app.settle(file,wallet.executor,String(poolFeeCap));
  const status=await app.reconcile(file);
  if(status.settlement?.status!=='confirmed'||await balance(d.buyToken.address)!==publicUSDC)throw Error('Fill or shielded output verification failed');
  ledger.operations[mode]={status:'confirmed',transactionHash:tx,quoteId:record.scope.id,sellAmount:request.sellAmount,buyAmount:answer.buyAmount};await save('ledger.json',ledger);
  console.log(JSON.stringify({privateSwapConfirmed:tx,round}));
 }
 if(mode==='cleanup'){
  if([1,2,3].some(i=>ledger.operations['trade-'+i]?.status!=='confirmed')||ledger.operations[mode])throw Error('Finish and verify all three rounds before cleanup');
  const proceeds=BigInt(await app.availableInventory(address,d.sellToken.address));
  if(proceeds!==30000000000000000n||BigInt(await app.availableInventory(address,d.buyToken.address))!==0n)throw Error('Unexpected maker balances');
  const calls=[...await app.inventoryCalls('withdraw',d.sellToken.address,'0.03'),{contractAddress:d.address,entrypoint:'deactivate',calldata:[]}];
  ledger.operations[mode]={status:'started'};await save('ledger.json',ledger);
  const tx=await submit(calls);ledger.operations[mode]={status:'confirmed',transactionHash:tx.transaction_hash};await save('ledger.json',ledger);
 }
 }
}catch(error){
 // SDK errors may include proving calldata: preserve diagnostic locally, never print it.
 await save('last-error.json',{at:new Date().toISOString(),stage:mode,name:error.name,message:error.message,stack:error.stack});
 console.error('Stopped. Private diagnostic saved under ~/.config/app20/mainnet-demo/last-error.json. Inspect before retrying.');
 process.exitCode=1;
}finally{await lock.close();await unlink(resolve(directory,'operation.lock'));}
