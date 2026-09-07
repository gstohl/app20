#!/usr/bin/env node
// The retired maker CLI must reject new public-term work before any side effect.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'app20-maker-policy-'));
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  response.writeHead(500, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'No RPC access is allowed by this test.' }));
});
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', accept);
});
const port = server.address().port;
const policyError = /Confidential settlement is required/;
const missing = join(directory, 'missing-operator.json');
const configFile = join(directory, 'existing-operator.json');
const stateFile = join(directory, 'existing-state.json');
const transportFile = join(directory, 'existing-transport.json');
const initialState = '{"preserve":"existing recovery and fee state"}\n';
const initialTransport = '{"test":"deliberately invalid transport key; must not load"}\n';
const config = {
  rpcUrl: `http://127.0.0.1:${port}/rpc`,
  chainId: '0x534e5f4d41494e', address: '0x123', classHash: '0x456', account: '0x789',
  fromBlock: 0, keyValidUntil: 2000000000, maxResponses: 1,
  maxFeePerTransaction: '1', maxTotalFees: '10',
  markets: [], stateFile,
};
const env = {
  PATH: process.env.PATH,
  APP20_MAKER_SIGNING_KEY: 'INVALID_TEST_SIGNER_MUST_NOT_LOAD',
  APP20_MAKER_TRANSPORT_FILE: transportFile,
};
async function rejected(mode, file) {
  try {
    await exec(process.execPath, ['scripts/starknet-maker.mjs', file, mode], {
      cwd: root, env, timeout: 10000, maxBuffer: 128 * 1024,
    });
    assert.fail(`${mode} unexpectedly succeeded`);
  } catch (error) {
    assert.equal(error.code, 1, `${mode}: expected an explicit CLI rejection`);
    assert.equal(error.stdout, '', `${mode}: must not print operator material`);
    assert(!error.stderr.includes(env.APP20_MAKER_SIGNING_KEY));
    return error.stderr;
  }
}
try {
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  await writeFile(stateFile, initialState, { mode: 0o600 });
  await writeFile(transportFile, initialTransport, { mode: 0o600 });
  const originalConfig = await readFile(configFile, 'utf8');
  const originalFiles = (await readdir(directory)).sort();
  for (const mode of ['--register', '--fund', '--run']) {
    // A missing file proves the policy runs before config access.
    assert.match(await rejected(mode, missing), policyError);
    // A real operator file proves no RPC, signing, key access or journal mutation occurs.
    assert.match(await rejected(mode, configFile), policyError);
  }
  for (const mode of ['--check', '--reconcile', '--release', '--withdraw', '--deactivate']) {
    // Recovery must reach its own config validation, not a blanket settlement denial.
    const error = await rejected(mode, missing);
    assert.doesNotMatch(error, policyError);
    assert.match(error, /ENOENT/);
  }
  assert.deepEqual(requests, [], 'Retired commands contacted RPC.');
  assert.deepEqual((await readdir(directory)).sort(), originalFiles, 'Retired commands created state or lock files.');
  assert.equal(await readFile(configFile, 'utf8'), originalConfig);
  assert.equal(await readFile(stateFile, 'utf8'), initialState);
  assert.equal(await readFile(transportFile, 'utf8'), initialTransport);
  console.log('PASS: register/fund/run reject before config, RPC, signer or journal access; historical recovery commands retain their validation path. No devnet or transactions.');
} finally {
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
  await rm(directory, { recursive: true, force: true });
}
