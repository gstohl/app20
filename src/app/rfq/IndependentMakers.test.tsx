import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import IndependentMakers, { parseMakerAmount, parseMakerConfig } from './IndependentMakers';
it('shows the independent operator path without presenting indicative quotes as trades', () => {
  const html = renderToStaticMarkup(<IndependentMakers />);
  expect(html).toContain('Compare &amp; swap');
  expect(html).toContain('Negotiate in Chat');
  expect(html).toContain('Account addresses, the selected maker and timing are public');
  expect(html).toContain('not been configured');
  expect(html).toContain('reserves its own inventory only for a funded offer');
  expect(html).not.toContain('>Take<');
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
