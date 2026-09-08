import { describe, expect, it } from 'vitest';
import {
  assertRoomEnvelope, cleanRoomPublicKey, confidentialRoomApi, createRoomKey,
  openRoomMessage, restoreRoomKey, roomId, sealRoomMessage, validRoomId,
  type ConfidentialRoomPayload, type RoomEnvelope, type RoomMessage,
} from './confidential-room';
import { decodeBase64url, encodeBase64url } from '../../packages/private-intents/src/hpke';

const payload: ConfidentialRoomPayload = { kind: 'declined', message: 'These private terms stay between the two parties.' };
const message = (envelope: RoomEnvelope): RoomMessage => ({ sequence: 1, role: 'maker', envelope });

describe('confidential room encryption', () => {
  it('roundtrips with a restored recipient key and pads the opaque envelope', async () => {
    const key = await createRoomKey(), id = roomId();
    expect(validRoomId(id)).toBe(true);
    expect(validRoomId(id + 'x')).toBe(false);
    const envelope = await sealRoomMessage(id, 'maker', payload, key.publicKey);
    expect(Object.keys(envelope).sort()).toEqual(['ciphertext', 'enc', 'id']);
    expect(() => assertRoomEnvelope(envelope)).not.toThrow();
    expect(decodeBase64url(envelope.ciphertext).length).toBe(512);
    expect(JSON.stringify(envelope)).not.toContain(payload.message);
    expect(await openRoomMessage(id, message(envelope), await restoreRoomKey(key.privateKey))).toEqual(payload);
  });

  it('authenticates the room, role, message ID, recipient and ciphertext', async () => {
    const key = await createRoomKey(), other = await createRoomKey(), id = roomId();
    const envelope = await sealRoomMessage(id, 'maker', payload, key.publicKey);
    await expect(openRoomMessage(roomId(), message(envelope), key.pair)).rejects.toThrow();
    await expect(openRoomMessage(id, { ...message(envelope), role: 'taker' }, key.pair)).rejects.toThrow();
    await expect(openRoomMessage(id, message({ ...envelope, id: roomId() }), key.pair)).rejects.toThrow();
    await expect(openRoomMessage(id, message(envelope), other.pair)).rejects.toThrow();
    const bytes = decodeBase64url(envelope.ciphertext); bytes[50] ^= 1;
    await expect(openRoomMessage(id, message({ ...envelope, ciphertext: encodeBase64url(bytes) }), key.pair)).rejects.toThrow();
  });

  it('rejects plaintext extensions, unbounded frames and invalid encryption keys', async () => {
    const key = await createRoomKey(), id = roomId();
    const envelope = await sealRoomMessage(id, 'maker', payload, key.publicKey);
    for (const invalid of [null, {}, { ...envelope, amount: '42' }, { ...envelope, ciphertext: 'secret' }, { ...envelope, enc: envelope.enc + '=' }, { ...envelope, id: '../private' }, { ...envelope, ciphertext: encodeBase64url(new Uint8Array(513)) }, { ...envelope, ciphertext: 'A'.repeat(88001) }, { ...envelope, enc: encodeBase64url(new Uint8Array(65)) }]) {
      expect(() => assertRoomEnvelope(invalid)).toThrow();
    }
    expect(() => cleanRoomPublicKey(key.privateKey)).toThrow();
    expect(() => cleanRoomPublicKey({ ...key.publicKey, crv: 'P-384' })).toThrow();
    await expect(restoreRoomKey(key.publicKey)).rejects.toThrow();
    await expect(sealRoomMessage(id, 'maker', { kind: 'declined', message: 'x'.repeat(65536) }, key.publicKey)).rejects.toThrow(/too large/);
  });

  it('opens the maximum permitted bucket and rejects an unsupported encrypted message kind', async () => {
    const key = await createRoomKey(), id = roomId();
    const large: ConfidentialRoomPayload = { kind: 'declined', message: 'x'.repeat(65000) };
    const envelope = await sealRoomMessage(id, 'maker', large, key.publicKey);
    expect(decodeBase64url(envelope.ciphertext).length).toBe(65536);
    expect(() => assertRoomEnvelope(envelope)).not.toThrow();
    expect(await openRoomMessage(id, message(envelope), key.pair)).toEqual(large);
    const unknown = await sealRoomMessage(id, 'maker', { kind: 'run-code' } as unknown as ConfidentialRoomPayload, key.publicKey);
    await expect(openRoomMessage(id, message(unknown), key.pair)).rejects.toThrow(/Unsupported/);
  });

  it('sends only ciphertext and selects room capability before maker authorization', async () => {
    const key = await createRoomKey(), id = roomId(), token = roomId();
    const envelope = await sealRoomMessage(id, 'taker', payload, key.publicKey);
    const calls: { url: string; init: RequestInit }[] = [];
    let minted = 0;
    const api = confidentialRoomApi({ baseUrl: 'https://app20.io', accessToken: async () => { minted++; return 'maker-session'; }, fetch: async (input, init) => { const url = String(input); calls.push({ url, init: init! }); return Response.json(init?.method === 'POST' ? url.endsWith('/rooms') ? { id, expiresAt: 1900000000, sequence: 1 } : { sequence: 2 } : { messages: [], makers: [], rooms: [] }); } });
    await api.create(id, '0xbeef', token, envelope); await api.send(id, envelope, token); await api.messages(id, 4, token);
    expect(minted).toBe(0);
    for (const call of calls) { expect(new Headers(call.init.headers).get('authorization')).toBe(`Room ${token}`); expect(call.init.redirect).toBe('error'); expect(call.init.cache).toBe('no-store'); expect(String(call.init.body ?? '')).not.toContain(payload.message); }
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ id, maker: '0xbeef', envelope });
    await api.inbox(); expect(minted).toBe(1); expect(new Headers(calls.at(-1)!.init.headers).get('authorization')).toBe('Bearer maker-session');
  });
});


