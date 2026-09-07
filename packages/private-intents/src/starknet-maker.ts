/** Browser/Node shared, backend-free indicative RFQ transport. Never authorizes value. */
import { createRfqHpkeSuite, padRfqPlaintext, unpadRfqPlaintext, decodeBase64url, encodeBase64url } from './hpke.ts';

const encoder = new TextEncoder();
const DOMAIN = 'app20/starknet-maker/v1';
import type { ExecutableMakerAnswer } from './private-settlement.ts';
const FIELD = (1n << 251n) + 17n * (1n << 192n) + 1n;
export type MakerScope = Readonly<{ chainId: string; book: string; id: string; maker: string; taker: string; revision: number; expiresAt: number }>;
export type MakerTerms = Readonly<{ sellToken: string; buyToken: string; sellAmount: string; minBuyAmount: string }>;
export type MakerRequest = MakerTerms & { replyKey: JsonWebKey; settlementCommitment?: string };
export type MakerAnswer = Readonly<{ kind: 'indicative'; buyAmount: string; expiresAt: number }>;
export type BookCall = { contractAddress: string; entrypoint: string; calldata: string[] };
export function felt(value: string): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value) || BigInt(value) <= 0n || BigInt(value) >= FIELD) throw new Error('Invalid nonzero felt.');
  return `0x${BigInt(value).toString(16)}`;
}
export function amount(value: string): bigint {
  if (!/^[1-9][0-9]{0,38}$/.test(value) || BigInt(value) >= 1n << 128n) throw new Error('Amount must be a positive u128 in base units.');
  return BigInt(value);
}
export function validateTerms(value: MakerTerms): void {
  if (felt(value.sellToken) === felt(value.buyToken)) throw new Error('Choose two different tokens.');
  amount(value.sellAmount); amount(value.minBuyAmount);
}
function aad(scope: MakerScope, direction: 'request' | 'quote'): Uint8Array {
  if (!Number.isSafeInteger(scope.revision) || scope.revision <= 0 || !Number.isSafeInteger(scope.expiresAt) || scope.expiresAt <= 0) throw new Error('Invalid request scope.');
  return encoder.encode(JSON.stringify([DOMAIN, direction, felt(scope.chainId), felt(scope.book), felt(scope.id), felt(scope.maker), felt(scope.taker), scope.revision, scope.expiresAt]));
}
export function randomRequestId(): string {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(30)), b => b.toString(16).padStart(2, '0')).join('')}`;
}
export function generateTransportKey(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as Promise<CryptoKeyPair>;
}
export async function publicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || jwk.d) throw new Error('Expected a public P-256 key.');
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}
export function packBytes(bytes: Uint8Array): string[] {
  if (bytes.length < 1 || bytes.length > 4096) throw new Error('Encrypted payload exceeds the chain limit.');
  const values = [`0x${bytes.length.toString(16)}`];
  for (let offset = 0; offset < bytes.length; offset += 31) {
    values.push(`0x${Array.from(bytes.subarray(offset, offset + 31), b => b.toString(16).padStart(2, '0')).join('')}`);
  }
  return values;
}
export function unpackBytes(values: readonly string[]): Uint8Array {
  const length = Number(BigInt(values[0] ?? '0'));
  if (!Number.isSafeInteger(length) || length < 1 || length > 4096 || values.length !== 1 + Math.ceil(length / 31)) throw new Error('Malformed encrypted payload.');
  const out = new Uint8Array(length);
  for (let i = 1; i < values.length; i++) {
    const size = Math.min(31, length - (i - 1) * 31);
    const value = BigInt(values[i]!);
    if (value < 0n || value >= 1n << BigInt(size * 8)) throw new Error('Noncanonical encrypted payload.');
    const hex = value.toString(16).padStart(size * 2, '0');
    out.set(Uint8Array.from(hex.match(/../g)!, x => parseInt(x, 16)), (i - 1) * 31);
  }
  return out;
}
export async function seal(scope: MakerScope, direction: 'request' | 'quote', body: MakerRequest | MakerAnswer | ExecutableMakerAnswer, recipient: CryptoKey): Promise<string[]> {
  const canonical = JSON.stringify(body);
  const size = encoder.encode(canonical).length;
  const bucket = [512, 1024, 2048].find(n => size <= n - 18);
  if (!bucket) throw new Error('Quote request is too large.');
  const result = await createRfqHpkeSuite().seal({ recipientPublicKey: recipient, info: encoder.encode(DOMAIN) }, padRfqPlaintext(canonical, bucket), aad(scope, direction));
  return packBytes(new Uint8Array([1, ...new Uint8Array(result.enc), ...new Uint8Array(result.ct)]));
}
export async function open(scope: MakerScope, direction: 'request' | 'quote', payload: readonly string[], recipientKey: CryptoKeyPair): Promise<unknown> {
  const bytes = unpackBytes(payload);
  if (bytes[0] !== 1 || bytes[1] !== 4 || ![578, 1090, 2114].includes(bytes.length)) throw new Error('Unsupported encrypted envelope.');
  const plain = await createRfqHpkeSuite().open({ recipientKey, enc: bytes.slice(1, 66).buffer, info: encoder.encode(DOMAIN) }, bytes.slice(66).buffer, aad(scope, direction));
  return JSON.parse(unpadRfqPlaintext(new Uint8Array(plain)));
}
export async function decodeRequest(body: unknown): Promise<MakerRequest> {
  if (!body || typeof body !== 'object') throw new Error('Invalid request.');
  const v = body as MakerRequest;
  validateTerms(v); await publicKey(v.replyKey);
  return { sellToken: felt(v.sellToken), buyToken: felt(v.buyToken), sellAmount: v.sellAmount, minBuyAmount: v.minBuyAmount, replyKey: v.replyKey, ...(v.settlementCommitment ? { settlementCommitment: felt(v.settlementCommitment) } : {}) };
}
export function decodeAnswer(body: unknown, scope: MakerScope, terms: MakerTerms, now: number): MakerAnswer {
  if (!body || typeof body !== 'object') throw new Error('Invalid quote.');
  const v = body as MakerAnswer;
  if (v.kind !== 'indicative' || !Number.isSafeInteger(v.expiresAt) || v.expiresAt > scope.expiresAt || v.expiresAt <= now || amount(v.buyAmount) < amount(terms.minBuyAmount)) throw new Error('Quote expired or does not meet your minimum.');
  return { kind: 'indicative', buyAmount: v.buyAmount, expiresAt: v.expiresAt };
}
export function requestCall(scope: MakerScope, payload: string[]): BookCall {
  aad(scope, 'request'); unpackBytes(payload);
  return { contractAddress: felt(scope.book), entrypoint: 'request', calldata: [felt(scope.id), felt(scope.maker), String(scope.revision), String(scope.expiresAt), String(payload.length), ...payload] };
}
export function responseCall(scope: MakerScope, payload: string[]): BookCall {
  aad(scope, 'quote'); unpackBytes(payload);
  return { contractAddress: felt(scope.book), entrypoint: 'respond', calldata: [felt(scope.id), String(payload.length), ...payload] };
}
export function keyCoordinates(jwk: JsonWebKey): string[] {
  if (!jwk.x || !jwk.y || jwk.d) throw new Error('Expected public key.');
  return [jwk.x, jwk.y].flatMap(coordinate => {
    const bytes = decodeBase64url(coordinate);
    if (bytes.length !== 32) throw new Error('Invalid coordinate.');
    const n = BigInt(`0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`);
    return [(n & ((1n << 128n) - 1n)).toString(), (n >> 128n).toString()];
  });
}
export function coordinatesKey(values: readonly string[]): JsonWebKey {
  if (values.length !== 4) throw new Error('Invalid key length.');
  const coordinates = [0, 2].map(i => {
    const lo = BigInt(values[i]!), hi = BigInt(values[i + 1]!);
    if (lo < 0n || hi < 0n || lo >= 1n << 128n || hi >= 1n << 128n) throw new Error('Invalid key limbs.');
    const hex = (lo + (hi << 128n)).toString(16).padStart(64, '0');
    return encodeBase64url(Uint8Array.from(hex.match(/../g)!, x => parseInt(x, 16)));
  });
  return { kty: 'EC', crv: 'P-256', x: coordinates[0], y: coordinates[1] };
}
