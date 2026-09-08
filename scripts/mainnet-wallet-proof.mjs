#!/usr/bin/env node
// Narrow operator proof preparation only. No account execution or broadcast API.
import { readFile, mkdir, chmod, open, rename, unlink, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash, scryptSync, createCipheriv, createDecipheriv, timingSafeEqual, randomBytes } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { Account, RpcProvider, CallData, ec, hash } from 'starknet';
import { createEmptyRegistry, createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';
import { MAINNET_DEPLOYMENT as deployment } from '../src/lib/mainnet-deployment.ts';
import { CONFIDENTIAL_RFQ_CONTRACT } from '../src/lib/confidential-rfq-deployment.ts';
import { validateMainnetProof } from './mainnet-proof-policy.mjs';

export const WALLET_PROOF_SCOPE = Object.freeze({
  owner: '0x2baf5bf273ff0ecf729e1b9d455889a2dfbc831c944e48a124367295d2d6bc3',
  escrow: '0x11b28bb270f1c9c7eefd1205cfba6c1a686436fcb5f5c3281d5a0a77011438f',
  shieldToken: deployment.sellToken.address,
  shieldAmount: '20000000000000000',
  rpc: 'https://api.cartridge.gg/x/starknet/mainnet',
  relay: 'https://app20.dokgst.workers.dev/api/privacy/prove',
});
const root = resolve(import.meta.dirname, '..');
const directory = resolve(homedir(), '.config/app20/mainnet-wallet-proofs');
const stages = new Set(['shield', 'fundA', 'fundB']);
// Pinned pool source: privacy/src/utils.cairo DEPOSITOR_VALIDATION_MAX_AGE.
export const SHIELD_SCREENING_MAX_AGE_SECONDS = 300;
const same = (a, b) => BigInt(a) === BigInt(b);
const serialize = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? '0x' + v.toString(16) : v, 2) + '\n';
const digest = value => createHash('sha256').update(serialize(value)).digest('hex');
const jsonRead = async path => JSON.parse(await readFile(path, 'utf8'));

