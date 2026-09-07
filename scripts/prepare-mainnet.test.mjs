import { test } from 'node:test';
import assert from 'node:assert/strict';
import { address, strkBudget, inspectMainnet, readRpc, MAINNET_POOL, MAINNET_CHAIN_ID } from './prepare-mainnet.mjs';

const mock = (overrides = {}) => async (_url, options) => {
  const { method } = JSON.parse(options.body);
  const values = {
    starknet_chainId: MAINNET_CHAIN_ID,
    starknet_blockHashAndNumber: { block_hash: '0xabc', block_number: 123 },
    starknet_getClassHashAt: '0x123', starknet_call: ['0x7'], starknet_getStorageAt: MAINNET_POOL,
    ...overrides,
  };
  return { ok: true, json: async () => ({ result: values[method] }) };
};
const rpc = 'https://rpc.example/mainnet';
test('preparation cannot submit RPC transactions', async () => {
  await assert.rejects(readRpc(rpc, 'starknet_addInvokeTransaction', [], () => { throw new Error('must not fetch'); }), /read-only/);
});
test('refuses wrong-chain and mismatched deployments', async () => {
  await assert.rejects(inspectMainnet(rpc, { classHash: '0x123' }, undefined, mock({ starknet_chainId: '0x534e5f5345504f4c4941' })), /not Starknet mainnet/);
  await assert.rejects(inspectMainnet(rpc, { classHash: '0x456' }, '0x789', mock()), /does not match/);
  await assert.rejects(inspectMainnet(rpc, { classHash: '0x123' }, '0x789', mock({ starknet_getStorageAt: '0x456' })), /constructor/);
});
test('verifies both class and constructor, and records the observed block', async () => {
  const report = await inspectMainnet(rpc, { classHash: '0x123' }, '0x789', mock());
  assert.equal(report.deployment.address, '0x789');
  assert.equal(report.block.block_number, 123);
  assert.equal(report.poolFeeBaseUnits, '7');
});
test('invalid addresses and non-HTTPS or credential-bearing endpoints fail', async () => {
  for (const value of ['0x0', '-1', '0x' + 'f'.repeat(64)]) assert.throws(() => address(value, 'deployer'));
  for (const url of ['http://rpc.example', 'https://user:secret@rpc.example']) await assert.rejects(readRpc(url, 'starknet_chainId', [], mock()), /HTTPS/);
});

test('spending-plan budgets use exact units and reject ambiguous input', () => {
  assert.equal(strkBudget('18.000000000000000001'), '18000000000000000001');
  for (const value of ['0', '-1', '1e3', '1.0000000000000000001', 'Infinity']) assert.throws(() => strkBudget(value));
});
