import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { hash, shortString } from 'starknet';
import { MAINNET_DEPLOYMENT as d } from '../src/lib/mainnet-deployment.ts';
import { verifyHackathonTransaction, requestedTransactionHashes, updatedSubmissionManifest, DEFAULT_VERIFICATION_RPC } from './verify-hackathon-transactions.mjs';

const chat = JSON.parse(await readFile(new URL('../deployments/mainnet/chat-message-2026-09-08.json', import.meta.url), 'utf8'));
const confidential = JSON.parse(await readFile(new URL('../deployments/mainnet/confidential-settlement-2026-09-08.json', import.meta.url), 'utf8'));
const selector = hash.getSelectorFromName;
const event = (address, name, keys = [], data = []) => ({ from_address: address, keys: [selector(name), ...keys], data });
const invocation = (address, entrypoint, calldata = [], calls = []) => ({ contract_address: address, entry_point_selector: selector(entrypoint), calldata, calls, caller_address: d.settlement.pool });
function fixture(kind, chatHash = chat.transaction.hash) {
  const evidence = structuredClone({ chat, confidential }), isChat = kind === 'chat', isSettle = kind === 'settle';
  const txHash = isChat ? chatHash : isSettle ? confidential.transactionHash : '0x123';
  if (isChat && chatHash !== chat.transaction.hash) {
    const followup = structuredClone(chat); followup.transaction.hash = chatHash;
    evidence.additionalChatMessages = [followup];
  }
  const address = isChat ? chat.chat.address : isSettle ? confidential.escrow : d.settlement.address;
  const classHash = isChat ? chat.chat.classHash : isSettle ? confidential.escrowClass : d.settlement.classHash;
  const block = isChat ? { hash: chat.transaction.blockHash, number: chat.transaction.blockNumber } : isSettle ? confidential.block : { hash: '0xabcd', number: 101 };
  const data = ['0x11', '0x12', '0x7', '0x13', '0x14', '0x1', '0x15', '0x16'];
  const callback = invocation(address, 'privacy_invoke_with_computation', isChat ? ['0x1', '0x2', d.sellToken.address, d.settlement.pool, '0x0', ...data] : [shortString.encodeShortString('APP20_JOINT_COMPUTE_V1'), '0x1']);
  const pool = invocation(d.settlement.pool, 'apply_actions', [], [callback]);
  const trace = { execute_invocation: invocation('0x99', '__execute__', [], [pool]) };
  const events = isChat ? [event(address, 'MessagePosted', ['0x0'], data)] : isSettle ? ['EncNoteCreated', 'NoteUsed', 'EncNoteCreated', 'NoteUsed'].map(name => event(d.settlement.pool, name)) : [event(address, 'QuoteFilled', ['0x7', '0x8'], ['100', '20'])];
  const receipt = { transaction_hash: txHash, execution_status: 'SUCCEEDED', finality_status: 'ACCEPTED_ON_L2', block_hash: block.hash, block_number: block.number, events, actual_fee: { amount: '1', unit: 'FRI' } };
  const state = ['0x1']; const queried = [];
  const provider = {
    getTransactionReceipt: async h => { assert.equal(h, txHash); return receipt; },
    getTransactionTrace: async h => { assert.equal(h, txHash); return trace; },
    getClassHashAt: async (a, b) => { assert.equal(b, block.hash); queried.push(a); return BigInt(a) === BigInt(d.settlement.pool) ? d.settlement.poolClassHash : classHash; },
    callContract: async (call, b) => { assert.equal(call.contractAddress, address); assert.equal(call.entrypoint, 'is_settled'); assert.equal(b, block.hash); return state; },
  };
  return { evidence, txHash, address, block, receipt, trace, callback, pool, provider, state, queried, run: () => verifyHackathonTransaction(provider, txHash, evidence) };
}

