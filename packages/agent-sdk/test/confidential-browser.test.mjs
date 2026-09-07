import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('browser confidential entrypoint and durable storage work across real browser tabs', { timeout: 60_000 }, async t => {
  const bundled = await build({ absWorkingDir: root, stdin: { resolveDir: root, sourcefile: 'confidential-browser-fixture.js', contents: `
    import * as sdk from './packages/agent-sdk/dist/confidential-browser.js';
    import { ec } from 'starknet';
    window.sdk = sdk;
    const agreement = sdk.createConfidentialAgreement({ chainId: sdk.domain('SN_SEPOLIA'), pool: '0x200', poolClassHash: '0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d', escrowClassHash: sdk.confidentialContract.classHash, signerA: ec.starkCurve.getStarkKey('0x123'), signerB: ec.starkCurve.getStarkKey('0x456'), deadline: 1000, address: '0x300', terms: { tokenA: '0x400', tokenB: '0x500', amountA: '1234', amountB: '2345', partyA: '0x600', partyB: '0x700', salt: '0x789' } });
    window.fixtureScope = [agreement.chainId, agreement.address, agreement.commitment].join('/');
    window.fundingClient = () => sdk.createConfidentialClient({ agreement,
      provider: { channel: { nodeUrl: 'http://127.0.0.1:9999' }, getChainId: async () => agreement.chainId,
        getClassHashAt: async address => address === agreement.pool ? agreement.poolClassHash : agreement.escrowClassHash,
        getBlockWithTxHashes: async () => ({ block_number: 20, timestamp: 100 }),
        callContract: async ({entrypoint}) => entrypoint === 'configuration' ? sdk.confidentialConstructor(agreement) : entrypoint === 'get_public_key' ? [ec.starkCurve.getStarkKey('0x11')] : ['0'] },
      viewingKeyProvider: { getViewingKey: async () => 17n },
      journal: sdk.createBrowserConfidentialJournal(window.fixtureScope), simulatedProofs: true,
      proofProvider: { getDefaultDetails: async () => ({}), prove: async () => { throw Error('Test must not prove'); } },
      discovery: { resolve: async () => ({ discoverNotes: async () => ({ notes: new Map() }) }) },
      submit: async () => { throw Error('Test must not submit'); } });
    window.rawStore = async (store, key, value, remove = false) => {
      const database = await new Promise((accept, reject) => { const request = indexedDB.open('app20-confidential-sessions', 1); request.onsuccess = () => accept(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((accept, reject) => { const tx = database.transaction(store, value === undefined && !remove ? 'readonly' : 'readwrite'); const records = tx.objectStore(store); const request = remove ? records.delete(key) : value === undefined ? records.get(key) : records.put(value,key); tx.oncomplete = () => accept(request.result); tx.onabort = tx.onerror = () => reject(tx.error); }); }
      finally { database.close(); }
    };
  ` }, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false, metafile: true });
  assert(!Object.keys(bundled.metafile.inputs).some(name => name.endsWith('/src/confidential-journal.ts')));
  assert(!Object.values(bundled.metafile.outputs).some(output => output.imports.length), 'Browser package must bundle without external Node imports');
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    if (request.url === '/bundle.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundled.outputFiles[0].contents); }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script type="module" src="/bundle.js"></script>'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise(accept => server.close(accept)); });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], outbound = [];
  context.on('page', child => child.on('pageerror', error => errors.push(error.message)));
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== base) { outbound.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  async function ready(target = page) { await target.goto(base); await target.waitForFunction(() => Boolean(window.sdk)); }
  await ready();

  await t.test('existing Node exports survive and browser status matches without a filesystem API', async () => {
    const nodeSdk = await import('../dist/confidential.js');
    assert.equal(typeof nodeSdk.createConfidentialJournal, 'function');
    const actual = await page.evaluate(() => ({ filesystem: typeof sdk.createConfidentialJournal, browser: typeof sdk.createBrowserConfidentialJournal, mainnet: sdk.confidentialCapabilities.mainnetEnabled, realProof: sdk.confidentialCapabilities.realProofVerified }));
    assert.deepEqual(actual, { filesystem: 'undefined', browser: 'function', mainnet: nodeSdk.confidentialCapabilities.mainnetEnabled, realProof: false });
  });

  await t.test('cross-tab locks serialize read/modify/write and preserve both records', async () => {
    const second = await context.newPage(); await ready(second);
    const firstOperation = page.evaluate(async () => {
      const journal = sdk.createBrowserConfidentialJournal('0x1/0x2/0x3');
      return journal.runExclusive(async () => {
        const state = await journal.load() ?? { schema: 'app20/confidential-journal/v1', scope: '0x1/0x2/0x3', confirmed: [] };
        window.firstEntered = true; await new Promise(resolve => { window.releaseFirst = resolve; });
        state.confirmed.push({ id: '0xa', mode: 'setup', hash: '0xaa' }); await journal.save(state);
      });
    });
    await page.waitForFunction(() => window.firstEntered);
    const secondOperation = second.evaluate(async () => {
      const journal = sdk.createBrowserConfidentialJournal('1/2/3');
      return journal.runExclusive(async () => {
        const state = await journal.load(); state.confirmed.push({ id: '0xb', mode: 'settle', hash: '0xbb' }); await journal.save(state);
      });
    });
    await second.waitForFunction(async () => (await navigator.locks.query()).pending.some(lock => lock.name === 'app20-confidential:0x1/0x2/0x3'));
    await page.evaluate(() => window.releaseFirst()); await Promise.all([firstOperation, secondOperation]);
    const state = await second.evaluate(() => sdk.createBrowserConfidentialJournal('0x1/0x2/0x3').load());
    assert.deepEqual(state.confirmed.map(item => item.id), ['0xa', '0xb']); await second.close();
  });

  await t.test('uncertain wallet submission remains fenced after a full reload', async () => {
    const original = await page.evaluate(async () => {
      const client = await fundingClient(); let calls = 0, message;
      try { await client.fund('a', async () => { calls++; throw Error('Lost response after broadcast'); }); } catch (error) { message = error.message; }
      return { calls, message, state: await sdk.createBrowserConfidentialJournal(fixtureScope).load() };
    });
    assert.equal(original.calls, 1); assert.match(original.message, /uncertain/i); assert.equal(original.state.pending.hash, undefined);
    await ready();
    const resumed = await page.evaluate(async () => {
      const client = await fundingClient(); let calls = 0, message;
      try { await client.fund('a', async () => { calls++; return { transaction_hash: '0x999' }; }); } catch (error) { message = error.message; }
      return { calls, message, state: await sdk.createBrowserConfidentialJournal(fixtureScope).load() };
    });
    assert.equal(resumed.calls, 0); assert.match(resumed.message, /unknown submission outcome|pending/i); assert.deepEqual(resumed.state, original.state);
  });

  await t.test('private material is separate, encrypted, scope-bound and survives reload', async () => {
    const result = await page.evaluate(async () => {
      const scope = '0x4/0x5/0x6', journal = sdk.createBrowserConfidentialJournal(scope);
      const state = { schema: 'app20/confidential-journal/v1', scope, pending: { id: '0x7', mode: 'fundA', hash: '0x8', witness: 'PRIVATE_CANARY' }, confirmed: [], agreement: { viewingKey: 'PRIVATE_CANARY' } };
      const saving = journal.save(state); state.pending.hash = '0x9'; await saving;
      await sdk.createBrowserConfidentialSecretStore(scope).save(new TextEncoder().encode('PRIVATE_CANARY'));
      const metadata = await rawStore('metadata', scope), secret = await rawStore('secrets', scope), key = await rawStore('keys', scope);
      let exportDenied = false; try { await crypto.subtle.exportKey('raw', key); } catch { exportDenied = true; }
      return { metadata, visibleCiphertext: new TextDecoder().decode(secret.ciphertext), exportDenied };
    });
    assert(!JSON.stringify(result.metadata).includes('PRIVATE_CANARY')); assert.equal(result.metadata.pending.hash, '0x8'); assert(!result.visibleCiphertext.includes('PRIVATE_CANARY')); assert.equal(result.exportDenied, true);
    await ready();
    assert.equal(await page.evaluate(async () => new TextDecoder().decode(await sdk.createBrowserConfidentialSecretStore('0x4/0x5/0x6').load())), 'PRIVATE_CANARY');
    const swapped = await page.evaluate(async () => {
      const source = '0x4/0x5/0x6', target = '0xa/0xb/0xc';
      await rawStore('keys', target, await rawStore('keys', source)); await rawStore('secrets', target, await rawStore('secrets', source));
      try { await sdk.createBrowserConfidentialSecretStore(target).load(); return 'accepted'; } catch (error) { return error.message; }
    });
    assert.match(swapped, /authenticated/);
    const missing = await page.evaluate(async () => {
      const scope = '0x4/0x5/0x6'; await rawStore('keys', scope, undefined, true);
      const secrets = sdk.createBrowserConfidentialSecretStore(scope), messages = [];
      for (const action of [() => secrets.load(), () => secrets.save(new TextEncoder().encode('replacement'))]) {
        try { await action(); messages.push('accepted'); } catch (error) { messages.push(error.message); }
      }
      return messages;
    });
    for (const message of missing) assert.match(message, /encryption key is unavailable/);
  });

  await t.test('a tab crash releases its lock without erasing a pending transaction', async () => {
    const crashed = await context.newPage(); await ready(crashed);
    const operation = crashed.evaluate(() => sdk.createBrowserConfidentialJournal('0x11/0x12/0x13').runExclusive(async () => {
      await sdk.createBrowserConfidentialJournal('0x11/0x12/0x13').save({ schema: 'app20/confidential-journal/v1', scope: '0x11/0x12/0x13', pending: { id: '0x14', mode: 'settle', hash: '0x15' }, confirmed: [] });
      window.durable = true; await new Promise(() => {});
    })).catch(() => {});
    await crashed.waitForFunction(() => window.durable); await crashed.close(); await operation;
    const pending = await page.evaluate(() => { const journal = sdk.createBrowserConfidentialJournal('0x11/0x12/0x13'); return journal.runExclusive(() => journal.load()); });
    assert.equal(pending.pending.hash, '0x15');
  });

  await t.test('missing coordination support and corrupt scope fail without resetting recovery', async () => {
    const rejected = await page.evaluate(async () => {
      const scope = '0x21/0x22/0x23';
      await rawStore('metadata', scope, { schema: 'app20/confidential-journal/v1', scope: '0x21/0x22/0x24', pending: { id: '0x1', mode: 'settle', hash: '0x2' }, confirmed: [] });
      let message; try { await sdk.createBrowserConfidentialJournal(scope).load(); } catch (error) { message = error.message; }
      return { message, raw: await rawStore('metadata', scope) };
    });
    assert.match(rejected.message, /does not match/); assert.equal(rejected.raw.pending.hash, '0x2');
    const unsupported = await context.newPage(); await ready(unsupported);
    const message = await unsupported.evaluate(() => { Object.defineProperty(navigator, 'locks', { value: undefined }); try { sdk.createBrowserConfidentialJournal('0x1/0x2/0x3'); return 'accepted'; } catch (error) { return error.message; } });
    assert.match(message, /coordinate/); await unsupported.close();
  });
  assert.deepEqual(errors, []); assert.deepEqual(outbound, []);
});
