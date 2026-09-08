// Fresh, read-only social footage. No wallet signing, proof jobs or broadcasts.
// Optional operator Chat mode uses an isolated source preview and real mainnet
// events. Its mailbox seed is only persisted as an encrypted temporary browser
// vault; no trace or profile export is written. The resulting scene must retain MAINNET · READ-ONLY.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {chromium} from '@playwright/test';
import {RpcProvider, hash} from 'starknet';
import {presentation} from './presentation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const {values} = parseArgs({options: {config: {type: 'string'}, 'check-only': {type: 'boolean'}}});
const config = values.config ? JSON.parse(await readFile(resolve(values.config), 'utf8')) : {};
const origin = new URL(config.origin ?? 'https://app20.io').origin;
const destination = resolve(config.destination ?? 'artifacts/hackathon/social-fresh');
const sourceOrigin = config.chatSourceOrigin ? new URL(config.chatSourceOrigin).origin : undefined;
if (sourceOrigin && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(sourceOrigin).hostname)) throw Error('The Chat source preview must use an isolated local server.');
if (!origin.startsWith('https://') && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('Use HTTPS for production capture.');
const rpcUrl = config.mainnetRpc ?? 'https://api.cartridge.gg/x/starknet/mainnet';
if (new URL(rpcUrl).protocol !== 'https:' || new URL(rpcUrl).username || new URL(rpcUrl).password) throw Error('A public HTTPS mainnet RPC is required.');
const viewport = {width: 1800, height: 900};
const readMethods = new Set(['starknet_chainId', 'starknet_specVersion', 'starknet_blockNumber', 'starknet_blockHashAndNumber', 'starknet_getBlockWithTxHashes', 'starknet_getBlockWithReceipts', 'starknet_getEvents', 'starknet_getTransactionReceipt', 'starknet_getTransactionByHash', 'starknet_getClassHashAt', 'starknet_getStorageAt', 'starknet_call']);
const evidence = JSON.parse(await readFile(resolve(root, 'deployments/mainnet/chat-message-2026-09-08.json'), 'utf8'));
const operator = '0x2baf5bf273ff0ecf729e1b9d455889a2dfbc831c944e48a124367295d2d6bc3';
const message = 'Hey, the private chat is live. Can you see this message?';
const same = (a, b) => BigInt(a) === BigInt(b);
const scenes = [], blocked = [], failures = [];
const runId = `social-${new Date().toISOString().replace(/[:.]/g, '-')}`;

async function verifyMainnetMessage() {
  const provider = new RpcProvider({nodeUrl: rpcUrl});
  assert(same(await provider.getChainId(), evidence.chainId), 'Wrong mainnet chain');
  const receipt = await provider.getTransactionReceipt(evidence.transaction.hash);
  assert.equal(receipt.execution_status, 'SUCCEEDED');
  assert(['ACCEPTED_ON_L1', 'ACCEPTED_ON_L2'].includes(receipt.finality_status));
  const [chatClass, poolClass] = await Promise.all([
    provider.getClassHashAt(evidence.chat.address, receipt.block_hash),
    provider.getClassHashAt(evidence.pool.address, receipt.block_hash),
  ]);
  assert(same(chatClass, evidence.chat.classHash) && same(poolClass, evidence.pool.classHash), 'Receipt deployment pins changed');
  const events = receipt.events.filter(event => same(event.from_address, evidence.chat.address) && same(event.keys[0], hash.getSelectorFromName('MessagePosted')));
  assert.equal(events.length, 1);
  const data = events[0].data;
  const count = Number(BigInt(data[5]));
  assert.equal(data.length, count + 7);
  return {receipt, record: {ephemeralPub: data.slice(0, 2), viewTag: Number(BigInt(data[2])), nonce: data.slice(3, 5), ciphertextFelts: data.slice(6, -1)}};
}

async function protect(context, allowedOrigin, privateMode = false, quoteOnly = false) {
  // JSON-RPC uses POST even for reads. Only these named read methods can leave
  // the isolated browser; no addInvoke/declare/deploy, proofs or quote writes.
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (quoteOnly && url.origin === allowedOrigin && url.pathname.startsWith('/api/confidential/')) {
      const read = request.method() === 'GET' && (/^\/api\/confidential\/makers$/.test(url.pathname) || /^\/api\/confidential\/rooms\/[A-Za-z0-9_-]{32}$/.test(url.pathname));
      let body;
      try { body = request.method() === 'POST' ? request.postDataJSON() : undefined; } catch {}
      const create = request.method() === 'POST' && url.pathname === '/api/confidential/rooms' && body && Object.keys(body).sort().join(',') === 'envelope,id,maker' && body.maker && same(body.maker, operator) && /^[A-Za-z0-9_-]{32}$/.test(body.id) && body.envelope && Object.keys(body.envelope).sort().join(',') === 'ciphertext,enc,id' && /^[A-Za-z0-9_-]{32}$/.test(body.envelope.id) && /^[A-Za-z0-9_-]{87}$/.test(body.envelope.enc) && /^[A-Za-z0-9_-]{683,88000}$/.test(body.envelope.ciphertext) && JSON.stringify(body).length < 100_000;
      if (read || create) {
        const headers = {'origin': origin, ...(create ? {'content-type': 'application/json'} : {})};
        const authorization = request.headers().authorization;
        if (authorization) { if (!/^Room [A-Za-z0-9_-]{32}$/.test(authorization)) throw Error('Only anonymous room capabilities are allowed in this capture'); headers.authorization = authorization; }
        const response = await fetch(origin + url.pathname + url.search, {method: request.method(), headers, ...(create ? {body: JSON.stringify(body)} : {}), redirect: 'error', signal: AbortSignal.timeout(30_000)});
        return route.fulfill({status: response.status, contentType: 'application/json', body: await response.text()});
      }
      failures.push('A non-quote operation was blocked');
      return route.abort();
    }
    if (request.method() === 'GET' || request.method() === 'HEAD') {
      if (url.origin === allowedOrigin || (!privateMode && request.resourceType() === 'font')) return route.continue();
      blocked.push({kind: 'external-read', host: url.host});
      return route.abort();
    }
    if (request.method() === 'POST' && url.origin === allowedOrigin && url.pathname === '/api/starknet/mainnet') {
      let payload;
      try { payload = request.postDataJSON(); } catch { return route.abort(); }
      const batch = Array.isArray(payload) ? payload : [payload];
      if (batch.length > 0 && batch.length <= 20 && batch.every(item => item && readMethods.has(item.method))) {
        // Forward the unchanged read to a public RPC. No operator files,
        // private keys, message plaintext or wallet tokens enter this request.
        const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(20_000)});
        return route.fulfill({status: response.status, contentType: 'application/json', body: await response.text()});
      }
    }
    blocked.push({kind: 'write', host: url.host, path: url.pathname, method: request.method()});
    if (url.origin === allowedOrigin && !url.pathname.includes('telemetry')) failures.push('Unexpected application write was blocked');
    await route.abort();
  });
}

