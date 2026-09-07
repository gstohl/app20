import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { hash } from 'starknet';
const manifest = JSON.parse(await readFile('public/.well-known/app20.json', 'utf8'));
const book = manifest.contracts.App20MakerBook, swap = manifest.contracts.App20PrivateSwap;
const base = 'http://127.0.0.1:5198';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5198', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} if (i === 99) throw Error('Vite did not start'); await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const now = Math.floor(Date.now() / 1000); let revision = 0, expiry = 0, balance = 0n, submits = 0, receiptReady = true;
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey), privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const errors = [];
  await context.route('https://api.cartridge.gg/x/starknet/mainnet**', async route => {
    const body = route.request().postDataJSON(); let result;
    const selector = body.params?.request?.entry_point_selector;
    const is = name => selector && BigInt(selector) === BigInt(hash.getSelectorFromName(name));
    if (body.method === 'starknet_specVersion') result = '0.9.0';
    else if (body.method === 'starknet_chainId') result = manifest.chainId;
    else if (body.method === 'starknet_getBlockWithTxHashes') result = { block_hash: '0xabc', block_number: 15000000, timestamp: now, status: 'ACCEPTED_ON_L2', transactions: [], l1_gas_price: { price_in_fri: '0x1', price_in_wei: '0x1' }, l2_gas_price: { price_in_fri: '0x1', price_in_wei: '0x1' }, l1_data_gas_price: { price_in_fri: '0x1', price_in_wei: '0x1' }, l1_da_mode: 'CALLDATA', starknet_version: '0.14.0' };
    else if (body.method === 'starknet_getClassHashAt') result = BigInt(body.params.contract_address) === BigInt(book.address) ? book.classHash : BigInt(body.params.contract_address) === BigInt(swap.address) ? swap.classHash : manifest.pool.classHash;
    else if (is('pool')) result = [manifest.pool.address];
    else if (is('book')) result = [book.address];
    else if (is('is_open_note_depositor_blocked')) result = ['0x0'];
    else if (is('maker')) result = ['0x1', '0x1', '0x1', '0x1', String(revision), String(expiry)];
    else if (is('available')) result = [balance.toString(), '0x0'];
    else if (body.method === 'starknet_getTransactionStatus') result = { finality_status: receiptReady ? 'ACCEPTED_ON_L2' : 'RECEIVED', execution_status: 'SUCCEEDED' };
    else if (body.method === 'starknet_getTransactionReceipt') {
      if (!receiptReady) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: 29, message: 'Not found' } }) }); return; }
      result = { type: 'INVOKE', transaction_hash: body.params.transaction_hash, execution_status: 'SUCCEEDED', finality_status: 'ACCEPTED_ON_L2', actual_fee: { amount: '0x0', unit: 'FRI' }, block_hash: '0xabc', block_number: 15000000, messages_sent: [], events: [], execution_resources: { l1_gas: 0, l1_data_gas: 0, l2_gas: 0 } };
    } else throw Error('Unexpected RPC ' + body.method);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) });
  });
  await context.exposeFunction('makerSetupExecute', async calls => {
    submits++;
    if (calls[0].entrypoint === 'register') { assert.equal(calls[0].calldata.length, 5); revision++; expiry = Number(calls[0].calldata[4]); }
    else if (calls[0].entrypoint === 'approve') { assert.deepEqual(calls.map(c => c.entrypoint), ['approve', 'deposit_inventory']); assert.deepEqual(calls[0].calldata.slice(1), ['1500000', '0']); balance += 1500000n; receiptReady = false; }
    else if (calls[0].entrypoint === 'withdraw_inventory') { assert.equal(calls[0].calldata[1], '500000'); balance -= 500000n; }
    else throw Error('Unexpected mutation');
    return { transaction_hash: '0x' + (100 + submits).toString(16) };
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  async function connect(p) { await p.evaluate(async () => {
    const { useStoreWallet } = await import('/src/app/components/Wallet/walletContext.ts');
    const { useFrontendProvider } = await import('/src/app/components/client/provider/providerContext.ts');
    useFrontendProvider.getState().setCurrentFrontendProviderIndex(0);
    useStoreWallet.setState({ address: '0x202', chain: '0x534e5f4d41494e', isConnected: true, myWalletAccount: { execute: calls => window.makerSetupExecute(calls) } });
  }); }
  await page.goto(base + '/rfq/maker'); await connect(page);
  const panel = page.getByRole('region', { name: 'Become a maker', exact: true });
  await panel.getByLabel('Public P-256 key').fill(JSON.stringify(privateJwk)); await panel.getByRole('button', { name: 'Review registration in wallet' }).click();
  await panel.getByText('This is a private key.', { exact: false }).waitFor(); assert.equal(submits, 0);
  await panel.getByLabel('Public P-256 key').fill(JSON.stringify(publicJwk)); await panel.getByRole('button', { name: 'Review registration in wallet' }).click();
  await panel.getByText('Register maker confirmed.', { exact: true }).waitFor(); assert.equal(submits, 1);
  await panel.getByRole('button', { name: '2. Inventory', exact: true }).click(); await panel.getByLabel('Amount', { exact: true }).fill('1.5'); await panel.getByRole('button', { name: 'Review funding in wallet' }).click();
  await panel.getByText('Transaction submitted.', { exact: false }).waitFor(); assert.equal(submits, 2);
  await page.reload(); await connect(page); await panel.getByRole('button', { name: 'Check transaction', exact: true }).waitFor();
  await panel.getByRole('button', { name: '2. Inventory', exact: true }).click(); await panel.getByLabel('Amount', { exact: true }).fill('1.5'); assert(await panel.getByRole('button', { name: 'Review funding in wallet' }).isDisabled());
  receiptReady = true; await panel.getByRole('button', { name: 'Check transaction', exact: true }).click(); await panel.getByText('Fund inventory confirmed.', { exact: true }).waitFor();
  await panel.getByLabel('Amount', { exact: true }).fill('0.5'); await panel.getByRole('button', { name: 'Review withdrawal in wallet' }).click(); await panel.getByText('Withdraw inventory confirmed.', { exact: true }).waitFor(); assert.equal(submits, 3);
  await panel.getByRole('button', { name: '3. Run bot', exact: true }).click();
  await panel.getByLabel('USDC per 1 STRK, before spread').fill('0.25'); await panel.getByLabel('Maximum customer sell (STRK)').fill('100'); await panel.getByLabel('Maximum output per quote (USDC)').fill('30'); await panel.getByLabel('Maximum fee per transaction (STRK)').fill('0.2'); await panel.getByLabel('Total bot gas budget (STRK)').fill('2');
  const downloading = page.waitForEvent('download'); await panel.getByRole('button', { name: 'Download operator.json' }).click(); const downloaded = await downloading;
  const operator = JSON.parse(await readFile(await downloaded.path(), 'utf8')); assert.equal(operator.account, '0x202'); assert.equal(operator.markets[0].numerator, '250000'); assert.equal(operator.markets[0].denominator, '1000000000000000000'); assert(!JSON.stringify(operator).includes(privateJwk.d));
  await mkdir('artifacts/maker-setup', { recursive: true });
  for (const width of [1440, 1024]) { await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: `artifacts/maker-setup/setup-${width}.png`, fullPage: true }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await page.goto(base + '/agents'); await page.getByRole('heading', { name: 'Chat, quote, and become a maker' }).waitFor(); await page.screenshot({ path: 'artifacts/maker-setup/agents.png', fullPage: true }); assert.deepEqual(errors, []);
  console.log('PASS: public-key-only registration, exact atomic inventory funding, reload/pending fence, receipt recovery, withdrawal, decimal-correct public config download, agents guide, desktop layouts. Wallet and RPC are fixtures; no live transactions sent.');
} finally { await browser?.close(); server.kill('SIGTERM'); }
