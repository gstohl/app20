import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectConfidentialProofPrerequisites, readProofRpc } from './confidential-mainnet-proof.mjs';
import { MAINNET_DEPLOYMENT as deployment } from '../src/lib/mainnet-deployment.ts';

function rpcFixture(change = {}) {
  const requests = [];
  const responses = {
    starknet_chainId: deployment.chainId,
    starknet_getBlockWithTxHashes: { block_hash: '0x123', block_number: 20, status: 'ACCEPTED_ON_L1' },
    starknet_getClassHashAt: deployment.settlement.poolClassHash,
    starknet_getStorageProof: { global_roots: { block_hash: '0x123' }, classes_proof: [], contracts_proof: { contract_leaves_data: [{}] } },
    starknet_call: ['0x53444835ec580000'],
    ...change,
  };
  return { requests, fetcher: async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    return Response.json(request.method === 'starknet_getClass' ? { error: { code: 28 } } : { result: responses[request.method] });
  } };
}
test('preflight reports an undeclared escrow distinctly from available finalized pool storage proofs', async () => {
  const fixture = rpcFixture();
  const report = await inspectConfidentialProofPrerequisites(fixture);
  assert.equal(report.escrowDeclaredAtProvingBlock, false);
  assert.equal(report.storageProofResponseAvailable, true);
  assert.equal(report.realConfidentialProofVerified, false);
  assert.equal(report.transactionSubmitted, false);
  assert.equal(report.poolFeeBaseUnits, '6000000000000000000');
  for (const request of fixture.requests.filter(r => r.params.block_id && r.method !== 'starknet_getBlockWithTxHashes')) assert.deepEqual(request.params.block_id, { block_hash: '0x123' });
});
test('preflight rejects another chain, pool class and storage-proof block', async () => {
  for (const changed of [{ starknet_chainId: '0x1' }, { starknet_getClassHashAt: '0x2' }, { starknet_getStorageProof: { global_roots: { block_hash: '0x456' } } }, { starknet_getBlockWithTxHashes: { block_number: 20, block_hash: '0x123', status: 'PRE_CONFIRMED' } }]) await assert.rejects(() => inspectConfidentialProofPrerequisites(rpcFixture(changed)));
});
test('preflight cannot submit or request proving, and does not treat provider errors as an undeclared class', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return Response.json({ error: { code: -32601 } }); };
  for (const method of ['starknet_addInvokeTransaction', 'starknet_addDeclareTransaction', 'starknet_proveTransaction']) await assert.rejects(() => readProofRpc(deployment.rpcUrl, method, {}, fetcher), /read-only/);
  assert.equal(requests, 0);
  await assert.rejects(() => readProofRpc(deployment.rpcUrl, 'starknet_getClass', {}, fetcher), /failed/);
});
