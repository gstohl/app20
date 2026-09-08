#!/usr/bin/env node
// Explicitly started confidential maker. No credentials or state belong in the checkout.
import { open, readFile, rename, unlink, lstat, realpath, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { ec, hash } from 'starknet';
import { MAINNET_DEPLOYMENT as deployment } from '../src/lib/mainnet-deployment.ts';
import { CONFIDENTIAL_RFQ_CONTRACT } from '../src/lib/confidential-rfq-deployment.ts';
import { protectedMakerDirectory } from './confidential-maker-files.mjs';
export { protectedMakerDirectory } from './confidential-maker-files.mjs';
const root = resolve(import.meta.dirname, '..');
const hex = v => '0x' + BigInt(v).toString(16);
const equal = (a, b) => BigInt(a) === BigInt(b);
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const randomFelt = () => hex('0x' + randomBytes(31).toString('hex'));
class MakerMessageError extends Error {}
const privateKey = () => '0x' + Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString('hex');
const amount = value => { if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) >= 2n ** 128n) throw Error('Positive canonical u128 base-unit amount required.'); return value; };
const felt = value => { if (typeof value !== 'string' || !/^(0x[\da-f]+|\d+)$/i.test(value) || BigInt(value) <= 0n || BigInt(value) >= 2n ** 251n - 256n) throw Error('Invalid contract identity.'); return hex(value); };

export async function loadMakerRuntime() {
  const { build } = await import('esbuild');
  const destination = resolve(root, '.e2e-build/confidential-maker/runtime.mjs');
  await build({ stdin: { contents: "export * from './src/lib/confidential-room.ts'; export * from './packages/agent-sdk/src/confidential-node.ts'; export * from './src/lib/ready-proof-session.ts';", resolveDir: root }, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', alias: { '@': resolve(root, 'src') }, define: { 'import.meta.env': '{}' }, outfile: destination, logLevel: 'silent' });
  return import(pathToFileURL(destination).href);
}
export function normalizeMarkets(markets) {
  if (!Array.isArray(markets) || !markets.length || markets.length > 16) throw Error('Explicit bounded markets required.');
  const result = markets.map(m => ({ sellToken: felt(m.sellToken), buyToken: felt(m.buyToken), ...Object.fromEntries(['rateNumerator','rateDenominator','minSellAmount','maxSellAmount','maxBuyAmount','maxReservedBuyAmount'].map(k => [k, amount(m[k])])) }));
  if (result.some(m => m.sellToken === m.buyToken || BigInt(m.minSellAmount) > BigInt(m.maxSellAmount) || BigInt(m.maxBuyAmount) > BigInt(m.maxReservedBuyAmount)) || new Set(result.map(m => m.sellToken + '/' + m.buyToken)).size !== result.length) throw Error('Invalid market limits.');
  return result;
}
export function priceRequest(request, markets, reserved = 0n) {
  const market = markets.find(m => equal(request.sellToken,m.sellToken) && equal(request.buyToken,m.buyToken));
  if (!market) throw Error('This pair is not quoted.');
  const sell = BigInt(amount(request.sellAmount)), minimum = BigInt(amount(request.minimumAmount));
  const buy = sell * BigInt(market.rateNumerator) / BigInt(market.rateDenominator);
  if (sell < BigInt(market.minSellAmount) || sell > BigInt(market.maxSellAmount) || buy < minimum || buy <= 0n || buy > BigInt(market.maxBuyAmount) || buy + reserved > BigInt(market.maxReservedBuyAmount)) throw Error('Request exceeds the configured price or inventory limits.');
  return { market, buyAmount: buy.toString() };
}
async function load(file) { try { const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) throw Error('Unsafe maker journal permissions.'); return JSON.parse(await readFile(file,'utf8')); } catch(e) { if(e.code==='ENOENT')return undefined; throw e; } }
async function save(file, value) {
  const tmp=file+'.'+crypto.randomUUID()+'.next', h=await open(tmp,'wx',0o600);
  try { await h.writeFile(JSON.stringify(value)+'\n'); await h.sync(); } finally { await h.close(); }
  await rename(tmp,file); const parent=await open(resolve(file,'..'),'r'); try { await parent.sync(); } finally { await parent.close(); }
}
export async function lockMakerDirectory(directory) {
  const path=resolve(directory,'maker.lock'), h=await open(path,'wx',0o600);
  await h.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})); await h.sync();
  return async()=>{await h.close();await unlink(path);};
}

