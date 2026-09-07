import { presentation } from '../tools/demo-video/presentation.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { hash } from 'starknet';
import { settlementCommitment } from '../packages/private-intents/src/private-settlement.ts';
import { generateTransportKey, keyCoordinates, open, decodeRequest, publicKey, seal } from '../packages/private-intents/src/starknet-maker.ts';
const executable = process.argv.includes('--settlement');
const baseUrl = 'http://127.0.0.1:5196';
const config = { rpcUrl: 'https://maker-rpc.example', chainId: '0x534e5f5345504f4c4941', address: '0x101', classHash: '0x102', fromBlock: 1, sellToken: { address: '0x11', symbol: 'STRK', decimals: 18 }, buyToken: { address: '0x22', symbol: 'USDC', decimals: 6 } };
if (executable) config.settlement = { address: '0x601', classHash: '0x602', pool: '0x603', poolClassHash: '0x604' };
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5196', '--strictPort'], { env: { ...process.env, VITE_MAKER_BOOK_CONFIG: JSON.stringify(config) }, stdio: 'ignore' });
let browser;
let page;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Browser test server failed to start.');
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (i === 99) throw new Error('Browser test server did not start.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const maker = await generateTransportKey();
  const coordinates = keyCoordinates(await crypto.subtle.exportKey('jwk', maker.publicKey));
  const entries = new Map();
  let scope, response, commitment, submissions = 0, payments = 0, receiptReady = false, quoteStatus = 1;
  const now = Math.floor(Date.now() / 1000);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...(process.env.APP20_DEMO_VIDEO === '1' ? { recordVideo: { dir: 'artifacts/hackathon/raw-rfq', size: { width: 1440, height: 1000 } } } : {}) });
  const demo = process.env.APP20_DEMO_VIDEO === '1' ? await presentation(page, 'rfq') : null;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://maker-rpc.example/**', async route => {
    const body = route.request().postDataJSON();
    let result;
    if (body.method === 'starknet_specVersion') result = '0.9.0';
    else if (body.method === 'starknet_chainId') result = config.chainId;
    else if (body.method === 'starknet_getClassHashAt') result = body.params.contract_address === config.settlement?.address ? config.settlement.classHash : body.params.contract_address === config.settlement?.pool ? config.settlement.poolClassHash : config.classHash;
    else if (body.method === 'starknet_getBlockWithTxHashes') result = { block_hash: '0xabc', block_number: 10, timestamp: now, status: 'ACCEPTED_ON_L2', transactions: [], l1_gas_price: { price_in_fri: '0x1', price_in_wei: '0x1' }, l2_gas_price: { price_in_fri: '0x1', price_in_wei: '0x1' }, l1_data_gas_price: { price_in_fri: '0x1', price_in_wei: '0x1' }, l1_da_mode: 'CALLDATA', starknet_version: '0.14.0' };
    else if (body.method === 'starknet_call') {
      const selector = body.params.request.entry_point_selector;
      const record = entries.get(body.params.request.calldata[0]);
      if (BigInt(selector) === BigInt(hash.getSelectorFromName('maker_count'))) result = ['0x3'];
      else if (BigInt(selector) === BigInt(hash.getSelectorFromName('maker_at'))) result = [['0x303', '0x304', '0x305'][Number(body.params.request.calldata[0])]];
      else if (BigInt(selector) === BigInt(hash.getSelectorFromName('maker'))) result = [...coordinates.map(x => `0x${BigInt(x).toString(16)}`), '0x1', `0x${(now + 3600).toString(16)}`];
      else if (BigInt(selector) === BigInt(hash.getSelectorFromName('available'))) result = ['0x989680', '0x0'];
      else if (BigInt(selector) === BigInt(hash.getSelectorFromName('pool'))) result = [config.settlement.pool];
      else if (BigInt(selector) === BigInt(hash.getSelectorFromName('book'))) result = [config.address];
      else if (['get_fee_amount', 'is_open_note_depositor_blocked'].some(name => BigInt(selector) === BigInt(hash.getSelectorFromName(name)))) result = ['0x0'];
      else if (BigInt(selector) === BigInt(hash.getSelectorFromName('quote'))) result = [scope.maker, '0x11', '0x22', '2000000000000000000', '1550000', commitment, String(scope.expiresAt), String(quoteStatus)];
      else result = [record.scope.taker, record.scope.maker, '0x1', `0x${record.scope.expiresAt.toString(16)}`, '0x2'];
    } else if (body.method === 'starknet_getEvents') { const record = entries.get(body.params.filter.keys[1][0]); result = { events: record ? [{ from_address: config.address, keys: [hash.getSelectorFromName('Responded'), record.scope.id, record.scope.maker], data: [String(record.response.length), ...record.response], block_hash: '0xabc', block_number: 10, transaction_hash: '0x404' }] : [] }; }
    else if (body.method === 'starknet_getTransactionStatus') result = { finality_status: receiptReady ? 'ACCEPTED_ON_L2' : 'RECEIVED', execution_status: 'SUCCEEDED' };
    else if (body.method === 'starknet_getTransactionReceipt') {
      if (!receiptReady) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: 29, message: 'Transaction hash not found' } }) }); return; }
      result = { type: 'INVOKE', transaction_hash: '0x505', execution_status: 'SUCCEEDED', finality_status: 'ACCEPTED_ON_L2', actual_fee: { amount: '0x0', unit: 'FRI' }, block_hash: '0xabc', block_number: 10, messages_sent: [], events: [], execution_resources: { l1_gas: 0, l1_data_gas: 0, l2_gas: 0 } };
    }
    else throw new Error(`Unexpected maker RPC ${body.method}`);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) });
  });
  await page.exposeFunction('testMakerExecute', async calls => {
    assert.equal(calls.length, submissions === 0 ? 3 : 1);
    for (const call of calls) {
      assert.equal(call.entrypoint, 'request');
      const data = call.calldata;
      scope = { chainId: config.chainId, book: config.address, id: data[0], maker: data[1], taker: '0x202', revision: Number(data[2]), expiresAt: Number(data[3]) };
      const request = await decodeRequest(await open(scope, 'request', data.slice(5), maker));
      assert.equal(request.sellAmount, '2000000000000000000');
      assert.equal(request.minBuyAmount, '1000000');
      commitment = request.settlementCommitment;
      if (submissions === 0) assert.equal(commitment, undefined, 'Comparison must never request an inventory reservation');
      else { assert(commitment); assert.equal(scope.maker, '0x304', 'Only the best valid maker is selected'); }
      const funded = Boolean(commitment);
      const buyAmount = funded ? '1550000' : scope.maker === '0x304' ? '1600000' : scope.maker === '0x305' ? '999999' : '1500000';
      response = await seal(scope, 'quote', { kind: funded ? 'executable' : 'indicative', buyAmount, expiresAt: scope.expiresAt, ...(funded ? { settlement: config.settlement.address, quoteId: scope.id, commitment } : {}) }, await publicKey(request.replyKey));
      entries.set(scope.id, { scope, response });
    }
    submissions++;
    return { transaction_hash: '0x404' };
  });
  await page.exposeFunction('testPrivateSwap', async actions => {
    assert.equal(actions.length, 3);
    assert.deepEqual(actions.map(a => a.type), ['withdraw', 'transfer', 'invoke']);
    assert.equal(actions[0].recipient, config.settlement.address);
    assert.equal(actions[1].amount, 'OPEN'); assert.equal(actions[1].recipient, '0x202');
    assert.equal(settlementCommitment(config.chainId, config.settlement.address, actions[2].calldata[1]), commitment);
    payments++; quoteStatus = 2;
    return { transaction_hash: '0x505' };
  });
  async function connectFixture() {
    await page.evaluate(async () => {
      const { useStoreWallet } = await import('/src/app/components/Wallet/walletContext.ts');
      const { useFrontendProvider } = await import('/src/app/components/client/provider/providerContext.ts');
      useFrontendProvider.getState().setCurrentFrontendProviderIndex(2);
      useStoreWallet.setState({ address: '0x202', chain: '0x534e5f5345504f4c4941', isConnected: true, isStrk20Capable: true, myWalletAccount: { execute: calls => window.testMakerExecute(calls), strk20InvokeTransaction: actions => window.testPrivateSwap(actions) } });
    });
  }
  await page.goto(`${baseUrl}/rfq`);
  await connectFixture();
  const panel = page.getByRole('region', { name: 'Private swap', exact: true });
  await demo?.mark('Enter amount and minimum');
  await panel.getByLabel('You sell (STRK)', { exact: true }).fill('2');
  await demo?.hold(5);
  await panel.getByLabel('Minimum you receive (USDC)', { exact: true }).fill('1');
  await demo?.hold(5);
  await panel.getByRole('button', { name: 'Get quotes · gas required' }).click();
  await panel.getByText('Request submitted.', { exact: false }).waitFor();
  await panel.getByRole('button', { name: 'Refresh replies', exact: true }).click();
  const comparison = panel.getByRole('region', { name: 'Quote comparison' });
  await comparison.getByText('2 valid replies from 3 contacted makers.', { exact: false }).waitFor();
  await comparison.getByText('1.6 USDC', { exact: true }).waitFor();
  assert.equal(submissions, 1);
  await mkdir('artifacts/independent-makers', { recursive: true });
  await demo?.mark('Best quote received');
  await panel.screenshot({ path: 'artifacts/independent-makers/automatic-comparison.png' });
    if (process.env.APP20_DEMO_VIDEO === '1') await page.waitForTimeout(10000);
  // Non-exportable reply keys and decoded prices survive reload.
  if (!demo) { await page.reload(); await connectFixture(); }
  await comparison.getByText('1.6 USDC', { exact: true }).waitFor();
  if (executable) {
    await comparison.getByRole('button', { name: 'Request funded offer', exact: true }).click();
    await panel.getByText('Request submitted.', { exact: false }).waitFor();
    await panel.locator('li').filter({ has: page.locator('small', { hasText: 'Funded offer' }) }).getByRole('button', { name: 'Check quote', exact: true }).click();
    await panel.getByText('Reserved receive: 1.55 USDC.', { exact: false }).waitFor();
    assert.equal(submissions, 2);
    assert.equal(payments, 0, 'Reservation must not execute settlement');
    assert.equal(await comparison.getByRole('button', { name: 'Request funded offer', exact: true }).count(), 0);
    if (!demo) { await page.reload(); await connectFixture(); }
    await panel.locator('li').filter({ has: page.locator('small', { hasText: 'Funded offer' }) }).getByRole('button', { name: 'Check quote', exact: true }).click();
  }
  if (executable) {
    await demo?.mark('Review funded price');
    await panel.getByRole('button', { name: 'Review swap', exact: true }).click();
    await panel.getByText('The funded price differs from the preliminary quote.', { exact: false }).waitFor();
    await panel.screenshot({ path: 'artifacts/independent-makers/funded-review.png' });
    if (process.env.APP20_DEMO_VIDEO === '1') await page.waitForTimeout(10000);
    if (demo) receiptReady = true;
    await panel.getByRole('button', { name: 'Confirm private swap', exact: true }).click();
    if (!demo) {
    await panel.getByText('Swap submitted. Waiting for on-chain confirmation…', { exact: true }).waitFor();
    if (!demo) { await page.reload(); await connectFixture(); }
    receiptReady = true;
    await panel.getByRole('button', { name: 'Check settlement', exact: true }).click();
    }
    await panel.getByText('Swap settled · receive asset shielded', { exact: true }).waitFor();
    await demo?.mark('Swap confirmed');
    if (process.env.APP20_DEMO_VIDEO === '1') await page.waitForTimeout(10000);
    assert.equal(payments, 1);
    assert.equal(submissions, 2);
    const race = await page.evaluate(async () => {
      const storage = await import('/src/lib/maker-request-store.ts');
      const row = (await storage.loadMakerRequests()).find(value => value.executableAnswer);
      const copy = { ...row, scope: { ...row.scope, id: '0xbeef' }, settlementAttempt: undefined };
      await storage.saveMakerRequest(copy);
      const attempts = await Promise.allSettled([storage.beginMakerSettlement('0xbeef'), storage.beginMakerSettlement('0xbeef')]);
      return attempts.map(value => value.status).sort();
    });
    assert.deepEqual(race, ['fulfilled', 'rejected']);
    const reservationRace = await page.evaluate(async () => {
      const storage = await import('/src/lib/maker-request-store.ts');
      const row = (await storage.loadMakerRequests()).find(value => value.executableAnswer);
      const make = id => ({ ...row, scope: { ...row.scope, id, taker: '0x888' }, comparisonId: '0xcafe', stage: 'reservation', settlementAttempt: undefined });
      const result = await Promise.allSettled([storage.saveMakerBatch([make('0xf01')], '0xcafe'), storage.saveMakerBatch([make('0xf02')], '0xcafe')]);
      return result.map(value => value.status).sort();
    });
    assert.deepEqual(reservationRace, ['fulfilled', 'rejected']);

  }
  await mkdir('artifacts/independent-makers', { recursive: true });
  await demo?.mark('End presentation');
  for (const width of (demo ? [] : [1440, 1280, 1024])) {
    await page.setViewportSize({ width, height: 1100 });
    await panel.screenshot({ path: `artifacts/independent-makers/${executable ? "settlement" : "desktop"}-${width}.png` });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
  }
  if (executable) {
    // Reset only this isolated test origin to exercise a fresh direct negotiation.
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => { const request = indexedDB.open('app20-independent-makers-v1', 1); request.onsuccess = () => { const db = request.result; const tx = db.transaction('requests', 'readwrite'); tx.objectStore('requests').clear(); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; }; });
    });
    if (!demo) { await page.reload(); await connectFixture(); }
    await panel.getByText('Advanced · choose a maker', { exact: true }).click();
    await panel.getByRole('checkbox', { name: 'Request a fixed offer from one maker' }).check();
    await panel.getByRole('button', { name: 'Find makers', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Maker' }).selectOption('0x304');
    await panel.getByLabel('You sell (STRK)', { exact: true }).fill('2');
    await panel.getByLabel('Minimum you receive (USDC)', { exact: true }).fill('1');
    await panel.getByRole('button', { name: 'Request fixed offer · gas required' }).click();
    await panel.getByText('Request submitted.', { exact: false }).waitFor();
    assert.equal(submissions, 3);
    assert.equal(payments, 1);
    assert.equal(await panel.getByRole('link', { name: 'Negotiate in Chat' }).getAttribute('href'), '/chat');
  }
  assert.deepEqual(errors, []);
  if (demo) console.log('PASS: paced recording of quote comparison, funded-price review, and simulated settlement; reload and viewport checks are excluded from presentation mode.');
  if (!demo && executable) console.log('PASS: private swap review, one wallet payment, receipt recovery after reload, and atomic IndexedDB duplicate-attempt fence.');
  if (!demo) console.log('PASS: automatic comparison rejects below-minimum prices, ranks replies, reserves only the winner, reviews price changes, and provides desktop browser discovery, encrypted request/reply, non-exportable key recovery after reload, and 1440/1280/1024px layouts. RPC and wallet are test fixtures; cryptography is real.');
} catch (error) {
  await mkdir('artifacts/independent-makers', { recursive: true });
  await page?.screenshot({ path: 'artifacts/independent-makers/browser-failure.png', fullPage: true });
  if (page) console.error(await page.locator('section[aria-label="Private swap"]').innerText());
  throw error;
} finally {
  try {
    const video = page?.video();
    await page?.context().close();
    if (video) await video.saveAs('artifacts/hackathon/rfq-ui-rehearsal.webm');
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
}