async function recordScene(browser, {id, title, path, setup, shoot, source = origin, label = 'PRODUCT PREVIEW', provenance = 'Current deployed website; read-only controls', quoteOnly = false}) {
  if (config.sceneIds && !config.sceneIds.includes(id)) return;
  const context = await browser.newContext({viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference', serviceWorkers: 'block', recordVideo: {dir: resolve(destination, 'raw'), size: viewport}});
  let page, video;
  try {
    await protect(context, source, source === sourceOrigin, quoteOnly);
    page = await context.newPage(); video = page.video();
    page.setDefaultTimeout(20_000);
    page.on('pageerror', () => failures.push(`Page error in ${id}`)); // Never log page state or private arguments.
    const demo = await presentation(page, `${runId}-${id}`);
    const recordingStarted = Date.now();
    await page.goto(source + path, {waitUntil: 'domcontentloaded'});
    await page.locator('.app-brand').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await setup?.(page, demo);
    assert.equal(await page.locator('.signal-bar, .app-signal-bar, .app-signal').count(), 0, 'Remove the old signal bar before filming');
    const start = (Date.now() - recordingStarted) / 1000;
    await demo.mark(title);
    await shoot(page, demo);
    const end = (Date.now() - recordingStarted) / 1000;
    assert.equal(await page.evaluate(() => window.__app20CaptureSigningAttempts ?? 0), 0, 'No wallet signing or value method may be called');
    await page.screenshot({path: resolve(destination, `${id}.png`)});
    await demo.mark('End scene');
    await context.close();
    const file = resolve(destination, `${id}.webm`);
    await video.saveAs(file);
    scenes.push({id, title, file, start, sourceSeconds: end - start, browserPath: (source === origin ? new URL(origin).host + path : `Source preview · ${new URL(origin).host}${path}`), label, provenance, newTransactions: 0});
    console.log(`Captured ${id} (${(end - start).toFixed(1)}s, read-only).`);
  } finally { await context.close().catch(() => {}); }
}

async function openOperatorMailbox(page) {
  const checked = await verifyMainnetMessage();
  // This is the identical derivation used by scripts/mainnet-chat-proof.mjs.
  // No spend key is needed, and neither this seed nor the viewing key is saved.
  const protectedFile = resolve(homedir(), '.config/app20/mainnet-demo/viewing-key.json');
  const viewing = BigInt(JSON.parse(await readFile(protectedFile, 'utf8')).key);
  const seed = createHash('sha256').update('app20/mainnet-proof/chat-key/v1:' + viewing.toString(16)).digest();
  const passphrase = randomBytes(24).toString('base64url');
  try {
    await page.evaluate(async ({address, chainId}) => {
      const {useStoreWallet} = await import('/src/app/components/Wallet/walletContext.ts');
      const {useFrontendProvider} = await import('/src/app/components/client/provider/providerContext.ts');
      const stop = async () => { window.__app20CaptureSigningAttempts = (window.__app20CaptureSigningAttempts ?? 0) + 1; throw Error('This capture wallet is read-only.'); };
      useFrontendProvider.getState().setCurrentFrontendProviderIndex(0);
      useStoreWallet.setState({address, chain: chainId, isConnected: true, isStrk20Capable: false, myWalletAccount: {address, execute: stop, executeWithProof: stop, signMessage: stop, strk20InvokeTransaction: stop, request: stop}});
    }, {address: operator, chainId: evidence.chainId});
    await page.waitForTimeout(250); // Let scope listeners clear any previous key before unlocking.
    const opened = await page.evaluate(async ({bytes, record, address, chainId, expected, passphrase, helper}) => {
      const {deriveKeypair, decryptMail, publicKeyToFelts} = await import('/src/lib/mail.ts');
      const {persistWrappedSeed} = await import('/src/lib/mail-vault.ts');
      const {myFrontendProviders} = await import('/src/utils/constants.ts');
      const seed = Uint8Array.from(bytes), keypair = deriveKeypair(seed);
      try {
        if (new TextDecoder().decode(await decryptMail(keypair.privateKey, record)) !== expected) throw Error('The on-chain message failed authentication');
        const registered = await myFrontendProviders[0].callContract({contractAddress: helper, entrypoint: 'get_pubkey', calldata: [address]});
        const expectedKey = publicKeyToFelts(keypair.publicKey);
        if (registered.length !== 2 || registered.some((value, i) => BigInt(value) !== BigInt(expectedKey[i]))) throw Error('Register the matching operator mailbox before this read-only capture');
        await persistWrappedSeed(localStorage, chainId, address, seed, passphrase);
        return true;
      } finally { seed.fill(0); keypair.privateKey.fill(0); }
    }, {bytes: [...seed], record: checked.record, address: operator, chainId: evidence.chainId, expected: message, passphrase, helper: evidence.chat.address});
    assert(opened);
  } finally { seed.fill(0); }
  await page.getByRole('navigation', {name: 'APP20 modules'}).getByRole('link', {name: 'Chat', exact: true}).click();
  await page.getByLabel('Chat passphrase', {exact: true}).fill(passphrase);
  await page.getByRole('button', {name: 'Unlock chat', exact: true}).click();
  const row = page.getByRole('button').filter({hasText: message});
  for (let older = 0; older <= 32; older++) {
    if (await row.count()) break;
    await page.waitForTimeout(1_500);
    if (await row.count()) break;
    const tools = page.locator('details[aria-label="Chat tools"]');
    if (!(await tools.getAttribute('open'))) await tools.locator(':scope > summary').click();
    const history = tools.locator('details').filter({has: page.locator('summary', {hasText: 'Message history'})}).first();
    if (!(await history.getAttribute('open'))) await history.locator(':scope > summary').click();
    const load = page.getByRole('button', {name: 'Load older messages', exact: true});
    await load.waitFor();
    await load.click({timeout: 30_000});
  }
  await row.first().waitFor({timeout: 30_000});
  await row.first().click();
  if (config.chatAssociateSelf) {
    await page.getByRole('textbox', {name: 'Reply wallet address', exact: true}).fill(operator);
    await page.getByRole('button', {name: 'Set reply wallet', exact: true}).click();
    const dismiss = page.getByRole('button', {name: 'Dismiss notice', exact: true});
    if (await dismiss.count()) await dismiss.click();
    await page.getByRole('button').filter({hasText: message}).first().click();
    await page.locator('header').getByText('This chat', {exact: true}).waitFor();
    assert.equal(await page.getByRole('textbox', {name: 'Reply wallet address', exact: true}).count(), 0);
    // Chat intentionally has no composer for a self-associated message. Do not
    // invent a second participant or enable a Send action for the recording.
    assert.equal(await page.locator('#chat-composer').count(), 0);
  }
  await page.getByRole('main', {name: 'APP20 Chat'}).getByText(message, {exact: true}).last().waitFor();
  // A watch-only source preview must not masquerade as a connected Ready app.
  // Omit the app's wallet/session header from this isolated capture only; the
  // editor's browser title identifies the source and read-only mainnet scope.
  await page.addStyleTag({content: '.app-header{display:none!important}.app-shell{--app-shell-offset:0px!important} details[aria-label="Chat tools"]{display:none!important}'});
  return checked.receipt;
}

if (values['check-only']) {
  const checked = await verifyMainnetMessage();
  console.log(JSON.stringify({origin, destination, viewport, chatMode: sourceOrigin ? 'isolated-watch-only-mainnet' : 'production-welcome', mainnetMessage: {hash: evidence.transaction.hash, block: checked.receipt.block_number, finality: checked.receipt.finality_status}, signing: false, broadcasting: false}, null, 2));
} else {
  await mkdir(destination, {recursive: true});
  const browser = await chromium.launch();
  try {
    await recordScene(browser, {id: '01-rfq-terms', title: 'Set your terms', path: '/rfq', shoot: async (page, demo) => {
      await demo.point(page.getByRole('heading', {name: 'Instant RFQ', exact: true})); await demo.hold(1.5);
      await page.getByLabel('You sell (STRK)', {exact: true}).fill('25');
      await page.getByLabel('Minimum you receive (USDC)', {exact: true}).fill('1.5');
      await demo.point(page.getByRole('button', {name: 'Request quotes', exact: true})); await demo.hold(4);
    }});
    await recordScene(browser, {id: '02-rfq-direction', title: 'Choose the direction', path: '/rfq', shoot: async (page, demo) => {
      await page.getByRole('button', {name: 'Reverse swap direction', exact: true}).click();
      await page.getByLabel('You sell (USDC)', {exact: true}).fill('2');
      await page.getByLabel('Minimum you receive (STRK)', {exact: true}).fill('25');
      await demo.hold(4);
    }});
    await recordScene(browser, sourceOrigin ? {id: '03-chat', title: 'Open an encrypted conversation', path: '/chat', source: sourceOrigin, label: 'MAINNET · READ-ONLY', provenance: 'Current source UI with isolated watch-only operator scope; actual mainnet event authenticated and decrypted; no native Ready connection', setup: async (page) => {
      // Start outside Chat, then use its normal encrypted-vault unlock.
      await page.goto(sourceOrigin + '/rfq', {waitUntil: 'domcontentloaded'});
      await page.getByRole('heading', {name: 'Instant RFQ', exact: true}).waitFor();
      await openOperatorMailbox(page);
    }, shoot: async (page, demo) => {
      await demo.point(page.getByRole('heading', {name: 'Chat', exact: true})); await demo.hold(2);
      await demo.point(page.getByRole('main', {name: 'APP20 Chat'}).getByText(message, {exact: true}).last()); await demo.hold(8);
    }} : {id: '03-chat', title: 'Open an encrypted conversation', path: '/chat', shoot: async (page, demo) => {
      await demo.point(page.getByRole('heading', {name: 'Chat', exact: true})); await demo.hold(2);
      await demo.point(page.getByRole('heading', {name: 'Connect your wallet to open Chat', exact: true})); await demo.hold(7);
    }});
    if (config.quoteOnly && sourceOrigin) await recordScene(browser, {id: '06-live-quote', title: 'Review a private quote', path: '/rfq', source: sourceOrigin, label: 'LIVE ENCRYPTED QUOTE', quoteOnly: true, provenance: 'Current source UI with isolated watch-only taker; real encrypted APP20 room and operator-controlled maker; quote only, no signatures or value movements', setup: async (page) => {
      const taker = config.taker ?? '0x3055ae83ad35ec22a64a98ad08a8389be4eb7fb2a1b749e53beaeac8e8877ba';
      assert(/^0x[0-9a-f]{1,64}$/i.test(taker) && BigInt(taker) > 0n);
      await page.evaluate(async address => {
        const {useStoreWallet} = await import('/src/app/components/Wallet/walletContext.ts');
        const {useFrontendProvider} = await import('/src/app/components/client/provider/providerContext.ts');
        const stop = async () => { window.__app20CaptureSigningAttempts = (window.__app20CaptureSigningAttempts ?? 0) + 1; throw Error('This quote-only wallet cannot sign or move funds.'); };
        useFrontendProvider.getState().setCurrentFrontendProviderIndex(0);
        useStoreWallet.setState({address, chain: '0x534e5f4d41494e', isConnected: true, isStrk20Capable: true, myWalletAccount: {address, execute: stop, executeWithProof: stop, signMessage: stop, strk20InvokeTransaction: stop, request: stop}});
      }, taker);
      await page.addStyleTag({content: '.app-header{display:none!important}.app-shell{--app-shell-offset:0px!important}'});
      await page.getByLabel('Quote from', {exact: true}).selectOption(operator, {timeout: 60_000});
      await page.getByRole('button', {name: 'Request quotes', exact: true}).waitFor();
    }, shoot: async (page, demo) => {
      await page.getByLabel('You sell (STRK)', {exact: true}).fill('0.01');
      await page.getByLabel('Minimum you receive (USDC)', {exact: true}).fill('0.0009');
      await page.getByRole('button', {name: 'Request quotes', exact: true}).click({timeout: 60_000});
      const review = page.getByRole('button', {name: 'Review & set up swap', exact: true});
      await review.first().waitFor({timeout: 90_000});
      await demo.mark('Real encrypted quote received');
      await demo.point(review.first());
      await demo.hold(8);
    }});
    await recordScene(browser, {id: '04-agents', title: 'Build with the SDK', path: '/agents', setup: async (page) => {
      await page.getByRole('heading', {name: 'Node.js library', exact: true}).evaluate(element => window.scrollTo({top: scrollY + element.getBoundingClientRect().top - 125}));
    }, shoot: async (page, demo) => {
      await demo.point(page.getByRole('heading', {name: 'Node.js library', exact: true})); await demo.hold(3);
      await demo.point(page.getByRole('link', {name: 'API guide and examples', exact: true})); await demo.hold(6);
    }});
    await recordScene(browser, {id: '05-privacy', title: 'Know what stays visible', path: '/rfq', shoot: async (page, demo) => {
      await page.locator('summary').filter({hasText: 'Privacy & fees'}).click();
      await demo.hold(9);
    }});
    assert.deepEqual(failures, [], 'Capture encountered an application error or attempted write');
    await writeFile(resolve(destination, 'capture-manifest.json'), JSON.stringify({schema: 'app20-social-capture/v1', capturedAt: new Date().toISOString(), origin, viewport, newTransactions: 0, simulatedChainData: false, simulatedMessages: false, receiptChapter: false, scenes, blockedRequests: blocked}, null, 2) + '\n');
  } finally { await browser.close(); }
}