describe('confidential room response validation', () => {
  it('rejects malformed, oversized and duplicated directory entries', async () => {
    const key = await createRoomKey();
    const maker = { account: '0xbeef', name: 'Maker', publicKey: key.publicKey, expiresAt: 1900000000 };
    for (const response of [null, [], {}, { makers: {} }, { makers: Array(101).fill(maker) }, { makers: [maker, maker] }, { makers: [{ ...maker, account: 'not-an-address' }] }, { makers: [{ ...maker, publicKey: key.privateKey }] }, { makers: [{ ...maker, expiresAt: 1.5 }] }]) {
      const api = confidentialRoomApi({ fetch: async () => Response.json(response) });
      await expect(api.makers()).rejects.toThrow();
    }
    const api = confidentialRoomApi({ fetch: async () => Response.json({ makers: [maker] }) });
    expect(await api.makers()).toEqual([maker]);
  });

  it('rejects malformed room lists, substituted creation IDs and unordered message pages', async () => {
    const key = await createRoomKey(), id = roomId(), token = roomId();
    const envelope = await sealRoomMessage(id, 'maker', payload, key.publicKey);
    for (const response of [{ rooms: [{ id: '../escape', expiresAt: 1 }] }, { rooms: [{ id, expiresAt: 1 }, { id, expiresAt: 2 }] }]) {
      await expect(confidentialRoomApi({ fetch: async () => Response.json(response) }).inbox()).rejects.toThrow();
    }
    await expect(confidentialRoomApi({ fetch: async () => Response.json({ id: roomId(), expiresAt: 1900000000, sequence: 1 }) }).create(id, '0xbeef', token, envelope)).rejects.toThrow();
    for (const messages of [[{ sequence: 2, role: 'maker', envelope }], [{ sequence: 1, role: 'admin', envelope }], [{ sequence: 1, role: 'maker', envelope }, { sequence: 2, role: 'maker', envelope }], Array(51).fill({ sequence: 1, role: 'maker', envelope })]) {
      await expect(confidentialRoomApi({ fetch: async () => Response.json({ messages }) }).messages(id)).rejects.toThrow();
    }
    expect(await confidentialRoomApi({ fetch: async () => Response.json({ messages: [{ sequence: 1, role: 'maker', envelope }] }) }).messages(id)).toEqual([{ sequence: 1, role: 'maker', envelope }]);
  });

  it('bounds the response stream before JSON parsing and cancels an oversized response', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5_000_001)); }, cancel() { cancelled = true; } });
    await expect(confidentialRoomApi({ fetch: async () => new Response(body) }).makers()).rejects.toThrow(/Invalid/);
    expect(cancelled).toBe(true);
  });
});
