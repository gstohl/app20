import { hash, type ProviderInterface } from 'starknet';
import { coordinatesKey, felt, publicKey, type MakerScope } from '@app20/private-intents/starknet-maker';

export type MakerBookConfig = Readonly<{ address: string; classHash: string; chainId: string; fromBlock: number }>;
export type RegisteredMaker = Readonly<{ address: string; revision: number; validUntil: number; key: JsonWebKey }>;
export async function verifyMakerBook(provider: ProviderInterface, config: MakerBookConfig) {
  if (!Number.isSafeInteger(config.fromBlock) || config.fromBlock < 0) throw new Error('Invalid maker deployment block.');
  if (felt(await provider.getChainId()) !== felt(config.chainId)) throw new Error('Maker book network does not match.');
  const head = await provider.getBlockWithTxHashes('latest');
  if (!('block_hash' in head) || !head.block_hash || !('block_number' in head)) throw new Error('Confirmed block unavailable.');
  const block = head.block_hash;
  if (felt(await provider.getClassHashAt(config.address, block)) !== felt(config.classHash)) throw new Error('Maker book contract does not match the pinned deployment.');
  return { block, number: head.block_number, timestamp: head.timestamp };
}
export async function readMakerPage(provider: ProviderInterface, config: MakerBookConfig, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid maker page.');
  const head = await verifyMakerBook(provider, config);
  const call = (entrypoint: string, calldata: string[] = []) => provider.callContract({ contractAddress: config.address, entrypoint, calldata }, head.block);
  const result = await call('maker_count');
  const count = Number(BigInt(result[0]!));
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid maker count.');
  const makers: RegisteredMaker[] = [];
  // Bound each page so a permissionless registry cannot trigger unbounded RPC work.
  for (let i = offset; i < Math.min(count, offset + 20); i++) {
    const [address] = await call('maker_at', [String(i)]);
    const values = await call('maker', [felt(address!)]);
    if (values.length !== 6) throw new Error('Invalid maker record.');
    const revision = Number(BigInt(values[4]!)), validUntil = Number(BigInt(values[5]!));
    if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(validUntil)) throw new Error('Invalid maker key window.');
    if (revision <= 0 || validUntil <= head.timestamp) continue;
    const key = coordinatesKey(values.slice(0, 4));
    try { await publicKey(key); } catch { continue; } // Untrusted registrations cannot break discovery.
    makers.push({ address: felt(address!), revision, validUntil, key });
  }
  return { makers, totalCount: count, nextOffset: offset + 20 < count ? offset + 20 : undefined, head };
}
export async function readMakerAnswer(provider: ProviderInterface, config: MakerBookConfig, scope: MakerScope) {
  const head = await verifyMakerBook(provider, config);
  if (felt(scope.chainId) !== felt(config.chainId) || felt(scope.book) !== felt(config.address)) throw new Error('Request deployment changed.');
  const state = await provider.callContract({ contractAddress: config.address, entrypoint: 'get_request', calldata: [scope.id] }, head.block);
  if (state.length !== 5 || felt(state[0]!) !== felt(scope.taker) || felt(state[1]!) !== felt(scope.maker) || Number(BigInt(state[2]!)) !== scope.revision || Number(BigInt(state[3]!)) !== scope.expiresAt) throw new Error('On-chain request does not match.');
  if (Number(BigInt(state[4]!)) !== 2) return undefined;
  const matches: string[][] = [];
  let continuation: string | undefined;
  const tokens = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const events = await provider.getEvents({ address: config.address, from_block: { block_number: config.fromBlock }, to_block: { block_hash: head.block }, keys: [[hash.getSelectorFromName('Responded')], [scope.id], [scope.maker]], chunk_size: 100, ...(continuation ? { continuation_token: continuation } : {}) });
    for (const event of events.events) {
      // Verify returned keys as well as the requested RPC filter.
      if (felt(event.from_address) !== felt(config.address) || event.keys.length !== 3 || BigInt(event.keys[0]!) !== BigInt(hash.getSelectorFromName('Responded')) || BigInt(event.keys[1]!) !== BigInt(scope.id) || BigInt(event.keys[2]!) !== BigInt(scope.maker)) continue;
      if (BigInt(event.data[0]!) !== BigInt(event.data.length - 1)) throw new Error('Invalid response event.');
      matches.push(event.data.slice(1));
    }
    continuation = events.continuation_token;
    if (!continuation) {
      if (matches.length !== 1) throw new Error('Ambiguous maker response.');
      return matches[0]!;
    }
    if (tokens.has(continuation)) throw new Error('RPC pagination did not advance.');
    tokens.add(continuation);
  }
  throw new Error('Maker response scan exceeded its bounded page limit.');
}

import type { SettlementDeployment, ExecutableMakerAnswer } from '@app20/private-intents/private-settlement';
import type { MakerTerms } from '@app20/private-intents/starknet-maker';
export async function verifySettlement(provider: ProviderInterface, config: MakerBookConfig, deployment: SettlementDeployment, requireOutputNotes = true) {
  const head = await verifyMakerBook(provider, config);
  const [classHash, poolClassHash, pool, book, blocked] = await Promise.all([
    provider.getClassHashAt(deployment.address, head.block),
    requireOutputNotes ? provider.getClassHashAt(deployment.pool, head.block) : Promise.resolve(deployment.poolClassHash),
    provider.callContract({ contractAddress: deployment.address, entrypoint: 'pool', calldata: [] }, head.block),
    provider.callContract({ contractAddress: deployment.address, entrypoint: 'book', calldata: [] }, head.block),
    requireOutputNotes ? provider.callContract({ contractAddress: deployment.pool, entrypoint: 'is_open_note_depositor_blocked', calldata: [deployment.address] }, head.block) : Promise.resolve(['0x0']),
  ]);
  if (felt(classHash) !== felt(deployment.classHash) || felt(poolClassHash) !== felt(deployment.poolClassHash) || felt(pool[0]!) !== felt(deployment.pool) || felt(book[0]!) !== felt(config.address)) throw new Error('Settlement deployment or privacy pool does not match its pinned configuration.');
  if (blocked.length !== 1 || BigInt(blocked[0]!) !== 0n) throw new Error('The privacy pool does not currently accept output notes from this settlement contract.');
  return head;
}
export async function readExecutableQuote(provider: ProviderInterface, config: MakerBookConfig, deployment: SettlementDeployment, scope: MakerScope, terms: MakerTerms, answer: ExecutableMakerAnswer, requireOutputNotes = true) {
  const head = await verifySettlement(provider, config, deployment, requireOutputNotes);
  const values = await provider.callContract({ contractAddress: deployment.address, entrypoint: 'quote', calldata: [scope.id] }, head.block);
  if (values.length !== 8 || felt(values[0]!) !== felt(scope.maker) || felt(values[1]!) !== felt(terms.sellToken) || felt(values[2]!) !== felt(terms.buyToken) || BigInt(values[3]!) !== BigInt(terms.sellAmount) || BigInt(values[4]!) !== BigInt(answer.buyAmount) || felt(values[5]!) !== felt(answer.commitment) || Number(BigInt(values[6]!)) !== answer.expiresAt || felt(answer.settlement) !== felt(deployment.address) || felt(answer.quoteId) !== felt(scope.id)) throw new Error('The on-chain reservation does not match this quote.');
  const status = Number(BigInt(values[7]!));
  return { status, expired: head.timestamp >= answer.expiresAt, head };
}
