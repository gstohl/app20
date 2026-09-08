import { defaultDeployer, ec, hash, RpcProvider, type WalletAccountV6 } from 'starknet';
import { normalizeConfidentialAgreement, confidentialConstructor, reviewConfidentialOperation, verifyConfidentialApproval, type ConfidentialPrepared, type ConfidentialApproval } from '../../packages/agent-sdk/src/confidential-protocol';
import { MAINNET_DEPLOYMENT } from './mainnet-deployment';
import { CONFIDENTIAL_RFQ_CONTRACT } from './confidential-rfq-deployment';
import { confidentialRoomApi, createRoomKey, restoreRoomKey, roomId, openRoomMessage, sealRoomMessage, validRoomId, type ConfidentialMaker, type ConfidentialRoomPayload, type QuoteRequest, type RoomEnvelope } from './confidential-room';
import { createBrowserConfidentialJournal, createBrowserConfidentialSecretStore } from './confidential-browser-journal';
import type { ConfidentialJournalState } from '../../packages/agent-sdk/src/confidential';
import { createReadyConfidentialProofSession, createReadyConfidentialWallet, openConfidentialEscrowIdentity } from './confidential-wallet';

type Quote = Extract<ConfidentialRoomPayload,{kind:'quote'}>;
type Prepared = { prepared: ConfidentialPrepared; approval: ConfidentialApproval };
export type RoomSummary = {
  id:string; makerName:string; makerAddress:string; sellToken:string; buyToken:string; sellAmount:string; minimumAmount:string; buyAmount?:string; quoteExpiresAt?:number; deadline?:number;
  state:'requesting'|'quote'|'deploying'|'setup'|'fund'|'waiting'|'settle'|'settled'|'refundable'|'refunded'|'declined'|'attention'; message?:string; transactionHash?:string;
};
export type QuoteInput = {sellToken:string;buyToken:string;sellAmount:string;minimumAmount:string;maker?:string};
type Room = { id:string; token:string; maker:ConfidentialMaker; request:QuoteRequest; key:JsonWebKey; identityScope:string; initial:RoomEnvelope; created:boolean; sequence:number; outbox:RoomEnvelope[]; notifications?:string[]; quote?:Quote; prepared?:Prepared; deploymentPending?:boolean; deploymentHash?:string; setupHash?:string; fundingHash?:string; settlementHash?:string; refundHash?:string; declined?:string; error?:string; expired?:boolean; pending?:boolean };
const same = (a:string,b:string) => BigInt(a) === BigInt(b);
const felt = (value:string) => { if (!/^0x[\da-f]+$/i.test(value) || BigInt(value)<=0n || BigInt(value)>=2n**251n+17n*2n**192n+1n) throw Error('Invalid transaction or account identity.'); return `0x${BigInt(value).toString(16)}`; };
const amount = (value:string) => { if(!/^\d+$/.test(value)||BigInt(value)<=0n||BigInt(value)>=2n**128n)throw Error('Enter a positive amount.');return BigInt(value).toString(); };
function deployment(quote:Quote) { return defaultDeployer.buildDeployerCall({ classHash: quote.agreement.escrowClassHash, constructorCalldata: confidentialConstructor(quote.agreement), salt:quote.salt, unique:false },quote.agreement.terms.partyA); }

