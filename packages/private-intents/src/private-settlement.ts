import { poseidonHashMany } from '@scure/starknet';
import { rejectPublicSettlement } from '@app20/domain';
import { amount, felt, type MakerScope, type MakerTerms } from './starknet-maker.ts';
export type SettlementDeployment = Readonly<{ address: string; classHash: string; pool: string; poolClassHash: string }>;
export type ExecutableMakerAnswer = Readonly<{ kind: 'executable'; buyAmount: string; expiresAt: number; settlement: string; quoteId: string; commitment: string }>;
const DOMAIN = BigInt('0x41505032305f535741505f5345435245545f5631'); // APP20_SWAP_SECRET_V1
export function settlementCommitment(chainId: string, settlement: string, secret: string): string {
  return `0x${poseidonHashMany([DOMAIN, BigInt(felt(chainId)), BigInt(felt(settlement)), BigInt(felt(secret))]).toString(16)}`;
}
export function decodeExecutableAnswer(body: unknown, scope: MakerScope, terms: MakerTerms, deployment: SettlementDeployment, commitment: string, now: number): ExecutableMakerAnswer {
  if (!body || typeof body !== 'object') throw new Error('Invalid executable quote.');
  const v = body as ExecutableMakerAnswer;
  if (v.kind !== 'executable' || felt(v.settlement) !== felt(deployment.address) || felt(v.quoteId) !== felt(scope.id) || felt(v.commitment) !== felt(commitment) || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= now || v.expiresAt > scope.expiresAt || amount(v.buyAmount) < amount(terms.minBuyAmount)) throw new Error('Executable quote is expired or does not match this request.');
  return { kind: 'executable', buyAmount: v.buyAmount, expiresAt: v.expiresAt, settlement: felt(v.settlement), quoteId: felt(v.quoteId), commitment: felt(v.commitment) };
}
/** Published Wallet API actions only: one atomic withdrawal and shielded output. */
export function buildPrivateSettlementActions(scope: MakerScope, terms: MakerTerms, answer: ExecutableMakerAnswer, secret: string, recipient: string) {
  rejectPublicSettlement();
  if (settlementCommitment(scope.chainId, answer.settlement, secret) !== felt(answer.commitment) || felt(answer.quoteId) !== felt(scope.id)) throw new Error('Settlement authorization does not match.');
  amount(terms.sellAmount); amount(answer.buyAmount);
  return [
    { type: 'withdraw' as const, token: felt(terms.sellToken), amount: `0x${amount(terms.sellAmount).toString(16)}`, recipient: felt(answer.settlement) },
    { type: 'transfer' as const, token: felt(terms.buyToken), amount: 'OPEN' as const, recipient: felt(recipient) },
    { type: 'invoke' as const, contract: felt(answer.settlement), calldata: [felt(answer.quoteId), felt(secret), '${openNoteIds[0]}'] },
  ];
}
