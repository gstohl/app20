import { createRfqHpkeSuite, padRfqPlaintext, unpadRfqPlaintext, encodeBase64url, decodeBase64url } from '../../packages/private-intents/src/hpke.ts';
import type { ConfidentialAgreement, ConfidentialApproval, ConfidentialPrepared } from '../../packages/agent-sdk/src/confidential-protocol';

export const CONFIDENTIAL_ROOM_SCHEMA = 'app20/confidential-room/v1';
export type RoomRole = 'taker' | 'maker';
export type RoomEnvelope = { id: string; enc: string; ciphertext: string };
export type RoomMessage = { sequence: number; role: RoomRole; envelope: RoomEnvelope };
export type ConfidentialMaker = { account: string; name: string; publicKey: JsonWebKey; expiresAt: number };
export type QuoteRequest = {
  kind: 'request'; taker: string; signerA: string; replyKey: JsonWebKey;
  sellToken: string; buyToken: string; sellAmount: string; minimumAmount: string;
};
export type ConfidentialRoomPayload = QuoteRequest
  | { kind: 'quote'; agreement: ConfidentialAgreement; viewingKey: string; salt: string; expiresAt: number }
  | { kind: 'accepted'; commitment: string; deploymentHash: string }
  | { kind: 'prepared'; prepared: ConfidentialPrepared; approval: ConfidentialApproval }
  | { kind: 'confirmed'; stage: 'setup' | 'fundA' | 'settle' | 'refundA'; hash: string }
  | { kind: 'funded'; hash: string }
  | { kind: 'declined'; message: string };

