#!/usr/bin/env node
// Read-only unless --write is supplied. Never signs, broadcasts or updates GitHub.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RpcProvider, hash as starknetHash, shortString } from 'starknet';
import { MAINNET_DEPLOYMENT as deployment } from '../src/lib/mainnet-deployment.ts';
import { CONFIDENTIAL_RFQ_CONTRACT } from '../src/lib/confidential-rfq-deployment.ts';

export const DEFAULT_VERIFICATION_RPC = 'https://starknet-rpc.publicnode.com';
const root = resolve(import.meta.dirname, '..');
const normalized = value => '0x' + BigInt(value).toString(16);
const same = (a, b) => normalized(a) === normalized(b);
const sequence = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
const selector = name => starknetHash.getSelectorFromName(name);
const CHAT = Object.freeze({
  hash: '0x382800b805219f0c8639459c353976618ae38fdb6468dd28f1e71ecec7bcf62',
  address: '0x501331396a00e95a4b520502ff73155412e056bd42bc41cb115deb656d97ae4',
  classHash: '0x2e6fd0b464b0a7a1c8793b5d18609609e167af5ce7916e28821af34b5de4b12',
});
const CONFIDENTIAL = Object.freeze({
  hash: '0x59435ee65a7f42ed41b329c2df8bb9be7cf5fdfe69ddfd8cb2d08230412696',
  address: '0x11b28bb270f1c9c7eefd1205cfba6c1a686436fcb5f5c3281d5a0a77011438f',
  classHash: CONFIDENTIAL_RFQ_CONTRACT.classHash,
});

export function requestedTransactionHashes(values) {
  if (!Array.isArray(values) || values.length < 3 || values.some(v => typeof v !== 'string' || !/^0x[\da-f]{1,64}$/i.test(v) || BigInt(v) <= 0n || BigInt(v) >= 2n ** 251n + 17n * 2n ** 192n + 1n)) throw Error('Provide at least three distinct real mainnet transaction hashes.');
  const unique = [...new Set(values.map(normalized))];
  if (unique.length < 3) throw Error('Three distinct nonzero transaction hashes are required.');
  return unique;
}
function invocations(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.contract_address === 'string' && typeof node.entry_point_selector === 'string' && Array.isArray(node.calldata)) out.push(node);
  for (const value of Object.values(node)) if (value && typeof value === 'object') invocations(value, out);
  return out;
}
function eventFrom(event, address, name) {
  return typeof event.from_address === 'string' && same(event.from_address, address) && Array.isArray(event.keys) && event.keys.length > 0 && same(event.keys[0], selector(name));
}
function evidenceBinding(record, type, txHash, receipt) {
  const chat = type === 'chat-message', pin = chat ? CHAT : CONFIDENTIAL;
  const stored = chat ? record?.transaction : { hash: record?.transactionHash, blockHash: record?.block?.hash, blockNumber: record?.block?.number };
  if (record?.schema !== (chat ? 'app20-mainnet-chat-message-evidence/v1' : 'app20/confidential-mainnet-settlement/v1') || !same(record.chainId, deployment.chainId) || !same(stored?.hash, txHash) || !same(stored?.blockHash, receipt.block_hash) || stored?.blockNumber !== receipt.block_number || !same(chat ? record.chat?.address : record.escrow, pin.address) || !same(chat ? record.chat?.classHash : record.escrowClass, pin.classHash) || !same(chat ? record.pool?.address : record.pool, deployment.settlement.pool) || !same(chat ? record.pool?.classHash : record.poolClass, deployment.settlement.poolClassHash)) throw Error('Durable evidence does not match the exact transaction, receipt block and pinned contracts.');
}

