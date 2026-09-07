// Read-only download of the deployed pool class for an isolated devnet experiment.
import { mkdir, writeFile } from 'node:fs/promises';
import { hash } from 'starknet';
import { MAINNET_DEPLOYMENT as deployment } from '../src/lib/mainnet-deployment.ts';

const directory = new URL('../artifacts/confidential-rfq/', import.meta.url);
async function rpc(method, params) {
  const response = await fetch(deployment.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw Error(JSON.stringify(body.error));
  return body.result;
}
const block = await rpc('starknet_blockHashAndNumber', {});
const classHash = await rpc('starknet_getClassHashAt', { block_id: { block_hash: block.block_hash }, contract_address: deployment.settlement.pool });
if (BigInt(classHash) !== BigInt(deployment.settlement.poolClassHash)) throw Error('Mainnet pool class changed; review the new version first.');
const contract = await rpc('starknet_getClass', { block_id: { block_hash: block.block_hash }, class_hash: classHash });
if (typeof contract.abi === 'string') contract.abi = JSON.parse(contract.abi);
if (BigInt(hash.computeSierraContractClassHash(contract)) !== BigInt(classHash)) throw Error('Downloaded Sierra class hash mismatch.');
const casm = await rpc('starknet_getCompiledCasm', { class_hash: classHash });
await mkdir(directory, { recursive: true });
await writeFile(new URL('mainnet-pool.sierra.json', directory), JSON.stringify(contract));
await writeFile(new URL('mainnet-pool.casm.json', directory), JSON.stringify(casm));
await writeFile(new URL('mainnet-class-source.json', directory), JSON.stringify({ downloadedAt: new Date().toISOString(), block, pool: deployment.settlement.pool, classHash, compiledClassHash: hash.computeCompiledClassHash(casm), rpc: deployment.rpcUrl }, null, 2) + '\n');
console.log(`Verified and downloaded pool class ${classHash}; no transaction submitted.`);
