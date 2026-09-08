// Protected, budgeted support for the explicitly started confidential maker.
// No key loader, CLI, wallet activation, public deposit or generic proof payer.
import { readFile, open, rename, unlink, mkdir, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ec, hash, CallData } from 'starknet';
import { createPrivateTransfers, createEmptyRegistry } from '@starkware-libs/starknet-privacy-sdk';
import { PrivacyPoolABI } from '@starkware-libs/starknet-privacy-sdk/abi';
import { MAINNET_DEPLOYMENT as d } from '../src/lib/mainnet-deployment.ts';
import { CONFIDENTIAL_RFQ_CONTRACT as escrowPin } from '../src/lib/confidential-rfq-deployment.ts';
import { validateMainnetProof } from './mainnet-proof-policy.mjs';
import { fixedBlockDiscoveryProvider, sealWalletInvocation, unsealWalletInvocation } from './mainnet-wallet-proof.mjs';
import { protectedMakerDirectory } from './confidential-maker-files.mjs';
const same=(a,b)=>BigInt(a)===BigInt(b), hex=v=>'0x'+BigInt(v).toString(16);
const serial=v=>JSON.stringify(v,(_,value)=>typeof value==='bigint'?hex(value):value);
const digest=v=>createHash('sha256').update(serial(v)).digest('hex');
const uint=(value,bits=128)=>{if(!['string','bigint','number'].includes(typeof value)||(typeof value==='number'&&!Number.isSafeInteger(value)))throw Error('Invalid unsigned value.');const n=BigInt(value);if(n<0n||n>=2n**BigInt(bits))throw Error('Unsigned value out of range.');return n;};
const address=v=>{if(typeof v!=='string'||!/^0x[\da-f]+$/i.test(v)||BigInt(v)<=0n||BigInt(v)>=2n**251n-256n)throw Error('Invalid address.');return hex(v);};
const transactionHash=v=>{if(typeof v!=='string'||!/^0x[\da-f]+$/i.test(v)||BigInt(v)<=0n||BigInt(v)>=2n**251n+17n*2n**192n+1n)throw Error('Invalid transaction hash.');return hex(v);};
const positive=v=>{const n=uint(v);if(n===0n)throw Error('An explicit positive fee budget is required.');return n;};
const uint256=result=>{if(!Array.isArray(result)||result.length!==2)throw Error('Invalid token balance or allowance.');return uint(result[0])+(uint(result[1])<<128n);};
const feeValue=result=>{if(!Array.isArray(result)||result.length!==1)throw Error('Invalid pool fee.');return uint(result[0]);};
async function read(path){try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077)throw Error('Unsafe private wallet journal.');return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return undefined;throw e;}}
async function save(path,value){const temporary=path+'.'+crypto.randomUUID()+'.next',file=await open(temporary,'wx',0o600);try{await file.writeFile(serial(value)+'\n');await file.sync();}finally{await file.close();}await rename(temporary,path);const dir=await open(resolve(path,'..'),'r');try{await dir.sync();}finally{await dir.close();}}
async function exclusive(path,work){const h=await open(path,'wx',0o600);try{await h.writeFile(serial({pid:process.pid,startedAt:new Date().toISOString()}));await h.sync();return await work();}finally{await h.close();await unlink(path);}}
async function loadRuntime(){const{build}=await import('esbuild');const root=resolve(import.meta.dirname,'..'),file=resolve(root,'.e2e-build/confidential-maker-wallet/runtime.mjs');await build({stdin:{contents:"export {starkscanProver} from './packages/privy/src/starkscan.ts'; export {contractDiscovery} from './packages/privy/src/discovery.ts';",resolveDir:root},bundle:true,packages:'external',platform:'node',format:'esm',target:'node24',outfile:file,logLevel:'silent'});return import(pathToFileURL(file).href);}

