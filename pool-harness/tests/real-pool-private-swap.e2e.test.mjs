import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { constants, json, OutsideExecutionVersion } from 'starknet';
import { CorePrivateTransfersProver, passphraseViewingKeyProvider } from '@starkware-libs/starknet-privacy-client';
import { createEmptyRegistry, createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';
import { ContractDiscoveryProvider, Devnet, ScreeningCallMockProofProvider, createDevnetTestEnv } from '@starkware-libs/starknet-privacy-sdk/testing';
import { generateTransportKey, randomRequestId, publicKey, seal, open, requestCall, felt, decodeAnswer } from '../../packages/private-intents/src/starknet-maker.ts';
import { settlementCommitment, decodeExecutableAnswer, buildPrivateSettlementActions } from '../../packages/private-intents/src/private-settlement.ts';
import { readMakerPage, readMakerAnswer, readExecutableQuote } from '../../src/lib/starknet-maker-client.ts';
const ROOT = resolve(import.meta.dirname, '../..');
const exec = promisify(execFile);
async function rpc(url, method, params = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json(); assert(!body.error, JSON.stringify(body.error)); return body.result;
}
async function blocks(url) { for (let i = 0; i < 12; i++) await rpc(url, 'devnet_createBlock'); }
async function success(env, tx) { const receipt = await env.node.waitForTransaction(tx.transaction_hash); assert(receipt.isSuccess(), String(receipt.revert_reason)); return receipt; }
async function deploy(env, name, calldata = []) {
  const path = join(ROOT, 'cairo/target/dev', `app20_chat_${name}`);
  const declared = await env.admin.declare({ contract: json.parse(await readFile(`${path}.contract_class.json`, 'utf8')), casm: json.parse(await readFile(`${path}.compiled_contract_class.json`, 'utf8')) });
  await success(env, declared);
  const tx = await env.admin.deployContract({ classHash: declared.class_hash, constructorCalldata: calldata }); await success(env, tx);
  return { address: tx.contract_address ?? tx.address, classHash: declared.class_hash };
}
function privacy(env) {
  const passphrase = 'app20-private-swap-local-test';
  const discovery = new ContractDiscoveryProvider(env.privacy);
  const proving = new ScreeningCallMockProofProvider(env.node, constants.StarknetChainId.SN_SEPOLIA);
  const transfers = createPrivateTransfers({ account: env.alice, viewingKeyProvider: passphraseViewingKeyProvider(passphrase, env.alice.address), provingProvider: proving, discoveryProvider: discovery, poolContractAddress: env.privacy.address });
  const prover = new CorePrivateTransfersProver({ signer: env.alice.signer, address: env.alice.address, passphrase, node: env.node, discovery, prover: proving, poolContractAddress: env.privacy.address, shadowAccountAnonymizerAddress: '0x1', storage: { loadRegistry: async () => createEmptyRegistry(), saveRegistry: async () => {} } });
  const build = prover.transfers.build.bind(prover.transfers);
  prover.transfers.build = (...args) => build(...args).surplusTo(env.alice.address, false);
  return { prover, transfers };
}
async function broadcast(devnet, env, prover, actions) {
  const prepared = await prover.prove(actions);
  assert.equal(prepared.proof.data, undefined, 'upstream devnet simulated proof, not a live STARK proof');
  assert.equal(prepared.proof.proof_facts.length, 9);
  assert(!prepared.call.calldata.some(x => typeof x === 'string' && x.includes('${')));
  await blocks(devnet.url);
  const now = Math.floor(Date.now() / 1000);
  const call = { contractAddress: prepared.call.contract_address, entrypoint: prepared.call.entry_point, calldata: prepared.call.calldata };
  // No helper pre-call, compute_and_invoke shim, or extra token transfer.
  const outside = await env.admin.getOutsideTransaction({ caller: env.admin.address, execute_after: now - 3600, execute_before: now + 3600 }, call, OutsideExecutionVersion.V2);
  const tx = await env.admin.executeFromOutside(outside, { proofFacts: prepared.proof.proof_facts, proof: prepared.proof.data });
  return { hash: tx.transaction_hash, receipt: await env.node.waitForTransaction(tx.transaction_hash) };
}
async function balance(env, token, address) { const n = await env.node.callContract({ contractAddress: token, entrypoint: 'balance_of', calldata: [address] }); return BigInt(n[0]) + (BigInt(n[1]) << 128n); }

test('independent maker: funded quote -> real-pool private swap -> proceeds withdrawal -> expiry refund', { timeout: 600000 }, async () => {
  execFileSync(join(ROOT, 'vendor/bin/app20-scarb'), ['build'], { cwd: join(ROOT, 'cairo'), stdio: 'inherit' });
  const devnet = new Devnet();
  const directory = await mkdtemp(join(tmpdir(), 'app20-private-swap-'));
  try {
    const { env } = await createDevnetTestEnv(devnet);
    const book = await deploy(env, 'App20MakerBook');
    const swap = await deploy(env, 'App20PrivateSwap', [env.privacy.address, book.address]);
    const head = await env.node.getBlockWithTxHashes('latest');
    const config = { ...book, rpcUrl: devnet.url, chainId: await env.node.getChainId(), fromBlock: head.block_number, account: env.bob.address, stateFile: join(directory, 'state.json'), keyValidUntil: head.timestamp + 3600, quoteTtlSeconds: 1200, reservationCooldownSeconds: 1, maxResponses: 1, maxFeePerTransaction: '1000000000000000000', maxTotalFees: '100000000000000000000', settlement: { ...swap, pool: env.privacy.address, poolClassHash: await env.node.getClassHashAt(env.privacy.address) }, inventoryFunding: { token: env.eth, amount: '200' }, markets: [{ sellToken: env.strk, buyToken: env.eth, numerator: '2', denominator: '1', maxSellAmount: '100', maxBuyAmount: '200', spreadBps: 500, validUntil: head.timestamp + 3600 }] };
    const configPath = join(directory, 'operator.json');
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const accounts = await rpc(devnet.url, 'devnet_getPredeployedAccounts', []);
    const bob = accounts.find(a => BigInt(a.address) === BigInt(env.bob.address)); assert(bob);
    const operatorEnv = { ...process.env, APP20_MAKER_SIGNING_KEY: bob.private_key, APP20_MAKER_TRANSPORT_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)) };
    const run = async mode => {
      await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
      return await exec(process.execPath, ['scripts/starknet-maker.mjs', configPath, mode], { cwd: ROOT, env: operatorEnv, timeout: 120000 });
    };
    await run('--register'); await run('--fund');
    const { prover, transfers } = privacy(env);
    await success(env, await env.alice.execute({ contractAddress: env.strk, entrypoint: 'approve', calldata: [env.privacy.address, '100', '0'] }));
    assert((await broadcast(devnet, env, prover, [{ type: 'deposit', token: env.strk, amount: '0x64' }])).receipt.isSuccess());
    await blocks(devnet.url);
    const maker = (await readMakerPage(env.node, config)).makers[0]; assert(maker);
    const requestKeys = await generateTransportKey();
    const secret = randomRequestId();
    const commitment = settlementCommitment(config.chainId, swap.address, secret);
    const terms = { sellToken: env.strk, buyToken: env.eth, sellAmount: '40', minBuyAmount: '75' };
    const scope = { chainId: config.chainId, book: book.address, maker: maker.address, taker: felt(env.alice.address), id: randomRequestId(), revision: maker.revision, expiresAt: head.timestamp + 1800 };
    // A settlement-configured bot must answer comparison requests without reserving output.
    const preliminary = { ...scope, id: randomRequestId() };
    const preliminaryPayload = await seal(preliminary, 'request', { ...terms, replyKey: await crypto.subtle.exportKey('jwk', requestKeys.publicKey) }, await publicKey(maker.key));
    const inventoryBefore = await env.node.callContract({ contractAddress: swap.address, entrypoint: 'available', calldata: [maker.address, terms.buyToken] });
    await success(env, await env.alice.execute([requestCall(preliminary, preliminaryPayload)]));
    await run('--run');
    const indicativePayload = await readMakerAnswer(env.node, config, preliminary);
    const indicative = decodeAnswer(await open(preliminary, 'quote', indicativePayload, requestKeys), preliminary, terms, head.timestamp);
    assert.equal(indicative.buyAmount, '76');
    assert.deepEqual(await env.node.callContract({ contractAddress: swap.address, entrypoint: 'available', calldata: [maker.address, terms.buyToken] }), inventoryBefore);
    assert.equal(BigInt((await env.node.callContract({ contractAddress: swap.address, entrypoint: 'quote', calldata: [preliminary.id] }))[7]), 0n);
    const payload = await seal(scope, 'request', { ...terms, replyKey: await crypto.subtle.exportKey('jwk', requestKeys.publicKey), settlementCommitment: commitment }, await publicKey(maker.key));
    await success(env, await env.alice.execute([requestCall(scope, payload)]));
    await run('--run');
    const answerPayload = await readMakerAnswer(env.node, config, scope);
    const answer = decodeExecutableAnswer(await open(scope, 'quote', answerPayload, requestKeys), scope, terms, config.settlement, commitment, head.timestamp);
    assert.equal(answer.buyAmount, '76');
    assert.equal((await readExecutableQuote(env.node, config, config.settlement, scope, terms, answer)).status, 1);
    const alicePublicBefore = await balance(env, env.eth, env.alice.address);
    const actions = buildPrivateSettlementActions(scope, terms, answer, secret, env.alice.address);
    const paid = await broadcast(devnet, env, prover, actions);
    assert(paid.receipt.isSuccess(), String(paid.receipt.revert_reason));
    assert.equal((await readExecutableQuote(env.node, config, config.settlement, scope, terms, answer)).status, 2);
    await blocks(devnet.url);
    const discovered = await transfers.discoverNotes({ tokens: [BigInt(env.strk), BigInt(env.eth)] });
    assert((discovered.notes.get(env.eth) ?? []).some(note => note.amount === 76n), 'taker discovers shielded output');
    assert.equal(await balance(env, env.eth, env.alice.address), alicePublicBefore, 'output was not paid to public wallet');
    const proceeds = await env.node.callContract({ contractAddress: swap.address, entrypoint: 'available', calldata: [env.bob.address, env.strk] });
    assert.equal(BigInt(proceeds[0]), 40n, 'maker earns the full sell asset');
    const replay = await broadcast(devnet, env, prover, actions);
    assert(replay.receipt.isReverted(), 'single-use quote rejects second payment atomically');
    assert.match(String(replay.receipt.revert_reason), /NOT_RESERVED/);
    await blocks(devnet.url);
    const afterReplay = await transfers.discoverNotes({ tokens: [BigInt(env.strk)] });
    assert.equal((afterReplay.notes.get(env.strk) ?? []).reduce((sum, note) => sum + note.amount, 0n), 60n, 'reverted replay does not spend a second sell amount');
    const bobBefore = await balance(env, env.strk, env.bob.address);
    config.inventoryWithdrawal = { token: env.strk, amount: '40' }; const withdrawal = await run('--withdraw');
    const withdrawalHash = withdrawal.stdout.match(/0x[0-9a-f]+\s*$/)?.[0].trim(); assert(withdrawalHash);
    const withdrawalReceipt = await env.node.getTransactionReceipt(withdrawalHash);
    assert.equal((await balance(env, env.strk, env.bob.address)) + BigInt(withdrawalReceipt.actual_fee.amount), bobBefore + 40n, 'maker receives proceeds net of its transaction fee');
    // Gas is also charged in STRK, so verify the escrow ledger rather than an
    // incorrect public-wallet delta that would ignore the fee.
    const after = await env.node.callContract({ contractAddress: swap.address, entrypoint: 'available', calldata: [env.bob.address, env.strk] });
    assert.equal(BigInt(after[0]), 0n); assert(bobBefore > 0n);
    // A second unused executable quote is released automatically/explicitly.
    const second = { ...scope, id: randomRequestId() };
    const secondPayload = await seal(second, 'request', { ...terms, replyKey: await crypto.subtle.exportKey('jwk', requestKeys.publicKey), settlementCommitment: commitment }, await publicKey(maker.key));
    await success(env, await env.alice.execute([requestCall(second, secondPayload)]));
    await run('--run');
    const reserved = await env.node.callContract({ contractAddress: swap.address, entrypoint: 'quote', calldata: [second.id] });
    await rpc(devnet.url, 'devnet_setTime', { time: Number(BigInt(reserved[6])) + 1 }); await blocks(devnet.url);
    await run('--release');
    const released = await env.node.callContract({ contractAddress: swap.address, entrypoint: 'quote', calldata: [second.id] });
    assert.equal(Number(BigInt(released[7])), 3);
    config.inventoryWithdrawal = { token: env.eth, amount: '124' }; await run('--withdraw');
    assert.equal(await balance(env, env.eth, swap.address), 0n, 'unspent maker inventory can be fully withdrawn');
    console.log('Private settlement verified with the real pool contract and upstream simulated devnet proof facts; no mainnet transaction or live STARK proof was used.');
  } finally { await devnet.cleanup(); await rm(directory, { recursive: true, force: true }); }
});
