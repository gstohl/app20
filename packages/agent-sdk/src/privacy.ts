import type { Account, RpcProvider, Call } from 'starknet';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrivacyClient } from '../../privy/src/privacy';
import { contractDiscovery } from '../../privy/src/discovery';
import { starkscanProver, type ProofJob } from '../../privy/src/starkscan';
import { MAINNET_DEPLOYMENT as mainnet } from '../../../src/lib/mainnet-deployment';
import type { PrivacyExecutor } from './types.js';
import { executeBudgeted } from './budgeted-account';
export interface NodePrivacyOptions {
  account: Account; provider: RpcProvider; stateDirectory: string;
  viewingKeyProvider: { getViewingKey(): Promise<bigint> };
  relayUrl: string; relayToken: string;
  maxFeePerTransaction: bigint; maxTotalFees: bigint;
}
export interface NodePrivacyWallet {
  executor: PrivacyExecutor;
  register(): Promise<string>;
  shield(token: string, amount: bigint): Promise<string>;
  transfer(token: string, recipient: string, amount: bigint): Promise<string>;
  unshield(token: string, amount: bigint): Promise<string>;
  reconcile(): Promise<void>;
}
/** Local keys, direct contract discovery, hosted proving, durable account/fee journal. */
export async function createPrivacyWallet(options: NodePrivacyOptions): Promise<NodePrivacyWallet> {
  const relay = new URL(options.relayUrl);
  if (relay.protocol !== 'https:' || relay.username || relay.password) throw new Error('Use an HTTPS proof relay without URL credentials.');
  if (options.maxFeePerTransaction <= 0n || options.maxTotalFees < options.maxFeePerTransaction) throw new Error('Explicit positive gas limits required.');
  const dir=resolve(options.stateDirectory);
  await mkdir(dir,{recursive:true,mode:0o700});
  const scope=`${mainnet.chainId}/${options.account.address}`;
  async function read<T>(name:string):Promise<T|undefined>{try{return JSON.parse(await readFile(resolve(dir,name),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}}
  async function write(name:string,value:unknown){const path=resolve(dir,name),temp=path+'.'+crypto.randomUUID()+'.next';const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(value));await f.sync();}finally{await f.close();}await rename(temp,path);const d=await open(dir,'r');try{await d.sync();}finally{await d.close();}}
  async function exclusive<T>(name:string,fn:()=>Promise<T>):Promise<T>{const path=resolve(dir,name+'.lock'),f=await open(path,'wx',0o600);try{return await fn();}finally{await f.close();await unlink(path);}}
  type State={scope:string;spent:string;pending?:{hash?:string}};
  const state=async()=>{const s=await read<State>('wallet.json')??{scope,spent:'0'};if(s.scope!==scope)throw new Error('Wallet state belongs to another account.');return s;};
  async function reconcile(){const s=await state();if(s.pending){if(!s.pending.hash)throw new Error('Unknown submission outcome: inspect account before clearing the wallet journal.');const r=await options.provider.getTransactionReceipt(s.pending.hash);if(!r.isSuccess()&&!r.isReverted())throw new Error('Transaction still pending.');delete s.pending;await write('wallet.json',s);}}
  const account=new Proxy(options.account,{get(target,prop){
    if(prop==='execute')return async(calls:Call|Call[],details:Parameters<Account['execute']>[1])=>{
      await reconcile();
      return executeBudgeted(target,calls,details,{maxFeePerTransaction:options.maxFeePerTransaction,maxTotalFees:options.maxTotalFees,load:state,save:s=>write('wallet.json',s)});
    };
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
  const privacy=new PrivacyClient({account,provider:options.provider,network:'mainnet',poolAddress:mainnet.settlement.pool,viewingKeyProvider:options.viewingKeyProvider,discovery:contractDiscovery(),prover:starkscanProver({relayUrl:relay.href,accessToken:async()=>options.relayToken,poolClassHash:mainnet.settlement.poolClassHash,journal:{runExclusive:fn=>exclusive('proof',fn),load:key=>read<ProofJob>('proof-'+key+'.json'),save:(key,value)=>write('proof-'+key+'.json',value)}})});
  const run=(fn:()=>ReturnType<PrivacyClient['register']>)=>exclusive('wallet',async()=>{await reconcile();const result=await fn();if(!result.submitted)throw new Error('No live transaction produced.');await reconcile();return result.transactionHash;});
  return {
    register:()=>run(()=>privacy.register()),
    shield:(token,amount)=>run(()=>privacy.shield({token,amount})),
    transfer:(token,recipient,amount)=>run(()=>privacy.transfer({token,recipient,amount})),
    unshield:(token,amount)=>run(()=>privacy.unshield({token,amount})),
    reconcile:()=>exclusive('wallet',reconcile),
    executor:{address:account.address,chainId:mainnet.chainId,execute:async actions=>{
      const [fund,recover,invoke]=actions;
      if(actions.length!==3||fund?.type!=='withdraw'||recover?.type!=='transfer'||recover.amount!=='OPEN'||invoke?.type!=='invoke'||BigInt(fund.recipient)!==BigInt(mainnet.settlement.address)||BigInt(invoke.contract)!==BigInt(mainnet.settlement.address)||invoke.calldata.length!==3||invoke.calldata[2]!=='${openNoteIds[0]}'||BigInt(recover.recipient)!==BigInt(account.address))throw new Error('Unsupported private settlement batch.');
      const transaction_hash=await run(()=>privacy.invokeExternal({funding:{token:fund.token,recipient:fund.recipient,amount:BigInt(fund.amount)},recovery:{token:recover.token,recipient:recover.recipient},calldata:args=>{const notes=args.openNotes as {noteId:bigint}[];if(notes.length!==1)throw new Error('Expected one output note.');return {contractAddress:invoke.contract,calldata:[invoke.calldata[0],invoke.calldata[1],notes[0]!.noteId]};}}));
      return {transaction_hash};
    }},
  };
}