/** Account.signMessage returns either felt arrays or the SDK's {r,s} signature. */
export function makerMessageSignature(value) {
  const pair=!Array.isArray(value)&&value&&typeof value==='object';
  const values=Array.isArray(value)?value:pair?[value.r,value.s]:undefined;
  if(!values||values.length<2||values.length>64)throw Error('Unsupported account message signature.');
  return values.map(v=>{
    if(!['string','bigint'].includes(typeof v)||(typeof v==='string'&&!/^(?:0x[\da-f]+|\d+)$/i.test(v)))throw Error('Invalid account message signature.');
    const n=BigInt(v),limit=pair?ec.starkCurve.CURVE.n:2n**251n+17n*2n**192n+1n;
    if(n<(pair?1n:0n)||n>=limit)throw Error('Account message signature is out of range.');
    return hex(n);
  });
}
/** Only an account message is signed here. Tokens stay in memory. */
export function makerAccessToken(options, runtime, fetcher, now=()=>Math.floor(Date.now()/1000)) {
  let session, pending;
  async function authenticate() {
    const issuedAt=now(), claim=runtime.normalizeReadyProofSession({account:felt(options.account.address),chainId:deployment.chainId,origin:new URL(options.baseUrl??'https://app20.io').origin,issuedAt,expiresAt:issuedAt+runtime.READY_PROOF_SESSION_TTL,nonce:randomFelt()});
    const signature=makerMessageSignature(await options.account.signMessage(runtime.buildReadyProofSessionTypedData(claim)));
    const response=await fetcher(claim.origin+'/api/privacy/ready-proof-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claim,signature:signature.map(hex)}),redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Maker session authentication failed.');
    const data=await response.json();
    if(typeof data.token!=='string'||!data.token.startsWith('app20-ready-proof-v1.')||data.token.length>4096||data.expiresAt!==claim.expiresAt||data.account!==claim.account||data.origin!==claim.origin)throw Error('Invalid maker session response.');
    session={token:data.token,expiresAt:claim.expiresAt};return session.token;
  }
  return async()=>session?.expiresAt>now()+60?session.token:pending??(pending=authenticate().finally(()=>{pending=undefined;}));
}

