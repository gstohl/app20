import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAINNET_DEPLOYMENT as deployment } from '../src/lib/mainnet-deployment.ts';
import { CONFIDENTIAL_RFQ_CONTRACT } from '../src/lib/confidential-rfq-deployment.ts';
import { hash, shortString } from 'starknet';
import { MAINNET_PROOF_FORMAT, realProofConfigHash } from '../src/lib/mainnet-proof-format.ts';
import { validateMainnetProof } from './mainnet-proof-policy.mjs';
import { WALLET_PROOF_SCOPE, walletStage, buildWalletStage, fixedBlockDiscoveryProvider, inspectWalletProof, sealWalletInvocation, unsealWalletInvocation, shieldingExpiry, assertExpiredShieldRefresh } from './mainnet-wallet-proof.mjs';

const agreement = { chainId: deployment.chainId, pool: deployment.settlement.pool, poolClassHash: deployment.settlement.poolClassHash, escrowClassHash: CONFIDENTIAL_RFQ_CONTRACT.classHash, address: WALLET_PROOF_SCOPE.escrow, commitment: '0x123', terms: { partyA: WALLET_PROOF_SCOPE.owner, partyB: '0xb0b', tokenA: deployment.sellToken.address, tokenB: deployment.buyToken.address, amountA: '10000000000000000', amountB: '1000' } };
function builderSpy() {
  const calls = [];
  const token = Object.fromEntries(['deposit', 'transfer', 'surplusTo'].map(method => [method, (...args) => { calls.push([method, ...args]); return token; }]));
  const builder = { with: value => { calls.push(['token', value]); return token; } };
  const transfers = { build: options => { calls.push(['build', options]); return builder; } };
  return { calls, transfers, builder };
}
test('shield builds exactly 0.02 STRK into the operator private balance with no callback or withdrawal', () => {
  const reviewed = walletStage('shield');
  assert.equal(reviewed.amount, '20000000000000000');
  const spy = builderSpy();
  assert.equal(buildWalletStage(spy.transfers, reviewed), spy.builder);
  assert.deepEqual(spy.calls.slice(1), [['token', deployment.sellToken.address], ['deposit', { amount: 20000000000000000n }], ['surplusTo', WALLET_PROOF_SCOPE.owner, false]]);
  assert.throws(() => buildWalletStage(spy.transfers, { ...reviewed, amount: '1' }), /exactly 0.02/);
  assert.throws(() => walletStage('withdraw'), /Unsupported/);
});
test('funding takes each exact leg from the agreement and always returns change privately to A', () => {
  for (const [mode, token, amount] of [['fundA', deployment.sellToken.address, 10000000000000000n], ['fundB', deployment.buyToken.address, 1000n]]) {
    const spy = builderSpy(), reviewed = walletStage(mode, agreement);
    buildWalletStage(spy.transfers, reviewed);
    assert.deepEqual(spy.calls.slice(1), [['token', token], ['transfer', { recipient: WALLET_PROOF_SCOPE.escrow, amount }], ['surplusTo', WALLET_PROOF_SCOPE.owner, false]]);
  }
  assert.throws(() => walletStage('fundA', { ...agreement, address: '0x321' }), /reviewed deployment/);
  assert.throws(() => walletStage('fundB', { ...agreement, terms: { ...agreement.terms, tokenB: deployment.sellToken.address } }), /funding asset/);
  assert.throws(() => walletStage('fundB', { ...agreement, terms: { ...agreement.terms, amountB: '0' } }), /funding asset/);
});
test('sealed invocations are confidential and cannot move between stages, blocks or keys', () => {
  const invocation = { sender_address: deployment.settlement.pool, calldata: ['PRIVATE_VIEWING_KEY_FIXTURE', '0x123'], signature: ['0x1', '0x2'] };
  const sealed = sealWalletInvocation(invocation, 12345n, 'shield/block-1');
  assert(!JSON.stringify(sealed).includes('PRIVATE_VIEWING_KEY_FIXTURE'));
  assert.deepEqual(unsealWalletInvocation(sealed, 12345n, 'shield/block-1'), invocation);
  for (const [key, scope] of [[12346n, 'shield/block-1'], [12345n, 'fundA/block-1'], [12345n, 'shield/block-2']]) assert.throws(() => unsealWalletInvocation(sealed, key, scope));
  assert.throws(() => unsealWalletInvocation({ ...sealed, ciphertext: (sealed.ciphertext[0] === '0' ? '1' : '0') + sealed.ciphertext.slice(1) }, 12345n, 'shield/block-1'));
});
test('all discovery calls use the exact proof block rather than newer notes', async () => {
  const calls = [], provider = { value: 7, async callContract(...args) { calls.push(args); return ['0x1']; }, marker() { return this.value; } };
  const fixed = fixedBlockDiscoveryProvider(provider, '0xabc');
  await fixed.callContract({ entrypoint: 'get_note' }, 'latest');
  assert.deepEqual(calls, [[{ entrypoint: 'get_note' }, '0xabc']]);
  assert.equal(fixed.marker(), 7);
  assert.throws(() => fixedBlockDiscoveryProvider(provider, { block_hash: '0xabc' }), /Explicit/);
});
function providerFixture(overrides = {}) {
  const block = { block_number: 90, block_hash: '0xabc', status: 'ACCEPTED_ON_L2', timestamp: 1788830000 };
  return {
    getChainId: async () => deployment.chainId,
    getBlockWithTxHashes: async id => id === 'latest' ? { ...block, block_number: 100 } : block,
    getClassHashAt: async () => deployment.settlement.poolClassHash,
    callContract: async call => call.entrypoint === 'get_fee_amount' ? ['6000000000000000000'] : ['450'],
    ...overrides,
  };
}
test('proof preflight binds the actual pool and accepted saved block, failing on stale or ignored block requests', async () => {
  const good = await inspectWalletProof(providerFixture());
  assert.deepEqual(good.block, { number: 90, hash: '0xabc' });
  assert.equal(good.transactionSubmitted, false);
  await assert.rejects(inspectWalletProof(providerFixture(), { number: 89, hash: '0xdef' }), /another block/);
  await assert.rejects(inspectWalletProof(providerFixture({ getClassHashAt: async () => '0x123' })), /pool class/);
  await assert.rejects(inspectWalletProof(providerFixture({ getBlockWithTxHashes: async () => ({ block_number: 100, block_hash: '0xabc', status: 'ACCEPTED_ON_L2' }) })), /ten blocks/);
  await assert.rejects(inspectWalletProof(providerFixture({ callContract: async call => call.entrypoint === 'get_fee_amount' ? ['6000000000000000001'] : ['450'] })), /fee exceeds/);
});
test('expired screening refresh rejects a valid, pending or already successful shield proof', () => {
  const owner = WALLET_PROOF_SCOPE.owner, token = WALLET_PROOF_SCOPE.shieldToken, amount = WALLET_PROOF_SCOPE.shieldAmount;
  const output = [deployment.settlement.poolClassHash, '4', '2', owner, token, amount, '6', owner, token, amount, '0', '11', '1', '22', '8', '33', '44'];
  const issued_at = 1788820000, signature = { issued_at, sig_r: '0x1', sig_s: '0x2' };
  const proofFacts = [shortString.encodeShortString(MAINNET_PROOF_FORMAT.version), shortString.encodeShortString('VIRTUAL_SNOS'), MAINNET_PROOF_FORMAT.virtualProgramHash, shortString.encodeShortString('VIRTUAL_SNOS0'), '14528000', '0xabc', realProofConfigHash(deployment.chainId, token), '1', hash.computePoseidonHashOnElements([deployment.settlement.pool, 0, output.length, ...output])];
  const record = { mode: 'shield', chainId: deployment.chainId, submission: { proof: { data: Buffer.from('test fixture only').toString('base64'), output, proofFacts, additionalData: { signature } }, call: { contractAddress: deployment.settlement.pool, entrypoint: 'apply_actions', calldata: [...output.slice(1), '0', String(issued_at), '0x1', '0x2'] } } };
  const ledger = { schema: 'app20/mainnet-release/v1', accountAddress: owner, chainId: deployment.chainId, transactions: [], pending: null };
  assert.equal(shieldingExpiry(record, issued_at + 290).screeningSecondsRemaining, 10);
  assert.throws(() => assertExpiredShieldRefresh(record, ledger, issued_at + 300), /still valid/);
  assert.equal(assertExpiredShieldRefresh(record, ledger, issued_at + 301).screeningSecondsRemaining, -1);
  assert.throws(() => assertExpiredShieldRefresh(record, { ...ledger, pending: { hash: null } }, issued_at + 301), /Resolve/);
  const proofId = validateMainnetProof({ record, stage: 'shield' }).proofId;
  assert.throws(() => assertExpiredShieldRefresh(record, { ...ledger, transactions: [{ proofId, success: true }] }, issued_at + 301), /already succeeded/);
});