export function normalizeMakerPayment(payment,owner){
  if(!payment||Object.keys(payment).sort().join(',')!=='amount,recipient,token')throw Error('Exact encrypted payment required.');
  const token=address(payment.token),recipient=address(payment.recipient);
  if(![d.sellToken.address,d.buyToken.address].some(t=>same(t,token))||same(recipient,owner)||typeof payment.amount!=='string'||!/^[1-9]\d*$/.test(payment.amount)||uint(payment.amount)===0n)throw Error('Unsupported encrypted maker payment.');
  return {token,recipient,amount:payment.amount};
}
/** Inspect the private compile request before signing/proving can move a note. */
export function validateMakerTransferInvocation(invocation,payment,owner,viewingKey){
  if(!same(invocation.sender_address,d.settlement.pool)||!Array.isArray(invocation.calldata))throw Error('Transfer must compile through the pinned pool.');
  const c=invocation.calldata;
  if(c.length<7||c.length>4096||!same(c[0],1)||!same(c[1],d.settlement.pool)||!same(c[2],hash.getSelectorFromName('compile_actions'))||Number(c[3])!==c.length-4)throw Error('One bounded compile call required.');
  let at=4;const take=()=>{if(at>=c.length)throw Error('Truncated private transfer.');return uint(c[at++],252);};const skip=n=>{for(let i=0;i<n;i++)take();};
  if(take()!==BigInt(owner)||take()!==viewingKey)throw Error('Private transfer identity changed.');
  const count=Number(take());if(count<1||count>128)throw Error('Invalid private action count.');
  let outgoing=0n,inputs=0;
  const recipient=()=>{const target=take();if(target!==BigInt(owner)&&target!==BigInt(payment.recipient))throw Error('Unrelated private channel or recipient.');return target;};
  const token=()=>{if(take()!==BigInt(payment.token))throw Error('Private transfer asset changed.');};
  for(let i=0;i<count;i++)switch(Number(take())){
    case 1:recipient();skip(3);break;
    case 2:recipient();skip(3);token();skip(1);break;
    case 3:{const target=recipient();skip(1);token();const value=take();if(value>=2n**128n)throw Error('Invalid encrypted output amount.');skip(2);if(target===BigInt(payment.recipient))outgoing+=value;break;}
    case 6:skip(1);token();skip(1);inputs++;break;
    default:throw Error('Only encrypted transfers, private channel setup and note consumption are permitted.');
  }
  if(at!==c.length||inputs===0||outgoing!==BigInt(payment.amount))throw Error('Encrypted transfer differs from the exact payment.');
  return true;
}
export function makerResourceMaximum(bounds){
  if(!bounds||Object.keys(bounds).sort().join(',')!=='l1_data_gas,l1_gas,l2_gas')throw Error('Complete v3 resource bounds required.');
  let total=0n;for(const entry of Object.values(bounds)){if(!entry||Object.keys(entry).sort().join(',')!=='max_amount,max_price_per_unit')throw Error('Invalid resource bound.');total+=uint(entry.max_amount,64)*uint(entry.max_price_per_unit,128);}
  if(total<=0n)throw Error('Nonzero bounded execution fee required.');return total;
}