/** A transport peer cannot change any user term or substitute a settlement contract. */
export function reviewConfidentialQuote(request:QuoteRequest,maker:ConfidentialMaker,quote:Quote,now=Math.floor(Date.now()/1000),accepted=false):Quote {
  const a=normalizeConfidentialAgreement(quote.agreement),t=a.terms;
  if(!same(a.chainId,MAINNET_DEPLOYMENT.chainId)||!same(a.pool,MAINNET_DEPLOYMENT.settlement.pool)||!same(a.poolClassHash,MAINNET_DEPLOYMENT.settlement.poolClassHash)||!same(a.escrowClassHash,CONFIDENTIAL_RFQ_CONTRACT.classHash)||!same(a.signerA,request.signerA)||!same(t.partyA,request.taker)||!same(t.partyB,maker.account)||!same(t.tokenA,request.sellToken)||!same(t.tokenB,request.buyToken)||t.amountA!==request.sellAmount||BigInt(t.amountB)<BigInt(request.minimumAmount))throw Error('The maker quote differs from your requested trade.');
  if(!Number.isSafeInteger(quote.expiresAt)||(!accepted&&(quote.expiresAt<=now||quote.expiresAt>now+300||a.deadline<now+120||a.deadline>now+3600))||quote.expiresAt>a.deadline)throw Error('This quote has expired. Request a fresh quote.');
  if(typeof quote.viewingKey!=='string'||!/^0x[\da-f]+$/i.test(quote.viewingKey)||BigInt(quote.viewingKey)<=0n||BigInt(quote.viewingKey)>ec.starkCurve.CURVE.n/2n)throw Error('The escrow recovery material is invalid.');
  felt(quote.salt);
  if(!same(deployment({...quote,agreement:a}).addresses[0]!,a.address))throw Error('The escrow address does not match the agreed deployment.');
  return {...quote,agreement:a};
}

/** Rebuild the UI from the SDK's receipt-checked journal after a reload or timeout. */
export function confirmedTradingState(journal:ConfidentialJournalState|undefined) {
  const restored:Pick<Room,'setupHash'|'fundingHash'|'settlementHash'|'refundHash'>={};
  for(const attempt of journal?.confirmed??[]) {
    if(!attempt.hash)throw Error('A confirmed operation is missing its receipt identity.');
    const tx=felt(attempt.hash);
    if(attempt.mode==='setup')restored.setupHash=tx;
    else if(attempt.mode==='fundA')restored.fundingHash=tx;
    else if(attempt.mode==='settle')restored.settlementHash=tx;
    else if(attempt.mode==='refundA')restored.refundHash=tx;
  }
  return restored;
}

