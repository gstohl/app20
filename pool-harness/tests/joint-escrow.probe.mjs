// LOCAL ONLY: exact mainnet pool class, simulated proof facts, real Cairo authorization checks.
// Run explicitly: the ordinary *.e2e.test.mjs suite needs no downloaded mainnet fixtures.
// This experiment is not a production wallet and does not produce a cryptographic STARK proof.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import { CallData, Contract, constants, ec, hash, json, OutsideExecutionVersion, shortString } from 'starknet';
import { CorePrivateTransfersProver, passphraseViewingKeyProvider } from '@starkware-libs/starknet-privacy-client';
import { createEmptyRegistry, createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';
import { PrivacyPoolABI } from '@starkware-libs/starknet-privacy-sdk/abi';
import { ContractDiscoveryProvider, Devnet, ScreeningCallMockProofProvider, createDevnetTestEnv } from '@starkware-libs/starknet-privacy-sdk/testing';
import { MAINNET_DEPLOYMENT } from '../../src/lib/mainnet-deployment.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const DEST = join(ROOT, 'artifacts/confidential-rfq');
const eq = (a, b) => BigInt(a) === BigInt(b);
const tag = text => shortString.encodeShortString(text);
const poseidon = values => hash.computePoseidonHashOnElements(values.map(BigInt));
const secret = () => `0x${randomBytes(31).toString('hex')}`;
const decoder = new CallData(PrivacyPoolABI);
const SERVER_ACTIONS = 'core::array::Span::<privacy::actions::ServerAction>';
const CLIENT_ACTIONS = 'core::array::Span::<privacy::actions::ClientAction>';
const hasReason = (error, reason) => {
  const message = `${String(error)} ${JSON.stringify(error)}`.toLowerCase();
  return message.includes(reason.toLowerCase()) || message.includes(tag(reason).toLowerCase());
};

async function rpc(devnet, method, params = {}) {
  const response = await fetch(devnet.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const result = await response.json();
  assert(!result.error, JSON.stringify(result.error));
  return result.result;
}
async function mature(devnet) {
  for (let i = 0; i < 12; i++) await rpc(devnet, 'devnet_createBlock');
}
async function success(env, tx) {
  const receipt = await env.node.waitForTransaction(tx.transaction_hash);
  assert(receipt.isSuccess(), String(receipt.revert_reason));
  return receipt;
}
async function submit(env, callAndProof) {
  const block = await env.node.getBlock('latest');
  const outside = await env.admin.getOutsideTransaction({ caller: env.admin.address, execute_after: block.timestamp - 3600, execute_before: block.timestamp + 3600 }, [callAndProof.call], OutsideExecutionVersion.V2);
  const tx = await env.admin.executeFromOutside(outside, { proofFacts: callAndProof.proof.proofFacts });
  return env.node.waitForTransaction(tx.transaction_hash);
}
function fromCore(p) {
  return { call: { contractAddress: p.call.contract_address, entrypoint: p.call.entry_point, calldata: p.call.calldata }, proof: { ...p.proof, proofFacts: p.proof.proof_facts } };
}
function wallet(env, account, proving) {
  const passphrase = `local-joint-escrow-${account.address}`;
  let registry = createEmptyRegistry();
  const discovery = new ContractDiscoveryProvider(env.privacy);
  const prover = new CorePrivateTransfersProver({ signer: account.signer, address: account.address, passphrase, node: env.node, discovery, prover: proving, poolContractAddress: env.privacy.address, shadowAccountAnonymizerAddress: '0x1', storage: { loadRegistry: async () => registry, saveRegistry: async next => { registry = next; } } });
  const build = prover.transfers.build.bind(prover.transfers);
  prover.transfers.build = (...args) => build(...args).surplusTo(account.address, false);
  const transfers = createPrivateTransfers({ account, viewingKeyProvider: passphraseViewingKeyProvider(passphrase, account.address), provingProvider: proving, discoveryProvider: discovery, poolContractAddress: env.privacy.address });
  return { prover, transfers };
}
async function balances(transfers, env) {
  const result = await transfers.discoverNotes({ tokens: [BigInt(env.strk), BigInt(env.eth)] });
  return [env.strk, env.eth].map(token => [...result.notes].filter(([key]) => eq(key, token)).flatMap(([, notes]) => notes).reduce((total, note) => total + note.amount, 0n));
}
function unsignedInner(invocation) {
  assert.equal(BigInt(invocation.calldata[0]), 1n);
  assert.equal(Number(invocation.calldata[3]), invocation.calldata.length - 4);
  return invocation.calldata.slice(4);
}
function resign(escrow, invocation, { mode = escrow.mode, terms = escrow.terms, a = true, b = true } = {}) {
  const inner = unsignedInner(invocation);
  const digest = poseidon([tag('APP20_JOINT_AUTH_V1'), escrow.chain, escrow.address, escrow.pool, escrow.poolClass, escrow.commitment, mode, poseidon(inner)]);
  const sa = ec.starkCurve.sign(digest, escrow.keyA), sb = ec.starkCurve.sign(digest, escrow.keyB);
  return { ...invocation, signature: [mode, ...terms, ...(a ? [sa.r, sa.s] : [0, 0]), ...(b ? [sb.r, sb.s] : [0, 0])].map(String) };
}
function replaceInner(invocation, inner) {
  return { ...invocation, calldata: [...invocation.calldata.slice(0, 3), String(inner.length), ...inner.map(String)] };
}
function validatePolicy(escrow, invocation) {
  return escrow.contract.is_custom_signature_valid([
    { to: invocation.calldata[1], selector: invocation.calldata[2], calldata: unsignedInner(invocation) },
  ], [], invocation.signature);
}
function actionsOf(invocation) {
  return decoder.decodeParameters(CLIENT_ACTIONS, unsignedInner(invocation).slice(2));
}
async function prepare(escrow, configure, mode) {
  escrow.mode = mode;
  const builder = escrow.transfers.build({ autoRegister: mode === 0, autoSetup: true, autoSelectNotes: 'naive', autoDiscover: { channels: 'refresh', notes: 'refresh' }, registry: createEmptyRegistry() });
  configure(builder);
  builder.computeAndInvoke(() => ({ contractAddress: escrow.address, computeAdditionalData: [escrow.viewingKey, String(mode)], invokeAdditionalData: [] }));
  const result = await builder.createProofInvocation();
  assert(result.invocation.signature.length > 0, 'Never use unsigned simulation: it skips authorization');
  return result.invocation;
}
async function prove(escrow, invocation) {
  const proof = await escrow.proving.prove(invocation);
  assert.equal(proof.data, undefined, 'This harness supplies simulated facts, not a STARK proof');
  assert.equal(proof.proofFacts.length, 9);
  assert.equal(BigInt(proof.proofFacts[7]), 1n, 'A single message hash covers both legs');
  return { call: { contractAddress: escrow.pool, entrypoint: 'apply_actions', calldata: [...proof.output.slice(1), '1'] }, proof };
}
function checkPublicTrade(prepared, escrow, env) {
  const actions = decoder.decodeParameters(SERVER_ACTIONS, prepared.proof.output.slice(1));
  const kinds = actions.map(action => action.activeVariant());
  assert(kinds.includes('EmitEncNoteCreated') && kinds.includes('EmitNoteUsed'));
  assert.equal(kinds.filter(kind => kind === 'InvokeWithComputation').length, 1);
  for (const kind of kinds) assert(['WriteOnce', 'EmitEncNoteCreated', 'EmitNoteUsed', 'InvokeWithComputation'].includes(kind), `Unexpected public action: ${kind}`);
  // Exact-value checks supplement the structural check; not a cryptographic privacy proof.
  const secrets = [env.strk, env.eth, env.alice.address, env.bob.address, ...escrow.terms.slice(2, 4), escrow.viewingKey, escrow.terms[6]];
  for (const value of prepared.call.calldata) assert(!secrets.some(secret => eq(value, secret)), 'Public calldata contains a plaintext trade field');
  return kinds;
}
async function checkPublicExecution(receipt, escrow, env) {
  const secrets = [env.strk, env.eth, env.alice.address, env.bob.address, ...escrow.terms.slice(2, 4), escrow.viewingKey, escrow.terms[6]];
  const noSecrets = values => {
    for (const value of values) assert(!secrets.some(secret => eq(value, secret)), 'Plaintext trade field in pool/escrow execution');
  };
  const relevant = address => eq(address, escrow.pool) || eq(address, escrow.address);
  const events = receipt.events.filter(event => relevant(event.from_address));
  assert(events.length > 0);
  for (const event of events) noSecrets([...event.keys, ...event.data]);
  const trace = await env.node.getTransactionTrace(receipt.transaction_hash);
  let checked = 0;
  const visit = call => {
    if (!call) return;
    if (call.contract_address && relevant(call.contract_address)) {
      noSecrets([...(call.calldata ?? []), ...(call.result ?? [])]);
      checked++;
    }
    for (const child of call.calls ?? []) visit(child);
  };
  visit(trace.execute_invocation);
  assert(checked >= 2, 'Inspect both pool and escrow callback traces');
  for (const diff of trace.state_diff.storage_diffs.filter(diff => relevant(diff.address))) {
    noSecrets(diff.storage_entries.flatMap(entry => [entry.key, entry.value]));
  }
  return { poolAndEscrowEvents: events.length, tracedCalls: checked };
}

test('joint escrow: one pool proof settles two encrypted assets, with independent timeout refunds', { timeout: 900000 }, async () => {
  await mkdir(DEST, { recursive: true });
  await rm(join(DEST, 'joint-escrow-feasibility.json'), { force: true });
  execFileSync(join(ROOT, 'vendor/bin/app20-scarb'), ['build'], { cwd: join(ROOT, 'cairo'), stdio: 'inherit' });
  const report = { testedAt: new Date().toISOString(), proofMode: 'simulated-devnet-facts-with-signature-validation', productionReady: false, mainnetTransactionsSubmitted: 0, cases: [] };
  const record = (label, extra = {}) => { report.cases.push({ label, passed: true, ...extra }); console.log(`PASS: ${label}`); };
  const devnet = new Devnet();
  try {
    const { env } = await createDevnetTestEnv(devnet);
    assert(['localhost', '127.0.0.1'].includes(new URL(devnet.url).hostname));
    const storageProbe = await fetch(devnet.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'starknet_getStorageProof', params: { block_id: 'latest', class_hashes: [], contract_addresses: [], contracts_storage_keys: [] } }) }).then(r => r.json());
    report.storageProofRpc = storageProbe.error ?? { supported: true };
    const contract = json.parse(await readFile(join(DEST, 'mainnet-pool.sierra.json'), 'utf8'));
    if (typeof contract.abi === 'string') contract.abi = JSON.parse(contract.abi);
    const poolClass = hash.computeSierraContractClassHash(contract);
    assert(eq(poolClass, MAINNET_DEPLOYMENT.settlement.poolClassHash));
    const declaration = await env.admin.declare({ contract, casm: json.parse(await readFile(join(DEST, 'mainnet-pool.casm.json'), 'utf8')) });
    await success(env, declaration);
    const deployment = await env.admin.deployContract({ classHash: declaration.class_hash, constructorCalldata: [env.admin.address, '1', ec.starkCurve.getStarkKey('0xCAFEBABE'), '450'] });
    await success(env, deployment);
    env.privacy = new Contract({ abi: contract.abi, address: deployment.contract_address ?? deployment.address, providerOrAccount: env.admin });
    report.poolClassHash = await env.node.getClassHashAt(env.privacy.address);
    assert(eq(report.poolClassHash, MAINNET_DEPLOYMENT.settlement.poolClassHash));
    report.matchesPinnedMainnetClass = true;
    const base = join(ROOT, 'cairo/target/dev/app20_chat_App20ConfidentialEscrow');
    const probeClass = json.parse(await readFile(`${base}.contract_class.json`, 'utf8'));
    const declared = await env.admin.declare({ contract: probeClass, casm: json.parse(await readFile(`${base}.compiled_contract_class.json`, 'utf8')) });
    await success(env, declared);
    report.probeClassHash = declared.class_hash;
    const chain = await env.node.getChainId();
    const proving = new ScreeningCallMockProofProvider(env.node, constants.StarknetChainId.SN_SEPOLIA);
    const deadline = (await env.node.getBlock('latest')).timestamp + 7200;
    const escrows = [];
    // Deploy before outside executions: the test admin wrapper caches its declaration nonce.
    for (let index = 0; index < 2; index++) {
      const keyA = secret(), keyB = secret();
      const publicA = ec.starkCurve.getStarkKey(keyA), publicB = ec.starkCurve.getStarkKey(keyB);
      const terms = [env.strk, env.eth, 1234, 2345, env.alice.address, env.bob.address, secret()].map(String);
      const commitment = poseidon([tag('APP20_JOINT_TERMS_V1'), chain, env.privacy.address, poolClass, publicA, publicB, deadline, ...terms]);
      const deployed = await env.admin.deployContract({ classHash: declared.class_hash, constructorCalldata: [env.privacy.address, poolClass, commitment, publicA, publicB, String(deadline)] });
      await success(env, deployed);
      const address = deployed.contract_address ?? deployed.address;
      const escrow = { address, keyA, keyB, chain, poolClass, pool: env.privacy.address, terms, commitment, deadline, viewingKey: secret(), mode: 0, proving };
      const signer = { signTransaction: async calls => {
        assert.equal(calls.length, 1);
        const inner = calls[0].calldata;
        const invocation = { calldata: ['1', env.privacy.address, hash.getSelectorFromName('compile_actions'), String(inner.length), ...inner] };
        return resign(escrow, invocation).signature;
      } };
      escrow.transfers = createPrivateTransfers({ account: { address, signer }, viewingKeyProvider: { getViewingKey: async () => BigInt(escrow.viewingKey) }, provingProvider: proving, discoveryProvider: new ContractDiscoveryProvider(env.privacy), poolContractAddress: env.privacy.address });
      escrow.contract = new Contract({ abi: probeClass.abi, address, providerOrAccount: env.admin });
      escrows.push(escrow);
    }
    const [joint, expired] = escrows;
    const alice = wallet(env, env.alice, proving), bob = wallet(env, env.bob, proving);
    for (const [owner, account, token] of [[alice, env.alice, env.strk], [bob, env.bob, env.eth]]) {
      await success(env, await account.execute({ contractAddress: token, entrypoint: 'approve', calldata: [env.privacy.address, '10000', '0'] }));
      const deposit = fromCore(await owner.prover.prove([{ type: 'deposit', token, amount: '10000' }]));
      await mature(devnet);
      assert((await submit(env, deposit)).isSuccess());
      await mature(devnet);
    }
    record('controlled wallet funding succeeded');
    const rejectProof = async (label, escrow, invocation, reason) => {
      assert(invocation.signature.length > 0);
      await assert.rejects(() => validatePolicy(escrow, invocation), error => !reason || hasReason(error, reason));
      await assert.rejects(() => escrow.proving.prove(invocation));
      record(label);
    };
    for (const escrow of escrows) {
      const setup = await prepare(escrow, b => {
        b.register().setup(env.alice.address).setup(env.bob.address);
        for (const token of [env.strk, env.eth]) b.with(token, t => t.setup(env.alice.address).setup(env.bob.address));
      }, 0);
      assert.equal(BigInt(await validatePolicy(escrow, setup)), BigInt(tag('VALID')));
      if (escrow === joint) await rejectProof('one party cannot register the escrow alone', escrow, resign(escrow, setup, { b: false }), 'SIGNER_B');
      const result = await submit(env, await prove(escrow, setup));
      assert(result.isSuccess(), String(result.revert_reason));
      await mature(devnet);
    }
    record('jointly signed setup accepted for both escrows');
    const fund = async (escrow, owner, token, amount) => {
      const p = fromCore(await owner.prover.prove([{ type: 'transfer', token, recipient: escrow.address, amount: String(amount) }]));
      const receipt = await submit(env, p);
      assert(receipt.isSuccess(), String(receipt.revert_reason));
      await mature(devnet);
    };
    for (const escrow of escrows) {
      await fund(escrow, alice, env.strk, 1234);
      await fund(escrow, bob, env.eth, 2345);
    }
    assert.deepEqual(await balances(joint.transfers, env), [1234n, 2345n]);
    assert.deepEqual(await balances(expired.transfers, env), [1234n, 2345n]);
    const settle = escrow => prepare(escrow, b => {
      b.with(env.strk, t => t.surplusTo(env.alice.address, false).transfer({ recipient: env.bob.address, amount: 1234n }));
      b.with(env.eth, t => t.surplusTo(env.bob.address, false).transfer({ recipient: env.alice.address, amount: 2345n }));
    }, 1);
    const swap = await settle(joint);
    assert.equal(BigInt(await validatePolicy(joint, swap)), BigInt(tag('VALID')));
    await rejectProof('maker signature alone cannot settle', joint, resign(joint, swap, { b: false }));
    await rejectProof('taker signature alone cannot settle', joint, resign(joint, swap, { a: false }));
    const changedTerms = [...joint.terms]; changedTerms[2] = '1233';
    await rejectProof('altered committed terms rejected', joint, resign(joint, swap, { terms: changedTerms }));
    await rejectProof('signature cannot be replayed on another escrow', expired, replaceInner(swap, [expired.address, ...unsignedInner(swap).slice(1)]));
    const noCallback = unsignedInner(swap);
    assert.equal(BigInt(noCallback.at(-6)), 9n);
    noCallback.splice(-6);
    noCallback[2] = String(Number(noCallback[2]) - 1);
    await rejectProof('removing timeout callback rejected even with both signatures', joint, resign(joint, replaceInner(swap, noCallback)));
    const wrongAmount = unsignedInner(swap);
    const decoded = actionsOf(swap);
    let offset = 3;
    const widths = [1, 4, 6, 6, 5, 2, 3, 5];
    for (const action of decoded) {
      const kind = Number(wrongAmount[offset]);
      if (action.activeVariant() === 'CreateEncNote') { wrongAmount[offset + 4] = '1233'; break; }
      assert(kind < 8);
      offset += 1 + widths[kind];
    }
    await rejectProof('incorrect swap amount rejected even with both signatures', joint, resign(joint, replaceInner(swap, wrongAmount)));
    const wrongRecipient = unsignedInner(swap);
    wrongRecipient[offset + 1] = env.admin.address;
    await rejectProof('substituted recipient rejected even with both signatures', joint, resign(joint, replaceInner(swap, wrongRecipient)), 'CHANGE_POLICY');
    const publicOutput = unsignedInner(swap);
    publicOutput[offset] = '4';
    await rejectProof('OPEN output is forbidden', joint, resign(joint, replaceInner(swap, publicOutput)), 'ACTION_FORBIDDEN');
    const forgedCallback = unsignedInner(swap);
    forgedCallback.splice(-6, 6, '8', joint.address, '2', tag('APP20_JOINT_COMPUTE_V1'), '1');
    await rejectProof('plain external callback cannot replace identity-bound computation', joint, resign(joint, replaceInner(swap, forgedCallback)), 'ACTION_FORBIDDEN');
    await assert.rejects(() => env.node.callContract({ contractAddress: joint.address, entrypoint: 'privacy_invoke_with_computation', calldata: [tag('APP20_JOINT_COMPUTE_V1'), '1'] }), error => hasReason(error, 'ONLY_POOL'));
    record('direct callback cannot mark an escrow settled');
    const attacker = alice.transfers.build({ autoSetup: true, autoSelectNotes: 'naive', autoDiscover: { channels: 'refresh', notes: 'refresh' }, registry: createEmptyRegistry() }).surplusTo(env.alice.address, false)
      .with(env.strk, t => t.transfer({ recipient: env.alice.address, amount: 1n }))
      .computeAndInvoke(() => ({ contractAddress: joint.address, computeAdditionalData: [joint.viewingKey, '1'], invokeAdditionalData: [] }));
    const attackerInvocation = (await attacker.createProofInvocation()).invocation;
    assert(attackerInvocation.signature.length > 0);
    const computeCall = identity => env.node.callContract({ contractAddress: joint.address, entrypoint: 'privacy_compute', calldata: [identity, joint.viewingKey, '1'] });
    const validIdentity = poseidon([tag('IDENTITY_KEY_TAG:V1'), joint.address, joint.viewingKey, joint.address]);
    assert.deepEqual((await computeCall(validIdentity)).map(BigInt), [BigInt(tag('APP20_JOINT_COMPUTE_V1')), 1n]);
    const otherIdentity = poseidon([tag('IDENTITY_KEY_TAG:V1'), env.alice.address, joint.viewingKey, joint.address]);
    await assert.rejects(() => computeCall(otherIdentity), error => hasReason(error, 'ESCROW_IDENTITY'));
    await assert.rejects(() => proving.prove(attackerInvocation));
    assert.equal(await joint.contract.is_settled(), false);
    record('another authenticated pool user cannot spoof the escrow identity');
    assert.equal(BigInt(await joint.contract.is_valid_signature(123, [1, 2])), 0n);
    record('standard signature fallback disabled');
    const prepared = await prove(joint, swap);
    report.settlementActionKinds = checkPublicTrade(prepared, joint, env);
    const before = [await balances(alice.transfers, env), await balances(bob.transfers, env)];
    const receipt = await submit(env, prepared);
    assert(receipt.isSuccess(), String(receipt.revert_reason));
    report.publicSettlementInspection = await checkPublicExecution(receipt, joint, env);
    await mature(devnet);
    assert.deepEqual(await balances(joint.transfers, env), [0n, 0n]);
    assert.deepEqual(await balances(alice.transfers, env), [before[0][0], before[0][1] + 2345n]);
    assert.deepEqual(await balances(bob.transfers, env), [before[1][0] + 1234n, before[1][1]]);
    assert.equal(await joint.contract.is_settled(), true);
    record('one transaction settles both assets into encrypted recipient notes', { singletonProofFacts: true, noOpenNotes: true, noPlaintextTradeFields: true });
    const replay = await submit(env, prepared);
    assert(replay.isReverted());
    record('settlement replay rejected');
    const stale = await prove(expired, await settle(expired));
    const refund = (escrow, mode, amount) => prepare(escrow, b => b.with(mode === 2 ? env.strk : env.eth, t => t.transfer({ recipient: mode === 2 ? env.alice.address : env.bob.address, amount: BigInt(amount) })), mode);
    const earlyInvocation = await refund(expired, 2, 1234);
    const early = await prove(expired, resign(expired, earlyInvocation, { mode: 2, b: false }));
    const earlyReceipt = await submit(env, early);
    assert(earlyReceipt.isReverted());
    assert.match(String(earlyReceipt.revert_reason), /REFUND_TOO_EARLY/);
    await mature(devnet);
    assert.deepEqual(await balances(expired.transfers, env), [1234n, 2345n]);
    record('early unilateral refund reverts and both balances remain intact');
    await rpc(devnet, 'devnet_setTime', { time: deadline + 1 });
    const lateReceipt = await submit(env, stale);
    assert(lateReceipt.isReverted());
    assert.match(String(lateReceipt.revert_reason), /ESCROW_EXPIRED/);
    await mature(devnet);
    assert.deepEqual(await balances(expired.transfers, env), [1234n, 2345n]);
    record('previously signed settlement cannot execute after expiry');
    // Rebuild after expiry: neither refund depends on a pre-signed, expiring joint proof.
    const refundA = await refund(expired, 2, 1234);
    const wrongAssetRefund = unsignedInner(refundA);
    let inputOffset = 3;
    for (const action of actionsOf(refundA)) {
      const kind = Number(wrongAssetRefund[inputOffset]);
      if (action.activeVariant() === 'UseNote') { wrongAssetRefund[inputOffset + 2] = env.eth; break; }
      assert(kind < 8); inputOffset += 1 + widths[kind];
    }
    await rejectProof('party A signature cannot refund party B asset', expired, resign(expired, replaceInner(refundA, wrongAssetRefund), { mode: 2, b: false }), 'TOKEN_POLICY');
    const divertedRefund = unsignedInner(refundA);
    // Find the encrypted output using the exact ABI decoder, retaining a valid action body.
    let refundOffset = 3;
    for (const action of actionsOf(refundA)) {
      const kind = Number(divertedRefund[refundOffset]);
      if (action.activeVariant() === 'CreateEncNote') { divertedRefund[refundOffset + 1] = env.bob.address; break; }
      assert(kind < 8); refundOffset += 1 + widths[kind];
    }
    await rejectProof('refund cannot be redirected to the counterparty', expired, resign(expired, replaceInner(refundA, divertedRefund), { mode: 2, b: false }), 'RECIPIENT_POLICY');
    await rejectProof('counterparty cannot claim the other asset refund', expired, resign(expired, refundA, { mode: 2, a: false }));
    const ra = await submit(env, await prove(expired, resign(expired, refundA, { mode: 2, b: false })));
    assert(ra.isSuccess(), String(ra.revert_reason));
    await mature(devnet);
    assert.deepEqual(await balances(expired.transfers, env), [0n, 2345n]);
    record('party A recovers its own asset without party B signature');
    const refundB = await refund(expired, 3, 2345);
    const rb = await submit(env, await prove(expired, resign(expired, refundB, { mode: 3, a: false })));
    assert(rb.isSuccess(), String(rb.revert_reason));
    await mature(devnet);
    assert.deepEqual(await balances(expired.transfers, env), [0n, 0n]);
    record('party B independently recovers its own asset');
    await fund(expired, alice, env.strk, 77);
    const lateRefund = await refund(expired, 2, 77);
    const rr = await submit(env, await prove(expired, resign(expired, lateRefund, { mode: 2, b: false })));
    assert(rr.isSuccess(), String(rr.revert_reason));
    await mature(devnet);
    assert.deepEqual(await balances(expired.transfers, env), [0n, 0n]);
    record('late one-sided funding can be refunded after an earlier refund');
    assert.deepEqual(await balances(alice.transfers, env), [8766n, 2345n]);
    assert.deepEqual(await balances(bob.transfers, env), [1234n, 7655n]);
    record('final balances account for exactly one swap; all other funding returned');
    report.result = 'local single-proof encrypted settlement and unilateral refund gates passed';
    await writeFile(join(DEST, 'joint-escrow-feasibility.json'), JSON.stringify(report, null, 2) + '\n');
  } finally {
    await devnet.cleanup();
  }
});
