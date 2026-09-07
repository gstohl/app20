#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, mkdirSync, fsyncSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Account, RpcProvider, hash } from 'starknet';
import { rejectPublicSettlement } from '../packages/domain/src/settlement-privacy.ts';
import { coordinatesKey, decodeRequest, felt, keyCoordinates, open, publicKey, responseCall, seal } from '../packages/private-intents/src/starknet-maker.ts';
import { canRespond, validateResponseLimits } from '../packages/maker-node/src/response-limits.ts';
import { priceRequest, validateMarket } from '../packages/maker-node/src/starknet-pricing.ts';
import { verifyMakerBook, verifySettlement } from '../src/lib/starknet-maker-client.ts';

const [configPath, mode = '--check'] = process.argv.slice(2);
// Stop before reading operator files, loading keys, accessing RPC, or spawning transactions.
if (['--register', '--run', '--fund'].includes(mode)) rejectPublicSettlement();
if (configPath === '--init-key') {
  if (!mode || mode.startsWith('--')) throw new Error('Usage: node app20-maker.mjs --init-key ./maker-key.json');
  const path = resolve(mode);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(privateJwk) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  console.log('Private key saved locally with owner-only permissions. Paste only this PUBLIC key into maker setup:');
  console.log(JSON.stringify(publicJwk));
  process.exit(0);
}

