import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ec, hash } from 'starknet';
import {
  createConfidentialAgreement, confidentialConstructor, confidentialDigest, confidentialContract,
  reviewConfidentialOperation, approveConfidentialOperation, authorizeConfidentialOperation,
  createConfidentialClient, createConfidentialJournal, confidentialCapabilities, domain, poseidon,
} from '../dist/confidential.js';

const chainId = domain('SN_SEPOLIA');
const poolClassHash = '0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d';
const keys = { a: '0x123', b: '0x456' };
function fixture() {
  const agreement = createConfidentialAgreement({ chainId, pool: '0x200', poolClassHash, escrowClassHash: confidentialContract.classHash, signerA: ec.starkCurve.getStarkKey(keys.a), signerB: ec.starkCurve.getStarkKey(keys.b), deadline: 1000, address: '0x300', terms: { tokenA: '0x400', tokenB: '0x500', amountA: '1234', amountB: '2345', partyA: '0x600', partyB: '0x700', salt: '0x789' } });
  const inner = [agreement.address, '17', '5', '6', '111', agreement.terms.tokenA, '0', '6', '222', agreement.terms.tokenB, '0', '3', agreement.terms.partyB, '33', agreement.terms.tokenA, '1234', '0', '88', '3', agreement.terms.partyA, '44', agreement.terms.tokenB, '2345', '0', '99', '9', agreement.address, '2', '17', '1', '0'];
  const invocation = { sender_address: agreement.pool, calldata: ['1', agreement.pool, hash.getSelectorFromName('compile_actions'), String(inner.length), ...inner], signature: [] };
  const prepared = { agreement, mode: 'settle', invocation, digest: confidentialDigest(agreement, 'settle', inner) };
  const sign = role => async digest => { const signature = ec.starkCurve.sign(digest, keys[role]); return [String(signature.r), String(signature.s)]; };
  return { agreement, prepared, sign };
}
function runtime(agreement, journal, overrides = {}) {
  let submissions = 0;
  const provider = {
    channel: { nodeUrl: 'http://127.0.0.1:9999' }, getChainId: async () => chainId,
    getClassHashAt: async address => address === agreement.pool ? poolClassHash : confidentialContract.classHash,
    getBlockWithTxHashes: async () => ({ block_number: 20, timestamp: 100 }),
    callContract: async ({ entrypoint }) => entrypoint === 'configuration' ? confidentialConstructor(agreement) : entrypoint === 'get_public_key' ? [ec.starkCurve.getStarkKey('0x11')] : ['0'],
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

test('public network activation and remote simulated proofs fail closed before SDK setup', async () => {
  const { agreement } = fixture();
  const journal = { runExclusive: action => action(), load: async () => undefined, save: async () => {} };
  const mainnet = runtime(agreement, journal); mainnet.options.provider.getChainId = async () => domain('SN_MAIN');
  await assert.rejects(() => createConfidentialClient(mainnet.options), /mainnet activation/i);
  const remote = runtime(agreement, journal); remote.options.provider.channel.nodeUrl = 'https://example.invalid';
  await assert.rejects(() => createConfidentialClient(remote.options), /loopback/i);
  assert.equal(confidentialCapabilities.mainnetEnabled, false);
  assert.equal(confidentialCapabilities.realProofVerified, false);
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
