import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import IndependentMakers, { parseMakerAmount, parseMakerConfig } from './IndependentMakers';
it('keeps earlier records readable without offering public settlement', () => {
  const html = renderToStaticMarkup(<IndependentMakers />);
  expect(html).toContain('Earlier public RFQ records only');
  expect(html).toContain('Confidential settlement availability');
  expect(html).toContain('Recover maker inventory');
  expect(html).not.toContain('Confirm private swap');
  expect(html).not.toContain('Request funded offer');
});
it('converts human amounts exactly and rejects precision loss', () => {
  expect(parseMakerAmount('1.000001', 6)).toBe('1000001');
  expect(parseMakerAmount('0.000000000000000001', 18)).toBe('1');
  for (const value of ['1e3', '-1', '0', '1.0000001']) expect(() => parseMakerAmount(value, 6)).toThrow();
});
it('rejects invalid deployment and token metadata', () => {
  expect(parseMakerConfig(undefined)).toBeUndefined();
  expect(() => parseMakerConfig('{}')).toThrow();
  const config = { address: '0x1', classHash: '0x2', chainId: '0x3', fromBlock: 1, rpcUrl: 'https://rpc.example', sellToken: { address: '0x4', symbol: 'A', decimals: 18 }, buyToken: { address: '0x5', symbol: 'B', decimals: 6 } };
  expect(parseMakerConfig(JSON.stringify(config))).toEqual(config);
  expect(() => parseMakerConfig(JSON.stringify({ ...config, rpcUrl: 'http://rpc.example' }))).toThrow();
  expect(() => parseMakerConfig(JSON.stringify({ ...config, buyToken: config.sellToken }))).toThrow();
});
