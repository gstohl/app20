#!/usr/bin/env node
// Operator-owned, proof-only Chat rehearsal. This command has no broadcast path.
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, scryptSync, createCipheriv, createDecipheriv, timingSafeEqual, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { Account, RpcProvider, CallData, ec, hash, shortString } from 'starknet';
import { createEmptyRegistry, createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';
import { PrivacyPoolABI } from '@starkware-libs/starknet-privacy-sdk/abi';
import { MAINNET_DEPLOYMENT as deployment } from '../src/lib/mainnet-deployment.ts';
import { MAINNET_PROOF_FORMAT, realProofConfigHash } from '../src/lib/mainnet-proof-format.ts';

export const CHAT = Object.freeze({
  address: '0x501331396a00e95a4b520502ff73155412e056bd42bc41cb115deb656d97ae4',
  classHash: '0x2e6fd0b464b0a7a1c8793b5d18609609e167af5ce7916e28821af34b5de4b12',
});
export const OPERATOR = '0x2baf5bf273ff0ecf729e1b9d455889a2dfbc831c944e48a124367295d2d6bc3';
const root = resolve(import.meta.dirname, '..');
const directory = resolve(homedir(), '.config/app20/mainnet-chat-proof');
const rpc = 'https://api.cartridge.gg/x/starknet/mainnet';
const relayUrl = 'https://app20.dokgst.workers.dev/api/privacy/prove';
const message = 'Hey, the private chat is live. Can you see this message?';
const same = (a, b) => BigInt(a) === BigInt(b);
const domain = value => BigInt(shortString.encodeShortString(value));
const poseidon = values => ec.starkCurve.poseidonHashMany(values.map(BigInt));
const hex = value => '0x' + BigInt(value).toString(16);
const storageAddress = (name, ...keys) => hex(keys.reduce((address, key) => BigInt(hash.computePedersenHash(address, key)), hash.starknetKeccak(name)) % ((1n << 251n) - 256n));
const serialize = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? hex(v) : v, 2) + '\n';
async function read(name) { try { return JSON.parse(await readFile(resolve(directory, name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; } }
async function save(name, value) {
  const destination = resolve(directory, name), temporary = destination + '.' + crypto.randomUUID() + '.next';
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(serialize(value)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, destination);
  const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
}
async function exclusive(name, work) {
  const path = resolve(directory, name + '.lock'), lock = await open(path, 'wx', 0o600);
  try { return await work(); } finally { await lock.close(); await unlink(path); }
}
async function runtime() {
  // Bundle only public application source; no operator files enter this build.
  const { build } = await import('esbuild');
  const destination = resolve(root, '.e2e-build/mainnet-chat-proof/runtime.mjs');
  await build({ stdin: { contents: "export * as mail from './src/lib/mail.ts'; export { buildMessageOnlyChatActions } from './src/lib/strk20.ts'; export { starkscanProver } from './packages/privy/src/starkscan.ts'; export { contractDiscovery } from './packages/privy/src/discovery.ts';", resolveDir: root }, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', alias: { '@': resolve(root, 'src') }, define: { 'import.meta.env': '{}' }, outfile: destination, logLevel: 'silent' });
  return import(pathToFileURL(destination).href);
}

export async function inspectChatPrerequisites(provider, savedBlock, checkFresh = true) {
  if (!same(await provider.getChainId(), deployment.chainId)) throw Error('Unexpected chain.');
  const head = await provider.getBlockWithTxHashes('latest');
  if (!Number.isSafeInteger(head.block_number) || head.block_number <= 10) throw Error('Accepted chain head required.');
  const block = await provider.getBlockWithTxHashes(savedBlock ? savedBlock.hash : head.block_number - 10);
  if (!['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(block.status) || !block.block_hash || head.block_number - block.block_number < 10) throw Error('Proving block must be accepted and at least ten blocks behind head.');
  if (savedBlock && (block.block_number !== savedBlock.number || !same(block.block_hash, savedBlock.hash))) throw Error("Proving block lookup changed.");
  const blockId = block.block_hash;
  const [poolClass, chatClass, helperPool, validity, fee] = await Promise.all([
    provider.getClassHashAt(deployment.settlement.pool, blockId),
    provider.getClassHashAt(CHAT.address, blockId),
    provider.getStorageAt(CHAT.address, storageAddress('pool'), blockId),
    provider.callContract({ contractAddress: deployment.settlement.pool, entrypoint: 'get_proof_validity_blocks', calldata: [] }, blockId),
    provider.callContract({ contractAddress: deployment.settlement.pool, entrypoint: 'get_fee_amount', calldata: [] }, blockId),
  ]);
  if (!same(poolClass, deployment.settlement.poolClassHash) || !same(chatClass, CHAT.classHash) || !same(helperPool.value ?? helperPool, deployment.settlement.pool)) throw Error('Unexpected pool or Chat deployment.');
  if (validity.length !== 1 || (checkFresh && BigInt(head.block_number - block.block_number) >= BigInt(validity[0]))) throw Error('Saved proving block has expired; preserve its proof journal before preparing a new attempt.');
  if (fee.length !== 1 || BigInt(fee[0]) > 6n * 10n ** 18n) throw Error('Pool application fee exceeds the reviewed cap.');
  return { chainId: deployment.chainId, head: head.block_number, block: { number: block.block_number, hash: block.block_hash }, pool: deployment.settlement.pool, chat: CHAT, poolFeeBaseUnits: BigInt(fee[0]).toString(), validityBlocks: Number(BigInt(validity[0])), transactionSubmitted: false };
}

/** Reject any economic operation, substituted payload, helper or proof scope. */
export function validateChatProof(submission, expected) {
  const { proof, call } = submission;
  if (!proof || typeof proof.data !== 'string' || !proof.data.length || proof.additionalData != null || !Array.isArray(proof.output) || !same(proof.output[0], deployment.settlement.poolClassHash)) throw Error('Real proof and canonical pool output required.');
  const facts = proof.proofFacts;
  const config = realProofConfigHash(deployment.chainId, deployment.sellToken.address);
  const wanted = [domain(MAINNET_PROOF_FORMAT.version), domain('VIRTUAL_SNOS'), MAINNET_PROOF_FORMAT.virtualProgramHash, domain('VIRTUAL_SNOS0'), expected.block.number, expected.block.hash, config, 1, poseidon([deployment.settlement.pool, 0, proof.output.length, ...proof.output])];
  if (!Array.isArray(facts) || facts.length !== wanted.length || facts.some((v, i) => !same(v, wanted[i]))) throw Error('Proof facts do not bind the reviewed block, pool and chain.');
  if (!same(call.contractAddress, deployment.settlement.pool) || call.entrypoint !== 'apply_actions' || JSON.stringify(call.calldata.map(hex)) !== JSON.stringify([...proof.output.slice(1), '1'].map(hex))) throw Error('Public call differs from the proven actions.');
  const actions = new CallData(PrivacyPoolABI).decodeParameters('core::array::Span::<privacy::actions::ServerAction>', proof.output.slice(1));
  const kinds = actions.map(action => action.activeVariant());
  if (kinds.some(kind => !['WriteOnce', 'EmitEncNoteCreated', 'EmitNoteUsed', 'InvokeWithComputation'].includes(kind)) || kinds.filter(kind => kind === 'InvokeWithComputation').length !== 1 || kinds.at(-1) !== 'InvokeWithComputation' || !kinds.includes('WriteOnce') || !kinds.includes('EmitEncNoteCreated') || !kinds.includes('EmitNoteUsed')) throw Error('Message proof requires private note replay protection and exactly one encrypted callback.');
  const callback = actions.at(-1).unwrap();
  if (!same(callback.contract_address, CHAT.address) || !Array.isArray(callback.calldata) || JSON.stringify(callback.calldata.map(hex)) !== JSON.stringify(expected.callback.map(hex))) throw Error('Encrypted callback or replay fence changed.');
  return { publicActionKinds: kinds, actionId: expected.actionId, replaySlot: hex(expected.callback[0]), payloadCommitment: hex(expected.callback[1]), noWithdrawals: true, noOpenNotes: true, noHelperFunding: true, privateSelfTransferBaseUnits: '1', realProofBytesPresent: true, chainAcceptanceVerified: false };
}

async function operator(provider) {
  const deployer = resolve(homedir(), '.config/app20/mainnet-deployer');
  const config = JSON.parse(await readFile(resolve(deployer, 'account.json'), 'utf8'));
  const ks = JSON.parse(await readFile(resolve(deployer, 'keystore.json'), 'utf8')).crypto;
  const password = (await readFile(resolve(deployer, 'keystore.password'), 'utf8')).trim();
  const derived = scryptSync(password, Buffer.from(ks.kdfparams.salt, 'hex'), ks.kdfparams.dklen, { N: ks.kdfparams.n, r: ks.kdfparams.r, p: ks.kdfparams.p });
  let secret;
  try {
    const ciphertext = Buffer.from(ks.ciphertext, 'hex');
    if (!timingSafeEqual(Buffer.from(keccak_256(Buffer.concat([derived.subarray(16, 32), ciphertext]))), Buffer.from(ks.mac, 'hex'))) throw Error('Keystore authentication failed.');
    const cipher = createDecipheriv(ks.cipher, derived.subarray(0, 16), Buffer.from(ks.cipherparams.iv, 'hex'));
    secret = Buffer.concat([cipher.update(ciphertext), cipher.final()]);
    const key = '0x' + secret.toString('hex');
    if (!same(ec.starkCurve.getStarkKey(key), config.variant.public_key) || !same(hash.calculateContractAddressFromHash(config.deployment.salt, config.deployment.class_hash, CallData.compile({ publicKey: config.variant.public_key }), 0), OPERATOR) || !same(await provider.getClassHashAt(OPERATOR), config.deployment.class_hash)) throw Error('Operator identity mismatch.');
    const account = new Account({ provider, address: OPERATOR, signer: key, cairoVersion: '1' });
    // The Core SDK receives only proof-signing identity, never Account.execute.
    return { address: OPERATOR, signer: account.signer };
  } finally { secret?.fill(0); derived.fill(0); }
}

async function context(provider, checkFresh = true) {
  const app = await runtime();
  const viewing = BigInt(JSON.parse(await readFile(resolve(homedir(), '.config/app20/mainnet-demo/viewing-key.json'), 'utf8')).key);
  const keySeed = createHash('sha256').update('app20/mainnet-proof/chat-key/v1:' + viewing.toString(16)).digest();
  const mailbox = app.mail.deriveKeypair(keySeed); keySeed.fill(0);
  let request = await read('request.json');
  if (!request) {
    const preflight = await inspectChatPrerequisites(provider);
    request = { schema: 'app20-mainnet-chat-proof-request/v1', block: preflight.block, actionId: hash.starknetKeccak('app20/chat/mainnet-release/message/v1').toString(), record: await app.mail.encryptMail(mailbox.publicKey, message) };
    request.actionId = hex(request.actionId);
    await save('request.json', request);
  }
  if (request.schema !== 'app20-mainnet-chat-proof-request/v1' || !same(request.actionId, hash.starknetKeccak('app20/chat/mainnet-release/message/v1'))) throw Error('Unexpected saved Chat request.');
  if (new TextDecoder().decode(await app.mail.decryptMail(mailbox.privateKey, request.record)) !== message) throw Error('Saved encrypted message cannot be authenticated.');
  // Discovery may have required a later shielding transaction. Before any signed
  // invocation or hosted job exists, refresh only the public proving block.
  if (checkFresh && !(await read('invocation.sealed.json'))) {
    request.block = (await inspectChatPrerequisites(provider)).block;
    await save('request.json', request);
  }
  const preflight = await inspectChatPrerequisites(provider, request.block, checkFresh);
  const [, action] = app.buildMessageOnlyChatActions({ helperAddress: CHAT.address, senderAddress: OPERATOR, record: request.record, actionId: request.actionId });
  const identity = poseidon([domain('IDENTITY_KEY_TAG:V1'), OPERATOR, viewing, CHAT.address]);
  const replay = poseidon([domain('APP20_MAIL_ACTION_V2'), identity, request.actionId]);
  const payload = poseidon([domain('APP20_MAIL_PAYLOAD_V2'), ...action.compute_calldata]);
  const callback = [hex(replay), hex(payload), ...action.invoke_calldata.map(v => v === '${poolAddress}' ? deployment.settlement.pool : v)];
  return { app, viewing, mailbox, request, preflight, action, expected: { block: preflight.block, actionId: request.actionId, callback } };
}

async function prove(provider) {
  const ctx = await context(provider);
  if (BigInt((await provider.getStorageAt(CHAT.address, storageAddress('used_replay_slots', ctx.expected.callback[0]), 'latest')).value) !== 0n) throw Error('This message is already confirmed; use evidence mode.');
  const previous = await read('submission.json');
  if (previous) return { output: resolve(directory, 'submission.json'), ...validateChatProof(previous.submission, ctx.expected), transactionSubmitted: false, reused: true };
  const provingProvider = await ctx.app.starkscanProver({ relayUrl, poolClassHash: deployment.settlement.poolClassHash, accessToken: async () => (await readFile(resolve(homedir(), '.config/app20/prover-agent.token'), 'utf8')).trim(), journal: { runExclusive: work => exclusive('hosted-proof', work), load: key => read('proof-' + key + '.json'), save: (key, value) => save('proof-' + key + '.json', value) } }).resolve({ provider, network: 'mainnet', chainId: deployment.chainId, nodeUrl: rpc, poolAddress: deployment.settlement.pool });
  const discoveryProvider = await ctx.app.contractDiscovery().resolve({ provider, poolAddress: deployment.settlement.pool });
  const transfers = createPrivateTransfers({ account: await operator(provider), viewingKeyProvider: { getViewingKey: async () => ctx.viewing }, provingProvider, discoveryProvider, poolContractAddress: deployment.settlement.pool });
  const key = createHash('sha256').update('app20/chat-proof/invocation/v1:' + ctx.viewing.toString(16)).digest();
  let invocation;
  try {
    const sealed = await read('invocation.sealed.json');
    if (sealed) {
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'hex'));
      cipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
      invocation = JSON.parse(Buffer.concat([cipher.update(Buffer.from(sealed.ciphertext, 'hex')), cipher.final()]).toString('utf8'));
    } else {
      const builder = transfers.build({ autoRegister: false, autoSetup: false, autoSelectNotes: 'naive', autoDiscover: { channels: 'refresh', notes: 'refresh' } });
      builder.with(deployment.sellToken.address).surplusTo(OPERATOR, false).transfer({ recipient: OPERATOR, amount: 1n });
      builder.computeAndInvoke(() => ({ contractAddress: CHAT.address, computeAdditionalData: ctx.action.compute_calldata, invokeAdditionalData: ctx.expected.callback.slice(2) }));
      ({ invocation } = await builder.createProofInvocation());
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(serialize(invocation)), cipher.final()]);
      await save('invocation.sealed.json', { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('hex') });
    }
  } finally { key.fill(0); }
  const result = await transfers.executeWithInvocation({ invocation, registry: createEmptyRegistry(), warnings: [] }, { block_hash: ctx.preflight.block.hash });
  const validation = validateChatProof(result.callAndProof, ctx.expected);
  await save('submission.json', { schema: 'app20-mainnet-chat-proof/v1', mode: 'chat', generatedAt: new Date().toISOString(), ...ctx.preflight, ...validation, submission: result.callAndProof, transactionSubmitted: false });
  return { output: resolve(directory, 'submission.json'), ...validation, transactionSubmitted: false };
}

async function evidence(provider, transactionHash) {
  if (!/^0x[\da-f]+$/i.test(transactionHash ?? '')) throw Error('Receipt hash required.');
  const ctx = await context(provider, false);
  const receipt = await provider.getTransactionReceipt(transactionHash);
  if (receipt.execution_status !== 'SUCCEEDED' || !['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(receipt.finality_status)) throw Error('Successful included receipt required.');
  const events = receipt.events.filter(e => same(e.from_address, CHAT.address) && same(e.keys[0], hash.getSelectorFromName('MessagePosted')));
  if (events.length !== 1) throw Error('Exactly one Chat event required.');
  const data = events[0].data, count = Number(BigInt(data[5]));
  if (count !== ctx.request.record.ciphertextFelts.length || data.length !== count + 7 || !same(data.at(-1), ctx.request.actionId)) throw Error('Unexpected Chat event shape.');
  const record = { ephemeralPub: data.slice(0, 2), viewTag: Number(BigInt(data[2])), nonce: data.slice(3, 5), ciphertextFelts: data.slice(6, -1) };
  if (new TextDecoder().decode(await ctx.app.mail.decryptMail(ctx.mailbox.privateKey, record)) !== message) throw Error('Confirmed event did not decrypt to the expected message.');
  if (BigInt((await provider.getStorageAt(CHAT.address, storageAddress('used_replay_slots', ctx.expected.callback[0]), receipt.block_hash)).value) !== 1n) throw Error('Confirmed replay fence missing.');
  const result = { schema: 'app20-mainnet-chat-evidence/v1', verifiedAt: new Date().toISOString(), hash: transactionHash, block: receipt.block_number, finality: receipt.finality_status, chat: CHAT, actionId: ctx.request.actionId, messagePostedDecrypted: true, replaySlotConsumed: true, transactionSubmittedByThisCommand: false };
  await save('evidence.json', result); return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const { values } = parseArgs({ options: { mode: { type: 'string', default: 'check' }, transaction: { type: 'string' } } });
    if (!['check', 'prove', 'evidence'].includes(values.mode)) throw Error('Unsupported proof-only mode.');
    const provider = new RpcProvider({ nodeUrl: rpc });
    const result = await exclusive('operation', () => values.mode === 'check' ? inspectChatPrerequisites(provider) : values.mode === 'prove' ? prove(provider) : evidence(provider, values.transaction));
    console.log(serialize(result));
  } catch (error) {
    await save('last-error.json', { at: new Date().toISOString(), message: String(error?.message ?? error), stack: error?.stack });
    console.error('Chat proof rehearsal stopped without broadcasting. Inspect the protected operator journal; private prover diagnostics are not printed.');
    process.exitCode = 1;
  }
}
