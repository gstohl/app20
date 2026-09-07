// Builds and verifies reviewed pins; deliberately never rewrites them.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hash, json } from 'starknet';
import { CONFIDENTIAL_RFQ_CONTRACT } from '../src/lib/confidential-rfq-deployment.ts';
const root = resolve(import.meta.dirname, '..');
execFileSync(resolve(root, 'vendor/bin/app20-scarb'), ['build'], { cwd: resolve(root, 'cairo'), stdio: 'inherit' });
const base = resolve(root, 'cairo/target/dev/app20_chat_App20ConfidentialEscrow');
const actual = {
  classHash: hash.computeSierraContractClassHash(json.parse(await readFile(base + '.contract_class.json', 'utf8'))),
  compiledClassHash: hash.computeCompiledClassHash(json.parse(await readFile(base + '.compiled_contract_class.json', 'utf8'))),
};
for (const key of Object.keys(actual)) if (BigInt(actual[key]) !== BigInt(CONFIDENTIAL_RFQ_CONTRACT[key])) throw new Error(`${key} changed. Review the Cairo changes before updating confidential-rfq-deployment.ts.`);
console.log('Confidential escrow Sierra and CASM match the reviewed SDK pins.');