export class ConfidentialTrading {
  private active=true;
  private records:Room[]=[];
  private readonly account:string;
  private readonly scope:string;
  private readonly store:ReturnType<typeof createBrowserConfidentialSecretStore>;
  private readonly provider:RpcProvider;
  private readonly api=confidentialRoomApi();
  private readonly proofSession:ReturnType<typeof createReadyConfidentialProofSession>;
  private busy:string|null=null;
  constructor(private readonly options:{wallet:WalletAccountV6;assertCurrent():void;changed(rooms:RoomSummary[],busy:string|null):void}) {
    this.account=felt(options.wallet.address);
    this.scope=`${MAINNET_DEPLOYMENT.chainId}/${this.account}/0x${hash.starknetKeccak('APP20_CONFIDENTIAL_TRADING_V1').toString(16)}`;
    this.store=createBrowserConfidentialSecretStore(this.scope);
    this.provider=new RpcProvider({nodeUrl:`${location.origin}/api/starknet/mainnet`});
    this.proofSession=createReadyConfidentialProofSession({wallet:options.wallet,assertCurrent:()=>this.current()});
  }
  close(){this.active=false;}
  private current(){if(!this.active)throw Error('This wallet session has ended.');this.options.assertCurrent();if(!same(this.options.wallet.address,this.account))throw Error('The connected account changed.');}
  private emit(){if(this.active)this.options.changed(this.summaries(),this.busy);}
  private summaries():RoomSummary[]{const now=Math.floor(Date.now()/1000);return this.records.map(r=>{
    const state:RoomSummary['state']=r.refundHash?'refunded':r.settlementHash?'settled':r.pending||r.error?'attention':r.quote&&r.quote.agreement.deadline<=now&&r.fundingHash?'refundable':r.declined?'declined':r.deploymentPending?'deploying':r.prepared?.prepared.mode==='settle'?'settle':r.fundingHash?'waiting':r.setupHash?'fund':r.prepared?.prepared.mode==='setup'?'setup':r.deploymentHash?'waiting':r.quote?'quote':'requesting';
    return{id:r.id,makerName:r.maker.name,makerAddress:r.maker.account,sellToken:r.request.sellToken,buyToken:r.request.buyToken,sellAmount:r.request.sellAmount,minimumAmount:r.request.minimumAmount,buyAmount:r.quote?.agreement.terms.amountB,quoteExpiresAt:r.quote?.expiresAt,deadline:r.quote?.agreement.deadline,state,message:r.error??r.declined,transactionHash:r.refundHash??r.settlementHash??r.fundingHash??r.setupHash??r.deploymentHash};
  });}
  private async load():Promise<Room[]>{const bytes=await this.store.load();if(!bytes)return[];const v=JSON.parse(new TextDecoder().decode(bytes));if(v.schema!=='app20/trading-recovery/v1'||v.account!==this.account||!Array.isArray(v.rooms)||v.rooms.length>32||v.rooms.some((r:Room)=>!validRoomId(r.id)||!validRoomId(r.token)||r.request.taker!==this.account))throw Error('Private trading recovery records could not be authenticated.');return v.rooms;}
  async initialize(){this.current();this.records=await this.load();this.current();this.emit();}
  private async update(id:string,change:(record:Room)=>Room){
    await navigator.locks.request(`app20-trading-storage:${this.scope}`,async()=>{this.current();const records=await this.load();const index=records.findIndex(r=>r.id===id);if(index<0)throw Error('Private trade record is unavailable.');records[index]=change(records[index]!);await this.store.save(new TextEncoder().encode(JSON.stringify({schema:'app20/trading-recovery/v1',account:this.account,rooms:records})));this.records=records;});this.emit();
  }
  private room(id:string){const r=this.records.find(r=>r.id===id);if(!r)throw Error('Private trade record is unavailable.');return structuredClone(r);}
  private async outbox(id:string,payload:ConfidentialRoomPayload){
    const r=this.room(id),key=payload.kind==='confirmed'?`${payload.stage}:${felt(payload.hash)}`:payload.kind==='accepted'?`accepted:${felt(payload.deploymentHash)}`:undefined;
    if(!key||!r.notifications?.includes(key)) {
      const envelope=await sealRoomMessage(id,'taker',payload,r.maker.publicKey);
      await this.update(id,record=>key&&record.notifications?.includes(key)?record:{...record,outbox:[...record.outbox,envelope],notifications:key?[...(record.notifications??[]),key]:record.notifications});
    }
    await this.flush(id);
  }
  private async flush(id:string){let r=this.room(id);if(!r.created){await this.api.create(r.id,r.maker.account,r.token,r.initial);await this.update(id,v=>({...v,created:true}));r=this.room(id);}for(const envelope of r.outbox){await this.api.send(id,envelope,r.token);await this.update(id,v=>({...v,outbox:v.outbox.filter(e=>e.id!==envelope.id)}));}}
  async requestQuotes(input:QuoteInput,makers:ConfidentialMaker[]){
    this.current();if(this.busy)throw Error('Wait for the current wallet operation.');
    const sellToken=felt(input.sellToken),buyToken=felt(input.buyToken),sellAmount=amount(input.sellAmount),minimumAmount=amount(input.minimumAmount);
    const allowed=[MAINNET_DEPLOYMENT.sellToken.address,MAINNET_DEPLOYMENT.buyToken.address];
    if(same(sellToken,buyToken)||![sellToken,buyToken].every(t=>allowed.some(a=>same(t,a))))throw Error('Choose the supported STRK and USDC pair.');
    const selected=makers.filter(m=>m.expiresAt>Math.floor(Date.now()/1000)&&!same(m.account,this.account)&&(!input.maker||same(m.account,input.maker))).slice(0,3);
    if(!selected.length)throw Error('No other maker is online for this pair. Try again when a maker is available.');
    this.busy='quotes';this.emit();
    try{for(const maker of selected){
      const id=roomId(),token=roomId(),identityScope=`${MAINNET_DEPLOYMENT.chainId}/${this.account}/0x${hash.starknetKeccak(id).toString(16)}`;
      const identity=await openConfidentialEscrowIdentity({scope:identityScope}),key=await createRoomKey();this.current();
      const request:QuoteRequest={kind:'request',taker:this.account,signerA:identity.publicKey,replyKey:key.publicKey,sellToken,buyToken,sellAmount,minimumAmount};
      const initial=await sealRoomMessage(id,'taker',request,maker.publicKey);
      const record:Room={id,token,maker,request,key:key.privateKey,identityScope,initial,created:false,sequence:0,outbox:[]};
      await navigator.locks.request(`app20-trading-storage:${this.scope}`,async()=>{this.current();let records=await this.load();if(records.length>=32)records=records.filter(r=>!r.refundHash&&!r.settlementHash&&!r.declined);if(records.length>=32)throw Error('Finish or recover your existing private trades first.');records.push(record);await this.store.save(new TextEncoder().encode(JSON.stringify({schema:'app20/trading-recovery/v1',account:this.account,rooms:records})));this.records=records;});
      await this.flush(id);this.emit();
    }}finally{this.busy=null;this.emit();}
  }
  async sync(){
    this.current();if(this.busy)return;
    for(const record of [...this.records]){
      if((record.settlementHash||record.refundHash||record.declined)&&!record.outbox.length)continue;
      await navigator.locks.request(`app20-trading-poll:${record.id}`,{ifAvailable:true},async lock=>{if(!lock)return;this.records=await this.load();const r=this.room(record.id);await this.flush(r.id);const messages=await this.api.messages(r.id,r.sequence,r.token);const pair=await restoreRoomKey(r.key);
        for(const message of messages){this.current();if(message.sequence<=this.room(r.id).sequence)continue;if(message.sequence!==this.room(r.id).sequence+1)throw Error('Private quote messages arrived out of order.');
          let patch:Partial<Room>={};
          if(message.role==='maker'){
            const payload=await openRoomMessage(r.id,message,pair),current=this.room(r.id);
            if(payload.kind==='quote'&&!current.quote)patch.quote=reviewConfidentialQuote(current.request,current.maker,payload);
            else if(payload.kind==='prepared'){
              if(!current.quote||!['setup','settle'].includes(payload.prepared.mode)||JSON.stringify(normalizeConfidentialAgreement(payload.prepared.agreement))!==JSON.stringify(current.quote.agreement))throw Error('The maker operation belongs to another agreement.');
              reviewConfidentialOperation(payload.prepared,BigInt(current.quote.viewingKey));
              if(payload.approval.role!=='b'||!verifyConfidentialApproval(current.quote.agreement,payload.prepared.digest,payload.approval))throw Error('The maker approval does not match the reviewed operation.');
              if(payload.prepared.mode==='setup'&&!current.setupHash||payload.prepared.mode==='settle'&&!current.settlementHash)patch.prepared={prepared:payload.prepared,approval:payload.approval};
            }else if(payload.kind==='declined'&&!current.deploymentHash)patch.declined=typeof payload.message==='string'?payload.message.slice(0,180):'The maker declined this quote.';
            else if(payload.kind==='funded')felt(payload.hash);
          }
          await this.update(r.id,v=>({...v,...patch,sequence:message.sequence}));
        }
      });
    }
  }
  private async client(record:Room){
    this.current();if(!record.quote)throw Error('Select a maker quote first.');
    const quote=reviewConfidentialQuote(record.request,record.maker,record.quote,Math.floor(Date.now()/1000),Boolean(record.deploymentHash||record.deploymentPending));
    const identity=await openConfidentialEscrowIdentity({scope:record.identityScope});
    return createReadyConfidentialWallet({agreement:quote.agreement,role:'a',viewingKey:BigInt(quote.viewingKey),identity,provider:this.provider,wallet:this.options.wallet,assertCurrent:()=>this.current(),proofSession:this.proofSession});
  }
  private async action(id:string,task:()=>Promise<void>){
    if(this.busy)throw Error('Wait for the current wallet operation.');this.current();this.busy=id;this.emit();
    try{await navigator.locks.request(`app20-trading-action:${id}`,{ifAvailable:true},async lock=>{if(!lock)throw Error('This trade is open in another active tab.');this.records=await this.load();await this.update(id,r=>({...r,error:undefined}));await task();});}
    catch(error){await this.update(id,r=>({...r,error:error instanceof Error?error.message:'The operation did not finish. Check its transaction before retrying.'}));throw error;}
    finally{this.busy=null;this.emit();}
  }
  async advance(id:string){return this.action(id,async()=>{
    const record=this.room(id);if(!record.quote)throw Error('Wait for a maker quote.');
    if(record.deploymentPending||record.pending)throw Error('Check the existing transaction before continuing.');
    if(!record.deploymentHash){
      const quote=reviewConfidentialQuote(record.request,record.maker,record.quote);this.current();
      await this.update(id,r=>({...r,deploymentPending:true}));
      const tx=await this.options.wallet.execute(deployment(quote).calls);felt(tx.transaction_hash);
      await this.update(id,r=>({...r,deploymentHash:tx.transaction_hash}));
      const receipt=await this.provider.waitForTransaction(tx.transaction_hash);if(receipt.isReverted())throw Error('Escrow deployment reverted.');
      await this.client(this.room(id));
      await this.update(id,r=>({...r,deploymentPending:false}));
      await this.outbox(id,{kind:'accepted',commitment:quote.agreement.commitment,deploymentHash:tx.transaction_hash});return;
    }
    const client=await this.client(record);
    if(record.prepared){
      const own=await client.approve(record.prepared.prepared);this.current();
      await this.update(id,r=>({...r,pending:true}));
      const tx=await client.execute(record.prepared.prepared,[own,record.prepared.approval]);
      const stage=record.prepared.prepared.mode;if(stage!=='setup'&&stage!=='settle')throw Error('Unexpected trade operation.');
      await this.update(id,r=>({...r,prepared:undefined,pending:false,...(stage==='setup'?{setupHash:tx}:{settlementHash:tx})}));
      await this.outbox(id,{kind:'confirmed',stage,hash:tx});
    }else if(record.setupHash&&!record.fundingHash){
      await this.update(id,r=>({...r,pending:true}));
      const tx=await client.fund();await this.update(id,r=>({...r,fundingHash:tx,pending:false}));await this.outbox(id,{kind:'confirmed',stage:'fundA',hash:tx});
    }else throw Error('Waiting for the other side of the trade.');
  });}
  async recover(id:string){return this.action(id,async()=>{
    const record=this.room(id);if(!record.quote) {await this.flush(id);return;}
    if(record.deploymentPending){
      if(!record.deploymentHash)throw Error('The wallet did not return a deployment hash. Check its activity before creating another trade.');
      const receipt=await this.provider.getTransactionReceipt(record.deploymentHash);
      if(receipt.isReverted()){await this.update(id,r=>({...r,deploymentPending:false,deploymentHash:undefined}));return;}
      if(!receipt.isSuccess())throw Error('Escrow deployment is still pending.');
      await this.client(record);await this.update(id,r=>({...r,deploymentPending:false}));await this.outbox(id,{kind:'accepted',commitment:record.quote.agreement.commitment,deploymentHash:record.deploymentHash});return;
    }
    const client=await this.client(record);await client.reconcile();const state=await client.inspect();
    const a=record.quote.agreement,journal=await createBrowserConfidentialJournal(`${a.chainId}/${a.address}/${a.commitment}`).load();
    const restored=confirmedTradingState(journal);
    await this.update(id,r=>({...r,...restored,prepared:(r.prepared?.prepared.mode==='setup'&&restored.setupHash)||(r.prepared?.prepared.mode==='settle'&&restored.settlementHash)||restored.refundHash?undefined:r.prepared,pending:Boolean(state.pending||journal?.pending),expired:state.timestamp>=a.deadline}));
    if(state.pending)throw Error('This transaction is still unresolved. Check wallet activity before retrying.');
    for(const [key,stage] of [['setupHash','setup'],['fundingHash','fundA'],['settlementHash','settle'],['refundHash','refundA']] as const){const tx=restored[key];if(tx)await this.outbox(id,{kind:'confirmed',stage,hash:tx});}
    await this.flush(id);
  });}
  async refund(id:string){return this.action(id,async()=>{
    const record=this.room(id),client=await this.client(record),prepared=await client.prepare('refundA');
    const approval=await client.approve(prepared);await this.update(id,r=>({...r,pending:true}));
    const tx=await client.execute(prepared,[approval]);await this.update(id,r=>({...r,refundHash:tx,pending:false,prepared:undefined}));await this.outbox(id,{kind:'confirmed',stage:'refundA',hash:tx});
  });}
}