const encoder = new TextEncoder();
export function roomId(): string { return encodeBase64url(crypto.getRandomValues(new Uint8Array(24))); }
export function validRoomId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value); }
export function assertRoomEnvelope(value: unknown): asserts value is RoomEnvelope {
  const v = value as RoomEnvelope;
  if (!v || Object.keys(v).sort().join(',') !== 'ciphertext,enc,id' || !validRoomId(v.id) || typeof v.enc !== 'string' || typeof v.ciphertext !== 'string' || v.enc.length !== 87 || v.ciphertext.length < 683 || v.ciphertext.length > 88_000 || !/^[A-Za-z0-9_-]+$/.test(v.enc) || !/^[A-Za-z0-9_-]+$/.test(v.ciphertext)) throw new Error('Invalid encrypted room message.');
  const enc = decodeBase64url(v.enc), ciphertext = decodeBase64url(v.ciphertext);
  if (enc.length !== 65 || enc[0] !== 4 || ![512,1024,2048,4096,8192,16384,32768,65536].includes(ciphertext.length)) throw new Error('Invalid encrypted room framing.');
}
export function cleanRoomPublicKey(value: JsonWebKey): JsonWebKey {
  if (!value || value.kty !== 'EC' || value.crv !== 'P-256' || value.d || typeof value.x !== 'string' || typeof value.y !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.x) || !/^[A-Za-z0-9_-]{43}$/.test(value.y)) throw new Error('Invalid public encryption key.');
  return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
}
export async function importRoomPublicKey(value: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', cleanRoomPublicKey(value), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}
export async function createRoomKey(): Promise<{ pair: CryptoKeyPair; publicKey: JsonWebKey; privateKey: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { pair, publicKey: cleanRoomPublicKey(await crypto.subtle.exportKey('jwk', pair.publicKey)), privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}
export async function restoreRoomKey(privateKey: JsonWebKey): Promise<CryptoKeyPair> {
  if (!privateKey.d || !/^[A-Za-z0-9_-]{43}$/.test(privateKey.d)) throw new Error('Encrypted room recovery key is missing.');
  const publicKey = cleanRoomPublicKey({ ...privateKey, d: undefined });
  return { privateKey: await crypto.subtle.importKey('jwk', privateKey, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']), publicKey: await importRoomPublicKey(publicKey) };
}
function aad(room: string, role: RoomRole, id: string): Uint8Array<ArrayBuffer> {
  if (!validRoomId(room) || !validRoomId(id) || !['maker', 'taker'].includes(role)) throw new Error('Invalid encrypted room binding.');
  return encoder.encode(JSON.stringify([CONFIDENTIAL_ROOM_SCHEMA, room, role, id]));
}
export async function sealRoomMessage(room: string, role: RoomRole, payload: ConfidentialRoomPayload, recipient: JsonWebKey): Promise<RoomEnvelope> {
  const id = roomId(), text = JSON.stringify(payload), length = encoder.encode(text).length;
  const bucket = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].find(size => length <= size - 18);
  if (!bucket) throw new Error('Private quote message is too large.');
  const result = await createRfqHpkeSuite().seal({ recipientPublicKey: await importRoomPublicKey(recipient), info: encoder.encode(CONFIDENTIAL_ROOM_SCHEMA) }, padRfqPlaintext(text, bucket), aad(room, role, id));
  return { id, enc: encodeBase64url(new Uint8Array(result.enc)), ciphertext: encodeBase64url(new Uint8Array(result.ct)) };
}
export async function openRoomMessage(room: string, message: RoomMessage, pair: CryptoKeyPair): Promise<ConfidentialRoomPayload> {
  assertRoomEnvelope(message.envelope);
  const e = message.envelope;
  const plain = await createRfqHpkeSuite().open({ recipientKey: pair, enc: decodeBase64url(e.enc).buffer, info: encoder.encode(CONFIDENTIAL_ROOM_SCHEMA) }, decodeBase64url(e.ciphertext).buffer, aad(room, message.role, e.id));
  const value = JSON.parse(unpadRfqPlaintext(new Uint8Array(plain)));
  if (!value || !['request','quote','accepted','prepared','confirmed','funded','declined'].includes(value.kind)) throw new Error('Unsupported private quote message.');
  return value;
}

/** Transport contains ciphertext and routing metadata only. */
export function confidentialRoomApi(options: { baseUrl?: string; accessToken?: () => Promise<string>; fetch?: typeof fetch } = {}) {
  const fetcher = options.fetch ?? fetch, base = options.baseUrl ?? '';
  const invalid = (): never => { throw new Error('Invalid private quote response.'); };
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    return value as Record<string, unknown>;
  };
  const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > maximum) return invalid();
    return value;
  };
  const account = (value: unknown): string => {
    if (typeof value !== 'string' || !/^0x[\da-f]{1,64}$/i.test(value) || BigInt(value) <= 0n || BigInt(value) >= 2n ** 251n - 256n) return invalid();
    return `0x${BigInt(value).toString(16)}`;
  };
  const list = (value: unknown, maximum: number): unknown[] => {
    if (!Array.isArray(value) || value.length > maximum) return invalid();
    return value;
  };
  const room = (value: unknown): string => validRoomId(value) ? value : invalid();
  async function request(path: string, body?: unknown, roomToken?: string): Promise<Record<string, unknown>> {
    const authorization = roomToken ? `Room ${room(roomToken)}` : options.accessToken ? `Bearer ${await options.accessToken()}` : undefined;
    const response = await fetcher(`${base}/api/confidential${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(authorization ? { authorization } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    // At most 50 opaque 64-KiB envelopes fit in one page. Bound the stream before parsing.
    const reader = response.body?.getReader();
    if (!reader) return invalid();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 5_000_000) { await reader.cancel(); return invalid(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return invalid(); }
    const data = object(parsed);
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error.slice(0, 240) : 'Private quote connection failed.');
    return data;
  }
  return {
    async makers(): Promise<ConfidentialMaker[]> {
      const values = list((await request('/makers')).makers, 100).map(value => {
        const m = object(value);
        if (typeof m.name !== 'string' || m.name.length < 1 || m.name.length > 40 || /[\x00-\x1f\x7f]/.test(m.name)) return invalid();
        return { account: account(m.account), name: m.name, publicKey: cleanRoomPublicKey(object(m.publicKey) as JsonWebKey), expiresAt: integer(m.expiresAt) };
      });
      if (new Set(values.map(m => m.account)).size !== values.length) return invalid();
      return values;
    },
    async advertise(maker: Omit<ConfidentialMaker, 'account'>): Promise<{ account: string }> {
      return { account: account((await request('/makers', maker)).account) };
    },
    async inbox(): Promise<{ id: string; expiresAt: number }[]> {
      const values = list((await request('/inbox')).rooms, 100).map(value => { const r = object(value); return { id: room(r.id), expiresAt: integer(r.expiresAt) }; });
      if (new Set(values.map(r => r.id)).size !== values.length) return invalid();
      return values;
    },
    async create(id: string, maker: string, token: string, envelope: RoomEnvelope): Promise<{ id: string; expiresAt: number; sequence: number }> {
      assertRoomEnvelope(envelope);
      const result = await request('/rooms', { id: room(id), maker: account(maker), envelope }, token);
      if (result.id !== id || result.sequence !== 1) return invalid();
      return { id, expiresAt: integer(result.expiresAt), sequence: 1 };
    },
    async messages(id: string, after = 0, token?: string): Promise<RoomMessage[]> {
      if (!Number.isSafeInteger(after) || after < 0 || after > 256) return invalid();
      let sequence = after;
      const values = list((await request(`/rooms/${room(id)}?after=${after}`, undefined, token)).messages, 50).map((value): RoomMessage => {
        const m = object(value), next = integer(m.sequence, 256);
        if (next !== sequence + 1 || (m.role !== 'maker' && m.role !== 'taker')) return invalid();
        sequence = next; assertRoomEnvelope(m.envelope);
        return { sequence: next, role: m.role, envelope: { ...m.envelope } };
      });
      if (new Set(values.map(m => m.envelope.id)).size !== values.length) return invalid();
      return values;
    },
    async send(id: string, envelope: RoomEnvelope, token?: string): Promise<{ sequence: number }> {
      assertRoomEnvelope(envelope);
      return { sequence: integer((await request(`/rooms/${room(id)}`, { envelope }, token)).sequence, 256) };
    },
  };
}
