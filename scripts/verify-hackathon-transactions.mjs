#!/usr/bin/env node
// Read-only unless --write is supplied. Never signs or broadcasts.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {RpcProvider,hash as starknetHash} from 'starknet';
import {MAINNET_DEPLOYMENT as deployment} from '../src/lib/mainnet-deployment.ts';
const args=process.argv.slice(2),hashes=[];
let write=false,rpcUrl=deployment.rpcUrl;
for(let i=0;i<args.length;i++){
 const arg=args[i];
 if(arg==='--write')write=true;
 else if(arg==='--rpc'){
  const value=args[++i];
  if(!value)throw new Error('--rpc requires an HTTPS RPC URL.');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use an HTTPS RPC URL without URL credentials.');
  rpcUrl=url.href;
 }else if(arg.startsWith('--'))throw new Error('Unknown option: '+arg);
 else hashes.push(arg);
}
const manifest=JSON.parse(await readFile(new URL('../strk20.json',import.meta.url),'utf8'));
const requested=hashes.length?hashes:manifest.transactions;
if(!Array.isArray(requested)||requested.length<3||requested.some(hash=>!/^0x[0-9a-fA-F]{1,64}$/.test(hash)))throw new Error('Provide at least three real mainnet transaction hashes.');
const unique=[...new Set(requested.map(hash=>'0x'+BigInt(hash).toString(16)))];
if(unique.length<3||unique.includes('0x0'))throw new Error('Three distinct nonzero transaction hashes are required.');
const provider=new RpcProvider({nodeUrl:rpcUrl});
if(BigInt(await provider.getChainId())!==BigInt(deployment.chainId))throw new Error('Expected Starknet mainnet.');
function addresses(node,out=new Set()){
 if(!node||typeof node!=='object')return out;
 if(typeof node.contract_address==='string')out.add('0x'+BigInt(node.contract_address).toString(16));
 for(const value of Object.values(node))if(value&&typeof value==='object')addresses(value,out);
 return out;
}
const verified=[];
for(const hash of unique){
 const receipt=await provider.getTransactionReceipt(hash);
 if(!receipt.isSuccess()||!receipt.block_hash||!['ACCEPTED_ON_L1','ACCEPTED_ON_L2'].includes(receipt.finality_status))throw new Error(hash+': not a successful included transaction.');
 const trace=await provider.getTransactionTrace(hash),called=addresses(trace);
 const normalized=value=>'0x'+BigInt(value).toString(16);
 if(!called.has(normalized(deployment.settlement.pool)))throw new Error(hash+': did not call the STRK20 pool.');
 if(!called.has(normalized(deployment.settlement.address)))throw new Error(hash+': did not call APP20 private settlement.');
 const fills=receipt.events.filter(event=>normalized(event.from_address)===normalized(deployment.settlement.address)&&event.keys[0]&&BigInt(event.keys[0])===BigInt(starknetHash.getSelectorFromName('QuoteFilled')));
 if(fills.length!==1||fills[0].keys.length!==3||fills[0].data.length!==2)throw new Error(hash+': expected one APP20 QuoteFilled event.');
 const fill=fills[0];
 for(const [address,expected]of[[deployment.settlement.pool,deployment.settlement.poolClassHash],[deployment.settlement.address,deployment.settlement.classHash]])if(BigInt(await provider.getClassHashAt(address,receipt.block_hash))!==BigInt(expected))throw new Error(hash+': deployed class mismatch.');
 verified.push({hash,blockNumber:receipt.block_number,blockHash:receipt.block_hash,finality:receipt.finality_status,pool:deployment.settlement.pool,appContract:deployment.settlement.address,quoteId:fill.keys[1],maker:fill.keys[2],sellAmount:BigInt(fill.data[0]).toString(),buyAmount:BigInt(fill.data[1]).toString(),networkFee:receipt.actual_fee,explorer:'https://voyager.online/tx/'+hash});
}
await mkdir('artifacts/hackathon',{recursive:true});
await writeFile('artifacts/hackathon/verified-mainnet-transactions.json',JSON.stringify({verifiedAt:new Date().toISOString(),chainId:deployment.chainId,transactions:verified},null,2)+'\n');
if(write)await writeFile(new URL('../strk20.json',import.meta.url),JSON.stringify({...manifest,transactions:unique,contracts:[deployment.address,deployment.settlement.address],demo_url:'https://app20.io'},null,2)+'\n');
console.log(JSON.stringify({verified:verified.length,manifestUpdated:write,transactions:verified},null,2));
