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
  for (const route of ['/rfq', '/rfq/confidential']) {
    await page.goto(baseUrl + route);
    await connectFixture();
    const panel = page.getByRole('main', { name: 'Confidential RFQ', exact: true });
    await panel.getByRole('heading', { name: 'Confidential RFQ', exact: true }).waitFor();
    await panel.getByRole('heading', { name: 'Private settlement is required', exact: true }).waitFor();
    await panel.getByText('Mainnet and browser-wallet activation are pending.', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: /get quotes|request.*offer|review.*swap|confirm.*swap|fund|settle/i }).count(), 0, `${route} must not offer public settlement`);
    assert.equal(await panel.getByLabel('You sell (STRK)', { exact: true }).count(), 0);
    assert.equal(await panel.getByRole('link', { name: 'Recover earlier maker inventory →', exact: true }).getAttribute('href'), '/rfq/maker');
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} overflows at ${width}px`);
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
  await page.getByRole('navigation', { name: 'RFQ workspace', exact: true }).getByRole('link', { name: 'Maker recovery', exact: true }).click();
  await page.getByRole('region', { name: 'Maker recovery', exact: true }).waitFor();
  assert.deepEqual(walletCalls, [], 'Read-only RFQ routes must not submit wallet calls');
  assert.deepEqual(legacyRpcCalls, [], 'An earlier executable maker configuration must not activate public RFQ');
  assert.deepEqual(errors, []);
  console.log('PASS: /rfq and /rfq/confidential require confidential settlement, reject stale public builders, preserve the recovery link, and fit desktop widths. Connected wallet and RPC tripwires observed zero calls.');
} catch (error) {
  await mkdir('artifacts/independent-makers', { recursive: true });
  await page?.screenshot({ path: 'artifacts/independent-makers/browser-failure.png', fullPage: true });
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
