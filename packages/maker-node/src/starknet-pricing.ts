import { amount, felt, validateTerms, type MakerAnswer, type MakerTerms } from '@app20/private-intents/starknet-maker';

/** Operator-supplied prices; no oracle, exchange API, or shared maker service. */
export type MakerMarket = Readonly<{
  sellToken: string; buyToken: string;
  numerator: string; denominator: string;
  maxSellAmount: string; maxBuyAmount: string;
  spreadBps: number; validUntil: number;
}>;
export function validateMarket(market: MakerMarket): void {
  validateTerms({ ...market, sellAmount: market.maxSellAmount, minBuyAmount: market.maxBuyAmount });
  amount(market.numerator); amount(market.denominator);
  if (!Number.isSafeInteger(market.spreadBps) || market.spreadBps < 0 || market.spreadBps >= 10000 || !Number.isSafeInteger(market.validUntil) || market.validUntil <= 0) throw new Error('Invalid operator price policy.');
}
export function priceRequest(terms: MakerTerms, markets: readonly MakerMarket[], now: number, requestExpiry: number, ttlSeconds = 120): MakerAnswer | undefined {
  validateTerms(terms);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) throw new Error('Quote TTL must be between 60 and 3600 seconds.');
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(requestExpiry) || requestExpiry <= now) return undefined;
  for (const market of markets) {
    validateMarket(market);
    if (felt(market.sellToken) !== felt(terms.sellToken) || felt(market.buyToken) !== felt(terms.buyToken) || market.validUntil <= now) continue;
    if (amount(terms.sellAmount) > amount(market.maxSellAmount)) continue;
    const receive = amount(terms.sellAmount) * amount(market.numerator) * BigInt(10000 - market.spreadBps) / (amount(market.denominator) * 10000n);
    if (receive < amount(terms.minBuyAmount) || receive > amount(market.maxBuyAmount) || receive >= 1n << 128n) continue;
    return { kind: 'indicative', buyAmount: receive.toString(), expiresAt: Math.min(now + ttlSeconds, requestExpiry, market.validUntil) };
  }
  return undefined;
}
