import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash } from 'starknet';
import { deploymentCalls, verifyDeployedSettlement } from './prepare-private-settlement.mjs';
import { MAINNET_POOL, MAINNET_CHAIN_ID } from './prepare-mainnet.mjs';
const candidate = { contracts: { App20MakerBook: { classHash: '0x10' }, App20PrivateSwap: { classHash: '0x20' } } };
function fetcher(overrides = {}) { return async (_url, options) => {
  const { method, params } = JSON.parse(options.body);
  assert(['starknet_chainId', 'starknet_blockHashAndNumber', 'starknet_getClassHashAt', 'starknet_call'].includes(method));
  let result;
  if (method === 'starknet_chainId') result = overrides.chain ?? MAINNET_CHAIN_ID;
  else if (method === 'starknet_blockHashAndNumber') result = { block_hash: '0xabc', block_number: 10 };
  else if (method === 'starknet_getClassHashAt') result = params.contract_address === '0x100' ? (overrides.bookHash ?? '0x10') : params.contract_address === '0x200' ? '0x20' : '0x30';
  else {
    const selector = BigInt(params.request.entry_point_selector);
    result = selector === BigInt(hash.getSelectorFromName('get_fee_amount')) ? ['0x6'] : selector === BigInt(hash.getSelectorFromName('pool')) ? [overrides.pool ?? MAINNET_POOL] : selector === BigInt(hash.getSelectorFromName('book')) ? ['0x100'] : [overrides.blocked ?? '0x0'];
  }
  return { ok: true, json: async () => ({ result }) };
}; }
test('deployment calls bind the new book to the swap and the selected deployer', () => {
  const plan = deploymentCalls('0x10', '0x20', '0x99');
  assert.equal(plan.calls.length, 2);
  assert(plan.calls[1].calldata.some(value => BigInt(value) === BigInt(plan.bookAddress)));
  assert(plan.calls[1].calldata.some(value => BigInt(value) === BigInt(MAINNET_POOL)));
  assert.notEqual(deploymentCalls('0x10', '0x20', '0x98').bookAddress, plan.bookAddress);
});
test('verification checks chain, both classes, constructor and pool acceptance', async () => {
  const result = await verifyDeployedSettlement('https://rpc.example', candidate, '0x100', '0x200', fetcher());
  assert.equal(result.settlementAddress, '0x200');
  for (const bad of [{ chain: '0x1' }, { bookHash: '0x11' }, { pool: '0x9' }, { blocked: '0x1' }]) await assert.rejects(verifyDeployedSettlement('https://rpc.example', candidate, '0x100', '0x200', fetcher(bad)));
});
