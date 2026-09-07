// Older maker bookmarks open RFQ without resuming or discarding historical operations.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { MAINNET_DEPLOYMENT as config } from '../src/lib/mainnet-deployment.ts';

const base = 'http://127.0.0.1:5198';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5198', '--strictPort'], { env: { ...process.env, VITE_CONFIDENTIAL_RFQ_LAB: '' }, stdio: 'ignore' });
let browser, page;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('Maker bookmark test server failed to start.');
    try { if ((await fetch(base)).ok) break; } catch {}
    if (i === 99) throw Error('Maker bookmark test server did not start.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [], submissions = [], rpcCalls = [];
  await context.route(config.rpcUrl + '**', async route => {
    rpcCalls.push(route.request().postDataJSON());
    await route.abort();
  });
  await context.exposeFunction('forbiddenMakerSubmission', async method => {
    submissions.push(method);
    throw Error('Opening an earlier maker bookmark must not sign: ' + method);
  });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  async function connect() {
    await page.evaluate(async chain => {
      const { useStoreWallet } = await import('/src/app/components/Wallet/walletContext.ts');
      const { useFrontendProvider } = await import('/src/app/components/client/provider/providerContext.ts');
      useFrontendProvider.getState().setCurrentFrontendProviderIndex(0);
      useStoreWallet.setState({ address: '0x202', chain, isConnected: true, isStrk20Capable: true, myWalletAccount: {
        execute: () => window.forbiddenMakerSubmission('execute'),
        strk20InvokeTransaction: () => window.forbiddenMakerSubmission('strk20InvokeTransaction'),
        request: () => window.forbiddenMakerSubmission('request'),
      } });
    }, config.chainId);
  }
  await page.goto(base + '/rfq');
  const scope = `app20/maker-setup/v1/${config.chainId}/${config.settlement.address}/0x202`;
  for (const pending of [{ label: 'Fund inventory', hash: '0x64' }, { label: 'Withdraw inventory', hash: '0x65' }]) {
    const saved = JSON.stringify(pending);
    await page.evaluate(({ key, saved }) => localStorage.setItem(key, saved), { key: scope, saved });
    await page.goto(base + '/rfq/maker');
    await connect();
    const panel = page.getByRole('main', { name: 'Confidential RFQ', exact: true });
    await expect(panel).toBeVisible();
    assert.equal(new URL(page.url()).pathname, '/rfq');
    await expect(panel.getByRole('button', { name: 'Request quotes', exact: true })).toBeDisabled();
    assert.equal(await page.getByRole('region', { name: 'Maker recovery', exact: true }).count(), 0);
    assert.equal(await panel.getByRole('link', { name: /recovery|funding|development/i }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /registration in wallet|funding in wallet|withdrawal in wallet|Deactivate earlier registration|Check transaction/ }).count(), 0);
    await page.reload();
    await connect();
    await expect(panel).toBeVisible();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), scope), saved, 'Redirect and reload must preserve the earlier pending hash for explicit recovery');
  }
  // Historical recovery builders remain usable by the technical tooling; they do not sign.
  const withdrawal = await page.evaluate(async token => {
    const { makerInventoryCalls } = await import('/src/lib/maker-setup.ts');
    return makerInventoryCalls('withdraw', token, '0.5');
  }, config.buyToken.address);
  assert.deepEqual(withdrawal, [{ contractAddress: config.settlement.address, entrypoint: 'withdraw_inventory', calldata: ['0x' + BigInt(config.buyToken.address).toString(16), '500000'] }]);
  await page.goto(base + '/agents');
  await expect(page.getByRole('heading', { name: 'Node.js library', exact: true })).toBeVisible();
  const resources = page.getByRole('navigation', { name: 'Agent resources', exact: true });
  await expect(resources.getByRole('link', { name: 'Confidential RFQ', exact: true })).toHaveAttribute('href', '/rfq');
  assert.equal(await page.locator('a[href="/rfq/maker"], a[href="/rfq/confidential"]').count(), 0);
  assert.equal(await page.getByRole('heading', { name: /Recover an earlier maker position/ }).count(), 0);
  assert.deepEqual(submissions, []);
  assert.deepEqual(rpcCalls, [], 'Opening a historical bookmark must not resume an earlier protocol');
  assert.deepEqual(errors, []);
  console.log('PASS: maker bookmarks redirect to one RFQ workspace; saved pending funding/withdrawal records survive reload; recovery stays in technical tooling; no wallet or historical RPC calls.');
} catch (error) {
  await mkdir('artifacts/maker-setup', { recursive: true });
  await page?.screenshot({ path: 'artifacts/maker-setup/recovery-failure.png', fullPage: true });
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
