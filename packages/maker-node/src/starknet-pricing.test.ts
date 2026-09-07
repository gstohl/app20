import { it, expect } from 'vitest';
import { priceRequest, type MakerMarket } from './starknet-pricing.ts';
const market: MakerMarket = { sellToken: '0x1', buyToken: '0x2', numerator: '2', denominator: '1', maxSellAmount: '1000', maxBuyAmount: '2000', spreadBps: 100, validUntil: 2000 };
const terms = { sellToken: '0x1', buyToken: '0x2', sellAmount: '1000', minBuyAmount: '1900' };
it('prices from explicit operator rates and deducts spread using integers', () => {
  expect(priceRequest(terms, [market], 1000, 1100)).toEqual({ kind: 'indicative', buyAmount: '1980', expiresAt: 1100 });
});
it('refuses expired rates, unsupported pairs, size limits and unmet minimums', () => {
  expect(priceRequest(terms, [{ ...market, validUntil: 1000 }], 1000, 1100)).toBeUndefined();
  expect(priceRequest({ ...terms, buyToken: '0x3' }, [market], 1000, 1100)).toBeUndefined();
  expect(priceRequest({ ...terms, sellAmount: '1001' }, [market], 1000, 1100)).toBeUndefined();
  expect(priceRequest(terms, [{ ...market, maxBuyAmount: '1979' }], 1000, 1100)).toBeUndefined();
  expect(priceRequest({ ...terms, minBuyAmount: '1981' }, [market], 1000, 1100)).toBeUndefined();
});
