import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ec, hash } from 'starknet';
import {
  createConfidentialAgreement, confidentialConstructor, confidentialDigest, confidentialContract,
  reviewConfidentialOperation, approveConfidentialOperation, authorizeConfidentialOperation,
  createConfidentialClient, createConfidentialProofClient, createConfidentialJournal, confidentialCapabilities, domain, poseidon,
} from '../dist/confidential.js';

const chainId = domain('SN_SEPOLIA');
const poolClassHash = '0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d';
const keys = { a: '0x123', b: '0x456' };
function fixture(overrides = {}) {
  const agreement = createConfidentialAgreement({ chainId, pool: '0x200', poolClassHash, escrowClassHash: confidentialContract.classHash, signerA: ec.starkCurve.getStarkKey(keys.a), signerB: ec.starkCurve.getStarkKey(keys.b), deadline: 1000, address: '0x300', terms: { tokenA: '0x400', tokenB: '0x500', amountA: '1234', amountB: '2345', partyA: '0x600', partyB: '0x700', salt: '0x789' }, ...overrides });
  const inner = [agreement.address, '17', '5', '6', '111', agreement.terms.tokenA, '0', '6', '222', agreement.terms.tokenB, '0', '3', agreement.terms.partyB, '33', agreement.terms.tokenA, '1234', '0', '88', '3', agreement.terms.partyA, '44', agreement.terms.tokenB, '2345', '0', '99', '9', agreement.address, '2', '17', '1', '0'];
  const invocation = { sender_address: agreement.pool, calldata: ['1', agreement.pool, hash.getSelectorFromName('compile_actions'), String(inner.length), ...inner], signature: [] };
  const prepared = { agreement, mode: 'settle', invocation, digest: confidentialDigest(agreement, 'settle', inner) };
  const sign = role => async digest => { const signature = ec.starkCurve.sign(digest, keys[role]); return [String(signature.r), String(signature.s)]; };
  return { agreement, prepared, sign };
}
function runtime(agreement, journal, overrides = {}) {
  let submissions = 0;
  const provider = {
    channel: { nodeUrl: 'http://127.0.0.1:9999' }, getChainId: async () => agreement.chainId,
    getClassHashAt: async address => address === agreement.pool ? poolClassHash : confidentialContract.classHash,
    getBlockWithTxHashes: async () => ({ block_number: 20, block_hash: '0x123', status: 'ACCEPTED_ON_L2', timestamp: 100 }),
    callContract: async ({ entrypoint }) => entrypoint === 'configuration' ? confidentialConstructor(agreement) : entrypoint === 'get_public_key' ? [ec.starkCurve.getStarkKey('0x11')] : entrypoint === 'get_proof_validity_blocks' ? ['450'] : ['0'],
  };
  return { get submissions() { return submissions; }, options: { agreement, provider, viewingKeyProvider: { getViewingKey: async () => 17n }, journal, simulatedProofs: true, proofProvider: { getDefaultDetails: async () => ({}), prove: async () => { throw new Error('not used'); } }, discovery: { resolve: async () => ({ discoverNotes: async () => ({ notes: new Map() }) }) }, submit: async () => { submissions++; return { transaction_hash: '0x987' }; }, ...overrides } };
}

test('each role reviews and signs the exact private operation; tampering never reaches the signer', async () => {
  const { agreement, prepared, sign } = fixture();
  assert.equal(reviewConfidentialOperation(prepared, 17n).outputs, 2);
  const a = await approveConfidentialOperation(prepared, 17n, 'a', sign('a'));
  assert.throws(() => authorizeConfidentialOperation(prepared, 17n, [a]), /every required party/i);
  const b = await approveConfidentialOperation(prepared, 17n, 'b', sign('b'));
  assert.equal(authorizeConfidentialOperation(prepared, 17n, [a, b]).signature.length, 12);
  assert.throws(() => authorizeConfidentialOperation(prepared, 17n, [a, a]), /exactly once/i);
  const changed = structuredClone(prepared); changed.invocation.calldata[17] = '0x777';
  let signed = false;
  await assert.rejects(() => approveConfidentialOperation(changed, 17n, 'a', async () => { signed = true; return ['1', '2']; }));
  assert.equal(signed, false);
  const other = structuredClone(prepared); other.agreement = createConfidentialAgreement({ ...agreement, address: '0x301' });
  assert.throws(() => authorizeConfidentialOperation(other, 17n, [a, b]), /identity/i);
});

