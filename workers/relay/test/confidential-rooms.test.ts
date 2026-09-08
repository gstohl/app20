import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { ConfidentialRoomsDurableObject, handleConfidentialRooms } from '../src/confidential-rooms.ts';
import { handleReadyProofSession } from '../src/ready-proof-auth.ts';
import { createRoomKey, roomId, sealRoomMessage } from '../../../src/lib/confidential-room.ts';
import type { RelayDependencies, RelayEnv } from '../src/types.ts';

const at = 1_800_000_000_000;
function harness(t: TestContext) {
  t.mock.method(Date, 'now', () => at);
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let alarms = 0, routed = 0, leases = 0, released = 0, failInsert = false;
  const state = { storage: { sql: { exec: (query: string, ...args: unknown[]) => { if (failInsert && query.startsWith('INSERT INTO messages')) { failInsert = false; throw new Error('Injected durable write failure'); } return db.prepare(query).all(...args as SQLInputValue[]); } }, transactionSync: <T>(work: () => T) => { db.exec('SAVEPOINT room_test'); try { const result = work(); db.exec('RELEASE room_test'); return result; } catch (e) { db.exec('ROLLBACK TO room_test'); db.exec('RELEASE room_test'); throw e; } }, setAlarm: async () => { alarms++; } }, blockConcurrencyWhile: async <T>(work: () => Promise<T>) => work() };
  const target = new ConfidentialRoomsDurableObject(state as never);
  const gate = { acquire: async () => { leases++; return { release: async () => { released++; } }; } };
  const env = { PROOF_CAPABILITY_SECRET: 's'.repeat(64), STARKNET_MAINNET_RPC_URL: 'https://pinned.example/rpc', CONFIDENTIAL_ROOMS: { idFromName: (name: string) => name, get: () => ({ fetch: async (url: string, init: RequestInit) => { routed++; return target.fetch(new Request(url, init)); } }) } } as unknown as RelayEnv;
  const post = (input: unknown) => target.fetch(new Request('https://confidential.invalid', { method: 'POST', body: JSON.stringify(input) }));
  const http = (path: string, body?: unknown, authorization?: string, origin = 'https://app20.io') => handleConfidentialRooms(new Request('https://app20.io/api/confidential' + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin, ...(authorization ? { authorization } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, gate);
  const token = async (account = '0xb') => {
    const claim = { account, chainId: '0x534e5f4d41494e', origin: 'https://app20.io', issuedAt: at / 1000, expiresAt: at / 1000 + 900, nonce: '0x1234' };
    const deps = { now: () => at, fetch: async (_url: unknown, init: RequestInit) => { const input = JSON.parse(String(init.body)); return Response.json({ jsonrpc: '2.0', id: 1, result: input.method === 'starknet_chainId' ? claim.chainId : ['0x56414c4944'] }); } } as unknown as RelayDependencies;
    const result = await handleReadyProofSession(new Request('https://app20.io/api/privacy/ready-proof-session', { method: 'POST', headers: { origin: claim.origin, 'content-type': 'application/json' }, body: JSON.stringify({ claim, signature: ['0x1', '0x2'] }) }), env, deps, gate);
    return (await result.json() as { token: string }).token;
  };
  return { db, target, post, http, token, env, gate, failNextMessage: () => { failInsert = true; }, counters: () => ({ alarms, routed, leases, released }) };
}
async function fixture(t: TestContext) {
  const h = harness(t), key = await createRoomKey(), id = roomId(), tokenDigest = 'test-capability-digest';
  const envelope = await sealRoomMessage(id, 'taker', { kind: 'declined', message: 'PRIVATE REQUEST TERMS' }, key.publicKey);
  const advertisement = { name: 'Maker', publicKey: key.publicKey, expiresAt: at / 1000 + 240 };
  assert.equal((await h.post({ operation: 'advertise', account: '0xb', body: advertisement })).status, 200);
  const create = { operation: 'create', tokenDigest, body: { id, maker: '0xb', envelope } };
  assert.equal((await h.post(create)).status, 201);
  return { ...h, id, key, envelope, tokenDigest, advertisement, create };
}

test('SQLite room creation is idempotent and collisions cannot replace its capability or ciphertext', async t => {
  const h = await fixture(t);
  assert.equal((await h.post(h.create)).status, 200);
  for (const changed of [{ ...h.create, tokenDigest: 'other' }, { ...h.create, body: { ...h.create.body, maker: '0xc' } }, { ...h.create, body: { ...h.create.body, envelope: { ...h.envelope, id: roomId() } } }]) assert.equal((await h.post(changed)).status, 409);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM messages').get()!.count, 1);
  assert.equal(JSON.stringify(h.db.prepare('SELECT * FROM rooms').all()).includes('PRIVATE REQUEST TERMS'), false);
  assert.equal(JSON.stringify(h.db.prepare('SELECT * FROM messages').all()).includes('PRIVATE REQUEST TERMS'), false);
});

test('SQL authorization isolates maker inboxes and assigns roles from credentials, not body claims', async t => {
  const h = await fixture(t);
  assert.deepEqual((await (await h.post({ operation: 'inbox', account: '0xc' })).json() as { rooms: unknown[] }).rooms, []);
  assert.equal((await h.post({ operation: 'inbox' })).status, 401);
  for (const authority of [{}, { account: '0xc' }, { tokenDigest: 'other' }]) {
    assert.equal((await h.post({ operation: 'messages', id: h.id, ...authority })).status, 404);
    assert.equal((await h.post({ operation: 'send', id: h.id, body: { envelope: h.envelope }, ...authority })).status, 404);
  }
  const envelope = await sealRoomMessage(h.id, 'maker', { kind: 'funded', hash: '0x123' }, h.key.publicKey);
  const send = { operation: 'send', id: h.id, account: '0xb', body: { envelope } };
  assert.equal((await h.post(send)).status, 201); assert.equal((await h.post(send)).status, 200);
  assert.equal((await h.post({ ...send, account: undefined, tokenDigest: h.tokenDigest })).status, 409);
  assert.equal((await h.post({ ...send, body: { envelope: { ...envelope, ciphertext: h.envelope.ciphertext } } })).status, 409);
  const response = await h.post({ operation: 'messages', id: h.id, tokenDigest: h.tokenDigest, after: 1 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json() as { messages: unknown[] }).messages, [{ sequence: 2, role: 'maker', envelope }]);
});

test('expired advertisements and rooms disappear, reject replays, and alarm removes ciphertext', async t => {
  const h = await fixture(t);
  t.mock.method(Date, 'now', () => at + 86400_000);
  assert.equal((await h.post(h.create)).status, 409);
  assert.equal((await h.post({ operation: 'messages', id: h.id, tokenDigest: h.tokenDigest })).status, 404);
  assert.deepEqual((await (await h.post({ operation: 'makers' })).json() as { makers: unknown[] }).makers, []);
  assert.deepEqual((await (await h.post({ operation: 'inbox', account: '0xb' })).json() as { rooms: unknown[] }).rooms, []);
  await h.target.alarm();
  for (const table of ['rooms', 'messages', 'makers']) assert.equal(h.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count, 0);
});

test('bounded pagination and message capacity reject overflow without replacing stored messages', async t => {
  const h = await fixture(t);
  for (let sequence = 2; sequence <= 256; sequence++) h.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(h.id, sequence, roomId(), 'maker', JSON.stringify({ ...h.envelope, id: roomId() }));
  const page = await (await h.post({ operation: 'messages', id: h.id, account: '0xb', after: 1 })).json() as { messages: { sequence: number }[] };
  assert.equal(page.messages.length, 50); assert.equal(page.messages[0].sequence, 2); assert.equal(page.messages.at(-1)!.sequence, 51);
  for (const after of [-1, 1.5, 257]) assert.equal((await h.post({ operation: 'messages', id: h.id, account: '0xb', after })).status, 400);
  assert.equal((await h.post({ operation: 'send', id: h.id, account: '0xb', body: { envelope: { ...h.envelope, id: roomId() } } })).status, 429);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM messages').get()!.count, 256);
});

test('HTTP handler rejects cross-origin and unauthenticated callers before storage routing', async t => {
  const h = harness(t);
  await assert.rejects(h.http('/makers', undefined, undefined, 'https://evil.example'), /origin/i);
  await assert.rejects(h.http('/inbox'), /authentication/);
  await assert.rejects(h.http('/rooms', {}, 'Bearer made-up-token'), /invalid or expired/);
  await assert.rejects(h.http('/rooms', {}, 'Room short'), /Invalid quote/);
  assert.equal(h.counters().routed, 0);
});

test('HTTP handler forwards authenticated maker identity and only a digest of the room capability', async t => {
  const h = harness(t), key = await createRoomKey(), makerToken = await h.token(), id = roomId(), roomToken = roomId();
  const envelope = await sealRoomMessage(id, 'taker', { kind: 'declined', message: 'OPAQUE ONLY' }, key.publicKey);
  assert.equal((await h.http('/makers', { name: 'Maker', publicKey: key.publicKey, expiresAt: at / 1000 + 240 }, `Bearer ${makerToken}`)).status, 200);
  assert.equal((await h.http('/rooms', { id, maker: '0xb', envelope }, `Room ${roomToken}`)).status, 201);
  const stored = h.db.prepare('SELECT * FROM rooms').get()!; assert.equal(stored.maker, '0xb'); assert.match(String(stored.token_digest), /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(stored).includes(roomToken), false);
  const listed = await (await h.http('/inbox', undefined, `Bearer ${makerToken}`)).json() as { rooms: { id: string }[] }; assert.equal(listed.rooms[0].id, id);
  assert.equal((await h.http(`/rooms/${id}`, undefined, `Room ${roomToken}`)).status, 200);
  const counters = h.counters(); assert.equal(counters.leases, counters.released);
});

test('HTTP plaintext, extra schema fields and oversize JSON never persist trade data', async t => {
  const h = harness(t), key = await createRoomKey(), makerToken = await h.token(), id = roomId(), token = roomId();
  await h.http('/makers', { name: 'Maker', publicKey: key.publicKey, expiresAt: at / 1000 + 240 }, `Bearer ${makerToken}`);
  const envelope = await sealRoomMessage(id, 'taker', { kind: 'declined', message: 'private' }, key.publicKey);
  for (const body of [{ id, maker: '0xb', plaintext: 'secret' }, { id, maker: '0xb', envelope, sellAmount: '1234' }, { id, maker: '0xb', envelope: { ...envelope, privateKey: 'secret' } }, { id, maker: '0xb', envelope: { ...envelope, ciphertext: 'secret' } }]) assert.equal((await h.http('/rooms', body, `Room ${token}`)).status, 400);
  await assert.rejects(h.http('/rooms', { oversized: 'x'.repeat(100001) }, `Room ${token}`), /too large/);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 0);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM messages').get()!.count, 0);
  const counters = h.counters(); assert.equal(counters.leases, counters.released);
});

test('a failed initial message write rolls back the room and permits an exact retry', async t => {
  const h = harness(t), key = await createRoomKey(), id = roomId();
  await h.post({ operation: 'advertise', account: '0xb', body: { name: 'Maker', publicKey: key.publicKey, expiresAt: at / 1000 + 240 } });
  const envelope = await sealRoomMessage(id, 'taker', { kind: 'declined', message: 'opaque' }, key.publicKey);
  const input = { operation: 'create', tokenDigest: 'cap', body: { id, maker: '0xb', envelope } };
  h.failNextMessage(); assert.equal((await h.post(input)).status, 400);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 0);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM messages').get()!.count, 0);
  assert.equal((await h.post(input)).status, 201);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 1);
});

