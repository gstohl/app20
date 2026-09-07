import { expect, it } from 'vitest';
import { makerInventoryCalls, makerOperatorConfig, makerRegistration, makerUnits } from './maker-setup';
import { MAINNET_MAKER_CONFIG as config } from './mainnet-maker-config';
import { priceRequest } from '../../packages/maker-node/src/starknet-pricing';
it('blocks new public inventory while preserving wallet-owned withdrawals', () => {
  expect(() => makerInventoryCalls('fund', config.buyToken.address, '1.000001')).toThrow(/Confidential settlement is required/);
  expect(makerInventoryCalls('withdraw', config.sellToken.address, '2')[0].calldata).toEqual(['0x' + BigInt(config.sellToken.address).toString(16), '2000000000000000000']);
  for (const value of ['0', '-1', '1e2', '0.0000001']) expect(() => makerUnits(value, 6)).toThrow();
  expect(() => makerInventoryCalls('fund', '0x123', '1')).toThrow();
});
it('refuses public maker registration with either public or private keys', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await expect(makerRegistration(JSON.stringify(privateJwk), 7, 1000)).rejects.toThrow('Confidential settlement is required');
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  await expect(makerRegistration(JSON.stringify(publicJwk), 7, 1000)).rejects.toThrow(/Confidential settlement is required/);
});
it('converts human prices across STRK/USDC decimals and enforces budgets', () => {
  const input = { account: '0x123', reverse: false, price: '0.25', spread: 100, maxSell: '100', maxBuy: '30', priceHours: 1, maxFee: '0.2', totalFees: '2', keyValidUntil: 10000 };
  const output = makerOperatorConfig(input, 1000);
  expect(priceRequest({ sellToken: config.sellToken.address, buyToken: config.buyToken.address, sellAmount: '4000000000000000000', minBuyAmount: '1' }, output.markets, 1000, 2000)?.buyAmount).toBe('990000');
  const reverse = makerOperatorConfig({ ...input, reverse: true, price: '4', maxSell: '10', maxBuy: '50' }, 1000);
  expect(priceRequest({ sellToken: config.buyToken.address, buyToken: config.sellToken.address, sellAmount: '1000000', minBuyAmount: '1' }, reverse.markets, 1000, 2000)?.buyAmount).toBe('3960000000000000000');
  expect(JSON.stringify(output)).not.toContain('SIGNING_KEY');
  expect(() => makerOperatorConfig({ ...input, maxFee: '3' }, 1000)).toThrow('budget');
  expect(() => makerOperatorConfig({ ...input, keyValidUntil: 1000 }, 1000)).toThrow('Register');
});