test('direct prover JSON encodes all joint signature felts as hex without changing approvals or terms', async () => {
  for (const [mode, code] of [['setup', 0], ['settle', 1], ['refundA', 2], ['refundB', 3]]) {
    const { agreement, prepared, sign } = fixture();
    if (mode !== 'settle') {
      const isB = mode === 'refundB', token = isB ? agreement.terms.tokenB : agreement.terms.tokenA;
      const recipient = isB ? agreement.terms.partyB : agreement.terms.partyA;
      const actions = mode === 'setup' ? ['2', '0', '111'] : ['3', '6', '111', token, '0', '3', recipient, '33', token, '1234', '0', '88'];
      const inner = [agreement.address, '17', ...actions, '9', agreement.address, '2', '17', String(code), '0'];
      prepared.mode = mode;
      prepared.invocation.calldata = ['1', agreement.pool, hash.getSelectorFromName('compile_actions'), String(inner.length), ...inner];
      prepared.digest = confidentialDigest(agreement, mode, inner);
    }
    const roles = mode === 'refundA' ? ['a'] : mode === 'refundB' ? ['b'] : ['a', 'b'];
    const approvals = await Promise.all(roles.map(role => approveConfidentialOperation(prepared, 17n, role, sign(role))));
    const before = structuredClone({ prepared, approvals });
    const wire = JSON.parse(JSON.stringify(authorizeConfidentialOperation(prepared, 17n, approvals)));
    const expected = [String(code), agreement.terms.tokenA, agreement.terms.tokenB, agreement.terms.amountA, agreement.terms.amountB, agreement.terms.partyA, agreement.terms.partyB, agreement.terms.salt, ...['a', 'b'].flatMap(role => approvals.find(value => value.role === role)?.signature ?? ['0', '0'])];
    assert.equal(wire.signature.length, 12);
    for (const felt of wire.signature) assert.match(felt, /^0x(?:0|[1-9a-f][\da-f]*)$/, mode);
    assert.deepEqual(wire.signature.map(BigInt), expected.map(BigInt), mode);
    assert.deepEqual({ prepared, approvals }, before, 'Canonical encoding must not rewrite the signed request');
  }
});

test('mainnet simulated proofs and remote simulated proofs fail closed before SDK setup', async () => {
  const { agreement } = fixture();
  const journal = { runExclusive: action => action(), load: async () => undefined, save: async () => {} };
  const mainnet = runtime(agreement, journal); mainnet.options.provider.getChainId = async () => domain('SN_MAIN');
  await assert.rejects(() => createConfidentialClient(mainnet.options), /real cryptographic proofs/i);
  const remote = runtime(agreement, journal); remote.options.provider.channel.nodeUrl = 'https://example.invalid';
  await assert.rejects(() => createConfidentialClient(remote.options), /loopback/i);
  assert.equal(confidentialCapabilities.mainnetEnabled, true);
  assert.equal(confidentialCapabilities.realProofVerified, true);
  assert.equal(confidentialCapabilities.nativeReadyEndToEndVerified, false);
});

