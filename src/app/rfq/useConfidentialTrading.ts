import { useEffect, useRef, useState } from 'react';
import { useStoreWallet } from '@/app/components/Wallet/walletContext';
import { useFrontendProvider } from '@/app/components/client/provider/providerContext';
import { MAINNET_DEPLOYMENT } from '@/lib/mainnet-deployment';
import { confidentialRoomApi, type ConfidentialMaker } from '@/lib/confidential-room';
import type { ConfidentialTrading, RoomSummary, QuoteInput } from '@/lib/confidential-trading';
export type { RoomSummary } from '@/lib/confidential-trading';

export function useConfidentialTrading(){
  const connected=useStoreWallet(s=>s.isConnected),address=useStoreWallet(s=>s.address),chain=useStoreWallet(s=>s.chain),wallet=useStoreWallet(s=>s.myWalletAccount),privacy=useStoreWallet(s=>s.isStrk20Capable);
  const network=useFrontendProvider(s=>s.currentFrontendProviderIndex);
  const compatible=Boolean(connected&&wallet&&privacy&&network===0&&chain&&BigInt(chain)===BigInt(MAINNET_DEPLOYMENT.chainId));
  const [makers,setMakers]=useState<ConfidentialMaker[]>([]),[rooms,setRooms]=useState<RoomSummary[]>([]),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const controller=useRef<ConfidentialTrading|null>(null),polling=useRef(false);
  const refresh=async()=>{try{const items=await confidentialRoomApi().makers();if(!Array.isArray(items)||items.length>100)throw Error('Maker directory is invalid.');setMakers(items);await controller.current?.sync();}catch(e){setError(e instanceof Error?e.message:'The private quote connection failed.');}};
  useEffect(()=>{let alive=true;const poll=async()=>{if(polling.current)return;polling.current=true;try{if(alive)await refresh();}finally{polling.current=false;}};void poll();const timer=setInterval(()=>void poll(),5000);return()=>{alive=false;clearInterval(timer);};},[]);
  useEffect(()=>{let alive=true;setRooms([]);setBusy(null);setError(null);
    if(compatible&&wallet){void(async()=>{const {ConfidentialTrading}=await import('@/lib/confidential-trading');if(!alive)return;const instance=new ConfidentialTrading({wallet,assertCurrent:()=>{const current=useStoreWallet.getState();if(!alive||!current.isConnected||current.address!==address||current.chain!==chain||current.myWalletAccount!==wallet||useFrontendProvider.getState().currentFrontendProviderIndex!==0)throw Error('The connected wallet changed. Reopen this trade with its original account.');},changed:(next,working)=>{if(alive){setRooms(next);setBusy(working);}}});controller.current=instance;await instance.initialize();if(alive)await instance.sync();})().catch(e=>{if(alive)setError(e instanceof Error?e.message:'Private trading could not open.');});}
    return()=>{alive=false;controller.current?.close();controller.current=null;};
  },[compatible,wallet,address,chain]);
  async function run(task:(value:ConfidentialTrading)=>Promise<void>){setError(null);try{if(!controller.current)throw Error('Connect a Ready wallet on Starknet mainnet to trade.');await task(controller.current);}catch(e){setError(e instanceof Error?e.message:'The private trade operation did not finish.');}}
  return{connected,compatible,makers,rooms,busy,error,status:!connected?'Connect your wallet to request private quotes.':!compatible?'Use a Ready wallet with STRK20 support on Starknet mainnet.':makers.length?'Quotes are encrypted for the makers you choose.':'No makers are online right now. The directory updates automatically.',requestQuotes:(input:QuoteInput)=>run(c=>c.requestQuotes(input,makers)),advance:(id:string)=>run(c=>c.advance(id)),recover:(id:string)=>run(c=>c.recover(id)),refund:(id:string)=>run(c=>c.refund(id)),refresh};
}
