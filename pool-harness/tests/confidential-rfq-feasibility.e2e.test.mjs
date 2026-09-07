// Capability experiment against the unmodified pool, NOT a working swap protocol.
// Simulated proof facts exercise contract validation but are not real STARK proofs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import { CallData, Contract, constants, ec, hash, json, OutsideExecutionVersion } from 'starknet';
import { CorePrivateTransfersProver, passphraseViewingKeyProvider } from '@starkware-libs/starknet-privacy-client';
import { createEmptyRegistry, createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';
import { PrivacyPoolABI } from '@starkware-libs/starknet-privacy-sdk/abi';
import { ContractDiscoveryProvider, Devnet, ScreeningCallMockProofProvider, createDevnetTestEnv } from '@starkware-libs/starknet-privacy-sdk/testing';
import { MAINNET_DEPLOYMENT } from '../../src/lib/mainnet-deployment.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const DEST = join(ROOT, 'artifacts/confidential-rfq');
const decoder = new CallData(PrivacyPoolABI);
const SERVER_ACTIONS = 'core::array::Span::<privacy::actions::ServerAction>';
const equalFelt = (a, b) => BigInt(a) === BigInt(b);
const callOf = p => ({ contractAddress: p.call.contract_address, entrypoint: p.call.entry_point, calldata: p.call.calldata });

async function rpc(devnet, method, params = {}) {
  const response = await fetch(devnet.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  assert(!body.error, JSON.stringify(body.error));
  return body.result;
}
async function mature(devnet) {
  for (let n = 0; n < 12; n++) await rpc(devnet, 'devnet_createBlock');
}
async function success(env, tx) {
  const receipt = await env.node.waitForTransaction(tx.transaction_hash);
  assert(receipt.isSuccess(), String(receipt.revert_reason));
  return receipt;
}
function wallet(env, account) {
  const passphrase = `local-confidential-rfq-${account.address}`;
  const discovery = new ContractDiscoveryProvider(env.privacy);
  const proving = new ScreeningCallMockProofProvider(env.node, constants.StarknetChainId.SN_SEPOLIA);
  let registry = createEmptyRegistry();
  const prover = new CorePrivateTransfersProver({ signer: account.signer, address: account.address, passphrase, node: env.node, discovery, prover: proving, poolContractAddress: env.privacy.address, shadowAccountAnonymizerAddress: '0x1', storage: { loadRegistry: async () => registry, saveRegistry: async next => { registry = next; } } });
  // Avoid OPEN change notes; this adjustment is confined to controlled SDK accounts.
  const build = prover.transfers.build.bind(prover.transfers);
  prover.transfers.build = (...args) => build(...args).surplusTo(account.address, false);
  const transfers = createPrivateTransfers({ account, viewingKeyProvider: passphraseViewingKeyProvider(passphrase, account.address), provingProvider: proving, discoveryProvider: discovery, poolContractAddress: env.privacy.address });
  return { prover, transfers };
}
async function submit(env, calls, proofFacts) {
  const block = await env.node.getBlock('latest');
  const outside = await env.admin.getOutsideTransaction({ caller: env.admin.address, execute_after: block.timestamp - 3600, execute_before: block.timestamp + 3600 }, calls, OutsideExecutionVersion.V2);
  const tx = await env.admin.executeFromOutside(outside, { proofFacts });
  return env.node.waitForTransaction(tx.transaction_hash);
}
async function balances(wallet, env) {
  const found = await wallet.transfers.discoverNotes({ tokens: [BigInt(env.strk), BigInt(env.eth)] });
  return [env.strk, env.eth].map(token => [...found.notes.entries()].filter(([key]) => equalFelt(key, token)).flatMap(([, notes]) => notes).reduce((n, note) => n + note.amount, 0n));
}
function assertEncryptedLeg(prepared, env, amount) {
  assert.equal(prepared.proof.data, undefined, 'local simulated proof only');
  assert.equal(prepared.proof.proof_facts.length, 9);
  assert.equal(BigInt(prepared.proof.proof_facts[7]), 1n);
  const actions = decoder.decodeParameters(SERVER_ACTIONS, prepared.proof.output.slice(1));
  const kinds = actions.map(action => action.activeVariant());
  assert(kinds.includes('EmitEncNoteCreated'));
  assert(kinds.includes('EmitNoteUsed'));
  for (const kind of kinds) assert(['WriteOnce', 'EmitEncNoteCreated', 'EmitNoteUsed'].includes(kind), `Unexpected public action ${kind}; establish channels before the trade`);
  // A supplemental exact-value check, not a cryptographic proof of confidentiality.
  for (const value of prepared.call.calldata) {
    assert(![env.strk, env.eth, env.alice.address, env.bob.address, amount].some(secret => equalFelt(value, secret)), 'Plaintext trade value in public calldata');
  }
  return kinds;
}

test('confidential RFQ gate: two independently authorized pool legs cannot share singleton proof facts', { timeout: 600000 }, async () => {
  await mkdir(DEST, { recursive: true });
  execFileSync(join(ROOT, 'vendor/bin/app20-scarb'), ['build'], { cwd: join(ROOT, 'pool-harness/contracts'), stdio: 'inherit' });
  const devnet = new Devnet();
  const report = { testedAt: new Date().toISOString(), proofMode: 'simulated-devnet-facts', productionReady: false, cases: [] };
  try {
    const { env } = await createDevnetTestEnv(devnet);
    assert(new URL(devnet.url).hostname === '127.0.0.1' || new URL(devnet.url).hostname === 'localhost');
    if (process.env.APP20_PROBE_MAINNET_CLASS === '1') {
      // Deploy the downloaded, pinned mainnet CLASS to devnet, with local test
      // governance/screening keys and balances. This is not mainnet execution.
      const contract = json.parse(await readFile(join(DEST, 'mainnet-pool.sierra.json'), 'utf8'));
      if (typeof contract.abi === 'string') contract.abi = JSON.parse(contract.abi);
      assert(equalFelt(hash.computeSierraContractClassHash(contract), MAINNET_DEPLOYMENT.settlement.poolClassHash));
      const casm = json.parse(await readFile(join(DEST, 'mainnet-pool.casm.json'), 'utf8'));
      const declaration = await env.admin.declare({ contract, casm });
      await success(env, declaration);
      const deployment = await env.admin.deployContract({ classHash: declaration.class_hash, constructorCalldata: [env.admin.address, '1', ec.starkCurve.getStarkKey('0xCAFEBABE'), '450'] });
      await success(env, deployment);
      env.privacy = new Contract({ abi: contract.abi, address: deployment.contract_address ?? deployment.address, providerOrAccount: env.admin });
    }
    report.poolClassHash = await env.node.getClassHashAt(env.privacy.address);
    report.matchesPinnedMainnetClass = equalFelt(report.poolClassHash, MAINNET_DEPLOYMENT.settlement.poolClassHash);
    const base = join(ROOT, 'pool-harness/contracts/target/dev/app20_privacy_probe_ProofPairProbe');
    const declared = await env.admin.declare({ contract: json.parse(await readFile(`${base}.contract_class.json`, 'utf8')), casm: json.parse(await readFile(`${base}.compiled_contract_class.json`, 'utf8')) });
    await success(env, declared);
    const deployed = await env.admin.deployContract({ classHash: declared.class_hash, constructorCalldata: [] });
    await success(env, deployed);
    const probe = deployed.contract_address ?? deployed.address;
    const alice = wallet(env, env.alice), bob = wallet(env, env.bob);
    for (const [owner, account, token] of [[alice, env.alice, env.strk], [bob, env.bob, env.eth]]) {
      await success(env, await account.execute({ contractAddress: token, entrypoint: 'approve', calldata: [env.privacy.address, '10000', '0'] }));
      const deposit = await owner.prover.prove([{ type: 'deposit', token, amount: '10000' }]);
      await mature(devnet);
      const receipt = await submit(env, [callOf(deposit)], deposit.proof.proof_facts);
      assert(receipt.isSuccess(), String(receipt.revert_reason));
      await mature(devnet);
    }
    // One-unit setup payments establish the private channels before trade preparation.
    for (const [owner, recipient, token] of [[alice, env.bob.address, env.strk], [bob, env.alice.address, env.eth]]) {
      const setup = await owner.prover.prove([{ type: 'transfer', recipient, token, amount: '1' }]);
      const receipt = await submit(env, [callOf(setup)], setup.proof.proof_facts);
      assert(receipt.isSuccess(), String(receipt.revert_reason));
      await mature(devnet);
    }
    const before = [await balances(alice, env), await balances(bob, env)];
    assert.deepEqual(before, [[9999n, 1n], [1n, 9999n]]);
    const a = await alice.prover.prove([{ type: 'transfer', recipient: env.bob.address, token: env.strk, amount: '1234' }]);
    const b = await bob.prover.prove([{ type: 'transfer', recipient: env.alice.address, token: env.eth, amount: '2345' }]);
    report.actionKinds = [assertEncryptedLeg(a, env, 1234), assertEncryptedLeg(b, env, 2345)];
    assert(!equalFelt(a.proof.proof_facts[8], b.proof.proof_facts[8]));
    assert.deepEqual(a.proof.proof_facts.slice(0, 8), b.proof.proof_facts.slice(0, 8), 'Both compiled at the same base block');
    const pairFacts = [...a.proof.proof_facts.slice(0, 7), '0x2', a.proof.proof_facts[8], b.proof.proof_facts[8]];
    const calls = [callOf(a), callOf(b)];
    const wrapped = [{ contractAddress: probe, entrypoint: 'apply_pair', calldata: [env.privacy.address, String(calls[0].calldata.length), ...calls[0].calldata, String(calls[1].calldata.length), ...calls[1].calldata] }];
    for (const [label, candidate, facts] of [
      ['direct: first-leg facts', calls, a.proof.proof_facts],
      ['direct: second-leg facts', calls, b.proof.proof_facts],
      ['direct: both message hashes', calls, pairFacts],
      ['Cairo wrapper: first-leg facts', wrapped, a.proof.proof_facts],
      ['Cairo wrapper: both message hashes', wrapped, pairFacts],
    ]) {
      const receipt = await submit(env, candidate, facts);
      assert(receipt.isReverted(), label);
      assert.match(String(receipt.revert_reason), /INVALID_PROOF_MSG/, label);
      await mature(devnet);
      assert.deepEqual([await balances(alice, env), await balances(bob, env)], before, `${label}: entire transaction rolls back`);
      report.cases.push({ label, outcome: 'reverted', reason: 'INVALID_PROOF_MSG', balancesUnchanged: true });
      console.log(`${label}: rejected, both balances unchanged`);
    }
    // Control: these same signed action outputs are valid individually. Executing
    // them separately exposes one-sided settlement, so it is NOT the fallback.
    const onlyA = await submit(env, [callOf(a)], a.proof.proof_facts);
    assert(onlyA.isSuccess(), String(onlyA.revert_reason));
    await mature(devnet);
    assert.deepEqual([await balances(alice, env), await balances(bob, env)], [[8765n, 1n], [1235n, 9999n]]);
    report.cases.push({ label: 'first leg alone', outcome: 'succeeded', oneSidedPayment: true });
    const onlyB = await submit(env, [callOf(b)], b.proof.proof_facts);
    assert(onlyB.isSuccess(), String(onlyB.revert_reason));
    await mature(devnet);
    assert.deepEqual([await balances(alice, env), await balances(bob, env)], [[8765n, 2346n], [1235n, 7654n]]);
    report.cases.push({ label: 'second leg alone', outcome: 'succeeded', atomicSwap: false });
    report.result = 'paired-apply candidate blocked by pool singleton message validation';
    await writeFile(join(DEST, report.matchesPinnedMainnetClass ? 'mainnet-class-feasibility.json' : 'feasibility.json'), JSON.stringify(report, null, 2) + '\n');
  } finally {
    await devnet.cleanup();
  }
});
