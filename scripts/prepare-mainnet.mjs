#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { constants, defaultDeployer, hash, json } from 'starknet';

export const MAINNET_POOL = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a';
export const MAINNET_CHAIN_ID = '0x534e5f4d41494e';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const READ_METHODS = new Set(['starknet_chainId', 'starknet_blockHashAndNumber', 'starknet_getClassHashAt', 'starknet_getStorageAt', 'starknet_call']);

export function strkBudget(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) throw new Error('Fee budget must be a positive STRK decimal with at most 18 places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (amount <= 0n) throw new Error('Fee budget must be positive.');
  return amount.toString();
}

export function address(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value) || BigInt(value) <= 0n || BigInt(value) >= (1n << 251n) - 256n) throw new Error(`Invalid ${label}.`);
  return `0x${BigInt(value).toString(16)}`;
}

/** Deliberately cannot submit transactions or accept signer secrets. */
export async function readRpc(url, method, params, fetcher = fetch) {
  if (!READ_METHODS.has(method)) throw new Error('Only read-only RPC methods are allowed.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Use an HTTPS RPC URL without embedded credentials.');
  const response = await fetcher(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const result = await response.json();
  if (result.error || result.result === undefined) throw new Error(`${method}: RPC did not return a successful result.`);
  return result.result;
}

export async function inspectMainnet(rpc, candidate, deployedAddress, fetcher = fetch) {
  const read = (method, params) => readRpc(rpc, method, params, fetcher);
  const chainId = await read('starknet_chainId', []);
  if (BigInt(chainId) !== BigInt(MAINNET_CHAIN_ID)) throw new Error('RPC is not Starknet mainnet.');
  const block = await read('starknet_blockHashAndNumber', []);
  if (!Number.isSafeInteger(block.block_number) || block.block_number < 0 || !/^0x[0-9a-fA-F]+$/.test(block.block_hash)) throw new Error('RPC returned an invalid block.');
  const block_id = { block_hash: block.block_hash };
  const poolClassHash = await read('starknet_getClassHashAt', { block_id, contract_address: MAINNET_POOL });
  address(poolClassHash, 'pool class hash');
  const fee = await read('starknet_call', { block_id, request: { contract_address: MAINNET_POOL, entry_point_selector: hash.getSelectorFromName('get_fee_amount'), calldata: [] } });
  if (!Array.isArray(fee) || fee.length !== 1 || !/^0x[0-9a-fA-F]+$/.test(fee[0])) throw new Error('Invalid live pool fee.');
  const result = { rpcOrigin: new URL(rpc).origin, chainId, block, poolClassHash, poolFeeBaseUnits: BigInt(fee[0]).toString(), deployment: null };
  if (deployedAddress) {
    const contract_address = address(deployedAddress, 'Chat address');
    const actual = await read('starknet_getClassHashAt', { block_id, contract_address });
    if (BigInt(actual) !== BigInt(candidate.classHash)) throw new Error('Deployed Chat class does not match the built candidate.');
    const pool = await read('starknet_getStorageAt', { block_id, contract_address, key: hash.getSelectorFromName('pool') });
    if (BigInt(pool) !== BigInt(MAINNET_POOL)) throw new Error('Deployed Chat constructor does not pin the mainnet pool.');
    result.deployment = { address: contract_address, classHash: actual, poolAddress: pool };
  }
  return result;
}

export async function prepare({ root = ROOT, output, rpc, deployer, salt = '0x1', deployedAddress, maxFeeStrk } = {}) {
  const scarb = process.env.APP20_SCARB ?? 'scarb';
  const compilerVersion = execFileSync(scarb, ['--version'], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^scarb 2\.18\.0 /m.test(compilerVersion)) throw new Error('Mainnet preparation requires Scarb 2.18.0.');
  execFileSync(scarb, ['build'], { cwd: join(root, 'cairo'), stdio: 'inherit' });
  const base = 'cairo/target/dev/app20_chat_App20Chat';
  const sierraPath = `${base}.contract_class.json`, casmPath = `${base}.compiled_contract_class.json`;
  const [sierraBytes, casmBytes, source] = await Promise.all([readFile(join(root, sierraPath)), readFile(join(root, casmPath)), readFile(join(root, 'cairo/src/lib.cairo'))]);
  const sierra = json.parse(sierraBytes.toString()), casm = json.parse(casmBytes.toString());
  const candidate = {
    format: 'app20-mainnet-preparation/v1', generatedAt: new Date().toISOString(),
    status: 'prepared-not-deployed', releaseReady: false, network: 'SN_MAIN', contract: 'App20Chat',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim()),
    compilerVersion, sourceSha256: sha256(source), classHash: hash.computeContractClassHash(sierra), compiledClassHash: hash.computeCompiledClassHash(casm),
    artifacts: { sierraPath, sierraSha256: sha256(sierraBytes), casmPath, casmSha256: sha256(casmBytes), abiSha256: sha256(JSON.stringify(sierra.abi)) },
    constructorCalldata: [MAINNET_POOL],
    deploymentPlan: null, chainInspection: null,
    maximumTotalFeesBaseUnits: maxFeeStrk === undefined ? null : strkBudget(maxFeeStrk),
    remaining: ['Real-wallet message-only invocation rehearsal', 'Deployer wallet and exact fee budget', 'Mainnet declaration and deployment', 'Verify deployed class and pinned pool', 'Activate reviewed Chat address in runtime policy', 'Public frontend deployment and real-wallet browser check', 'Three successful pool transactions and three-minute video'],
  };
  if (deployer) {
    const account = address(deployer, 'deployer');
    address(salt, 'deployment salt');
    candidate.deploymentPlan = { account, udcAddress: constants.UDC.ADDRESS, salt, ...defaultDeployer.buildDeployerCall({ classHash: candidate.classHash, constructorCalldata: candidate.constructorCalldata, salt, unique: true }, account) };
  }
  if (deployedAddress && !rpc) throw new Error('Deployment verification requires --rpc.');
  if (rpc) candidate.chainInspection = await inspectMainnet(rpc, candidate, deployedAddress);
  const destination = resolve(output ?? join(root, 'artifacts/mainnet-preparation'));
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
  await writeFile(join(destination, 'App20Chat.abi.json'), JSON.stringify(sierra.abi, null, 2) + '\n');
  console.log(`Prepared App20Chat candidate: ${join(destination, 'candidate.json')}`);
  console.log(`Class hash: ${candidate.classHash}`);
  console.log('No transaction signed or submitted. No runtime address activated.');
  return candidate;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { output: { type: 'string' }, rpc: { type: 'string' }, deployer: { type: 'string' }, salt: { type: 'string' }, 'verify-deployment': { type: 'string' }, 'max-fee-strk': { type: 'string' } } });
    await prepare({ ...values, deployedAddress: values['verify-deployment'], maxFeeStrk: values['max-fee-strk'] });
  } catch (error) { console.error(`Mainnet preparation failed: ${error.message}`); process.exitCode = 1; }
}