test('durable journal retains uncertain funding across restarts and excludes private payloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'confidential-journal-test-'));
  try {
    const { agreement } = fixture(); const journal = await createConfidentialJournal(dir);
    const env = runtime(agreement, journal); const client = await createConfidentialClient(env.options);
    let funded = 0;
    await assert.rejects(() => client.fund('a', async () => { funded++; throw new Error('network disconnected after send'); }), /uncertain/i);
    const restarted = await createConfidentialClient({ ...env.options, journal: await createConfidentialJournal(dir) });
    await assert.rejects(() => restarted.fund('a', async () => { funded++; return { transaction_hash: '0x1' }; }), /unknown submission outcome/i);
    assert.equal(funded, 1);
    const state = await journal.load();
    await journal.save({ ...state, viewingKey: 'PRIVATE_CANARY', invocation: { witness: 'PRIVATE_CANARY' } });
    const text = await readFile(join(dir, 'confidential-session.json'), 'utf8');
    assert(!text.includes('PRIVATE_CANARY')); assert(!text.includes('tokenA')); assert(!text.includes('amountA'));
    assert.equal((await stat(join(dir, 'confidential-session.json'))).mode & 0o777, 0o600);
    await assert.rejects(() => journal.runExclusive(() => journal.runExclusive(async () => {})), /locked/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('client rejects empty proofs and a prover callback for another escrow before broadcasting', async () => {
  const { agreement, prepared, sign } = fixture();
  const journal = { runExclusive: action => action(), load: async () => undefined, save: async () => {} };
  const approvals = await Promise.all(['a', 'b'].map(role => approveConfidentialOperation(prepared, 17n, role, sign(role))));
  const empty = runtime(agreement, journal, { simulatedProofs: false, proofProvider: { getDefaultDetails: async () => ({}), prove: async () => ({ output: [poolClassHash, '0'], proofFacts: [] }) } });
  await assert.rejects(() => createConfidentialClient(empty.options).then(client => client.execute(prepared, approvals)), /proof bytes/i);
  assert.equal(empty.submissions, 0);
  const output = [poolClassHash, '1', '11', '0x999', '2', domain('APP20_JOINT_COMPUTE_V1'), '1'];
  const facts = [domain('PROOF0'), domain('VIRTUAL_SNOS'), '0x3e98c2d7703b03a7edb73ed7f075f97f1dcbaa8f717cdf6e1a57bf058265473', domain('VIRTUAL_SNOS0'), '10', '0x123', hash.computeHashOnElements([domain('StarknetOsConfig3'), chainId, '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d']), '1', poseidon([agreement.pool, 0, output.length, ...output])];
  const wrong = runtime(agreement, journal, { proofProvider: { getDefaultDetails: async () => ({}), prove: async () => ({ output, proofFacts: facts }) } });
  await assert.rejects(() => createConfidentialClient(wrong.options).then(client => client.execute(prepared, approvals)), /callback differs/i);
  assert.equal(wrong.submissions, 0);
});

const canonicalPool = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a';
function mainnetFixture() { return fixture({ chainId: domain('SN_MAIN'), pool: canonicalPool }); }
// An envelope fixture tests SDK boundaries, not STARK verification or mainnet acceptance.
function proofEnvelope(agreement) {
  const output = [poolClassHash, '2', '0', '0x111', '1', '0x222', '11', agreement.address, '2', domain('APP20_JOINT_COMPUTE_V1'), '1'];
  const proofFacts = [domain('PROOF1'), domain('VIRTUAL_SNOS'), '0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1', domain('VIRTUAL_SNOS0'), '20', '0x123', '0x5b3bc83b3a47231aa5f15e73309ef7e09e087bd4ace767656fe5d713f6e2d7a', '1', poseidon([agreement.pool, 0, output.length, ...output])];
  return { data: 'TEST_ENVELOPE_NOT_A_STARK_PROOF', output, proofFacts };
}
test('mainnet proof rehearsal exposes no funding/submission method while production retains real-proof validation', async () => {
  const { agreement, prepared, sign } = mainnetFixture();
  let writes = 0, proven = 0;
  const journal = { runExclusive: action => action(), load: async () => undefined, save: async () => { writes++; } };
  const env = runtime(agreement, journal, { simulatedProofs: false, proofProvider: { getDefaultDetails: async () => ({}), prove: async (invocation, block) => { proven++; assert.equal(invocation.signature.length, 12); assert.deepEqual(block, { block_hash: '0x123' }); return proofEnvelope(agreement); } } });
  const client = await createConfidentialProofClient(env.options);
  assert.equal(client.fund, undefined); assert.equal(client.execute, undefined); assert.equal(client.funding, undefined);
  const approvals = await Promise.all(['a', 'b'].map(role => client.approve(prepared, role, sign(role))));
  const submission = await client.prove(prepared, approvals);
  assert.equal(submission.call.entrypoint, 'apply_actions'); assert.equal(BigInt(submission.call.contractAddress), BigInt(canonicalPool));
  assert.equal(proven, 1); assert.equal(env.submissions, 0); assert.equal(writes, 0);
  assert(!JSON.stringify(submission).includes('amountA'));
  const production = await createConfidentialClient(env.options);
  assert.equal(typeof production.execute, 'function');
  assert.equal(env.submissions, 0);
  assert.equal(confidentialCapabilities.mainnetEnabled, true);
  assert.equal(confidentialCapabilities.realProofVerified, true);
});

test('mainnet proof rehearsal verifies live chain, pool, escrow and configuration before reading viewing material', async () => {
  const journal = { runExclusive: action => action(), load: async () => undefined, save: async () => {} };
  for (const failure of ['simulated', 'chain', 'pool', 'class', 'configuration', 'undeployed']) {
    const { agreement } = failure === 'pool' ? fixture({ chainId: domain('SN_MAIN') }) : mainnetFixture();
    let reads = 0;
    const env = runtime(agreement, journal, { simulatedProofs: false, viewingKeyProvider: { getViewingKey: async () => { reads++; return 17n; } } });
    if (failure === 'simulated') env.options.simulatedProofs = true;
    if (failure === 'chain') env.options.provider.getChainId = async () => chainId;
    if (failure === 'class') env.options.provider.getClassHashAt = async () => '0x123';
    if (failure === 'configuration') env.options.provider.callContract = async () => ['0'];
    if (failure === 'undeployed') env.options.provider.getClassHashAt = async () => { throw Error('Class not found'); };
    await assert.rejects(() => createConfidentialProofClient(env.options), undefined, failure);
    assert.equal(reads, 0, failure);
  }
});

test('proof rehearsal rejects missing proof bytes, wrong output binding, and incomplete independent approvals', async () => {
  const { agreement, prepared, sign } = mainnetFixture();
  const journal = { runExclusive: action => action(), load: async () => undefined, save: async () => {} };
  const approvals = await Promise.all(['a', 'b'].map(role => approveConfidentialOperation(prepared, 17n, role, sign(role))));
  for (const kind of ['empty', 'binding', 'approvals']) {
    let proven = 0;
    const env = runtime(agreement, journal, { simulatedProofs: false, proofProvider: { getDefaultDetails: async () => ({}), prove: async () => { proven++; const proof = proofEnvelope(agreement); if (kind === 'empty') proof.data = ''; if (kind === 'binding') proof.proofFacts[8] = '0x1'; return proof; } } });
    const client = await createConfidentialProofClient(env.options);
    env.options.simulatedProofs = true; // Mutation must not weaken an already created client.
    await assert.rejects(() => client.prove(prepared, kind === 'approvals' ? approvals.slice(0, 1) : approvals), kind === 'empty' ? /proof bytes/i : kind === 'binding' ? /bind/i : /every required party/i);
    assert.equal(env.submissions, 0); assert.equal(proven, kind === 'approvals' ? 0 : 1);
  }
});

test('proof preparation inputs are owned before asynchronous journal and provider callbacks', async () => {
  const { agreement, prepared, sign } = mainnetFixture();
  const approvals = await Promise.all(['a', 'b'].map(role => approveConfidentialOperation(prepared, 17n, role, sign(role))));
  let entered; const wait = new Promise(resolve => { entered = resolve; });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const journal = { runExclusive: async action => { entered(); await gate; return action(); }, load: async () => undefined, save: async () => {} };
  const env = runtime(agreement, journal, { simulatedProofs: false, proofProvider: { getDefaultDetails: async () => ({}), prove: async invocation => { assert.equal(invocation.signature[0], '0x1'); return proofEnvelope(agreement); } } });
  const client = await createConfidentialProofClient(env.options);
  const pending = client.prove(prepared, approvals);
  await wait; prepared.mode = 'refundA'; prepared.invocation.calldata[4] = '0xdead'; approvals.pop(); release();
  await pending;
  assert.equal(env.submissions, 0);
});

test('mainnet proof rehearsal rejects a different block and a proof older than the live pool window', async () => {
  const { agreement, prepared, sign } = mainnetFixture();
  const approvals = await Promise.all(['a', 'b'].map(role => approveConfidentialOperation(prepared, 17n, role, sign(role))));
  const journal = { runExclusive: action => action(), load: async () => undefined, save: async () => {} };
  for (const kind of ['block', 'expired']) {
    const env = runtime(agreement, journal, { simulatedProofs: false });
    env.options.proofProvider.prove = async () => {
      const proof = proofEnvelope(agreement);
      if (kind === 'block') proof.proofFacts[5] = '0x999';
      else env.options.provider.getBlockWithTxHashes = async () => ({ block_number: 471, block_hash: '0x456', timestamp: 100 });
      return proof;
    };
    const client = await createConfidentialProofClient(env.options);
    await assert.rejects(() => client.prove(prepared, approvals), kind === 'block' ? /another proving block/i : /expired/i);
    assert.equal(env.submissions, 0);
  }
});