test('historical swaps still require QuoteFilled and receipt-block deployment pins', async () => {
  const f = fixture('legacy'), verified = await f.run();
  assert.equal(verified.type, 'historical-swap'); assert.equal(verified.sellAmount, '100');
  assert.deepEqual(f.queried, [d.settlement.pool, d.settlement.address]);
  f.receipt.events = []; await assert.rejects(f.run(), /QuoteFilled/);
});
test('Chat evidence requires the exact encrypted callback event inside the pool', async () => {
  const f = fixture('chat'); assert.equal((await f.run()).callbackEventMatched, true);
  f.receipt.events[0].data[6] = '0x999'; await assert.rejects(f.run(), /exact Chat/);
  const outside = fixture('chat'); outside.pool.calls = []; outside.trace.execute_invocation.calls.push(outside.callback);
  await assert.rejects(outside.run(), /inside the pool/);
  const wrongCaller = fixture('chat'); wrongCaller.callback.caller_address = '0x123';
  await assert.rejects(wrongCaller.run(), /inside the pool/);
});
test('confidential evidence requires settlement mode, encrypted events and the receipt-block settled flag', async () => {
  const f = fixture('settle'); assert.equal((await f.run()).settledAtReceiptBlock, true);
  f.callback.calldata[1] = '0x0'; await assert.rejects(f.run(), /settlement callback/);
  const open = fixture('settle'); open.receipt.events.push(event(d.settlement.pool, 'OpenNoteDeposited')); await assert.rejects(open.run(), /without public/);
  const unsettled = fixture('settle'); unsettled.state[0] = '0x0'; await assert.rejects(unsettled.run(), /settled/);
});
test('additional Chat messages must independently bind their hash, block, helper and callback', async () => {
  const f = fixture('chat', '0x456');
  assert.equal((await f.run()).type, 'chat-message');
  assert.equal(f.evidence.chat.transaction.hash, chat.transaction.hash);
  f.evidence.additionalChatMessages[0].transaction.blockHash = '0xbad';
  await assert.rejects(f.run(), /Durable evidence/);
  const wrongContract = fixture('chat', '0x456');
  wrongContract.evidence.additionalChatMessages[0].chat.address = '0xbad';
  await assert.rejects(wrongContract.run(), /Durable evidence/);
  const wrongEvent = fixture('chat', '0x456');
  wrongEvent.callback.calldata[5] = '0xbad';
  await assert.rejects(wrongEvent.run(), /exact Chat/);
  const duplicate = fixture('chat', '0x456');
  duplicate.evidence.additionalChatMessages.push(structuredClone(duplicate.evidence.additionalChatMessages[0]));
  await assert.rejects(duplicate.run(), /Duplicate/);
});
test('unsuccessful receipts, wrong class pins and stale evidence blocks cannot be promoted', async () => {
  const f = fixture('settle'); f.receipt.execution_status = 'REVERTED'; await assert.rejects(f.run(), /successful/);
  const pin = fixture('chat'); pin.provider.getClassHashAt = async () => '0x1'; await assert.rejects(pin.run(), /class mismatch/);
  const stale = fixture('settle'); stale.evidence.confidential.block.hash = '0x1'; await assert.rejects(stale.run(), /Durable evidence/);
  const noPool = fixture('chat'); noPool.pool.entry_point_selector = selector('get_public_key'); await assert.rejects(noPool.run(), /apply STRK20/);
});
test('manifest writes retain all contracts, deadline video, URL and custom fields without mutating inputs', () => {
  const original = { transactions: ['0x1', '0x2', '0x3'], contracts: [d.address, d.settlement.address, chat.chat.address, confidential.escrow], demo_video: 'https://example.org/deadline.mp4', demo_url: 'https://example.org', preserved: 'yes' };
  const before = structuredClone(original);
  const updated = updatedSubmissionManifest(original, [...original.transactions, chat.transaction.hash, confidential.transactionHash], [{ appContract: d.settlement.address }, { appContract: chat.chat.address }, { appContract: confidential.escrow }]);
  assert.deepEqual(updated.contracts, original.contracts); assert.equal(updated.transactions.length, 5);
  assert.equal(updated.demo_video, before.demo_video); assert.equal(updated.demo_url, before.demo_url); assert.equal(updated.preserved, 'yes');
  assert.deepEqual(original, before);
  assert.throws(() => updatedSubmissionManifest({ contracts: 'not-array' }, [], []), /array/);
});
test('hash validation rejects aliases below three distinct transactions and out-of-field values', () => {
  assert.deepEqual(requestedTransactionHashes(['0x01', '0x2', '0x3', '0x1']), ['0x1', '0x2', '0x3']);
  assert.throws(() => requestedTransactionHashes(['0x1', '0x01', '0x2']), /distinct/);
  assert.throws(() => requestedTransactionHashes(['0x1', '0x2', '0x' + (2n ** 251n + 17n * 2n ** 192n + 1n).toString(16)]), /real mainnet/);
  assert.equal(DEFAULT_VERIFICATION_RPC, 'https://starknet-rpc.publicnode.com');
});
