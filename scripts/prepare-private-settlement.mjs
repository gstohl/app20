#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { defaultDeployer, hash, json } from 'starknet';
import { MAINNET_POOL, MAINNET_CHAIN_ID, address, strkBudget, inspectMainnet, readRpc } from './prepare-mainnet.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function deploymentCalls(bookHash, swapHash, deployer, salt = '0x1') {
  const account = address(deployer, 'deployer'); address(salt, 'salt');
  const book = defaultDeployer.buildDeployerCall({ classHash: address(bookHash, 'book class hash'), constructorCalldata: [], salt, unique: true }, account);
  const swap = defaultDeployer.buildDeployerCall({ classHash: address(swapHash, 'settlement class hash'), constructorCalldata: [MAINNET_POOL, book.addresses[0]], salt, unique: true }, account);
  return { account, bookAddress: book.addresses[0], settlementAddress: swap.addresses[0], calls: [...book.calls, ...swap.calls] };
}
export async function verifyDeployedSettlement(rpc, candidate, bookAddress, settlementAddress, fetcher = fetch) {
  const inspection = await inspectMainnet(rpc, {}, undefined, fetcher);
  const read = (method, params) => readRpc(rpc, method, params, fetcher);
  const block_id = { block_hash: inspection.block.block_hash };
  const book = address(bookAddress, 'book address'), settlement = address(settlementAddress, 'settlement address');
  for (const [contract_address, expected] of [[book, candidate.contracts.App20MakerBook.classHash], [settlement, candidate.contracts.App20PrivateSwap.classHash]]) {
    const actual = await read('starknet_getClassHashAt', { contract_address, block_id });
    if (BigInt(actual) !== BigInt(expected)) throw new Error('Deployed class does not match this build.');
  }
  const call = (contract_address, entrypoint, calldata = []) => read('starknet_call', { block_id, request: { contract_address, entry_point_selector: hash.getSelectorFromName(entrypoint), calldata } });
  const pool = await call(settlement, 'pool'), actualBook = await call(settlement, 'book');
  if (BigInt(pool[0]) !== BigInt(MAINNET_POOL) || BigInt(actualBook[0]) !== BigInt(book)) throw new Error('Settlement constructor does not match the intended pool and book.');
  const blocked = await call(MAINNET_POOL, 'is_open_note_depositor_blocked', [settlement]);
  if (blocked.length !== 1 || BigInt(blocked[0]) !== 0n) throw new Error('The pool does not currently accept output notes from this settlement contract.');
  return { ...inspection, bookAddress: book, settlementAddress: settlement };
}
export async function preparePrivateSettlement({ rpc, deployer, salt, output, maxFeeStrk, bookAddress, settlementAddress } = {}) {
  const compiler = process.env.APP20_SCARB ?? 'scarb';
  const version = execFileSync(compiler, ['--version'], { encoding: 'utf8' }).trim();
  if (!/^scarb 2\.18\.0 /m.test(version)) throw new Error('Use Scarb 2.18.0.');
  execFileSync(compiler, ['build'], { cwd: join(ROOT, 'cairo'), stdio: 'inherit' });
  const destination = resolve(output ?? join(ROOT, 'artifacts/private-settlement-mainnet'));
  await mkdir(destination, { recursive: true });
  const candidate = { format: 'app20-private-settlement-preparation/v1', status: 'prepared-not-deployed', generatedAt: new Date().toISOString(), chainId: MAINNET_CHAIN_ID, pool: MAINNET_POOL, compiler: version, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), contracts: {}, deployment: null, inspection: null, verifiedDeployment: null, maximumDeploymentFeesBaseUnits: maxFeeStrk === undefined ? null : strkBudget(maxFeeStrk) };
  for (const [name, source] of [['App20MakerBook', 'maker_book.cairo'], ['App20PrivateSwap', 'private_swap.cairo']]) {
    const base = `cairo/target/dev/app20_chat_${name}`;
    const sierraBytes = await readFile(join(ROOT, `${base}.contract_class.json`));
    const casmBytes = await readFile(join(ROOT, `${base}.compiled_contract_class.json`));
    const sierra = json.parse(sierraBytes.toString()), casm = json.parse(casmBytes.toString());
    candidate.contracts[name] = { classHash: hash.computeContractClassHash(sierra), compiledClassHash: hash.computeCompiledClassHash(casm), sourceSha256: sha256(await readFile(join(ROOT, 'cairo/src', source))), sierraSha256: sha256(sierraBytes), casmSha256: sha256(casmBytes), sierraPath: `${base}.contract_class.json`, casmPath: `${base}.compiled_contract_class.json` };
    await writeFile(join(destination, `${name}.abi.json`), JSON.stringify(sierra.abi, null, 2) + '\n');
  }
  if (deployer) candidate.deployment = deploymentCalls(candidate.contracts.App20MakerBook.classHash, candidate.contracts.App20PrivateSwap.classHash, deployer, salt);
  if (rpc) candidate.inspection = await inspectMainnet(rpc, {}, undefined);
  if (bookAddress || settlementAddress) {
    if (!rpc || !bookAddress || !settlementAddress) throw new Error('Verification requires RPC and both deployed addresses.');
    candidate.verifiedDeployment = await verifyDeployedSettlement(rpc, candidate, bookAddress, settlementAddress);
    candidate.status = 'deployment-verified';
  }
  candidate.nextSteps = candidate.verifiedDeployment ? ['Configure frontend and maker with verified deployment and token metadata', 'Real-wallet mainnet rehearsal and operator funding'] : ['Supply public deployer and fee budget if absent', 'Declare both exact classes with your signing wallet', 'Execute the two UDC calls in deployment order', 'Verify both deployed classes, constructors and pool output-note policy', 'Configure frontend and maker, then perform a real-wallet rehearsal'];
  await writeFile(join(destination, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
  console.log(`Prepared private settlement: ${join(destination, 'candidate.json')}`);
  console.log('No signing key loaded, no transaction submitted, no runtime address activated.');
  return candidate;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { rpc: { type: 'string' }, deployer: { type: 'string' }, salt: { type: 'string' }, output: { type: 'string' }, 'max-fee-strk': { type: 'string' }, 'book-address': { type: 'string' }, 'settlement-address': { type: 'string' } } });
    await preparePrivateSettlement({ ...values, maxFeeStrk: values['max-fee-strk'], bookAddress: values['book-address'], settlementAddress: values['settlement-address'] });
  } catch (error) { console.error(`Settlement preparation failed: ${error.message}`); process.exitCode = 1; }
}
