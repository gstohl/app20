// Earlier public inventory remains recoverable without enabling new public settlements.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { hash } from 'starknet';
import { MAINNET_DEPLOYMENT as config } from '../src/lib/mainnet-deployment.ts';

const base = 'http://127.0.0.1:5198';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5198', '--strictPort'], { env: { ...process.env, VITE_CONFIDENTIAL_RFQ_LAB: '' }, stdio: 'ignore' });
let browser, page;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('Maker recovery test server failed to start.');
    try { if ((await fetch(base)).ok) break; } catch {}
    if (i === 99) throw Error('Maker recovery test server did not start.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const now = Math.floor(Date.now() / 1000), expiry = now + 3600;
  let balance = 1_500_000n, receiptReady = false, deactivated = false;
  const errors = [], submissions = [], forbiddenCalls = [];
  await context.route(config.rpcUrl + '**', async route => {
    const body = route.request().postDataJSON();
    let result;
    const selector = body.params?.request?.entry_point_selector;
    const is = name => selector && BigInt(selector) === BigInt(hash.getSelectorFromName(name));
    if (body.method === 'starknet_specVersion') result = '0.9.0';
    else if (body.method === 'starknet_chainId') result = config.chainId;
    else if (body.method === 'starknet_getBlockWithTxHashes') result = { block_hash: '0xabc', block_number: 15000000, timestamp: now, status: 'ACCEPTED_ON_L2', transactions: [], l1_gas_price: { price_in_fri: '0x1', price_in_wei: '0x1' }, l2_gas_price: { price_in_fri: '0x1', price_in_wei: '0x1' }, l1_data_gas_price: { price_in_fri: '0x1', price_in_wei: '0x1' }, l1_da_mode: 'CALLDATA', starknet_version: '0.14.0' };
    else if (body.method === 'starknet_getClassHashAt') {
      if (BigInt(body.params.contract_address) === BigInt(config.address)) result = config.classHash;
      else if (BigInt(body.params.contract_address) === BigInt(config.settlement.address)) result = config.settlement.classHash;
      else throw Error('Recovery should not require the pool to accept new output notes.');
    } else if (is('pool')) result = [config.settlement.pool];
    else if (is('book')) result = [config.address];
    else if (is('maker')) result = ['0x1', '0x1', '0x1', '0x1', '0x1', String(deactivated ? 0 : expiry)];
    else if (is('available')) result = [BigInt(body.params.request.calldata[1]) === BigInt(config.buyToken.address) ? balance.toString() : '0', '0'];
    else if (body.method === 'starknet_getTransactionStatus') result = { finality_status: receiptReady ? 'ACCEPTED_ON_L2' : 'RECEIVED', execution_status: 'SUCCEEDED' };
    else if (body.method === 'starknet_getTransactionReceipt') {
      if (!receiptReady) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: 29, message: 'Not found' } }) });
        return;
      }
      result = { type: 'INVOKE', transaction_hash: body.params.transaction_hash, execution_status: 'SUCCEEDED', finality_status: 'ACCEPTED_ON_L2', actual_fee: { amount: '0x0', unit: 'FRI' }, block_hash: '0xabc', block_number: 15000000, messages_sent: [], events: [], execution_resources: { l1_gas: 0, l1_data_gas: 0, l2_gas: 0 } };
    } else {
      forbiddenCalls.push(body.method + ':' + (selector ?? ''));
      await route.abort();
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) });
  });
  await context.exposeFunction('makerRecoveryExecute', async calls => {
    assert.equal(calls.length, 1, 'Recovery must not batch approvals or new inventory deposits');
    const [call] = calls;
    if (call.entrypoint === 'withdraw_inventory') {
      assert.equal(BigInt(call.contractAddress), BigInt(config.settlement.address));
      assert.equal(BigInt(call.calldata[0]), BigInt(config.buyToken.address));
      assert.equal(call.calldata[1], '500000');
      balance -= 500_000n;
      receiptReady = false;
    } else if (call.entrypoint === 'deactivate') {
      assert.equal(BigInt(call.contractAddress), BigInt(config.address));
      assert.deepEqual(call.calldata, []);
      deactivated = true;
    } else {
      forbiddenCalls.push(call.entrypoint);
      throw Error('Forbidden public settlement operation: ' + call.entrypoint);
    }
    submissions.push(call.entrypoint);
    return { transaction_hash: '0x' + (100 + submissions.length).toString(16) };
  });
  await context.exposeFunction('forbiddenPrivateSwap', async () => {
    forbiddenCalls.push('strk20InvokeTransaction');
    throw Error('Maker recovery must not invoke a new private swap.');
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
        execute: calls => window.makerRecoveryExecute(calls),
        strk20InvokeTransaction: () => window.forbiddenPrivateSwap(),
      } });
    }, config.chainId);
  }
  await page.goto(base + '/rfq/maker');
  const panel = page.getByRole('region', { name: 'Maker recovery', exact: true });
  await panel.waitFor();
  assert(await panel.getByRole('button', { name: 'Review withdrawal in wallet', exact: true }).isDisabled());
  const scope = `app20/maker-setup/v1/${config.chainId}/${config.settlement.address}/0x202`;
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ label: 'Fund inventory', hash: '0x64' })), scope);
  await connect();
  await panel.getByRole('button', { name: 'Check transaction', exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: /registration in wallet|funding in wallet|Download operator.json|Run bot/ }).count(), 0);
  assert.equal(await panel.getByLabel('Public P-256 key').count(), 0);
  await panel.getByLabel('Amount', { exact: true }).fill('0.5');
  assert(await panel.getByRole('button', { name: 'Review withdrawal in wallet', exact: true }).isDisabled(), 'An earlier pending funding receipt must fence all new wallet actions');
  await page.reload();
  await connect();
  await panel.getByRole('button', { name: 'Check transaction', exact: true }).waitFor();
  receiptReady = true;
  await panel.getByRole('button', { name: 'Check transaction', exact: true }).click();
  await panel.getByText('Fund inventory confirmed.', { exact: true }).waitFor();
  assert.deepEqual(submissions, [], 'Checking an earlier funding receipt must not fund again');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), scope), null);
  await panel.getByText('1.5', { exact: true }).waitFor();
  await panel.getByLabel('Amount', { exact: true }).fill('0.5');
  await panel.getByRole('button', { name: 'Review withdrawal in wallet', exact: true }).click();
  await panel.getByText('Transaction submitted.', { exact: false }).waitFor();
  assert.deepEqual(submissions, ['withdraw_inventory']);
  await page.reload();
  await connect();
  await panel.getByRole('button', { name: 'Check transaction', exact: true }).waitFor();
  await panel.getByLabel('Amount', { exact: true }).fill('0.5');
  assert(await panel.getByRole('button', { name: 'Review withdrawal in wallet', exact: true }).isDisabled());
  receiptReady = true;
  await panel.getByRole('button', { name: 'Check transaction', exact: true }).click();
  await panel.getByText('Withdraw inventory confirmed.', { exact: true }).waitFor();
  assert.equal(balance, 1_000_000n);
  assert.deepEqual(submissions, ['withdraw_inventory'], 'Receipt reconciliation must not repeat the withdrawal');
  await panel.getByRole('button', { name: 'Deactivate earlier registration', exact: true }).click();
  await panel.getByText('Deactivate maker confirmed.', { exact: true }).waitFor();
  await panel.getByText('registration inactive', { exact: false }).waitFor();
  assert.deepEqual(submissions, ['withdraw_inventory', 'deactivate']);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), scope), null);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Recovery layout overflows at ${width}px`);
  }
  await page.goto(base + '/agents');
  await page.getByRole('heading', { name: 'Node.js library', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Recover an earlier maker position', exact: true }).waitFor();
  assert.deepEqual(forbiddenCalls, []);
  assert.deepEqual(errors, []);
  console.log('PASS: new maker funding/registration is unavailable; earlier pending funding and withdrawal receipts survive reload without duplicate payment; exact inventory withdrawal and deactivation remain available. Connected wallet/RPC fixtures reject all other mutations.');
} catch (error) {
  await mkdir('artifacts/maker-setup', { recursive: true });
  await page?.screenshot({ path: 'artifacts/maker-setup/recovery-failure.png', fullPage: true });
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