if (!configPath || !['--check', '--register', '--run', '--deactivate', '--fund', '--withdraw', '--release', '--reconcile'].includes(mode)) {
  console.error('Usage: npm run maker -- operator.json [--check|--register|--run|--deactivate|--fund|--withdraw|--release|--reconcile]');
  process.exit(1);
}
const config = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
const url = new URL(config.rpcUrl);
if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use an HTTPS Starknet RPC, or loopback for development.');
felt(config.account); felt(config.address); felt(config.classHash); felt(config.chainId);
if (!Array.isArray(config.markets)) throw new Error('Expected operator markets.');
config.markets.forEach(validateMarket);
validateResponseLimits(config);
if (!Number.isSafeInteger(config.maxResponses) || config.maxResponses < 1 || config.maxResponses > 1000) throw new Error('Set maxResponses between 1 and 1000 per run.');
if (!/^[1-9][0-9]*$/.test(config.maxFeePerTransaction) || !/^[1-9][0-9]*$/.test(config.maxTotalFees)) throw new Error('Set positive STRK base-unit fee caps.');
const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
const verifyConfigSettlement = () => verifySettlement(provider, config, config.settlement, !['--withdraw', '--release', '--reconcile', '--deactivate'].includes(mode));
await verifyMakerBook(provider, config);
if (config.settlement) await verifyConfigSettlement();
if (mode === '--check') {
  console.log(`Deployment and pricing configuration verified. No signing key loaded; no transaction sent. ${config.settlement ? 'Funded private settlement configured.' : 'Indicative quoting only; no settlement configured.'}`);
  process.exit(0);
}
const signingKey = process.env.APP20_MAKER_SIGNING_KEY;
if (!signingKey && mode !== '--reconcile') throw new Error('Set APP20_MAKER_SIGNING_KEY for this operator account.');
const account = signingKey ? new Account({ provider, address: config.account, signer: signingKey, cairoVersion: '1' }) : undefined;
const statePath = resolve(config.stateFile);
mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
// One process per state file. After a crash, investigate the pending account
// transaction before manually removing the lock. Never automatically resend.
const lock = openSync(`${statePath}.lock`, 'wx', 0o600);
let state;
try {
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { scope: [felt(config.chainId), felt(config.address), felt(config.account)].join('/'), cursor: config.fromBlock, spent: '0', pending: null, reservations: [], settlement: config.settlement?.address ?? null }; }
  if (state.scope !== [felt(config.chainId), felt(config.address), felt(config.account)].join('/') || !Number.isSafeInteger(state.cursor) || state.cursor < config.fromBlock || !/^[0-9]+$/.test(state.spent)) throw new Error('Maker state does not match this account/deployment.');
  if ((state.settlement ?? null) !== (config.settlement?.address ?? null)) throw new Error('Use a separate state file for a different settlement deployment.');
  state.reservations ??= [];
  state.recentResponses ??= {};
  if (!Array.isArray(state.reservations)) throw new Error('Invalid reservation state.');
  if (state.pending && mode !== '--reconcile') throw new Error('An earlier transaction is unresolved. Reconcile it on Starknet before clearing pending state; do not blindly resend.');
  const save = () => {
    const fd = openSync(`${statePath}.next`, 'w', 0o600);
    try { writeFileSync(fd, `${JSON.stringify(state)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(`${statePath}.next`, statePath);
    const dir = openSync(dirname(statePath), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  };
  const send = async (input, reservationId) => {
    const calls = Array.isArray(input) ? input : [input];
    if (config.settlement) await verifyConfigSettlement();
    await verifyMakerBook(provider, config);
    const estimate = await account.estimateInvokeFee(calls, { tip: 0n });
    const bounds = estimate.resourceBounds;
    const cap = Object.values(bounds).reduce((sum, resource) => sum + BigInt(resource.max_amount) * BigInt(resource.max_price_per_unit), 0n);
    if (cap > BigInt(config.maxFeePerTransaction) || cap + BigInt(state.spent) > BigInt(config.maxTotalFees)) throw new Error('Operator gas budget reached.');
    state.pending = { entrypoints: calls.map(call => call.entrypoint), hash: null, reservationId };
    // Conservatively reserve the maximum, even if a submission is uncertain.
    state.spent = (BigInt(state.spent) + cap).toString(); save();
    const tx = await account.execute(calls, { resourceBounds: bounds, tip: 0n });
    state.pending.hash = tx.transaction_hash; save();
    const receipt = await provider.waitForTransaction(tx.transaction_hash, { retryInterval: url.protocol === 'http:' ? 100 : 5000 });
    if (receipt.isReverted()) throw new Error('Maker transaction reverted; inspect the saved hash.');
    if (reservationId && !state.reservations.includes(reservationId)) state.reservations.push(reservationId);
    state.pending = null; save();
    console.log(`Confirmed ${calls.map(call => call.entrypoint).join(" + ")}: ${tx.transaction_hash}`);
  };
  async function releaseReservations() {
    if (!config.settlement) return;
      for (const id of [...state.reservations]) {
        const head = await verifyConfigSettlement();
        const quote = await provider.callContract({ contractAddress: config.settlement.address, entrypoint: 'quote', calldata: [id] }, head.block);
        const status = Number(BigInt(quote[7]));
        if (status === 1 && Number(BigInt(quote[6])) <= head.timestamp) await send({ contractAddress: config.settlement.address, entrypoint: 'release_expired', calldata: [id] });
        else if (status === 1) continue;
        state.reservations = state.reservations.filter(value => value !== id); save();
      }
  }
  if (mode === '--reconcile') {
    if (!state.pending) { console.log('No pending transaction.'); }
    else {
      if (!state.pending.hash) throw new Error('No transaction hash was returned. Inspect account activity before resolving this state manually.');
      const receipt = await provider.getTransactionReceipt(state.pending.hash);
      if (!receipt.isSuccess() && !receipt.isReverted()) throw new Error('The transaction is not final enough to reconcile.');
      if (receipt.isSuccess() && state.pending.reservationId && !state.reservations.includes(state.pending.reservationId)) state.reservations.push(state.pending.reservationId);
      state.pending = null; save(); console.log('Confirmed transaction reconciled; gas budget remains conservatively reserved.');
    }
  } else if (['--fund', '--withdraw', '--release'].includes(mode)) {
    if (!config.settlement) throw new Error('Configure a pinned settlement deployment first.');
    await verifyConfigSettlement();
    if (mode === '--release') {
      await releaseReservations();
    } else {
      const movement = mode === '--fund' ? config.inventoryFunding : config.inventoryWithdrawal;
      if (!movement || !/^[1-9][0-9]*$/.test(movement.amount) || BigInt(movement.amount) >= 1n << 128n) throw new Error('Configure an explicit positive u128 inventory amount.');
      const token = felt(movement.token);
      const movementCall = { contractAddress: config.settlement.address, entrypoint: mode === '--fund' ? 'deposit_inventory' : 'withdraw_inventory', calldata: [token, movement.amount] };
      await send(mode === '--fund' ? [{ contractAddress: token, entrypoint: 'approve', calldata: [config.settlement.address, movement.amount, '0'] }, movementCall] : movementCall);
    }
  } else if (mode === '--deactivate') {
    await send({ contractAddress: config.address, entrypoint: 'deactivate', calldata: [] });
  } else {
    let jwk;
    try { jwk = JSON.parse(process.env.APP20_MAKER_TRANSPORT_FILE ? readFileSync(resolve(process.env.APP20_MAKER_TRANSPORT_FILE), 'utf8') : (process.env.APP20_MAKER_TRANSPORT_JWK ?? '')); }
    catch { throw new Error('Set APP20_MAKER_TRANSPORT_FILE to the private P-256 key file, or APP20_MAKER_TRANSPORT_JWK.'); }
    if (!jwk.d) throw new Error('Transport private key is missing.');
    const recipientKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const pub = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
    const recipientPair = { privateKey: recipientKey, publicKey: await publicKey(pub) };
    if (mode === '--register') {
      const head = await verifyMakerBook(provider, config);
      if (!Number.isSafeInteger(config.keyValidUntil) || config.keyValidUntil <= head.timestamp || config.keyValidUntil > head.timestamp + 2592000) throw new Error('keyValidUntil must be within the next 30 days.');
      await send({ contractAddress: config.address, entrypoint: 'register', calldata: [...keyCoordinates(pub), String(config.keyValidUntil)] });
    } else {
      let responses = 0;
      while (responses < config.maxResponses) {
        await releaseReservations();
        const head = await verifyMakerBook(provider, config);
        const registered = await provider.callContract({ contractAddress: config.address, entrypoint: 'maker', calldata: [config.account] }, head.block);
        const registeredKey = coordinatesKey(registered.slice(0, 4));
        if (registeredKey.x !== pub.x || registeredKey.y !== pub.y || Number(BigInt(registered[5])) <= head.timestamp) throw new Error('Register this encryption key before running the bot.');
        const end = Math.min(head.number, state.cursor + 999);
        if (Math.max(config.fromBlock, state.cursor - 100) <= end) {
          let continuation_token;
          const seenTokens = new Set();
          do {
            const page = await provider.getEvents({ address: config.address, from_block: { block_number: Math.max(config.fromBlock, state.cursor - 100) }, to_block: { block_number: end }, keys: [[hash.getSelectorFromName('Requested')], [config.account]], chunk_size: 50, ...(continuation_token ? { continuation_token } : {}) });
            for (const event of page.events) {
              if (responses >= config.maxResponses) break;
              if (felt(event.from_address) !== felt(config.address) || event.keys.length !== 3 || BigInt(event.keys[0]) !== BigInt(hash.getSelectorFromName('Requested')) || felt(event.keys[1]) !== felt(config.account)) continue;
              if (BigInt(event.data[3]) !== BigInt(event.data.length - 4)) throw new Error('Malformed request event.');
              const scope = { chainId: config.chainId, book: config.address, id: event.keys[2], maker: config.account, taker: event.data[0], revision: Number(BigInt(event.data[1])), expiresAt: Number(BigInt(event.data[2])) };
              const current = await provider.callContract({ contractAddress: config.address, entrypoint: 'get_request', calldata: [scope.id] }, 'latest');
              if (Number(BigInt(current[4])) !== 1 || scope.expiresAt <= head.timestamp || scope.revision !== Number(BigInt(registered[4]))) continue;
              let body, answer;
              try {
                body = await decodeRequest(await open(scope, 'request', event.data.slice(4), recipientPair));
                answer = priceRequest(body, config.markets, Math.max(head.timestamp, Math.floor(Date.now() / 1000)), scope.expiresAt, body.settlementCommitment && config.settlement ? (config.quoteTtlSeconds ?? 1200) : (config.indicativeTtlSeconds ?? 300));
              } catch { continue; } // Bad ciphertext never stops other independent makers.
              if (!answer) continue;
              if (config.settlement) {
                const pin = await verifyConfigSettlement();
                const available = await provider.callContract({ contractAddress: config.settlement.address, entrypoint: 'available', calldata: [config.account, body.buyToken] }, pin.block);
                if (BigInt(available[0]) + (BigInt(available[1]) << 128n) < BigInt(answer.buyAmount)) continue;
              }
              const responseTime = Math.max(head.timestamp, Math.floor(Date.now() / 1000));
              if (!canRespond(config, state.recentResponses, scope.taker, responseTime, Boolean(body.settlementCommitment), state.reservations.length)) continue;
              // Persist admission before submission; an uncertain response consumes its allowance.
              state.recentResponses = Object.fromEntries(Object.entries(state.recentResponses).filter(([, value]) => responseTime - value.at < 86400));
              state.recentResponses[felt(scope.taker)] = { at: responseTime, firm: Boolean(body.settlementCommitment) };
              save();
              if (config.settlement && body.settlementCommitment) {
                answer = { ...answer, kind: 'executable', settlement: config.settlement.address, quoteId: scope.id, commitment: body.settlementCommitment };
                const payload = await seal(scope, 'quote', answer, await publicKey(body.replyKey));
                // Reservation and encrypted reply commit or revert together.
                await send([{ contractAddress: config.settlement.address, entrypoint: 'reserve_quote', calldata: [scope.id, body.sellToken, body.buyToken, body.sellAmount, answer.buyAmount, body.settlementCommitment, String(answer.expiresAt)] }, responseCall(scope, payload)], scope.id);
              } else {
                const payload = await seal(scope, 'quote', answer, await publicKey(body.replyKey));
                await send(responseCall(scope, payload));
              }
              responses++;
            }
            continuation_token = page.continuation_token;
            if (continuation_token && seenTokens.has(continuation_token)) throw new Error('RPC pagination did not advance.');
            if (continuation_token) seenTokens.add(continuation_token);
          } while (continuation_token && responses < config.maxResponses);
          // A partially processed range is replayed; on-chain status skips answers.
          if (responses < config.maxResponses) { state.cursor = end + 1; save(); }
        }
        if (responses < config.maxResponses) await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }
} finally {
  closeSync(lock); unlinkSync(`${statePath}.lock`);
}