test('browser same-origin GET works without Origin while same-site, cross-site and POST cannot use that exception', async t => {
  const h = harness(t);
  const request = (method: string, site?: string, origin?: string) => new Request('https://app20.io/api/confidential/makers', { method, headers: { ...(site ? { 'sec-fetch-site': site } : {}), ...(origin ? { origin } : {}) } });
  assert.equal((await handleConfidentialRooms(request('GET', 'same-origin'), h.env, h.gate)).status, 200);
  for (const site of ['same-site', 'cross-site', 'none', undefined]) await assert.rejects(handleConfidentialRooms(request('GET', site), h.env, h.gate), /origin/i);
  await assert.rejects(handleConfidentialRooms(request('POST', 'same-origin'), h.env, h.gate), /origin/i);
  await assert.rejects(handleConfidentialRooms(request('GET', 'same-origin', 'https://evil.example'), h.env, h.gate), /origin/i);
  assert.equal(h.counters().routed, 1);
});

test('HTTP requires JSON and invalid P256 advertisement points do not reach the directory', async t => {
  const h = harness(t), token = roomId();
  const request = new Request('https://app20.io/api/confidential/rooms', { method: 'POST', headers: { origin: 'https://app20.io', authorization: `Room ${token}`, 'content-type': 'text/plain' }, body: '{}' });
  await assert.rejects(handleConfidentialRooms(request, h.env, h.gate), /application\/json/);
  assert.equal(h.counters().routed, 0);
  const bad = { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'A'.repeat(43) };
  assert.equal((await h.post({ operation: 'advertise', account: '0xb', body: { name: 'Maker', publicKey: bad, expiresAt: at / 1000 + 240 } })).status, 400);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM makers').get()!.count, 0);
  assert.equal(h.counters().leases, h.counters().released);
});
