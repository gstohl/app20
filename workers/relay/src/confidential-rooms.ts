import { assertRoomEnvelope, cleanRoomPublicKey, importRoomPublicKey, validRoomId } from '../../../src/lib/confidential-room.ts';
import { authenticateReadyProofToken } from './ready-proof-auth.ts';
import { RelayHttpError } from './errors.ts';
import { requireSameOrigin } from './origin.ts';
import { readBoundedRequest } from './body.ts';
import { bootstrapQuotaSubject } from './bootstrap.ts';
import type { AtomicGate, RelayEnv } from './types.ts';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
type RoomRow = { id: string; maker: string; token_digest: string; expires_at: number };
interface RoomSql { exec<T = Record<string, unknown>>(query: string, ...args: unknown[]): Iterable<T>; }
interface RoomState { storage: { sql: RoomSql; transactionSync<T>(task: () => T): T; setAlarm(time: number): Promise<void> }; blockConcurrencyWhile<T>(task: () => Promise<T>): Promise<T>; }

/** Ciphertext mailboxes. No trade amounts, assets, agreements or keys are stored here. */
export class ConfidentialRoomsDurableObject {
  private readonly state: RoomState;
  constructor(state: RoomState) {
    this.state = state;
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS makers (account TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, maker TEXT NOT NULL, token_digest TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    state.storage.sql.exec('CREATE INDEX IF NOT EXISTS rooms_maker ON rooms(maker, expires_at)');
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS messages (room TEXT NOT NULL, sequence INTEGER NOT NULL, id TEXT NOT NULL, role TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY(room, sequence), UNIQUE(room, id))');
  }
  async alarm() {
    const now = Math.floor(Date.now()/1000);
    this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec('DELETE FROM messages WHERE room IN (SELECT id FROM rooms WHERE expires_at <= ?)', now);
      this.state.storage.sql.exec('DELETE FROM rooms WHERE expires_at <= ?', now);
      this.state.storage.sql.exec('DELETE FROM makers WHERE expires_at <= ?', now);
    });
    if ([...this.state.storage.sql.exec<{count: number}>('SELECT COUNT(*) AS count FROM rooms')][0]!.count) await this.state.storage.setAlarm(Date.now()+60*60*1000);
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const input = await request.json() as { operation: string; account?: string; tokenDigest?: string; id?: string; after?: number; body?: Record<string, unknown> };
      const now = Math.floor(Date.now()/1000), sql = this.state.storage.sql, body = input.body ?? {};
      if (input.operation === 'makers') return json({ makers: [...sql.exec<{account:string;name:string;public_key:string;expires_at:number}>('SELECT * FROM makers WHERE expires_at > ? ORDER BY name LIMIT 100', now)].map(m => ({account:m.account,name:m.name,publicKey:JSON.parse(m.public_key),expiresAt:m.expires_at})) });
      if (input.operation === 'advertise') {
        if (!input.account || Object.keys(body).sort().join(',') !== 'expiresAt,name,publicKey' || typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 40 || /[\x00-\x1f\x7f]/.test(body.name) || !Number.isSafeInteger(body.expiresAt) || Number(body.expiresAt) <= now || Number(body.expiresAt) > now+300) return json({error:'Invalid maker advertisement.'},400);
        const key = cleanRoomPublicKey(body.publicKey as JsonWebKey);
        await importRoomPublicKey(key);
        sql.exec('INSERT INTO makers VALUES (?, ?, ?, ?) ON CONFLICT(account) DO UPDATE SET name=excluded.name, public_key=excluded.public_key, expires_at=excluded.expires_at',input.account,body.name,JSON.stringify(key),body.expiresAt);
        await this.state.storage.setAlarm(Date.now()+60*60*1000);
        return json({account:input.account});
      }
      if (input.operation === 'inbox') {
        if (!input.account) return json({error:'Wallet authentication required.'},401);
        return json({ rooms: [...sql.exec<{id:string;expires_at:number}>('SELECT id,expires_at FROM rooms WHERE maker=? AND expires_at>? ORDER BY expires_at DESC LIMIT 100',input.account,now)].map(r=>({id:r.id,expiresAt:r.expires_at})) });
      }
      if (input.operation === 'create') {
        if (Object.keys(body).sort().join(',') !== 'envelope,id,maker' || !validRoomId(body.id) || !input.tokenDigest || typeof body.maker !== 'string') return json({error:'Invalid private quote request.'},400);
        assertRoomEnvelope(body.envelope);
        const envelope = JSON.stringify(body.envelope);
        const result = this.state.storage.transactionSync(() => {
          const existing = [...sql.exec<RoomRow>('SELECT * FROM rooms WHERE id=?',body.id)][0];
          if (existing) {
            const first = [...sql.exec<{envelope:string}>('SELECT envelope FROM messages WHERE room=? AND sequence=1',body.id)][0];
            return existing.maker === body.maker && existing.token_digest === input.tokenDigest && first?.envelope === envelope && existing.expires_at > now ? json({id:existing.id,expiresAt:existing.expires_at,sequence:1}) : json({error:'Quote request identity was already used.'},409);
          }
          if (![...sql.exec('SELECT account FROM makers WHERE account=? AND expires_at>?',body.maker,now)].length) return json({error:'This maker is offline. Choose another available maker.'},409);
          const count = [...sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM rooms WHERE expires_at>?',now)][0]!.count;
          if (count >= 5000) return json({error:'Quote service is busy. Try again later.'},429);
          sql.exec('INSERT INTO rooms VALUES (?, ?, ?, ?)',body.id,body.maker,input.tokenDigest,now+86400);
          sql.exec('INSERT INTO messages VALUES (?, 1, ?, ?, ?)',body.id,(body.envelope as {id:string}).id,'taker',envelope);
          return json({id:body.id,expiresAt:now+86400,sequence:1},201);
        });
        await this.state.storage.setAlarm(Date.now()+60*60*1000);
        return result;
      }
      if (!validRoomId(input.id)) return json({error:'Private quote not found.'},404);
      const room = [...sql.exec<RoomRow>('SELECT * FROM rooms WHERE id=? AND expires_at>?',input.id,now)][0];
      const role = room && input.tokenDigest === room.token_digest ? 'taker' : room && input.account === room.maker ? 'maker' : undefined;
      if (!room || !role) return json({error:'Private quote not found.'},404);
      if (input.operation === 'messages') {
        const after = input.after ?? 0;
        if (!Number.isSafeInteger(after) || after < 0 || after > 256) return json({error:'Invalid message cursor.'},400);
        return json({messages:[...sql.exec<{sequence:number;role:string;envelope:string}>('SELECT sequence,role,envelope FROM messages WHERE room=? AND sequence>? ORDER BY sequence LIMIT 50',input.id,after)].map(m=>({sequence:m.sequence,role:m.role,envelope:JSON.parse(m.envelope)}))});
      }
      if (input.operation === 'send') {
        if (Object.keys(body).join(',') !== 'envelope') return json({error:'Only encrypted messages are accepted.'},400);
        assertRoomEnvelope(body.envelope);
        const e = body.envelope, envelope = JSON.stringify(e);
        return this.state.storage.transactionSync(() => {
          const existing = [...sql.exec<{sequence:number;role:string;envelope:string}>('SELECT sequence,role,envelope FROM messages WHERE room=? AND id=?',input.id,e.id)][0];
          if (existing) return existing.role === role && existing.envelope === envelope ? json({sequence:existing.sequence}) : json({error:'Message identity was already used.'},409);
          const previous = [...sql.exec<{sequence:number}>('SELECT MAX(sequence) AS sequence FROM messages WHERE room=?',input.id)][0]!.sequence;
          if (previous >= 256) return json({error:'This conversation has reached its message limit.'},429);
          sql.exec('INSERT INTO messages VALUES (?, ?, ?, ?, ?)',input.id,previous+1,e.id,role,envelope);
          return json({sequence:previous+1},201);
        });
      }
      return json({error:'Not found.'},404);
    } catch { return json({error:'Invalid confidential transport request.'},400); }
  }
}

