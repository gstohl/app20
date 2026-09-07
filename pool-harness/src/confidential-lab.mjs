// Disposable controlled accounts only. Shared by the SDK integration test and development UI.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Account, Contract, constants, ec, json, OutsideExecutionVersion } from 'starknet';
import { CorePrivateTransfersProver, passphraseViewingKeyProvider } from '@starkware-libs/starknet-privacy-client';
import { createEmptyRegistry, createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';
import { ContractDiscoveryProvider, Devnet, ScreeningCallMockProofProvider, createDevnetTestEnv } from '@starkware-libs/starknet-privacy-sdk/testing';

const ROOT = resolve(import.meta.dirname, '../..');
const random = () => `0x${randomBytes(31).toString('hex')}`;
const TX_DETAILS = { tip: 0n, resourceBounds: Object.fromEntries(['l1_gas', 'l2_gas', 'l1_data_gas'].map(name => [name, { max_amount: 10000000000n, max_price_per_unit: 1n }])) };
export async function createConfidentialLab({ mainnetClass = false, build = true } = {}) {
  if (build) {
    execFileSync(join(ROOT, 'vendor/bin/app20-scarb'), ['build'], { cwd: join(ROOT, 'cairo'), stdio: 'inherit' });
    execFileSync(process.execPath, ['packages/agent-sdk/build.mjs'], { cwd: ROOT, stdio: 'inherit' });
  }
  const sdk = await import('../../packages/agent-sdk/dist/confidential.js');
  const devnet = new Devnet(), directory = await mkdtemp(join(tmpdir(), 'app20-confidential-lab-'));
  const close = async () => { await devnet.cleanup(); await rm(directory, { recursive: true, force: true }); };
  try {
    const { env } = await createDevnetTestEnv(devnet);
    assert(['localhost', '127.0.0.1'].includes(new URL(devnet.url).hostname));
    async function rpc(method, params = {}) {
      const response = await fetch(devnet.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const body = await response.json(); assert(!body.error, 'Devnet control call failed.'); return body.result;
    }
    async function mature() { for (let i = 0; i < 12; i++) await rpc('devnet_createBlock'); }
    async function success(tx) { const receipt = await env.node.waitForTransaction(tx.transaction_hash); assert(receipt.isSuccess(), String(receipt.revert_reason)); return receipt; }
    // This unwrapped account reads its nonce from the chain after relayed calls.
    const deployer = new Account({ provider: env.node, address: env.admin.address, signer: env.admin.signer, cairoVersion: '1' });
    if (mainnetClass) {
      const base = join(ROOT, 'artifacts/confidential-rfq');
      const sierra = json.parse(await readFile(join(base, 'mainnet-pool.sierra.json'), 'utf8'));
      if (typeof sierra.abi === 'string') sierra.abi = JSON.parse(sierra.abi);
      const declared = await deployer.declare({ contract: sierra, casm: json.parse(await readFile(join(base, 'mainnet-pool.casm.json'), 'utf8')) }, TX_DETAILS); await success(declared);
      const deployed = await deployer.deployContract({ classHash: declared.class_hash, constructorCalldata: [deployer.address, '1', ec.starkCurve.getStarkKey('0xCAFEBABE'), '450'] }, TX_DETAILS); await success(deployed);
      env.privacy = new Contract({ abi: sierra.abi, address: deployed.contract_address ?? deployed.address, providerOrAccount: deployer });
    }
    const poolClassHash = await env.node.getClassHashAt(env.privacy.address);
    const base = join(ROOT, 'cairo/target/dev/app20_chat_App20ConfidentialEscrow');
    const declared = await deployer.declare({ contract: json.parse(await readFile(base + '.contract_class.json', 'utf8')), casm: json.parse(await readFile(base + '.compiled_contract_class.json', 'utf8')) }, TX_DETAILS); await success(declared);
    assert.equal(BigInt(declared.class_hash), BigInt(sdk.confidentialContract.classHash), 'SDK pins the built contract');
    const proving = new ScreeningCallMockProofProvider(env.node, constants.StarknetChainId.SN_SEPOLIA);
    const chainId = await env.node.getChainId();
    async function submit(submission) {
      const block = await env.node.getBlock('latest');
      const outside = await deployer.getOutsideTransaction({ caller: deployer.address, execute_after: block.timestamp - 3600, execute_before: block.timestamp + 3600 }, [submission.call], OutsideExecutionVersion.V2);
      return deployer.executeFromOutside(outside, { ...TX_DETAILS, proofFacts: submission.proof.proofFacts });
    }
    const wallet = account => {
      let registry = createEmptyRegistry();
      const passphrase = `local-confidential-demo-${account.address}`;
      const discovery = new ContractDiscoveryProvider(env.privacy);
      const prover = new CorePrivateTransfersProver({ signer: account.signer, address: account.address, passphrase, node: env.node, discovery, prover: proving, poolContractAddress: env.privacy.address, shadowAccountAnonymizerAddress: '0x1', storage: { loadRegistry: async () => registry, saveRegistry: async next => { registry = next; } } });
      const build = prover.transfers.build.bind(prover.transfers);
      prover.transfers.build = (...args) => build(...args).surplusTo(account.address, false);
      const transfers = createPrivateTransfers({ account, viewingKeyProvider: passphraseViewingKeyProvider(passphrase, account.address), provingProvider: proving, discoveryProvider: discovery, poolContractAddress: env.privacy.address });
      return { prover, transfers };
    };
    const alice = wallet(env.alice), bob = wallet(env.bob);
    async function privateAction(owner, action) {
      const p = await owner.prover.prove([action]);
      await mature();
      return submit({ call: { contractAddress: p.call.contract_address, entrypoint: p.call.entry_point, calldata: p.call.calldata }, proof: { ...p.proof, proofFacts: p.proof.proof_facts } });
    }
    for (const [owner, account, token] of [[alice, env.alice, env.strk], [bob, env.bob, env.eth]]) {
      await success(await account.execute({ contractAddress: token, entrypoint: 'approve', calldata: [env.privacy.address, '100000000000000000000', '0'] }, TX_DETAILS));
      await success(await privateAction(owner, { type: 'deposit', token, amount: '100000000000000000000' }));
      await mature();
    }
    const sessions = new Map();
    async function create({ amountA = '1234', amountB = '2345', lifetime = 3600 } = {}) {
      if (!/^\d+$/.test(amountA) || !/^\d+$/.test(amountB) || BigInt(amountA) > 10000000000000000000n || BigInt(amountB) > 10000000000000000000n || !Number.isInteger(lifetime) || lifetime < 60 || lifetime > 86400) throw new Error('Invalid local demo terms.');
      const keys = { a: random(), b: random() }, viewingKey = BigInt(random());
      const input = { chainId, pool: env.privacy.address, poolClassHash, escrowClassHash: declared.class_hash, signerA: ec.starkCurve.getStarkKey(keys.a), signerB: ec.starkCurve.getStarkKey(keys.b), deadline: (await env.node.getBlock('latest')).timestamp + lifetime, terms: { tokenA: env.strk, tokenB: env.eth, amountA, amountB, partyA: env.alice.address, partyB: env.bob.address, salt: random() } };
      const proposal = sdk.createConfidentialAgreement(input);
      const deployed = await deployer.deployContract({ classHash: declared.class_hash, constructorCalldata: sdk.confidentialConstructor(proposal) }, TX_DETAILS); await success(deployed); await mature();
      const agreement = sdk.createConfidentialAgreement({ ...input, address: deployed.contract_address ?? deployed.address });
      const journal = await sdk.createConfidentialJournal(join(directory, agreement.address));
      const options = { agreement, provider: env.node, viewingKeyProvider: { getViewingKey: async () => viewingKey }, proofProvider: proving, journal, submit, simulatedProofs: true, discovery: { resolve: async () => new ContractDiscoveryProvider(env.privacy) } };
      const session = { agreement, client: await sdk.createConfidentialClient(options), hashes: [], async reopen() { this.client = await sdk.createConfidentialClient(options); },
        async approve(prepared, role) { return this.client.approve(prepared, role, async digest => { const s = ec.starkCurve.sign(digest, keys[role]); return [String(s.r), String(s.s)]; }); },
        async operation(mode) { const prepared = await this.client.prepare(mode); const approvals = []; for (const role of sdk.confidentialRequiredSigners(mode)) approvals.push(await this.approve(prepared, role)); const hash = await this.client.execute(prepared, approvals); this.hashes.push({ action: mode, hash }); await mature(); return hash; },
        async fund(role) { const hash = await this.client.fund(role, payment => privateAction(role === 'a' ? alice : bob, { type: 'transfer', ...payment })); this.hashes.push({ action: 'fund' + role.toUpperCase(), hash }); await mature(); return hash; },
        async expire() { await rpc('devnet_setTime', { time: agreement.deadline + 1 }); await mature(); },
        async view() { return { id: agreement.address, amountA, amountB, tokenA: 'STRK', tokenB: 'ETH', deadline: agreement.deadline, ...(await this.client.inspect()), hashes: [...this.hashes] }; },
      };
      sessions.set(agreement.address, session); return session;
    }
    async function balances() {
      return Promise.all([alice, bob].map(async owner => {
        const found = await owner.transfers.discoverNotes({ tokens: [BigInt(env.strk), BigInt(env.eth)] });
        return [env.strk, env.eth].map(token => [...found.notes.entries()].filter(([key]) => BigInt(key) === BigInt(token)).flatMap(([, notes]) => notes).reduce((sum, note) => sum + note.amount, 0n).toString());
      }));
    }
    return { create, close, sessions, balances, chainId, poolClassHash, journalDirectory: directory };
  } catch (error) { await close(); throw error; }
}
