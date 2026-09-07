import { it, expect } from 'vitest';
import { rankQuotes } from './quote-comparison';
import type { SavedMakerRequest } from './maker-request-store';
const row = (id: string, buyAmount: string, expiresAt = 2000): SavedMakerRequest => ({
  scope: { id, maker: id, taker: '0x9', book: '0xa', chainId: '0xb', revision: 1, expiresAt: 2000 },
  terms: { sellToken: '0x1', buyToken: '0x2', sellAmount: '10', minBuyAmount: '9007199254740992' },
  comparisonId: '0xc', stage: 'comparison', status: 'submitted', replyKey: {} as CryptoKeyPair,
  indicativeAnswer: { kind: 'indicative', buyAmount, expiresAt },
});
it('ranks exact amounts above JS integer precision and excludes below-minimum, expired and unrelated offers', () => {
  const best = row('0x3', '9007199254740993');
  const next = row('0x4', '9007199254740992');
  const below = row('0x5', '9007199254740991');
  const expired = row('0x6', '9999999999999999', 1000);
  const unrelated = { ...row('0x7', '9999999999999999'), comparisonId: '0xd' };
  const differentTerms = { ...row('0x8', '9999999999999999'), terms: { ...best.terms, sellAmount: '11' } };
  expect(rankQuotes([next, below, expired, unrelated, best, differentTerms], '0xc', 1000).map(r => r.scope.id)).toEqual(['0x3', '0x4']);
  expect(rankQuotes([best], '0xc', 2000)).toEqual([]);
});