export async function handleConfidentialRooms(request: Request, env: RelayEnv, gate: AtomicGate): Promise<Response> {
  // Same-origin browser GET requests omit Origin. Fetch Metadata is browser-set;
  // only read requests may use it, and any explicit Origin still wins.
  if(request.method==='GET'&&!request.headers.has('origin')&&request.headers.get('sec-fetch-site')==='same-origin') {
    const headers=new Headers(request.headers);headers.set('origin',new URL(request.url).origin);
    requireSameOrigin(new Request(request,{headers}),env);
  }else requireSameOrigin(request,env);
  if (!env.CONFIDENTIAL_ROOMS) throw new RelayHttpError(503,'Private quote transport is unavailable.');
  const url = new URL(request.url), path = url.pathname.slice('/api/confidential'.length);
  if (!['GET','POST'].includes(request.method)) throw new RelayHttpError(405,'Method not allowed.');
  const auth = request.headers.get('authorization') ?? '';
  let account: string|undefined, tokenDigest: string|undefined;
  if (auth.startsWith('Room ')) {
    const token = auth.slice(5);
    if (!validRoomId(token)) throw new RelayHttpError(401,'Invalid quote access token.');
    tokenDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
  } else if (auth.startsWith('Bearer ')) {
    const session = await authenticateReadyProofToken(auth.slice(7),url.origin,env,Date.now());
    account = session.account;
  }
  const post = request.method === 'POST';
  let operation: string;
  if (path === '/makers') operation = post ? 'advertise' : 'makers';
  else if (path === '/inbox' && !post) operation = 'inbox';
  else if (path === '/rooms' && post) operation = 'create';
  else if (/^\/rooms\/[A-Za-z0-9_-]{32}$/.test(path)) operation = post ? 'send' : 'messages';
  else throw new RelayHttpError(404,'Not found.');
  if (['advertise','inbox'].includes(operation) && !account || operation === 'create' && !tokenDigest || ['send','messages'].includes(operation) && !account && !tokenDigest) throw new RelayHttpError(401,'Quote session authentication required.');
  const subject = account ?? await bootstrapQuotaSubject(request,env);
  const lease = await gate.acquire({subject,service:'confidential-trading',budget:post?'rpc-submit':'rpc-read'});
  try {
    let body:unknown;
    if(post){
      if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new RelayHttpError(415,'Expected application/json.');
      const bytes=await readBoundedRequest(request,100_000,'Private quote request is too large.');
      try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new RelayHttpError(400,'Invalid private quote JSON.');}
    }
    const id = path.split('/')[2];
    const ns = env.CONFIDENTIAL_ROOMS;
    return await ns.get(ns.idFromName('confidential-rooms-v1')).fetch('https://confidential.invalid', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation,account,tokenDigest,body,id,after:Number(url.searchParams.get('after')??0)})});
  } finally { await lease.release().catch(()=>{}); }
}