export async function verifyHackathonTransaction(provider, txHash, evidence) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (receipt.execution_status !== 'SUCCEEDED' || !receipt.block_hash || !Number.isSafeInteger(receipt.block_number) || receipt.block_number <= 0 || !['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(receipt.finality_status) || !Array.isArray(receipt.events)) throw Error(txHash + ': not a successful included transaction.');
  if (receipt.transaction_hash && !same(receipt.transaction_hash, txHash)) throw Error('Receipt belongs to another transaction.');
  const trace = await provider.getTransactionTrace(txHash), calls = invocations(trace);
  const poolCalls = calls.filter(c => same(c.contract_address, deployment.settlement.pool) && same(c.entry_point_selector, selector('apply_actions')));
  if (poolCalls.length === 0) throw Error(txHash + ': did not apply STRK20 pool actions.');
  const type = same(txHash, CHAT.hash) ? 'chat-message' : same(txHash, CONFIDENTIAL.hash) ? 'confidential-settlement' : 'historical-swap';
  const pin = type === 'chat-message' ? CHAT : type === 'confidential-settlement' ? CONFIDENTIAL : deployment.settlement;
  if (!calls.some(c => same(c.contract_address, pin.address))) throw Error(txHash + ': did not call the expected APP20 contract.');
  for (const [address, expected] of [[deployment.settlement.pool, deployment.settlement.poolClassHash], [pin.address, pin.classHash]]) {
    if (!same(await provider.getClassHashAt(address, receipt.block_hash), expected)) throw Error(txHash + ': deployed class mismatch.');
  }
  const common = { hash: txHash, type, blockNumber: receipt.block_number, blockHash: receipt.block_hash, finality: receipt.finality_status, pool: deployment.settlement.pool, appContract: pin.address, networkFee: receipt.actual_fee, explorer: 'https://starkscan.co/tx/' + txHash };
  if (type === 'historical-swap') {
    const fills = receipt.events.filter(event => eventFrom(event, pin.address, 'QuoteFilled'));
    if (fills.length !== 1 || fills[0].keys.length !== 3 || fills[0].data?.length !== 2) throw Error(txHash + ': expected one APP20 QuoteFilled event.');
    const fill = fills[0];
    return { ...common, quoteId: fill.keys[1], maker: fill.keys[2], sellAmount: BigInt(fill.data[0]).toString(), buyAmount: BigInt(fill.data[1]).toString() };
  }
  evidenceBinding(type === 'chat-message' ? evidence.chat : evidence.confidential, type, txHash, receipt);
  // The callback must be inside apply_actions and called by the actual pool.
  const callbacks = poolCalls.flatMap(pool => invocations(pool.calls)).filter(c => same(c.contract_address, pin.address) && same(c.entry_point_selector, selector('privacy_invoke_with_computation')) && typeof c.caller_address === 'string' && same(c.caller_address, deployment.settlement.pool));
  if (poolCalls.length !== 1 || callbacks.length !== 1) throw Error('Expected exactly one proof-bound APP20 callback inside the pool application.');
  const callback = callbacks[0];
  if (type === 'chat-message') {
    const messages = receipt.events.filter(event => eventFrom(event, pin.address, 'MessagePosted'));
    const data = messages[0]?.data;
    if (messages.length !== 1 || messages[0].keys.length !== 2 || !Array.isArray(data) || data.length < 8 || BigInt(data[5]) <= 0n || BigInt(data[5]) > 768n || BigInt(data[5]) + 7n !== BigInt(data.length) || !sequence(callback.calldata.slice(5), data) || BigInt(data.at(-1)) === 0n) throw Error('Expected the exact Chat MessagePosted event from the proven callback.');
    return { ...common, messagePostedCount: 1, callbackEventMatched: true, postDeadlineEvidence: true, verificationScope: 'controlled SDK message; plaintext decryption was separately verified with retained private material' };
  }
  if (!sequence(callback.calldata, [shortString.encodeShortString('APP20_JOINT_COMPUTE_V1'), '1'])) throw Error('Expected the exact confidential settlement callback.');
  const state = await provider.callContract({ contractAddress: pin.address, entrypoint: 'is_settled', calldata: [] }, receipt.block_hash);
  if (!sequence(state, ['1'])) throw Error('Receipt block does not mark the escrow settled.');
  const count = name => receipt.events.filter(event => eventFrom(event, deployment.settlement.pool, name)).length;
  if (count('EncNoteCreated') !== 2 || count('NoteUsed') !== 2 || ['Deposit', 'Withdrawal', 'OpenNoteDeposited'].some(name => count(name))) throw Error('Expected two encrypted settlement outputs and spent notes without public pool value events.');
  return { ...common, settledAtReceiptBlock: true, encryptedOutputEvents: 2, spentNoteEvents: 2, postDeadlineEvidence: true, verificationScope: 'controlled SDK settlement; exact encrypted balance deltas were separately verified with retained private material' };
}

export function updatedSubmissionManifest(manifest, transactions, verified) {
  if (!Array.isArray(manifest.contracts ?? [])) throw Error('Manifest contracts must be an array.');
  const contracts = [...(manifest.contracts ?? [])];
  for (const address of [deployment.address, ...verified.map(v => v.appContract)]) if (!contracts.some(existing => same(existing, address))) contracts.push(address);
  return { ...manifest, transactions, contracts, demo_url: manifest.demo_url ?? 'https://app20.io' };
}

async function main(args) {
  const hashes = []; let write = false, rpcUrl = DEFAULT_VERIFICATION_RPC;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--write') write = true;
    else if (arg === '--rpc') {
      const value = args[++i]; if (!value) throw Error('--rpc requires an HTTPS RPC URL.');
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) throw Error('Use an HTTPS RPC URL without URL credentials.');
      rpcUrl = url.href;
    } else if (arg.startsWith('--')) throw Error('Unknown option: ' + arg);
    else hashes.push(arg);
  }
  const manifestFile = resolve(root, 'strk20.json'), manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const requested = requestedTransactionHashes(hashes.length ? hashes : manifest.transactions);
  const evidence = {
    chat: JSON.parse(await readFile(resolve(root, 'deployments/mainnet/chat-message-2026-09-08.json'), 'utf8')),
    confidential: JSON.parse(await readFile(resolve(root, 'deployments/mainnet/confidential-settlement-2026-09-08.json'), 'utf8')),
  };
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  if (!same(await provider.getChainId(), deployment.chainId)) throw Error('Expected Starknet mainnet.');
  const verified = [];
  for (const txHash of requested) verified.push(await verifyHackathonTransaction(provider, txHash, evidence));
  const directory = resolve(root, 'artifacts/hackathon'); await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'verified-mainnet-transactions.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), chainId: deployment.chainId, transactions: verified }, null, 2) + '\n');
  if (write) await writeFile(manifestFile, JSON.stringify(updatedSubmissionManifest(manifest, requested, verified), null, 2) + '\n');
  console.log(JSON.stringify({ verified: verified.length, manifestUpdated: write, transactions: verified }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { console.error('Mainnet verification failed. Check the selected RPC, successful receipts, pinned traces and durable evidence; no chain transaction was submitted.'); process.exitCode = 1; });
}
