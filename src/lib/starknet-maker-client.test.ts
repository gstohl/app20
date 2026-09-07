import { describe, it, expect } from 'vitest';
import type { ProviderInterface } from 'starknet';
import { generateTransportKey, keyCoordinates } from '@app20/private-intents/starknet-maker';
import { readMakerPage, verifyMakerBook, readMakerAnswer } from './starknet-maker-client';
const config = { address: '0x1', classHash: '0x2', chainId: '0x3', fromBlock: 10 };
function provider(overrides = {}) {
  return { getChainId: async () => '0x3', getClassHashAt: async () => '0x2', getBlockWithTxHashes: async () => ({ block_hash: '0xaa', block_number: 12, timestamp: 1000 }), ...overrides } as unknown as ProviderInterface;
}
describe('pinned maker discovery', () => {
  it('rejects another network or class before reading makers', async () => {
    await expect(verifyMakerBook(provider({ getChainId: async () => '0x4' }), config)).rejects.toThrow('network');
    await expect(verifyMakerBook(provider({ getClassHashAt: async () => '0x4' }), config)).rejects.toThrow('pinned');
  });
  it('reads a bounded page at one block and skips invalid and expired registrations', async () => {
    const key = await crypto.subtle.exportKey('jwk', (await generateTransportKey()).publicKey);
    const blocks: string[] = [];
    const p = provider({ callContract: async (call: { entrypoint: string; calldata: string[] }, block: string) => {
      blocks.push(block);
      if (call.entrypoint === 'maker_count') return ['22'];
      if (call.entrypoint === 'maker_at') return [`0x${(Number(call.calldata[0]) + 1).toString(16)}`];
      return [...(call.calldata[0] === '0x1' ? ['1', '0', '1', '0'] : keyCoordinates(key)), '1', call.calldata[0] === '0x2' ? '999' : '2000'];
    } });
    const page = await readMakerPage(p, config);
    expect(page.makers).toHaveLength(18); expect(page.nextOffset).toBe(20);
    expect(new Set(blocks)).toEqual(new Set(['0xaa']));
    expect(blocks).toHaveLength(41);
  });
  it('does not accept a response from a different request owner', async () => {
    const scope = { chainId: '0x3', book: '0x1', id: '0x5', maker: '0x6', taker: '0x7', revision: 1, expiresAt: 1500 };
    await expect(readMakerAnswer(provider({ callContract: async () => ['0x8', '0x6', '1', '1500', '2'] }), config, scope)).rejects.toThrow('does not match');
  });
});

import { readExecutableQuote, verifySettlement } from './starknet-maker-client';
it('checks settlement backing identity and quote terms before authorizing value', async () => {
  const deployment = { address: '0x20', classHash: '0x21', pool: '0x22', poolClassHash: '0x23' };
  const scope = { chainId: '0x3', book: '0x1', id: '0x5', maker: '0x6', taker: '0x7', revision: 1, expiresAt: 1500 };
  const terms = { sellToken: '0x30', buyToken: '0x31', sellAmount: '40', minBuyAmount: '75' };
  const answer = { kind: 'executable' as const, settlement: '0x20', quoteId: '0x5', commitment: '0x32', buyAmount: '76', expiresAt: 1400 };
  let wrongAmount = false, blocked = false;
  const p = provider({
    getClassHashAt: async (address: string) => address === '0x20' ? '0x21' : address === '0x22' ? '0x23' : '0x2',
    callContract: async (call: { entrypoint: string }) => {
      if (call.entrypoint === 'pool') return ['0x22'];
      if (call.entrypoint === 'book') return ['0x1'];
      if (call.entrypoint === 'is_open_note_depositor_blocked') return [blocked ? '0x1' : '0x0'];
      return ['0x6', '0x30', '0x31', '40', wrongAmount ? '75' : '76', '0x32', '1400', '1'];
    },
  });
  expect((await readExecutableQuote(p, config, deployment, scope, terms, answer)).status).toBe(1);
  wrongAmount = true;
  await expect(readExecutableQuote(p, config, deployment, scope, terms, answer)).rejects.toThrow('does not match');
  blocked = true;
  await expect(verifySettlement(p, config, deployment)).rejects.toThrow('does not currently accept');
  await expect(verifySettlement(p, config, deployment, false)).resolves.toMatchObject({ block: '0xaa' });
});