async function protectedDirectory(path) { await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700); }
async function readOptional(path) { try { return await jsonRead(path); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; } }
async function save(path, value) {
  const temporary = path + '.' + crypto.randomUUID() + '.next';
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(serialize(value)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const parent = await open(resolve(path, '..'), 'r'); try { await parent.sync(); } finally { await parent.close(); }
}
async function exclusive(path, work) {
  const lock = await open(path, 'wx', 0o600);
  try { return await work(); } finally { await lock.close(); await unlink(path); }
}

/** Builds only the three reviewed operations; arbitrary recipient/amount input is absent. */
export function walletStage(stage, agreement) {
  if (!stages.has(stage)) throw Error('Unsupported wallet proof operation.');
  if (stage === 'shield') return Object.freeze({ mode: stage, owner: WALLET_PROOF_SCOPE.owner, recipient: WALLET_PROOF_SCOPE.owner, token: WALLET_PROOF_SCOPE.shieldToken, amount: WALLET_PROOF_SCOPE.shieldAmount });
  if (!agreement || !same(agreement.chainId, deployment.chainId) || !same(agreement.pool, deployment.settlement.pool) || !same(agreement.poolClassHash, deployment.settlement.poolClassHash) || !same(agreement.address, WALLET_PROOF_SCOPE.escrow) || !same(agreement.escrowClassHash, CONFIDENTIAL_RFQ_CONTRACT.classHash) || !same(agreement.terms.partyA, WALLET_PROOF_SCOPE.owner)) throw Error('Confidential funding agreement differs from the reviewed deployment.');
  const side = stage === 'fundA' ? 'A' : 'B', token = agreement.terms['token' + side], amount = agreement.terms['amount' + side];
  if (!same(agreement.terms.tokenA, deployment.sellToken.address) || !same(agreement.terms.tokenB, deployment.buyToken.address) || !/^\d+$/.test(amount) || BigInt(amount) <= 0n || BigInt(amount) >= 2n ** 128n) throw Error('Unexpected confidential funding asset or amount.');
  return Object.freeze({ mode: stage, owner: WALLET_PROOF_SCOPE.owner, recipient: WALLET_PROOF_SCOPE.escrow, token, amount, agreementCommitment: agreement.commitment });
}

export function buildWalletStage(transfers, reviewed) {
  if (!stages.has(reviewed.mode) || !same(reviewed.owner, WALLET_PROOF_SCOPE.owner)) throw Error('Unsupported wallet proof identity.');
  const builder = transfers.build({ autoRegister: false, autoSetup: true, autoSelectNotes: 'naive', autoDiscover: { channels: 'refresh', notes: 'refresh' } });
  const token = builder.with(reviewed.token);
  if (reviewed.mode === 'shield') {
    if (!same(reviewed.recipient, WALLET_PROOF_SCOPE.owner) || !same(reviewed.token, WALLET_PROOF_SCOPE.shieldToken) || reviewed.amount !== WALLET_PROOF_SCOPE.shieldAmount) throw Error('Shielding differs from exactly 0.02 STRK to the operator.');
    token.deposit({ amount: BigInt(reviewed.amount) }).surplusTo(WALLET_PROOF_SCOPE.owner, false);
  } else {
    if (!same(reviewed.recipient, WALLET_PROOF_SCOPE.escrow) || !reviewed.agreementCommitment || !/^\d+$/.test(reviewed.amount) || BigInt(reviewed.amount) <= 0n) throw Error('Funding requires the reviewed confidential escrow.');
    token.transfer({ recipient: WALLET_PROOF_SCOPE.escrow, amount: BigInt(reviewed.amount) }).surplusTo(WALLET_PROOF_SCOPE.owner, false);
  }
  return builder;
}

/** Prevent discovery from selecting notes/channels newer than the proving block. */
export function fixedBlockDiscoveryProvider(provider, blockHash) {
  if (typeof blockHash !== 'string' || !/^0x[\da-f]+$/i.test(blockHash)) throw Error('Explicit accepted block hash required.');
  return new Proxy(provider, { get(target, property) {
    if (property === 'callContract') return call => target.callContract(call, blockHash);
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

export async function inspectWalletProof(provider, savedBlock) {
  if (!same(await provider.getChainId(), deployment.chainId)) throw Error('Starknet mainnet required.');
  const head = await provider.getBlockWithTxHashes('latest');
  if (!Number.isSafeInteger(head.block_number) || head.block_number < 11) throw Error('Accepted chain head required.');
  const block = await provider.getBlockWithTxHashes(savedBlock ? savedBlock.hash : head.block_number - 10);
  if (!['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(block.status) || !Number.isSafeInteger(block.block_number) || !/^0x[\da-f]+$/i.test(block.block_hash) || head.block_number - block.block_number < 10) throw Error('Proving block must be accepted and ten blocks behind the head.');
  if (savedBlock && (savedBlock.number !== block.block_number || !same(savedBlock.hash, block.block_hash))) throw Error('RPC returned another block.');
  const [poolClass, fee, validity] = await Promise.all([
    provider.getClassHashAt(deployment.settlement.pool, block.block_hash),
    provider.callContract({ contractAddress: deployment.settlement.pool, entrypoint: 'get_fee_amount', calldata: [] }, block.block_hash),
    provider.callContract({ contractAddress: deployment.settlement.pool, entrypoint: 'get_proof_validity_blocks', calldata: [] }, block.block_hash),
  ]);
  if (!same(poolClass, deployment.settlement.poolClassHash)) throw Error('Canonical pool class changed.');
  if (fee.length !== 1 || BigInt(fee[0]) > 6n * 10n ** 18n || BigInt(fee[0]) < 0n) throw Error('Pool fee exceeds the reviewed cap.');
  if (validity.length !== 1 || BigInt(head.block_number - block.block_number) >= BigInt(validity[0])) throw Error('Saved proving block expired; preserve the existing job and reconcile before preparing another.');
  return { chainId: deployment.chainId, pool: deployment.settlement.pool, block: { number: block.block_number, hash: block.block_hash }, timestamp: block.timestamp, poolFeeBaseUnits: BigInt(fee[0]).toString(), transactionSubmitted: false };
}

export function sealWalletInvocation(invocation, viewingKey, scope) {
  const key = createHash('sha256').update('app20/wallet-proof/sealed-invocation/v1:' + scope + ':' + viewingKey.toString(16)).digest();
  try {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(scope));
    const ciphertext = Buffer.concat([cipher.update(serialize(invocation)), cipher.final()]);
    return { schema: 'app20-wallet-sealed-invocation/v1', iv: iv.toString('hex'), ciphertext: ciphertext.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
  } finally { key.fill(0); }
}
export function unsealWalletInvocation(sealed, viewingKey, scope) {
  if (sealed.schema !== 'app20-wallet-sealed-invocation/v1' || !/^[\da-f]{24}$/i.test(sealed.iv) || !/^[\da-f]{32}$/i.test(sealed.tag) || !/^(?:[\da-f]{2})+$/i.test(sealed.ciphertext)) throw Error('Invalid sealed proof invocation.');
  const key = createHash('sha256').update('app20/wallet-proof/sealed-invocation/v1:' + scope + ':' + viewingKey.toString(16)).digest();
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'hex'));
    cipher.setAAD(Buffer.from(scope)); cipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(sealed.ciphertext, 'hex')), cipher.final()]).toString('utf8'));
  } finally { key.fill(0); }
}

