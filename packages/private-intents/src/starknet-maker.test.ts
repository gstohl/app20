import { describe, it, expect } from 'vitest';
import { generateTransportKey, publicKey, seal, open, decodeRequest, decodeAnswer, packBytes, unpackBytes, keyCoordinates, coordinatesKey, requestCall, type MakerScope } from './starknet-maker.ts';
const scope: MakerScope = { chainId: '0x534e5f5345504f4c4941', book: '0x1', id: '0x2', maker: '0x3', taker: '0x4', revision: 1, expiresAt: 2000 };
const terms = { sellToken: '0x5', buyToken: '0x6', sellAmount: '1000', minBuyAmount: '900' };
describe('Starknet encrypted maker transport', () => {
  it('round-trips requests and quotes with different recipient keys', async () => {
    const maker = await generateTransportKey(), taker = await generateTransportKey();
    const replyKey = await crypto.subtle.exportKey('jwk', taker.publicKey);
    const payload = await seal(scope, 'request', { ...terms, replyKey }, maker.publicKey);
    const request = await decodeRequest(await open(scope, 'request', payload, maker));
    expect(request.sellAmount).toBe('1000');
    const response = await seal(scope, 'quote', { kind: 'indicative', buyAmount: '950', expiresAt: 1900 }, await publicKey(request.replyKey));
    expect(decodeAnswer(await open(scope, 'quote', response, taker), scope, terms, 1800).buyAmount).toBe('950');
    await expect(open(scope, 'request', payload, taker)).rejects.toThrow();
    await expect(open(scope, 'quote', response, maker)).rejects.toThrow();
    expect(requestCall(scope, payload).calldata).not.toContain('1000');
    expect(taker.privateKey.extractable).toBe(false);
  });
  it('authenticates direction, network, deployment, recipient, request and expiry', async () => {
    const maker = await generateTransportKey(), reply = await generateTransportKey();
    const payload = await seal(scope, 'request', { ...terms, replyKey: await crypto.subtle.exportKey('jwk', reply.publicKey) }, maker.publicKey);
    for (const field of ['chainId', 'book', 'id', 'maker', 'taker'] as const) {
      await expect(open({ ...scope, [field]: '0x999' }, 'request', payload, maker)).rejects.toThrow();
    }
    await expect(open({ ...scope, revision: 2 }, 'request', payload, maker)).rejects.toThrow();
    await expect(open({ ...scope, expiresAt: 1999 }, 'request', payload, maker)).rejects.toThrow();
    await expect(open(scope, 'quote', payload, maker)).rejects.toThrow();
    const bytes = unpackBytes(payload); bytes[bytes.length - 1]! ^= 1;
    await expect(open(scope, 'request', packBytes(bytes), maker)).rejects.toThrow();
  });
  it('validates canonical bytes and registry public keys', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(4096));
    expect(unpackBytes(packBytes(bytes))).toEqual(bytes);
    expect(() => unpackBytes(['0x1', '0x100'])).toThrow();
    expect(() => packBytes(new Uint8Array(4097))).toThrow();
    const key = await crypto.subtle.exportKey('jwk', (await generateTransportKey()).publicKey);
    const restored = coordinatesKey(keyCoordinates(key));
    expect(restored.x).toBe(key.x); expect(restored.y).toBe(key.y);
    await expect(publicKey({ ...restored, d: 'secret' })).rejects.toThrow();
    await expect(publicKey(coordinatesKey(['1', '0', '1', '0']))).rejects.toThrow();
  });
  it('rejects expired, below-floor and falsely executable quotes', () => {
    for (const body of [{ kind: 'indicative', buyAmount: '899', expiresAt: 1900 }, { kind: 'indicative', buyAmount: '950', expiresAt: 1800 }, { kind: 'indicative', buyAmount: '950', expiresAt: 2001 }, { kind: 'executable', buyAmount: '950', expiresAt: 1900 }]) {
      expect(() => decodeAnswer(body, scope, terms, 1800)).toThrow();
    }
  });
});