export async function createMakerWalletAdapter(options,dependencies={}){
  const directory=await protectedMakerDirectory(options.stateDirectory),provider=options.provider,account=options.account,owner=address(account?.address);
  const caps={per:positive(options.maxFeePerTransaction),total:positive(options.maxTotalFees),pool:uint(options.maxPoolFee)};
  if(caps.per>caps.total||caps.pool>caps.per||typeof options.accessToken!=='function'||typeof options.viewingKeyProvider?.getViewingKey!=='function')throw Error('Invalid explicit wallet limits or key provider.');
  const relay=new URL(options.relayUrl);if(relay.protocol!=='https:'||relay.username||relay.password||relay.search||relay.hash)throw Error('Pinned HTTPS proving relay required.');
  if(!same(await provider.getChainId(),d.chainId)||!same(await provider.getClassHashAt(d.settlement.pool),d.settlement.poolClassHash))throw Error('Mainnet pool identity mismatch.');
  const viewingKey=BigInt(await options.viewingKeyProvider.getViewingKey());if(viewingKey<=0n||viewingKey>ec.starkCurve.CURVE.n/2n)throw Error('Canonical wallet viewing material required.');
  const scope=digest({owner,chain:d.chainId,pool:d.settlement.pool,relay:relay.href,caps,viewingPublicKey:ec.starkCurve.getStarkKey(hex(viewingKey))});
  const ledgerFile=resolve(directory,'wallet-ledger.json'),lock=resolve(directory,'wallet-operation.lock');
  const initial={schema:'app20/confidential-maker-wallet/v1',scope,confirmed:[],pending:null};
  if(!await read(ledgerFile))await exclusive(lock,async()=>{if(!await read(ledgerFile))await save(ledgerFile,initial);});
  const ledger=async()=>{const l=await read(ledgerFile);if(l?.schema!==initial.schema||l.scope!==scope||!Array.isArray(l.confirmed))throw Error('Wallet journal scope changed.');return l;};
  await ledger();
  const runtime=dependencies.runtime??await loadRuntime();
  const proofDirectory=resolve(directory,'proofs');await mkdir(proofDirectory,{recursive:true,mode:0o700});
  const hosted=await runtime.starkscanProver({relayUrl:relay.href,poolClassHash:d.settlement.poolClassHash,accessToken:options.accessToken,fetch:(url,init={})=>{
    if(new URL(url).origin!==relay.origin)throw Error('Prover authentication cannot leave its configured origin.');
    return (dependencies.fetch??fetch)(url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Origin:relay.origin}});
  },journal:{runExclusive:work=>exclusive(resolve(proofDirectory,'hosted.lock'),work),load:key=>{if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid job identity.');return read(resolve(proofDirectory,key+'.json'));},save:(key,value)=>{if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid job identity.');return save(resolve(proofDirectory,key+'.json'),value);}}}).resolve({provider,network:'mainnet',chainId:d.chainId,nodeUrl:provider.channel?.nodeUrl,poolAddress:d.settlement.pool});
  const proofProvider={getDefaultDetails:()=>hosted.getDefaultDetails(),invalidateNonceCache:()=>hosted.invalidateNonceCache?.(),async prove(invocation,block){
    if(!block||typeof block!=='object'||typeof block.block_hash!=='string')throw Error('Explicit accepted proof block required.');
    const id=digest({invocation,block}),path=resolve(proofDirectory,'invocation-'+id+'.sealed.json');
    if(!await read(path))await save(path,sealWalletInvocation(invocation,viewingKey,scope+'/'+id));
    return hosted.prove(invocation,block);
  }};
  async function checkEscrow(recipient,block='latest',refund=false){
    if(!same(await provider.getClassHashAt(recipient,block),escrowPin.classHash))throw Error('Recipient is not the pinned confidential escrow class.');
    const config=await provider.callContract({contractAddress:recipient,entrypoint:'configuration',calldata:[]},block);
    const settled=await provider.callContract({contractAddress:recipient,entrypoint:'is_settled',calldata:[]},block);
    if(settled.length!==1||![0n,1n].includes(BigInt(settled[0]))||!refund&&BigInt(settled[0])!==0n)throw Error('Escrow is already settled.');
    const head=await provider.getBlockWithTxHashes(block);
    if(config.length!==6||!same(config[0],d.settlement.pool)||!same(config[1],d.settlement.poolClassHash)||!Number.isSafeInteger(head.block_number)||!['ACCEPTED_ON_L1','ACCEPTED_ON_L2'].includes(head.status)||!head.block_hash)throw Error('Escrow configuration is invalid.');
    const deadline=uint(config[5],64);
    if(refund?BigInt(head.timestamp)<deadline:BigInt(head.timestamp)+300n>=deadline)throw Error('Escrow deadline does not permit this operation.');
    return head;
  }
  async function reconcile(l){
    if(!l.pending)return;
    if(!l.pending.hash)throw Error('Unknown wallet submission outcome. Inspect account activity before repairing the journal.');
    const tx=await provider.getTransactionReceipt(l.pending.hash);
    if(!['ACCEPTED_ON_L1','ACCEPTED_ON_L2'].includes(tx.finality_status)||!['SUCCEEDED','REVERTED'].includes(tx.execution_status))throw Error('Wallet transaction remains pending.');
    if(tx.actual_fee?.unit!=='FRI')throw Error('Mainnet v3 fees must use STRK units.');
    const success=tx.execution_status==='SUCCEEDED',actual=uint(tx.actual_fee.amount,252);
    l.confirmed.push({...l.pending,success,actualFee:actual.toString(),poolFee:success?l.pending.poolFee:'0',block:tx.block_number});l.pending=null;await save(ledgerFile,l);
  }
  async function freshness(valid){
    const [block,head,validity]=await Promise.all([provider.getBlockWithTxHashes(valid.baseBlock.hash),provider.getBlockWithTxHashes('latest'),provider.callContract({contractAddress:d.settlement.pool,entrypoint:'get_proof_validity_blocks',calldata:[]})]);
    if(block.block_number!==valid.baseBlock.number||!same(block.block_hash,valid.baseBlock.hash)||!['ACCEPTED_ON_L1','ACCEPTED_ON_L2'].includes(block.status)||!Number.isSafeInteger(head.block_number)||head.block_number<block.block_number||!['ACCEPTED_ON_L1','ACCEPTED_ON_L2'].includes(head.status)||validity.length!==1||BigInt(validity[0])<=0n||BigInt(head.block_number)>BigInt(block.block_number)+BigInt(validity[0]))throw Error('Proof block is invalid or expired.');
  }
  async function submitUnlocked(valid,id){
    if(!same(account.address,owner)||!same(await provider.getChainId(),d.chainId)||!same(await provider.getClassHashAt(d.settlement.pool),d.settlement.poolClassHash))throw Error('Wallet or network changed.');
    const l=await ledger();await reconcile(l);
    const previous=l.confirmed.find(tx=>tx.id===id||tx.proofId===valid.proofId);
    if(previous){if(!previous.success)throw Error('The earlier attempt reverted. Do not retry automatically.');return{transaction_hash:previous.hash};}
    await freshness(valid);
    const [feeResult,allowanceResult,balanceResult,nonce,pendingNonce]=await Promise.all([provider.callContract({contractAddress:d.settlement.pool,entrypoint:'get_fee_amount',calldata:[]}),provider.callContract({contractAddress:d.sellToken.address,entrypoint:'allowance',calldata:[owner,d.settlement.pool]}),provider.callContract({contractAddress:d.sellToken.address,entrypoint:'balance_of',calldata:[owner]}),provider.getNonceForAddress(owner),provider.getNonceForAddress(owner,'pre_confirmed')]);
    if(!same(nonce,pendingNonce))throw Error('The wallet has an unconfirmed operation.');
    const poolFee=feeValue(feeResult);if(poolFee>caps.pool)throw Error('Pool fee exceeds the configured ceiling.');
    const calls=[...(uint256(allowanceResult)<poolFee?[{contractAddress:d.sellToken.address,entrypoint:'approve',calldata:[d.settlement.pool,hex(poolFee),'0x0']}]:[]),valid.call];
    const details={nonce,tip:0n,version:'0x3',proof:valid.proof.data,proofFacts:[...valid.proof.proofFacts]};
    const estimate=await account.estimateInvokeFee(structuredClone(calls),{...details,skipValidate:true});
    const bounds=structuredClone(estimate.resourceBounds),maximum=makerResourceMaximum(bounds);
    const spent=l.confirmed.reduce((sum,tx)=>sum+BigInt(tx.actualFee)+BigInt(tx.poolFee),0n);
    if(maximum+poolFee>caps.per||spent+maximum+poolFee>caps.total)throw Error('Gas and pool fee exceed the wallet budget.');
    if(maximum+poolFee>uint256(balanceResult))throw Error('Insufficient public STRK for gas and the pool fee.');
    const simulation=await account.simulateTransaction([{type:'INVOKE',payload:structuredClone(calls)}],{...details,resourceBounds:bounds,skipValidate:false,skipExecute:false});
    const result=simulation.simulated_transactions;
    if(!Array.isArray(result)||result.length!==1||!result[0].transaction_trace?.validate_invocation||!result[0].transaction_trace?.execute_invocation||result[0].transaction_trace.execute_invocation.revert_reason)throw Error('Bounded account validation and execution must both succeed.');
    await freshness(valid);
    if(!same(await provider.getNonceForAddress(owner),nonce)||!same(await provider.getNonceForAddress(owner,'pre_confirmed'),nonce))throw Error('Wallet nonce changed during validation.');
    l.pending={id,proofId:valid.proofId,nonce:hex(nonce),maximumFee:maximum.toString(),poolFee:poolFee.toString(),hash:null};await save(ledgerFile,l);
    let tx;
    try{tx=await account.execute(structuredClone(calls),{...details,resourceBounds:bounds,skipValidate:false});}
    catch(error){await save(resolve(directory,'last-error.json'),{at:new Date().toISOString(),message:String(error?.message??error)});throw Error('Wallet submission outcome is unknown. Preserve and reconcile the journal.');}
    l.pending.hash=transactionHash(tx.transaction_hash);await save(ledgerFile,l);await provider.waitForTransaction(l.pending.hash);await reconcile(l);
    if(!l.confirmed.at(-1)?.success)throw Error('Wallet transaction reverted.');return{transaction_hash:tx.transaction_hash};
  }
  async function transfer(payment){return exclusive(lock,async()=>{
    const wanted=normalizeMakerPayment(payment,owner),id=digest({scope,payment:wanted}),path=resolve(directory,'transfer-'+id+'.json');
    const l=await ledger();await reconcile(l);const previous=l.confirmed.find(tx=>tx.id===id);if(previous){if(!previous.success)throw Error('Earlier transfer reverted; no automatic retry.');return{transaction_hash:previous.hash};}
    let saved=await read(path);
    if(saved&&saved.scope!==scope)throw Error('Transfer journal identity changed.');
    if(!saved){const head=await provider.getBlockWithTxHashes('latest');if(!Number.isSafeInteger(head.block_number)||head.block_number<10)throw Error('Accepted discovery head required.');const block=await provider.getBlockWithTxHashes(head.block_number-10);if(block.block_number!==head.block_number-10)throw Error('Discovery block changed.');await checkEscrow(wanted.recipient,block.block_hash);saved={scope,payment:wanted,block:{number:block.block_number,hash:block.block_hash}};await save(path,saved);}
    if(serial(saved.payment)!==serial(wanted))throw Error('Transfer request changed.');
    const pub=await provider.callContract({contractAddress:d.settlement.pool,entrypoint:'get_public_key',calldata:[owner]},saved.block.hash);if(pub.length!==1||!same(pub[0],ec.starkCurve.getStarkKey(hex(viewingKey))))throw Error('Wallet viewing key does not match pool registration.');
    await checkEscrow(wanted.recipient);await proofProvider.invalidateNonceCache();
    const discovery=await runtime.contractDiscovery().resolve({provider:fixedBlockDiscoveryProvider(provider,saved.block.hash),poolAddress:d.settlement.pool});
    const transfers=(dependencies.createPrivateTransfers??createPrivateTransfers)({account:{address:owner,signer:account.signer},viewingKeyProvider:{getViewingKey:async()=>viewingKey},provingProvider:proofProvider,discoveryProvider:discovery,poolContractAddress:d.settlement.pool});
    const invocationScope=digest({scope,id,block:saved.block,payment:wanted});
    let invocation;if(saved.sealed)invocation=unsealWalletInvocation(saved.sealed,viewingKey,invocationScope);else{const builder=transfers.build({autoRegister:false,autoSetup:true,autoSelectNotes:'naive',autoDiscover:{channels:'refresh',notes:'refresh'}});builder.with(wanted.token).surplusTo(owner,false).transfer({recipient:wanted.recipient,amount:BigInt(wanted.amount)});({invocation}=await builder.createProofInvocation());validateMakerTransferInvocation(invocation,wanted,owner,viewingKey);saved.sealed=sealWalletInvocation(invocation,viewingKey,invocationScope);await save(path,saved);}
    validateMakerTransferInvocation(invocation,wanted,owner,viewingKey);
    if(!saved.submission){const result=await transfers.executeWithInvocation({invocation,registry:createEmptyRegistry(),warnings:[]},{block_hash:saved.block.hash});saved.submission=result.callAndProof;await save(path,saved);}
    const valid=validateMainnetProof({record:{chainId:d.chainId,mode:'fundB',block:saved.block,submission:saved.submission},stage:'fundB'});
    await checkEscrow(wanted.recipient);return submitUnlocked(valid,id);
  });}
  async function submit(submission){return exclusive(lock,async()=>{
    const output=submission?.proof?.output;if(!Array.isArray(output)||output.length>5000)throw Error('Bounded refund proof required.');
    const actions=new CallData(PrivacyPoolABI).decodeParameters('core::array::Span::<privacy::actions::ServerAction>',output.slice(1));
    const last=actions.at(-1);if(last?.activeVariant()!=='InvokeWithComputation')throw Error('Maker submit supports only its private timeout refund.');
    const callback=last.unwrap(),target=address(hex(callback.contract_address));
    const valid=validateMainnetProof({record:{chainId:d.chainId,mode:'refundB',submission},stage:'refundB',escrow:target});
    await checkEscrow(target,'latest',true);return submitUnlocked(valid,'refund-'+target+'-'+valid.proofId);
  });}
  return {proofProvider,transfer,submit};
}