export function shieldingExpiry(record, chainTimestamp) {
  const issuedAt = record?.submission?.proof?.additionalData?.signature?.issued_at;
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0 || !Number.isSafeInteger(chainTimestamp) || chainTimestamp <= 0) throw Error('Valid shielding screening and chain timestamps are required.');
  return { screeningIssuedAt: issuedAt, screeningExpiresAt: issuedAt + SHIELD_SCREENING_MAX_AGE_SECONDS, screeningSecondsRemaining: issuedAt + SHIELD_SCREENING_MAX_AGE_SECONDS - chainTimestamp };
}

/** Only an expired, unsubmitted shield proof can be archived for a fresh job. */
export function assertExpiredShieldRefresh(record, ledger, chainTimestamp) {
  const checked = validateMainnetProof({ record, stage: 'shield' });
  const expiry = shieldingExpiry(record, chainTimestamp);
  if (expiry.screeningSecondsRemaining >= 0) throw Error('The existing screening attestation is still valid; do not create another proof.');
  if (!ledger || ledger.schema !== 'app20/mainnet-release/v1' || !same(ledger.chainId, deployment.chainId) || !same(ledger.accountAddress, WALLET_PROOF_SCOPE.owner) || !Array.isArray(ledger.transactions) || ledger.pending) throw Error('Resolve the release journal before refreshing a shield proof.');
  if (ledger.transactions.some(tx => tx.proofId === checked.proofId && tx.success)) throw Error('This shield proof already succeeded; no additional deposit is authorized.');
  return { previousProofId: checked.proofId, ...expiry };
}

