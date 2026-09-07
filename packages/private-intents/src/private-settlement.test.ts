import { it, expect } from 'vitest';
import { buildPrivateSettlementActions, decodeExecutableAnswer, settlementCommitment } from './private-settlement.ts';
const scope = { chainId: '0x1', book: '0x2', id: '0x3', maker: '0x4', taker: '0x5', revision: 1, expiresAt: 2000 };
const deployment = { address: '0x6', classHash: '0x7', pool: '0x8', poolClassHash: '0x9' };
const terms = { sellToken: '0x10', buyToken: '0x11', sellAmount: '40', minBuyAmount: '75' };
const secret = '0x12';
const commitment = settlementCommitment(scope.chainId, deployment.address, secret);
const answer = { kind: 'executable' as const, buyAmount: '76', expiresAt: 1900, settlement: deployment.address, quoteId: scope.id, commitment };
it('binds authorization to native chain and settlement deployment', () => {
  expect(settlementCommitment('0x01', '0x06', '0x012')).toBe(commitment);
  expect(settlementCommitment('0x2', '0x6', secret)).not.toBe(commitment);
  expect(settlementCommitment('0x1', '0x7', secret)).not.toBe(commitment);
  expect(() => settlementCommitment('0x1', '0x6', '0x0')).toThrow();
});
it('constructs only standard atomic wallet actions with shielded output', () => {
  expect(buildPrivateSettlementActions(scope, terms, answer, secret, scope.taker)).toEqual([
    { type: 'withdraw', token: '0x10', amount: '0x28', recipient: '0x6' },
    { type: 'transfer', token: '0x11', amount: 'OPEN', recipient: '0x5' },
    { type: 'invoke', contract: '0x6', calldata: ['0x3', '0x12', '${openNoteIds[0]}'] },
  ]);
  expect(() => buildPrivateSettlementActions(scope, terms, answer, '0x13', scope.taker)).toThrow();
});
it('rejects wrong deployment, commitment, request, expiry and minimum', () => {
  expect(decodeExecutableAnswer(answer, scope, terms, deployment, commitment, 1800)).toEqual(answer);
  for (const patch of [{ kind: 'indicative' }, { settlement: '0x7' }, { quoteId: '0x9' }, { commitment: '0x88' }, { expiresAt: 1800 }, { expiresAt: 2001 }, { buyAmount: '74' }]) {
    expect(() => decodeExecutableAnswer({ ...answer, ...patch }, scope, terms, deployment, commitment, 1800)).toThrow();
  }
});
