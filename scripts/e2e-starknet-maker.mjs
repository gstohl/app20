#!/usr/bin/env node
// Localnet-only integration: two independently configured CLI makers, no relay.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Account, RpcProvider, json } from 'starknet';
import { generateTransportKey, seal, publicKey, requestCall, randomRequestId, open, decodeAnswer, felt } from '../packages/private-intents/src/starknet-maker.ts';
import { readMakerPage, readMakerAnswer } from '../src/lib/starknet-maker-client.ts';
const exec = promisify(execFile);
const rpcUrl = process.env.APP20_MAKER_TEST_RPC ?? 'http://127.0.0.1:7155/rpc';
const url = new URL(rpcUrl);
assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'This test may only use a local devnet.');
const root = resolve(import.meta.dirname, '..');
await exec('scarb', ['build'], { cwd: join(root, 'cairo') });
const provider = new RpcProvider({ nodeUrl: rpcUrl });
const accounts = (await (await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'devnet_getPredeployedAccounts', params: [] }) })).json()).result;
assert(accounts.length >= 3);
const taker = new Account({ provider, address: accounts[0].address, signer: accounts[0].private_key, cairoVersion: '1' });
const contract = json.parse(await readFile(join(root, 'cairo/target/dev/app20_chat_App20MakerBook.contract_class.json'), 'utf8'));
const casm = json.parse(await readFile(join(root, 'cairo/target/dev/app20_chat_App20MakerBook.compiled_contract_class.json'), 'utf8'));
const declaration = await taker.declareIfNot({ contract, casm }, { tip: 0n });
if (declaration.transaction_hash) await provider.waitForTransaction(declaration.transaction_hash, { retryInterval: 100 });
const deployed = await taker.deployContract({ classHash: declaration.class_hash, constructorCalldata: [] }, { tip: 0n });
await provider.waitForTransaction(deployed.transaction_hash, { retryInterval: 100 });
const head = await provider.getBlockWithTxHashes('latest');
const base = { rpcUrl, address: deployed.address, classHash: declaration.class_hash, chainId: await provider.getChainId(), fromBlock: head.block_number, keyValidUntil: head.timestamp + 3600, maxResponses: 1, maxFeePerTransaction: '1000000000000000000', maxTotalFees: '10000000000000000000' };
const directory = await mkdtemp(join(tmpdir(), 'app20-maker-e2e-'));
try {
  const operators = [];
  for (let i = 1; i <= 2; i++) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const file = join(directory, `maker-${i}.json`);
    const config = { ...base, account: accounts[i].address, stateFile: join(directory, `state-${i}.json`), markets: [{ sellToken: '0x11', buyToken: '0x22', numerator: String(i + 1), denominator: '1', maxSellAmount: '10000', maxBuyAmount: '40000', spreadBps: 100, validUntil: head.timestamp + 3600 }] };
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    const env = { ...process.env, APP20_MAKER_SIGNING_KEY: accounts[i].private_key, APP20_MAKER_TRANSPORT_JWK: JSON.stringify(jwk) };
    await exec(process.execPath, ['scripts/starknet-maker.mjs', file, '--check'], { cwd: root });
    await exec(process.execPath, ['scripts/starknet-maker.mjs', file, '--register'], { cwd: root, env, timeout: 60000 });
    operators.push({ file, env, pair, pub: await crypto.subtle.exportKey("jwk", pair.publicKey) });
  }
  const page = await readMakerPage(provider, base);
  assert.equal(page.makers.length, 2);
  const requests = [];
  for (const maker of page.makers) {
    const operator = operators[requests.length];
    assert.equal(maker.key.x, operator.pub.x);
    assert.equal(maker.key.y, operator.pub.y);
    const keys = await generateTransportKey();
    const scope = { chainId: base.chainId, book: base.address, id: randomRequestId(), maker: maker.address, taker: felt(taker.address), revision: maker.revision, expiresAt: head.timestamp + 600 };
    const terms = { sellToken: '0x11', buyToken: '0x22', sellAmount: '1000', minBuyAmount: '1000' };
    const payload = await seal(scope, 'request', { ...terms, replyKey: await crypto.subtle.exportKey('jwk', keys.publicKey) }, await publicKey(maker.key));
    await open(scope, 'request', payload, operator.pair);
    const tx = await taker.execute([requestCall(scope, payload)], { tip: 0n });
    await provider.waitForTransaction(tx.transaction_hash, { retryInterval: 100 });
    const events = await provider.getEvents({ address: base.address, from_block: {block_number: base.fromBlock}, to_block: 'latest', chunk_size: 100 });
    const matching = events.events.filter(e => e.keys.length === 3 && BigInt(e.keys[1]) === BigInt(maker.address) && BigInt(e.keys[2]) === BigInt(scope.id));
    assert.equal(matching.length, 1);
    const received = matching[0].data.slice(4);
    assert.deepEqual(received.map(BigInt), payload.map(BigInt));
    await open(scope, 'request', received, operator.pair);
    requests.push({ scope, terms, keys });
  }
  // Two independent processes only share Starknet.
  await Promise.all(operators.map(({ file, env }) => exec(process.execPath, ['scripts/starknet-maker.mjs', file, '--run'], { cwd: root, env, timeout: 90000 })));
  const amounts = [];
  for (const request of requests) {
    const payload = await readMakerAnswer(provider, base, request.scope);
    assert(payload);
    const answer = decodeAnswer(await open(request.scope, 'quote', payload, request.keys), request.scope, request.terms, head.timestamp);
    amounts.push(answer.buyAmount);
    const other = requests.find(row => row !== request);
    await assert.rejects(open(request.scope, 'quote', payload, other.keys));
  }
  assert.deepEqual(amounts.sort(), ['1980', '2970']);
  for (const { file } of operators) {
    const config = JSON.parse(await readFile(file, 'utf8'));
    const state = JSON.parse(await readFile(config.stateFile, 'utf8'));
    assert.equal(state.pending, null);
    assert(BigInt(state.spent) > 0n);
  }
  console.log('PASS: two independent CLI makers registered, discovered requests through Starknet, quoted distinct prices, and returned recipient-encrypted quotes. No RFQ server or settlement transactions.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