async function archiveExpiredShield(provider) {
  const release = resolve(homedir(), '.config/app20/mainnet-release');
  try { await lstat(resolve(release, 'operation.lock')); throw Error('A release operation is active; do not refresh its proof.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const location = resolve(directory, 'shield');
  const record = await jsonRead(resolve(location, 'submission.json'));
  const ledger = await jsonRead(resolve(release, 'ledger.json'));
  const head = await provider.getBlockWithTxHashes('latest');
  if (!['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(head.status)) throw Error('Accepted chain timestamp required.');
  const review = assertExpiredShieldRefresh(record, ledger, head.timestamp);
  const archive = resolve(directory, 'archive'); await protectedDirectory(archive);
  const destination = resolve(archive, 'shield-' + record.block.number + '-' + crypto.randomUUID());
  // Preserve the entire signed invocation, one-time prover result and diagnostics.
  await rename(location, destination);
  await save(resolve(destination, 'refresh.json'), { ...review, archivedAt: new Date().toISOString(), transactionSubmitted: false });
}

async function runtime() {
  const { build } = await import('esbuild');
  const destination = resolve(root, '.e2e-build/mainnet-wallet-proof/runtime.mjs');
  await build({ stdin: { contents: "export { starkscanProver } from './packages/privy/src/starkscan.ts'; export { contractDiscovery } from './packages/privy/src/discovery.ts'; export { normalizeConfidentialAgreement, confidentialConstructor } from './packages/agent-sdk/src/confidential-protocol.ts';", resolveDir: root }, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', outfile: destination, logLevel: 'silent' });
  return import(pathToFileURL(destination).href);
}
async function signingIdentity(provider) {
  const location = resolve(homedir(), '.config/app20/mainnet-deployer');
  const config = await jsonRead(resolve(location, 'account.json'));
  const ks = (await jsonRead(resolve(location, 'keystore.json'))).crypto;
  const password = (await readFile(resolve(location, 'keystore.password'), 'utf8')).trim();
  const derived = scryptSync(password, Buffer.from(ks.kdfparams.salt, 'hex'), ks.kdfparams.dklen, { N: ks.kdfparams.n, r: ks.kdfparams.r, p: ks.kdfparams.p });
  let secret;
  try {
    const ciphertext = Buffer.from(ks.ciphertext, 'hex');
    if (!timingSafeEqual(Buffer.from(keccak_256(Buffer.concat([derived.subarray(16, 32), ciphertext]))), Buffer.from(ks.mac, 'hex'))) throw Error('Keystore authentication failed.');
    const cipher = createDecipheriv(ks.cipher, derived.subarray(0, 16), Buffer.from(ks.cipherparams.iv, 'hex'));
    secret = Buffer.concat([cipher.update(ciphertext), cipher.final()]);
    const key = '0x' + secret.toString('hex');
    if (!same(ec.starkCurve.getStarkKey(key), config.variant.public_key) || !same(hash.calculateContractAddressFromHash(config.deployment.salt, config.deployment.class_hash, CallData.compile({ publicKey: config.variant.public_key }), 0), WALLET_PROOF_SCOPE.owner) || !same(await provider.getClassHashAt(WALLET_PROOF_SCOPE.owner), config.deployment.class_hash)) throw Error('Operator signing identity changed.');
    const account = new Account({ provider, address: WALLET_PROOF_SCOPE.owner, signer: key, cairoVersion: '1' });
    return { address: account.address, signer: account.signer };
  } finally { derived.fill(0); secret?.fill(0); }
}

export async function prepareWalletProof(stage, { refreshExpiredScreening = false } = {}) {
  if (!stages.has(stage)) throw Error('Unsupported wallet proof operation.');
  if (refreshExpiredScreening && stage !== 'shield') throw Error('Screening refresh is only valid for shielding.');
  if (process.env.SDK_DEBUG) throw Error('Disable SDK_DEBUG before loading operator material.');
  await protectedDirectory(directory);
  return exclusive(resolve(directory, 'operation.lock'), async () => {
    const provider = new RpcProvider({ nodeUrl: WALLET_PROOF_SCOPE.rpc });
    if (refreshExpiredScreening) await archiveExpiredShield(provider);
    const location = resolve(directory, stage); await protectedDirectory(location);
    const app = await runtime();
    const agreement = stage === 'shield' ? undefined : app.normalizeConfidentialAgreement(await jsonRead(resolve(homedir(), '.config/app20/mainnet-confidential/agreement.json')));
    const reviewed = walletStage(stage, agreement);
    const sealed = await readOptional(resolve(location, 'invocation.sealed.json'));
    let request = await readOptional(resolve(location, 'request.json'));
    if (sealed && !request) throw Error('Saved invocation has no request; manual reconciliation required.');
    if (request && (request.schema !== 'app20-wallet-proof-request/v1' || digest(request.reviewed) !== digest(reviewed))) throw Error('Saved request differs from the reviewed operation.');
    const preflight = await inspectWalletProof(provider, sealed ? request.block : undefined);
    if (!sealed) { request = { schema: 'app20-wallet-proof-request/v1', reviewed, block: preflight.block }; await save(resolve(location, 'request.json'), request); }
    if (agreement) {
      const [escrowClass, configuration, settled, registered] = await Promise.all([
        provider.getClassHashAt(WALLET_PROOF_SCOPE.escrow, preflight.block.hash),
        provider.callContract({ contractAddress: WALLET_PROOF_SCOPE.escrow, entrypoint: 'configuration', calldata: [] }, preflight.block.hash),
        provider.callContract({ contractAddress: WALLET_PROOF_SCOPE.escrow, entrypoint: 'is_settled', calldata: [] }, preflight.block.hash),
        provider.callContract({ contractAddress: deployment.settlement.pool, entrypoint: 'get_public_key', calldata: [WALLET_PROOF_SCOPE.escrow] }, preflight.block.hash),
      ]);
      const expected = app.confidentialConstructor(agreement);
      if (!same(escrowClass, CONFIDENTIAL_RFQ_CONTRACT.classHash) || configuration.length !== expected.length || configuration.some((v, i) => !same(v, expected[i])) || settled.length !== 1 || BigInt(settled[0]) !== 0n || registered.length !== 1 || BigInt(registered[0]) === 0n || agreement.deadline <= preflight.timestamp + 600) throw Error('Escrow is not ready for funding at the proving block.');
    }
    const previous = await readOptional(resolve(location, 'submission.json'));
    if (previous) {
      const valid = validateMainnetProof({ record: previous, stage, publicInput: { owner: reviewed.owner, token: reviewed.token, amount: reviewed.amount } });
      const expiry = stage === 'shield' ? shieldingExpiry(previous, (await provider.getBlockWithTxHashes('latest')).timestamp) : {};
      if (expiry.screeningSecondsRemaining < 0) throw Error('Shield screening expired. Use --refresh-expired-screening after reconciling the release journal.');
      return { mode: stage, output: resolve(location, 'submission.json'), proofId: valid.proofId, ...expiry, reused: true, transactionSubmitted: false };
    }
    const viewingKey = BigInt((await jsonRead(resolve(homedir(), '.config/app20/mainnet-demo/viewing-key.json'))).key);
    if (viewingKey <= 0n || viewingKey > ec.starkCurve.CURVE.n / 2n) throw Error('Canonical operator viewing key required.');
    const publicKey = await provider.callContract({ contractAddress: deployment.settlement.pool, entrypoint: 'get_public_key', calldata: [WALLET_PROOF_SCOPE.owner] }, preflight.block.hash);
    if (publicKey.length !== 1 || !same(publicKey[0], ec.starkCurve.getStarkKey('0x' + viewingKey.toString(16)))) throw Error('Registered operator viewing key differs.');
    const provingProvider = await app.starkscanProver({ relayUrl: WALLET_PROOF_SCOPE.relay, poolClassHash: deployment.settlement.poolClassHash, accessToken: async () => (await readFile(resolve(homedir(), '.config/app20/prover-agent.token'), 'utf8')).trim(), journal: {
      runExclusive: work => exclusive(resolve(location, 'hosted-proof.lock'), work),
      load: key => readOptional(resolve(location, 'proof-' + key + '.json')),
      save: (key, value) => save(resolve(location, 'proof-' + key + '.json'), value),
    } }).resolve({ provider, network: 'mainnet', chainId: deployment.chainId, nodeUrl: WALLET_PROOF_SCOPE.rpc, poolAddress: deployment.settlement.pool });
    const discoveryProvider = await app.contractDiscovery().resolve({ provider: fixedBlockDiscoveryProvider(provider, preflight.block.hash), poolAddress: deployment.settlement.pool });
    const transfers = createPrivateTransfers({ account: await signingIdentity(provider), viewingKeyProvider: { getViewingKey: async () => viewingKey }, discoveryProvider, provingProvider, poolContractAddress: deployment.settlement.pool });
    const scope = digest(request);
    let invocation;
    if (sealed) invocation = unsealWalletInvocation(sealed, viewingKey, scope);
    else {
      ({ invocation } = await buildWalletStage(transfers, reviewed).createProofInvocation());
      await save(resolve(location, 'invocation.sealed.json'), sealWalletInvocation(invocation, viewingKey, scope));
    }
    const { callAndProof } = await transfers.executeWithInvocation({ invocation, registry: createEmptyRegistry(), warnings: [] }, { block_hash: preflight.block.hash });
    const record = { schema: 'app20-mainnet-wallet-proof/v1', mode: stage, chainId: deployment.chainId, block: preflight.block, generatedAt: new Date().toISOString(), submission: callAndProof, transactionSubmitted: false };
    const valid = validateMainnetProof({ record, stage, publicInput: { owner: reviewed.owner, token: reviewed.token, amount: reviewed.amount } });
    await save(resolve(location, 'submission.json'), record);
    const expiry = stage === 'shield' ? shieldingExpiry(record, (await provider.getBlockWithTxHashes('latest')).timestamp) : {};
    return { mode: stage, output: resolve(location, 'submission.json'), proofId: valid.proofId, ...expiry, publicActionKinds: valid.publicActionKinds, publicInputs: valid.publicInputs, transactionSubmitted: false };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await protectedDirectory(directory);
  try {
    const { values } = parseArgs({ options: { mode: { type: 'string', default: 'check' }, 'refresh-expired-screening': { type: 'boolean', default: false } } });
    if (values.mode === 'check' && values['refresh-expired-screening']) throw Error('Screening refresh requires shield mode.');
    const result = values.mode === 'check' ? await inspectWalletProof(new RpcProvider({ nodeUrl: WALLET_PROOF_SCOPE.rpc })) : await prepareWalletProof(values.mode, { refreshExpiredScreening: values['refresh-expired-screening'] });
    console.log(serialize(result));
  } catch (error) {
    await save(resolve(directory, 'last-error.json'), { at: new Date().toISOString(), message: String(error?.message ?? error), stack: error?.stack });
    console.error('Wallet proof preparation stopped without broadcasting. Inspect the protected operator journal; private diagnostics are not printed.');
    process.exitCode = 1;
  }
}