export async function createMakerEngine(options, dependencies={}) {
  const r=dependencies.runtime??await loadMakerRuntime(), now=dependencies.now??(()=>Math.floor(Date.now()/1000));
  const directory=await protectedMakerDirectory(options.journalDirectory), markets=normalizeMarkets(options.markets), account=felt(options.account?.address);
  if(typeof options.name!=='string'||!options.name.trim()||options.name.length>40||/[\x00-\x1f\x7f]/.test(options.name)||typeof options.transfer!=='function'||typeof options.submit!=='function'||!options.proofProvider||!options.provider)throw Error('Complete explicit maker adapter required.');
  if(!equal(await options.provider.getChainId(),deployment.chainId))throw Error('Maker must use Starknet mainnet.');
  const maxRooms=options.maxActiveRooms??16;
  if(!Number.isInteger(maxRooms)||maxRooms<1||maxRooms>64)throw Error('Invalid active room limit.');
  const base=new URL(options.baseUrl??'https://app20.io');
  if(base.origin!==base.href.replace(/\/$/,'')||base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname))throw Error('Invalid maker service origin.');
  const fetcher=(url,init={})=>{if(new URL(url).origin!==base.origin)throw Error('Maker authentication cannot leave its configured origin.');return (options.fetch??fetch)(url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Origin:base.origin}});};
  const api=dependencies.api??r.confidentialRoomApi({baseUrl:base.origin,accessToken:makerAccessToken(options,r,fetcher,now),fetch:fetcher});
  const scope=digest({account,chainId:deployment.chainId,baseUrl:base.origin,markets,maxRooms});
  let identity=await load(resolve(directory,'identity.json'));
  if(!identity){const key=await r.createRoomKey();identity={schema:'app20/confidential-maker/v1',scope,privateKey:key.privateKey,publicKey:key.publicKey};await save(resolve(directory,'identity.json'),identity);}
  if(identity.schema!=='app20/confidential-maker/v1'||identity.scope!==scope)throw Error('Maker identity belongs to another configuration; preserve and reconcile its rooms.');
  const pair=await r.restoreRoomKey(identity.privateKey), states=new Map();
  for(const file of await readdir(directory))if(/^room-[A-Za-z0-9_-]{32}\.json$/.test(file)){
    const state=await load(resolve(directory,file));
    if(state.schema!=='app20/confidential-maker-room/v1'||!r.validRoomId(state.id)||state.scope!==scope||file!==`room-${state.id}.json`)throw Error('Invalid room journal.');
    if(state.agreement){const a=r.normalizeConfidentialAgreement(state.agreement);if(!equal(a.terms.partyB,account)||!equal(a.signerB,ec.starkCurve.getStarkKey(state.signingKey)))throw Error('Room signing identity changed.');}
    states.set(state.id,state);
  }
  const persist=s=>save(resolve(directory,`room-${s.id}.json`),s);
  const active=s=>!['settled','declined','refunded'].includes(s.status)&&(s.accepted||s.quote?.expiresAt>now());
  const emit=async(s,payload)=>{const envelope=await r.sealRoomMessage(s.id,'maker',payload,s.request.replyKey);s.outbox.push({envelope,sent:false});await persist(s);};
  const flush=async(s)=>{for(const item of s.outbox)if(!item.sent){await api.send(s.id,item.envelope);item.sent=true;await persist(s);}};
  async function receipt(hashValue) {
    const transaction=felt(hashValue), value=await options.provider.getTransactionReceipt(transaction);
    if(value.execution_status!=='SUCCEEDED'||!['ACCEPTED_ON_L1','ACCEPTED_ON_L2'].includes(value.finality_status)||!Number.isSafeInteger(value.block_number))throw Error('Successful included transaction required.');
    return value;
  }
  async function client(s, provider=options.provider) {
    return (dependencies.createClient??r.createConfidentialClient)({agreement:s.agreement,provider,viewingKeyProvider:{getViewingKey:async()=>BigInt(s.viewingKey)},proofProvider:options.proofProvider,journal:await r.createConfidentialJournal(resolve(directory,s.id)),submit:options.submit,discovery:options.discovery});
  }
  async function matureClient(s, head) {
    if(!Number.isSafeInteger(head)||head<10)throw Error('Accepted maturity head required.');
    const block=await options.provider.getBlockWithTxHashes(head-10);
    if(block.block_number!==head-10||!block.block_hash||!['ACCEPTED_ON_L1','ACCEPTED_ON_L2'].includes(block.status))throw Error('Accepted maturity block required.');
    // Contract discovery ignores its blockIdentifier argument. Pin the provider
    // itself so a caller-supplied transaction hash cannot stand in for note age.
    const provider=new Proxy(options.provider,{get(target,key){
      if(key==='callContract')return call=>target.callContract(call,block.block_hash);
      if(key==='getClassHashAt')return address=>target.getClassHashAt(address,block.block_hash);
      if(key==='getBlockWithTxHashes')return async()=>block;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    return client(s,provider);
  }
  async function prepared(s,c,mode) {
    await options.proofProvider.invalidateNonceCache?.();
    const operation=await c.prepare(mode);
    const approval=await c.approve(operation,'b',async(d,review)=>{
      if(review.mode!==mode||!equal(review.commitment,s.agreement.commitment))throw Error('Prepared operation changed.');
      const sig=ec.starkCurve.sign(d,s.signingKey);return[hex(sig.r),hex(sig.s)];
    });
    await emit(s,{kind:'prepared',prepared:operation,approval});s[mode+'Prepared']=true;await persist(s);
  }
  async function handle(s,message) {
    if(message.role!=='taker')return;
    let p;try{p=await r.openRoomMessage(s.id,message,pair);}catch{throw new MakerMessageError('Invalid encrypted maker-room message.');}
    if(p.kind==='request'){
      let request;try{request={kind:'request',taker:felt(p.taker),signerA:felt(p.signerA),replyKey:r.cleanRoomPublicKey(p.replyKey),sellToken:felt(p.sellToken),buyToken:felt(p.buyToken),sellAmount:amount(p.sellAmount),minimumAmount:amount(p.minimumAmount)};}catch{throw new MakerMessageError('Invalid private quote request.');}
      if(equal(request.taker,account))throw new MakerMessageError('Maker and taker accounts must be distinct.');
      if(s.request){if(s.requestDigest!==digest(request))throw new MakerMessageError('Room request changed.');return;}
      s.request=request;s.requestDigest=digest(request);await persist(s);
      try{
        if([...states.values()].filter(active).length>=maxRooms)throw Error('Maker room capacity reached.');
        const reserved=[...states.values()].filter(t=>active(t)&&t.agreement&&equal(t.agreement.terms.tokenB,request.buyToken)).reduce((sum,t)=>sum+BigInt(t.agreement.terms.amountB),0n);
        const price=priceRequest(request,markets,reserved), signingKey=privateKey();let viewingKey;
        do{viewingKey=BigInt(privateKey());}while(viewingKey>ec.starkCurve.CURVE.n/2n);
        const salt=randomFelt();
        const input={chainId:deployment.chainId,pool:deployment.settlement.pool,poolClassHash:deployment.settlement.poolClassHash,escrowClassHash:CONFIDENTIAL_RFQ_CONTRACT.classHash,signerA:request.signerA,signerB:ec.starkCurve.getStarkKey(signingKey),deadline:now()+1800,terms:{tokenA:request.sellToken,tokenB:request.buyToken,amountA:request.sellAmount,amountB:price.buyAmount,partyA:request.taker,partyB:account,salt:randomFelt()}};
        const candidate=r.createConfidentialAgreement(input), address=hash.calculateContractAddressFromHash(salt,candidate.escrowClassHash,r.confidentialConstructor(candidate),0);
        s.agreement=r.createConfidentialAgreement({...input,address});s.signingKey=signingKey;s.viewingKey=hex(viewingKey);s.quote={kind:'quote',agreement:s.agreement,viewingKey:s.viewingKey,salt,expiresAt:now()+300};s.status='quoted';await persist(s);await emit(s,s.quote);
      }catch(error){s.status='declined';await persist(s);await emit(s,{kind:'declined',message:'This request is outside the maker’s current limits.'});}
    }else if(p.kind==='accepted'){
      if(!s.quote||!equal(p.commitment,s.agreement.commitment)||(!s.accepted&&now()>=s.quote.expiresAt))throw new MakerMessageError('Quote is expired or changed.');
      const deploymentHash=felt(p.deploymentHash);if(s.accepted&&s.accepted.deploymentHash!==deploymentHash)throw new MakerMessageError('Deployment confirmation changed.');
      await receipt(deploymentHash);await r.inspectConfidentialDeployment(options.provider,s.agreement);
      s.accepted={deploymentHash};s.status='accepted';await persist(s);
    }else if(p.kind==='confirmed'){
      if(!s.accepted||!['setup','fundA','settle','refundA'].includes(p.stage))throw new MakerMessageError('Unexpected confirmation.');
      const h=felt(p.hash);if(s.confirmed[p.stage]&&s.confirmed[p.stage]!==h)throw new MakerMessageError('Confirmation changed.');
      const tx=await receipt(h);
      if(!tx.events?.some(e=>equal(e.from_address,s.agreement.pool)))throw new MakerMessageError('Confirmation did not touch the agreed pool.');
      s.confirmed[p.stage]=h;await persist(s);
    }else throw new MakerMessageError('Unsupported taker message.');
  }
  async function advance(s) {
    if(!s.accepted||s.status==='blocked'||s.status==='settled')return;
    const c=await client(s), snapshot=await c.inspect();
    if(snapshot.settled){s.status='settled';await persist(s);return;}
    if(snapshot.timestamp>=s.agreement.deadline){s.status='expired';await persist(s);return;}
    if(!snapshot.registered){if(!s.setupPrepared)await prepared(s,c,'setup');return;}
    if(!s.confirmed.setup||!s.confirmed.fundA||BigInt(snapshot.balanceA)<BigInt(s.agreement.terms.amountA))return;
    const aReceipt=await receipt(s.confirmed.fundA);
    if(snapshot.block<aReceipt.block_number+10||snapshot.timestamp+300>=s.agreement.deadline)return;
    const mature=await (await matureClient(s,snapshot.block)).inspect();
    if(!mature.registered||BigInt(mature.balanceA)<BigInt(s.agreement.terms.amountA))return;
    if(s.funding?.attempted&&!s.funding.hash){s.status='blocked';await persist(s);return;}
    if(!s.funding){
      if(snapshot.pending)throw Error('Reconcile pending funding before continuing.');
      if(BigInt(snapshot.balanceB)>=BigInt(s.agreement.terms.amountB)){s.status='blocked';await persist(s);return;}
      s.funding={attempted:true};await persist(s);
      try{s.funding.hash=await c.fund('b',payment=>{
        if(!equal(payment.token,s.agreement.terms.tokenB)||!equal(payment.recipient,s.agreement.address)||BigInt(payment.amount)<=0n||BigInt(payment.amount)>BigInt(s.agreement.terms.amountB))throw Error('Funding differs from the approved maker leg.');
        return options.transfer(payment);
      });await persist(s);await emit(s,{kind:'funded',hash:s.funding.hash});}
      catch(error){s.status='blocked';s.failure={at:now(),message:String(error?.message??error)};await persist(s);return;}
    }
    const bReceipt=await receipt(s.funding.hash), fresh=await c.inspect();
    if(fresh.pending){await c.reconcile();return;}
    if(fresh.status==='ready'&&fresh.block>=bReceipt.block_number+10&&!s.settlePrepared){
      const stable=await matureClient(s,fresh.block);
      if((await stable.inspect()).status==='ready')await prepared(s,stable,'settle');
    }
  }
  async function refundRoom(id) {
    if(!r.validRoomId(id)||!states.has(id))throw Error('Known private maker room required.');
    const s=states.get(id);
    if(!s.accepted||!s.agreement)throw Error('Only an accepted escrow can be refunded.');
    if(s.refund?.attempted&&!s.refund.hash)throw Error('Unknown refund outcome; reconcile the protected journal without retrying.');
    const current=await client(s);await current.reconcile();const snapshot=await current.inspect();
    if(s.refund?.hash){await receipt(s.refund.hash);if(BigInt(snapshot.balanceB)===0n)return {room:id,transaction:s.refund.hash,reused:true};}
    if(snapshot.timestamp<s.agreement.deadline||BigInt(snapshot.balanceB)<=0n)throw Error('Expired funded maker leg required.');
    const stable=await matureClient(s,snapshot.block), mature=await stable.inspect();
    if(mature.timestamp<s.agreement.deadline||BigInt(mature.balanceB)!==BigInt(snapshot.balanceB))throw Error('Wait for the refund notes and deadline to mature before retrying.');
    await options.proofProvider.invalidateNonceCache?.();
    const operation=await stable.prepare('refundB');
    const approval=await stable.approve(operation,'b',async(d,review)=>{
      if(review.mode!=='refundB'||!equal(review.commitment,s.agreement.commitment))throw Error('Refund operation changed.');
      const sig=ec.starkCurve.sign(d,s.signingKey);return[hex(sig.r),hex(sig.s)];
    });
    if(s.refund?.hash)s.refundHistory=[...(s.refundHistory??[]),s.refund];
    s.refund={attempted:true};await persist(s);
    try {
      s.refund.hash=await current.execute(operation,[approval]);await persist(s);
      if(BigInt((await current.inspect()).balanceB)!==0n)throw Error('Inspect remaining maker escrow notes before another refund.');
      s.status='refunded';await persist(s);return {room:id,transaction:s.refund.hash,reused:false};
    }catch(error){s.status='blocked';s.failure={at:now(),message:String(error?.message??error)};await persist(s);throw Error('Refund stopped; preserve and reconcile its private journal before another action.');}
  }
  let advertisedUntil=0;
  return {
    refundRoom,
    async tick(){
      if(!equal(options.account.address,account)||!equal(await options.provider.getChainId(),deployment.chainId))throw Error('Maker account or network changed.');
      if(advertisedUntil<now()+60){await api.advertise({name:options.name,publicKey:identity.publicKey,expiresAt:now()+240});advertisedUntil=now()+240;}
      for(const item of await api.inbox()){
        if(!r.validRoomId(item.id))throw Error('Invalid inbox room.');
        let s=states.get(item.id);
        if(!s){s={schema:'app20/confidential-maker-room/v1',scope,id:item.id,cursor:0,outbox:[],confirmed:{},status:'new'};states.set(s.id,s);await persist(s);}
        if(s.status==='blocked')continue;
        try{
          await flush(s);
          const messages=await api.messages(s.id,s.cursor);
          for(const message of messages){if(!Number.isSafeInteger(message.sequence)||message.sequence<=s.cursor)throw new MakerMessageError('Non-monotonic room sequence.');await handle(s,message);s.cursor=message.sequence;await persist(s);await flush(s);}
          await advance(s);await flush(s);
        }catch(error){if(error instanceof MakerMessageError)s.status='blocked';s.failure={at:now(),message:String(error?.message??error)};await persist(s);}
      }
      return {rooms:states.size,active:[...states.values()].filter(active).length,blocked:[...states.values()].filter(s=>s.status==='blocked').length};
    },
  };
}

export async function runMaker(options,{signal,refundRoom}={}) {
  const directory=await protectedMakerDirectory(options.journalDirectory), release=await lockMakerDirectory(directory);
  try {const engine=await createMakerEngine(options);if(refundRoom){const result=await engine.refundRoom(refundRoom);console.log(JSON.stringify(result));return result;}while(!signal?.aborted){const state=await engine.tick();console.log(JSON.stringify({at:new Date().toISOString(),...state}));await new Promise(resolve=>{const t=setTimeout(done,5000);function done(){clearTimeout(t);signal?.removeEventListener('abort',done);resolve();}signal?.addEventListener('abort',done,{once:true});});}}
  finally{await release();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{run:{type:'boolean'},adapter:{type:'string'},'refund-room':{type:'string'}}});
    if(!values.run||!values.adapter)throw Error('Start explicitly with --run --adapter /absolute/protected/adapter.mjs.');
    const file=resolve(values.adapter), rel=relative(root,await realpath(file)), stat=await lstat(file);
    if(!isAbsolute(values.adapter)||!rel.startsWith('../')||!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077)throw Error('Adapter must be an owner-only file outside the repository.');
    const adapter=await import(pathToFileURL(file).href);if(typeof adapter.createOptions!=='function')throw Error('Adapter must export createOptions().');
    const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
    await runMaker(await adapter.createOptions(),{signal:abort.signal,refundRoom:values['refund-room']});
  }catch{console.error('Confidential maker stopped. Preserve the protected journal and inspect adapter configuration; no private payload was logged.');process.exitCode=1;}
}
