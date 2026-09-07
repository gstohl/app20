import { decodeAnswer, type MakerAnswer, type MakerTerms } from '@app20/private-intents/starknet-maker';
import type { SavedMakerRequest } from './maker-request-store';

export const MAX_COMPARISON_MAKERS = 5;
export function rankQuotes(rows: readonly SavedMakerRequest[], comparisonId: string, now: number): (SavedMakerRequest & { indicativeAnswer: MakerAnswer })[] {
  const terms = rows.find(row => row.comparisonId === comparisonId && row.stage === 'comparison')?.terms;
  return rows.filter((row): row is SavedMakerRequest & { indicativeAnswer: MakerAnswer } => {
    if (!terms || !sameTerms(row.terms, terms) || row.stage !== 'comparison' || row.comparisonId !== comparisonId || !row.indicativeAnswer) return false;
    try { decodeAnswer(row.indicativeAnswer, row.scope, row.terms, now); return true; } catch { return false; }
  }).sort((a, b) => BigInt(a.indicativeAnswer.buyAmount) > BigInt(b.indicativeAnswer.buyAmount) ? -1 : BigInt(a.indicativeAnswer.buyAmount) < BigInt(b.indicativeAnswer.buyAmount) ? 1 : a.scope.maker.localeCompare(b.scope.maker));
}
export function sameTerms(a: MakerTerms, b: MakerTerms): boolean {
  return a.sellToken === b.sellToken && a.buyToken === b.buyToken && a.sellAmount === b.sellAmount && a.minBuyAmount === b.minBuyAmount;
}
