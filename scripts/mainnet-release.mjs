// Explicit mainnet declaration/deployment with pinned artifacts and a durable fee journal.
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { scryptSync, createDecipheriv, timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { Account, RpcProvider, hash, CallData, ec, json, defaultDeployer } from 'starknet';
import { MAINNET_DEPLOYMENT } from '../src/lib/mainnet-deployment.ts';
import { CONFIDENTIAL_RFQ_CONTRACT } from '../src/lib/confidential-rfq-deployment.ts';
import { normalizeConfidentialAgreement, confidentialConstructor } from '../packages/agent-sdk/dist/confidential.js';

const stage = process.argv[2] ?? 'check';
if (!['check', 'declare-chat', 'declare-confidential', 'deploy-chat', 'register-chat-key', 'deploy-recipient', 'deploy-confidential', 'submit-proof', 'reconcile'].includes(stage)) throw Error('Unknown release stage.');
if (stage !== 'check' && stage !== 'reconcile' && !process.argv.includes('--execute')) throw Error('Submission requires --execute.');
const root = resolve(import.meta.dirname, '..');
const directory = resolve(homedir(), '.config/app20/mainnet-release');
const deployerDirectory = resolve(homedir(), '.config/app20/mainnet-deployer');
const accountAddress = '0x2baf5bf273ff0ecf729e1b9d455889a2dfbc831c944e48a124367295d2d6bc3';
const chainId = MAINNET_DEPLOYMENT.chainId;
const gasLimit = 30n * 10n ** 18n;
// User authorized additional release spend on September 8. Keep individual runs bounded.
const releaseBudget = 100n * 10n ** 18n;
const provider = new RpcProvider({ nodeUrl: 'https://starknet-rpc.publicnode.com', resourceBoundsOverhead: { l1_gas: { max_amount: 20, max_price_per_unit: 20 }, l2_gas: { max_amount: 20, max_price_per_unit: 20 }, l1_data_gas: { max_amount: 20, max_price_per_unit: 20 } } });
const candidates = {
  chat: { name: 'App20Chat', classHash: '0x2e6fd0b464b0a7a1c8793b5d18609609e167af5ce7916e28821af34b5de4b12', compiledClassHash: '0x569f9283589005a6de489b1ffebd88c1575552920678f595c1f0899f56637e1' },
  confidential: { name: 'App20ConfidentialEscrow', ...CONFIDENTIAL_RFQ_CONTRACT },
};
const same = (a, b) => BigInt(a) === BigInt(b);
const serialize = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
await mkdir(directory, { recursive: true, mode: 0o700 });
async function read(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function save(name, value) {
  const path = resolve(directory, name), temporary = path + '.' + crypto.randomUUID() + '.next';
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(serialize(value)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
}
async function artifact(candidate) {
  const prefix = resolve(root, 'cairo/target/dev/app20_chat_' + candidate.name);
  const contract = json.parse(await readFile(prefix + '.contract_class.json', 'utf8'));
  const casm = json.parse(await readFile(prefix + '.compiled_contract_class.json', 'utf8'));
  if (!same(hash.computeContractClassHash(contract), candidate.classHash) || !same(hash.computeCompiledClassHash(casm), candidate.compiledClassHash)) throw Error('Built contract identity changed.');
  return { contract, casm, classHash: candidate.classHash, compiledClassHash: candidate.compiledClassHash };
}
async function declared(classHash) {
  try { await provider.getClassByHash(classHash); return true; }
  catch (error) { if (error.code === 28 || error.baseError?.code === 28) return false; throw error; }
}
const lock = await open(resolve(directory, 'operation.lock'), 'wx', 0o600);
try {
  if (!same(await provider.getChainId(), chainId) || !same(await provider.getClassHashAt(MAINNET_DEPLOYMENT.settlement.pool), MAINNET_DEPLOYMENT.settlement.poolClassHash)) throw Error('Unexpected network or pool identity.');
  for (const file of [resolve(deployerDirectory, 'deployment-ledger.json'), resolve(homedir(), '.config/app20/mainnet-demo/ledger.json')]) if ((await read(file)).pending) throw Error('Reconcile the existing account operation first.');
  let ledger;
  try { ledger = await read(resolve(directory, 'ledger.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  ledger ??= { schema: 'app20/mainnet-release/v1', accountAddress, chainId, maximumFees: releaseBudget.toString(), transactions: [], pending: null };
  if (!same(ledger.accountAddress, accountAddress) || !same(ledger.chainId, chainId) || BigInt(ledger.maximumFees) !== releaseBudget) throw Error('Release journal scope changed.');
  async function reconcile() {
    if (!ledger.pending) return;
    if (!ledger.pending.hash) throw Error('Unknown submission outcome; inspect the account nonce and transaction history before repairing this journal.');
    const receipt = await provider.waitForTransaction(ledger.pending.hash, { retryInterval: 3000 });
    const success = receipt.isSuccess();
    ledger.transactions.push({ ...ledger.pending, actualFee: receipt.actual_fee.amount, poolFee: success ? (ledger.pending.poolFee ?? '0') : '0', publicDeposit: success ? (ledger.pending.publicDeposit ?? '0') : '0', block: receipt.block_number, success });
    ledger.pending = null; await save('ledger.json', ledger);
    console.log(serialize({ confirmed: receipt.transaction_hash, success, fee: receipt.actual_fee.amount }).trim());
    if (!success) throw Error('Release transaction reverted.');
  }
  if (stage === 'reconcile') { await reconcile(); }
  else {
    if (ledger.pending) throw Error('Reconcile pending release transaction before another stage.');
    const rawBalance = await provider.callContract({ contractAddress: MAINNET_DEPLOYMENT.sellToken.address, entrypoint: 'balance_of', calldata: [accountAddress] });
    const balance = BigInt(rawBalance[0]) + (BigInt(rawBalance[1]) << 128n);
    const status = { chainId, accountAddress, balance: balance.toString(), chatDeclared: await declared(candidates.chat.classHash), confidentialDeclared: await declared(candidates.confidential.classHash) };
    console.log(serialize(status).trim());
    if (stage !== 'check') {
      let candidate = stage.includes('confidential') ? candidates.confidential : candidates.chat;
      let deployment = defaultDeployer.buildDeployerCall({ classHash: candidates.chat.classHash, constructorCalldata: [MAINNET_DEPLOYMENT.settlement.pool], salt: '0x1', unique: true }, accountAddress);
      let registration;
      if(stage==='register-chat-key') {
        const chatAddress=deployment.addresses[0];
        if(!same(await provider.getClassHashAt(chatAddress),candidates.chat.classHash))throw Error('Chat contract identity changed.');
        const {build}=await import('esbuild'),output=resolve(root,'.e2e-build/mainnet-release-mail.mjs');
        await build({entryPoints:[resolve(root,'src/lib/mail.ts')],bundle:true,packages:'external',platform:'node',format:'esm',target:'node24',outfile:output,logLevel:'silent'});
        const mail=await import(pathToFileURL(output).href);
        const viewing=BigInt((await read(resolve(homedir(),'.config/app20/mainnet-demo/viewing-key.json'))).key);
        const seed=createHash('sha256').update('app20/mainnet-proof/chat-key/v1:'+viewing.toString(16)).digest();
        const mailbox=mail.deriveKeypair(seed);seed.fill(0);
        const publicKey=mail.publicKeyToFelts(mailbox.publicKey);mailbox.privateKey.fill(0);
        const stored=await provider.callContract({contractAddress:chatAddress,entrypoint:'get_pubkey',calldata:[accountAddress]});
        if(stored.length!==2||stored.some(v=>BigInt(v)!==0n))throw Error(stored.every((v,i)=>same(v,publicKey[i]))?'Chat key is already registered; no transaction is needed.':'A different Chat key is already registered; preserve it.');
        registration={contractAddress:chatAddress,entrypoint:'register_pubkey',calldata:publicKey};
      }
      if (stage === 'deploy-recipient' || stage === 'deploy-confidential') {
        const privateDirectory = resolve(homedir(), '.config/app20/mainnet-confidential');
        const plan = await read(resolve(privateDirectory, 'deployment-plan.json'));
        if (plan.schema !== 'app20-confidential-deployment-plan/v1' || !same(plan.chainId, chainId) || !same(plan.deployer, accountAddress)) throw Error('Deployment plan scope changed.');
        const part = stage === 'deploy-recipient' ? plan.recipientWallet : plan.escrow;
        let constructorCalldata;
        if (stage === 'deploy-recipient') {
          const owner = await read(resolve(deployerDirectory, 'account.json'));
          if (!same(part.classHash, owner.deployment.class_hash)) throw Error('Unexpected recipient account class.');
          candidate = { classHash: part.classHash };
          constructorCalldata = [part.publicKey];
        } else {
          const agreement = normalizeConfidentialAgreement(await read(resolve(privateDirectory, 'agreement.json')));
          if (!same(agreement.address, part.address) || !same(agreement.chainId, chainId) || !same(agreement.pool, MAINNET_DEPLOYMENT.settlement.pool) || !same(agreement.poolClassHash, MAINNET_DEPLOYMENT.settlement.poolClassHash) || !same(agreement.escrowClassHash, candidates.confidential.classHash) || !same(agreement.terms.partyA, accountAddress) || !same(agreement.terms.partyB, plan.recipientWallet.address)) throw Error('Escrow agreement scope changed.');
          if (agreement.deadline <= Date.now() / 1000 + 3600) throw Error('Escrow deadline is too close for validation.');
          constructorCalldata = confidentialConstructor(agreement);
        }
        if (!same(part.classHash, candidate.classHash)) throw Error('Deployment class differs from the pin.');
        deployment = defaultDeployer.buildDeployerCall({ classHash: candidate.classHash, constructorCalldata, salt: part.salt, unique: true }, accountAddress);
        if (!same(deployment.addresses[0], part.address)) throw Error('Predicted deployment address changed.');
      }
      const payload = stage.startsWith('declare-') ? await artifact(candidate) : undefined;
      let proofSubmission, protocolFee = 0n, publicDeposit = 0n, feeApproval;
      if (stage === 'submit-proof') {
        const option = process.argv.indexOf('--proof-file');
        if (option < 0 || !process.argv[option + 1]) throw Error('An explicit --proof-file is required.');
        const record = await read(resolve(process.argv[option + 1]));
        const plan = await read(resolve(homedir(), '.config/app20/mainnet-confidential/deployment-plan.json'));
        const { validateMainnetProof } = await import('./mainnet-proof-policy.mjs');
        proofSubmission = validateMainnetProof({ record, stage: record.mode, recipient: plan.recipientWallet.address, escrow: plan.escrow.address, chatAddress: deployment.addresses[0] });
        // Only validated shielding inputs consume public principal. Keep that
        // principal separate from protocol/gas fees and the release fee budget.
        const publicInputs = proofSubmission.publicInputs;
        if (!Array.isArray(publicInputs) || publicInputs.length !== (proofSubmission.mode === 'shield' ? 1 : 0)) throw Error('Unexpected public proof inputs.');
        for (const input of publicInputs) {
          if (!same(input.owner, accountAddress) || !same(input.token, MAINNET_DEPLOYMENT.sellToken.address) || typeof input.amount !== 'string' || !/^\d+$/.test(input.amount) || BigInt(input.amount) <= 0n || BigInt(input.amount) >= 2n ** 128n) throw Error('Public deposit owner, token or amount differs from the validated STRK shielding input.');
          publicDeposit += BigInt(input.amount);
        }
        if (ledger.transactions.some(tx => tx.proofId === proofSubmission.proofId && tx.success)) throw Error('This proof has already been submitted successfully.');
        const facts = proofSubmission.proof.proofFacts;
        const [block, validity, fee] = await Promise.all([
          provider.getBlockWithTxHashes(facts[5]),
          provider.callContract({ contractAddress: MAINNET_DEPLOYMENT.settlement.pool, entrypoint: 'get_proof_validity_blocks', calldata: [] }),
          provider.callContract({ contractAddress: MAINNET_DEPLOYMENT.settlement.pool, entrypoint: 'get_fee_amount', calldata: [] }),
        ]);
        if (!('block_number' in block) || !same(block.block_number, facts[4]) || validity.length !== 1 || fee.length !== 1 || BigInt(await provider.getBlockNumber()) > BigInt(block.block_number) + BigInt(validity[0])) throw Error('Proof is expired or the referenced block does not match.');
        protocolFee = BigInt(fee[0]);
        if (protocolFee < 0n || protocolFee > 6n * 10n ** 18n) throw Error('Pool application fee exceeds the reviewed ceiling.');
        const allowance = await provider.callContract({ contractAddress: MAINNET_DEPLOYMENT.sellToken.address, entrypoint: 'allowance', calldata: [accountAddress, MAINNET_DEPLOYMENT.settlement.pool] });
        if (allowance.length !== 2) throw Error('Invalid pool fee allowance.');
        const requiredAllowance = protocolFee + publicDeposit;
        if (BigInt(allowance[0]) + (BigInt(allowance[1]) << 128n) < requiredAllowance) feeApproval = { contractAddress: MAINNET_DEPLOYMENT.sellToken.address, entrypoint: 'approve', calldata: [MAINNET_DEPLOYMENT.settlement.pool, (requiredAllowance % (2n ** 128n)).toString(), (requiredAllowance >> 128n).toString()] };
        candidate = { classHash: MAINNET_DEPLOYMENT.settlement.poolClassHash };
      }
      if (stage.startsWith('declare-') && await declared(candidate.classHash)) throw Error('Class already declared; no duplicate transaction required.');
      if (stage.startsWith('deploy-')) {
        try { await provider.getClassHashAt(deployment.addresses[0]); throw Error('Chat address is already deployed; verify instead of repeating deployment.'); }
        catch (error) { if (error.code !== 20 && error.baseError?.code !== 20) throw error; }
      }
      const config = await read(resolve(deployerDirectory, 'account.json'));
      const ks = (await read(resolve(deployerDirectory, 'keystore.json'))).crypto;
      const password = (await readFile(resolve(deployerDirectory, 'keystore.password'), 'utf8')).trim();
      const derived = scryptSync(password, Buffer.from(ks.kdfparams.salt, 'hex'), ks.kdfparams.dklen, { N: ks.kdfparams.n, r: ks.kdfparams.r, p: ks.kdfparams.p });
      const ciphertext = Buffer.from(ks.ciphertext, 'hex');
      if (!timingSafeEqual(Buffer.from(keccak_256(Buffer.concat([derived.subarray(16, 32), ciphertext]))), Buffer.from(ks.mac, 'hex'))) throw Error('Keystore authentication failed.');
      const cipher = createDecipheriv(ks.cipher, derived.subarray(0, 16), Buffer.from(ks.cipherparams.iv, 'hex'));
      const secret = Buffer.concat([cipher.update(ciphertext), cipher.final()]);
      const key = '0x' + secret.toString('hex');
      if (!same(ec.starkCurve.getStarkKey(key), config.variant.public_key) || !same(hash.calculateContractAddressFromHash(config.deployment.salt, config.deployment.class_hash, CallData.compile({ publicKey: config.variant.public_key }), 0), accountAddress) || !same(await provider.getClassHashAt(accountAddress), config.deployment.class_hash)) throw Error('Deployer identity mismatch.');
      const account = new Account({ provider, address: accountAddress, signer: key, cairoVersion: '1' });
      secret.fill(0); derived.fill(0);
      const nonce = await provider.getNonceForAddress(accountAddress);
      if (!same(await provider.getNonceForAddress(accountAddress, 'pre_confirmed'), nonce)) throw Error('The account has an unconfirmed operation.');
      const details = { nonce, tip: 0n, skipValidate: false, ...(proofSubmission ? { version: '0x3', proof: proofSubmission.proof.data, proofFacts: proofSubmission.proof.proofFacts } : {}) };
      const calls = proofSubmission ? [...(feeApproval ? [feeApproval] : []), proofSubmission.call] : registration ? [registration] : deployment.calls;
      const estimate = stage.startsWith('declare-') ? await account.estimateDeclareFee(payload, details) : await account.estimateInvokeFee(calls, proofSubmission ? { ...details, skipValidate: true } : details);
      const bounds = estimate.resourceBounds;
      const maximum = Object.values(bounds).reduce((sum, b) => sum + BigInt(b.max_amount) * BigInt(b.max_price_per_unit), 0n);
      const spent = ledger.transactions.reduce((sum, tx) => sum + BigInt(tx.actualFee) + BigInt(tx.poolFee ?? 0), 0n);
      if (maximum <= 0n || maximum > gasLimit || spent + maximum + protocolFee > releaseBudget) throw Error('Fee estimate exceeds the release or per-transaction fee limit.');
      if (maximum + protocolFee + publicDeposit > balance) throw Error('Account balance cannot cover gas, the pool fee and the public shielding deposit.');
      if (proofSubmission) {
        // Fee discovery has zero bounds, which are rewritten by estimation. Validate
        // the actual bounded signature and execution before recording any submission.
        const simulated = await account.simulateTransaction([{ type: 'INVOKE', payload: calls }], { ...details, resourceBounds: bounds, skipValidate: false, skipExecute: false });
        const results = simulated.simulated_transactions;
        if (!Array.isArray(results) || results.length !== 1 || !results[0].transaction_trace?.validate_invocation || !results[0].transaction_trace?.execute_invocation || results[0].transaction_trace.execute_invocation.revert_reason) throw Error('Bounded proof transaction did not pass account validation and execution.');
        const validity = await provider.callContract({ contractAddress: MAINNET_DEPLOYMENT.settlement.pool, entrypoint: 'get_proof_validity_blocks', calldata: [] });
        if (validity.length !== 1 || BigInt(await provider.getBlockNumber()) > BigInt(proofSubmission.baseBlock.number) + BigInt(validity[0])) throw Error('Proof expired during transaction validation.');
      }
      if (!same(await provider.getNonceForAddress(accountAddress), nonce)) throw Error('Account nonce changed during preparation.');
      ledger.pending = { stage, nonce, classHash: candidate.classHash, ...(stage.startsWith('deploy-') ? { address: deployment.addresses[0] } : {}), ...(proofSubmission ? { mode: proofSubmission.mode, proofId: proofSubmission.proofId } : {}), maximumFee: maximum.toString(), poolFee: protocolFee.toString(), publicDeposit: publicDeposit.toString(), hash: null };
      await save('ledger.json', ledger);
      console.log(serialize({ submitting: stage, maximumFee: maximum.toString(), poolFee: protocolFee.toString(), publicDeposit: publicDeposit.toString(), classHash: candidate.classHash }).trim());
      const tx = stage.startsWith('declare-') ? await account.declare(payload, { ...details, resourceBounds: bounds }) : await account.execute(calls, { ...details, resourceBounds: bounds });
      ledger.pending.hash = tx.transaction_hash; await save('ledger.json', ledger);
      console.log(serialize({ submitted: tx.transaction_hash }).trim());
      await reconcile();
      if (stage.startsWith('declare-') && !await declared(candidate.classHash)) throw Error('Declared class could not be read back.');
      if (stage.startsWith('deploy-') && !same(await provider.getClassHashAt(deployment.addresses[0]), candidate.classHash)) throw Error('Deployed class differs.');
      if(registration){const stored=await provider.callContract({contractAddress:registration.contractAddress,entrypoint:'get_pubkey',calldata:[accountAddress]});if(stored.length!==2||stored.some((v,i)=>!same(v,registration.calldata[i])))throw Error('Confirmed Chat key differs from the expected public key.');}
    }
  }
} catch (error) {
  await save('last-error.json', { stage, at: new Date().toISOString(), name: error.name, code: error.code, message: error.message });
  console.error('Stopped; protected diagnostic saved in ~/.config/app20/mainnet-release/last-error.json. Inspect before retrying.');
  process.exitCode = 1;
} finally { await lock.close(); await unlink(resolve(directory, 'operation.lock')); }
