#!/usr/bin/env node
// Read-only chain preflight and explicit proof generation. No signing keys are loaded here.
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { hash } from 'starknet';
import { MAINNET_DEPLOYMENT as deployment } from '../src/lib/mainnet-deployment.ts';
import { CONFIDENTIAL_RFQ_CONTRACT as escrow } from '../src/lib/confidential-rfq-deployment.ts';

const READS = new Set(['starknet_chainId', 'starknet_getBlockWithTxHashes', 'starknet_getClassHashAt', 'starknet_getClass', 'starknet_getStorageProof', 'starknet_call']);
export async function readProofRpc(url, method, params, fetcher = fetch) {
  if (!READS.has(method)) throw Error('Only read-only chain RPC is supported.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw Error('HTTPS RPC without embedded credentials required.');
  const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Chain preflight HTTP ${response.status}.`);
  const result = await response.json();
  // Code 28 means undeclared, unlike a transient failure or an unsupported RPC method.
  if (method === 'starknet_getClass' && result.error?.code === 28) return null;
  if (result.error || result.result === undefined) throw Error(`Chain preflight failed for ${method}; response payload omitted.`);
  return result.result;
}

export async function inspectConfidentialProofPrerequisites({ rpc = deployment.rpcUrl, fetcher = fetch } = {}) {
  const read = (method, params) => readProofRpc(rpc, method, params, fetcher);
  const chainId = await read('starknet_chainId', []);
  if (BigInt(chainId) !== BigInt(deployment.chainId)) throw Error('Starknet mainnet is required.');
  const block = await read('starknet_getBlockWithTxHashes', { block_id: 'latest' });
  if (!Number.isSafeInteger(block.block_number) || !/^0x[\da-fA-F]+$/.test(block.block_hash) || !['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(block.status)) throw Error('An accepted mainnet block is required.');
  const block_id = { block_hash: block.block_hash };
  const poolClass = await read('starknet_getClassHashAt', { block_id, contract_address: deployment.settlement.pool });
  if (BigInt(poolClass) !== BigInt(deployment.settlement.poolClassHash)) throw Error('Canonical pool class changed.');
  const [contract, storage, fee] = await Promise.all([
    read('starknet_getClass', { block_id, class_hash: escrow.classHash }),
    read('starknet_getStorageProof', { block_id, class_hashes: [poolClass], contract_addresses: [deployment.settlement.pool], contracts_storage_keys: [] }),
    read('starknet_call', { block_id, request: { contract_address: deployment.settlement.pool, entry_point_selector: hash.getSelectorFromName('get_fee_amount'), calldata: [] } }),
  ]);
  if (!storage?.global_roots || BigInt(storage.global_roots.block_hash) !== BigInt(block.block_hash) || !storage.contracts_proof?.contract_leaves_data?.length || !Array.isArray(storage.classes_proof)) throw Error('Storage-proof response is incomplete or refers to another block.');
  if (!Array.isArray(fee) || fee.length !== 1 || !/^0x[\da-fA-F]+$/.test(fee[0])) throw Error('Invalid pool application fee.');
  if (contract) {
    if (typeof contract.abi === 'string') contract.abi = JSON.parse(contract.abi);
    if (BigInt(hash.computeSierraContractClassHash(contract)) !== BigInt(escrow.classHash)) throw Error('Escrow class contents do not match their pin.');
  }
  return {
    schema: 'app20-confidential-proof-preflight/v1', inspectedAt: new Date().toISOString(), rpcOrigin: new URL(rpc).origin,
    chainId, block: { number: block.block_number, hash: block.block_hash }, pool: deployment.settlement.pool,
    poolClass, escrowClass: escrow.classHash, escrowDeclaredAtProvingBlock: contract !== null,
    storageProofResponseAvailable: true, poolFeeBaseUnits: BigInt(fee[0]).toString(),
    realConfidentialProofVerified: false, transactionSubmitted: false,
  };
}

export async function proveFromAdapter({ adapter, mode = 'setup', output }) {
  if (!['setup', 'settle', 'refundA', 'refundB'].includes(mode) || !adapter || !output) throw Error('Local adapter, output path and supported operation mode are required.');
  const { createConfidentialProofClient, confidentialRequiredSigners } = await import('../packages/agent-sdk/dist/confidential.js');
  const owner = await import(pathToFileURL(resolve(adapter)).href);
  if (typeof owner.createOptions !== 'function' || typeof owner.sign !== 'function') throw Error('Adapter must export createOptions and sign.');
  const options = await owner.createOptions();
  if (BigInt(options.agreement.chainId) !== BigInt(deployment.chainId)) throw Error('This operator command requires mainnet.');
  const client = await createConfidentialProofClient(options);
  const prepared = await client.prepare(mode);
  const approvals = [];
  for (const role of confidentialRequiredSigners(mode)) approvals.push(await client.approve(prepared, role, (digest, review) => owner.sign(role, digest, review)));
  const submission = await client.prove(prepared, approvals);
  // Only public submission data reaches disk, never the agreement, invocation or viewing key.
  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const file = await open(destination, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify({ schema: 'app20-confidential-proof-rehearsal/v1', generatedAt: new Date().toISOString(), chainId: deployment.chainId, escrow: client.agreement.address, mode, submission, chainAcceptanceVerified: false, transactionSubmitted: false }, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  return { output: destination, mode, escrow: client.agreement.address, transactionSubmitted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { rpc: { type: 'string' }, adapter: { type: 'string' }, mode: { type: 'string' }, output: { type: 'string' } } });
    console.log(JSON.stringify(values.adapter ? await proveFromAdapter(values) : await inspectConfidentialProofPrerequisites(values), null, 2));
  } catch {
    // SDK/prover diagnostics can include a private invocation. Never print an arbitrary error.
    console.error('Confidential proof rehearsal stopped. No transaction was submitted by this command; inspect the operator adapter and saved proof job without logging private inputs.');
    process.exitCode = 1;
  }
}
