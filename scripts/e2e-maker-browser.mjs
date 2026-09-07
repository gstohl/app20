// Browser regression for the privacy-only RFQ routes. Every wallet submission is a tripwire.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5196';
const config = { rpcUrl: 'https://maker-rpc.example', chainId: '0x534e5f5345504f4c4941', address: '0x101', classHash: '0x102', fromBlock: 1, sellToken: { address: '0x11', symbol: 'STRK', decimals: 18 }, buyToken: { address: '0x22', symbol: 'USDC', decimals: 6 }, settlement: { address: '0x601', classHash: '0x602', pool: '0x603', poolClassHash: '0x604' } };
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5196', '--strictPort'], {
  env: { ...process.env, VITE_MAKER_BOOK_CONFIG: JSON.stringify(config), VITE_CONFIDENTIAL_RFQ_LAB: '' }, stdio: 'ignore',
});
let browser, page;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('RFQ browser test server failed to start.');
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (i === 99) throw Error('RFQ browser test server did not start.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [], walletCalls = [], legacyRpcCalls = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://maker-rpc.example/**', async route => {
    legacyRpcCalls.push(route.request().postDataJSON());
    await route.abort();
  });
  await page.exposeFunction('forbiddenRfqSubmission', async method => {
    walletCalls.push(method);
    throw Error(`Privacy policy violation: wallet ${method} was invoked.`);
  });
  async function connectFixture() {
    await page.evaluate(async () => {
      const { useStoreWallet } = await import('/src/app/components/Wallet/walletContext.ts');
      const { useFrontendProvider } = await import('/src/app/components/client/provider/providerContext.ts');
      useFrontendProvider.getState().setCurrentFrontendProviderIndex(2);
      useStoreWallet.setState({ address: '0x202', chain: '0x534e5f5345504f4c4941', isConnected: true, isStrk20Capable: true, myWalletAccount: {
        execute: () => window.forbiddenRfqSubmission('execute'),
        strk20InvokeTransaction: () => window.forbiddenRfqSubmission('strk20InvokeTransaction'),
        request: () => window.forbiddenRfqSubmission('request'),
      } });
    });
  }
  for (const route of ['/rfq', '/rfq/confidential', '/rfq/maker']) {
    await page.goto(baseUrl + route);
    await connectFixture();
    const panel = page.getByRole('main', { name: 'Confidential RFQ', exact: true });
    await panel.getByRole('heading', { name: 'Confidential RFQ', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/rfq');
    await panel.getByRole('heading', { name: 'Instant RFQ', exact: true }).waitFor();
    assert.equal(await panel.getByRole('navigation').count(), 0);
    assert.equal(await panel.getByRole('link', { name: /recovery|funding|development/i }).count(), 0);
    assert(await panel.getByRole('button', { name: 'Request quotes', exact: true }).isDisabled());
    await panel.getByLabel('You sell (STRK)', { exact: true }).fill('12.5');
    await panel.getByLabel('Minimum you receive (USDC)', { exact: true }).fill('2.1');
    await panel.getByRole('button', { name: 'Reverse swap direction', exact: true }).click();
    assert.equal(await panel.getByLabel('You sell (USDC)', { exact: true }).inputValue(), '');
    assert.equal(await panel.getByLabel('Minimum you receive (STRK)', { exact: true }).inputValue(), '');
    await panel.getByRole('button', { name: 'Reverse swap direction', exact: true }).click();
    assert.equal(await panel.locator('details').getAttribute('open'), null);
    await mkdir('artifacts/rfq-single-screen', { recursive: true });
    for (const width of [1440, 1024, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} overflows at ${width}px`);
      const submitBox = await panel.getByRole('button', { name: 'Request quotes', exact: true }).boundingBox();
      assert(submitBox && submitBox.x >= 0 && submitBox.x + submitBox.width <= width, 'Quote action must fit its screen');
      if (route === '/rfq') await page.screenshot({ path: `artifacts/rfq-single-screen/rfq-${width}.png`, fullPage: true });
    }
  }
  // The deployed browser bundle also refuses stale callers that kept a prior UI open.
  const blocked = await page.evaluate(async () => {
    const { makerRegistration, makerInventoryCalls } = await import('/src/lib/maker-setup.ts');
    const { buildPrivateSettlementActions } = await import('/packages/private-intents/src/private-settlement.ts');
    const attempts = [
      () => makerRegistration('{}', 1, 0),
      () => makerInventoryCalls('fund', '0x22', '1'),
      () => buildPrivateSettlementActions({}),
    ];
    const results = [];
    for (const attempt of attempts) {
      try { await attempt(); results.push('accepted'); }
      catch (error) { results.push(error.message); }
    }
    return results;
  });
  for (const message of blocked) assert.match(message, /Confidential settlement is required/);
  assert.deepEqual(walletCalls, [], 'Read-only RFQ routes must not submit wallet calls');
  assert.deepEqual(legacyRpcCalls, [], 'An earlier executable maker configuration must not activate public RFQ');
  assert.deepEqual(errors, []);
  console.log('PASS: one confidential RFQ ticket; old pages redirect; amount fields and reversal work; phone and desktop layouts fit; disabled settlement and stale public builders make zero wallet/RPC calls.');
} catch (error) {
  await mkdir('artifacts/independent-makers', { recursive: true });
  await page?.screenshot({ path: 'artifacts/independent-makers/browser-failure.png', fullPage: true });
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
