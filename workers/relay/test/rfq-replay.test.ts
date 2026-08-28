import test from "node:test";
import assert from "node:assert/strict";
import { RfqReplayDurableObject } from "../src/rfq-replay-do.ts";

type EnvelopeRow = { maker_id: string; directory_epoch: number; replay_nonce: string; envelope_digest: string; envelope_id: string; rfq_digest: string; taker_account: string; envelope_json: string; created_at: number; expires_at: number; delivered_at: number | null; acknowledged_at: number | null };
type CommandRow = { maker_id: string; directory_epoch: number; envelope_id: string; rfq_digest: string; action: string; created_at: number; delivered_at: number | null; acknowledged_at: number | null };
class Sql {
  envelopes: EnvelopeRow[] = [];
  commands: CommandRow[] = [];
  exec<T>(query: string, ...b: unknown[]): Iterable<T> & { one(): T } {
    let output: unknown[] = [];
    if (query.startsWith("SELECT envelope_digest") && query.includes("replay_nonce")) output = this.envelopes.filter((r) => r.maker_id === b[0] && r.directory_epoch === b[1] && r.replay_nonce === b[2]);
    else if (query.startsWith("SELECT envelope_digest") && query.includes("rfq_digest")) output = this.envelopes.filter((r) => r.maker_id === b[0] && r.directory_epoch === b[1] && r.rfq_digest === b[2]);
    else if (query.startsWith("SELECT COUNT(*)") && query.includes("taker_account")) output = [{ count: this.envelopes.filter((r) => r.maker_id === b[0] && r.taker_account === b[1] && r.expires_at > Number(b[2])).length }];
    else if (query.startsWith("SELECT COUNT(*)")) output = [{ count: this.envelopes.filter((r) => r.maker_id === b[0] && r.expires_at > Number(b[1])).length }];
    else if (query.startsWith("INSERT INTO rfq_envelopes_v2")) this.envelopes.push({ maker_id: String(b[0]), directory_epoch: Number(b[1]), replay_nonce: String(b[2]), envelope_digest: String(b[3]), envelope_id: String(b[4]), rfq_digest: String(b[5]), taker_account: String(b[6]), envelope_json: String(b[8]), created_at: Number(b[9]), expires_at: Number(b[10]), delivered_at: null, acknowledged_at: null });
    else if (query.startsWith("SELECT envelope_json")) output = this.envelopes.filter((r) => r.maker_id === b[0] && r.directory_epoch === b[1] && r.acknowledged_at === null && r.created_at <= Number(b[2]) && r.expires_at > Number(b[3]) && (r.delivered_at === null || r.delivered_at <= Number(b[4]))).sort((a, c) => Number(a.delivered_at !== null) - Number(c.delivered_at !== null) || a.created_at - c.created_at || a.envelope_id.localeCompare(c.envelope_id)).slice(0, 50);
    else if (query.startsWith("UPDATE rfq_envelopes_v2 SET delivered_at")) { const r = this.envelopes.find((x) => x.maker_id === b[1] && x.directory_epoch === b[2] && x.envelope_id === b[3]); if (r && r.acknowledged_at === null) r.delivered_at = Number(b[0]); }
    else if (query.startsWith("UPDATE rfq_envelopes_v2 SET acknowledged_at")) { const r = this.envelopes.find((x) => x.maker_id === b[1] && x.directory_epoch === b[2] && x.envelope_id === b[3]); if (r && r.acknowledged_at === null) r.acknowledged_at = Number(b[0]); }
    else if (query.startsWith("SELECT envelope_id, rfq_digest, action")) output = this.commands.filter((r) => r.maker_id === b[0] && r.directory_epoch === b[1] && r.acknowledged_at === null && (r.delivered_at === null || r.delivered_at <= Number(b[2]))).sort((a, c) => Number(a.delivered_at !== null) - Number(c.delivered_at !== null) || a.created_at - c.created_at || a.envelope_id.localeCompare(c.envelope_id)).slice(0, 50);
    else if (query.startsWith("UPDATE rfq_commands_v2 SET delivered_at")) { const r = this.commands.find((x) => x.maker_id === b[1] && x.directory_epoch === b[2] && x.envelope_id === b[3]); if (r && r.acknowledged_at === null) r.delivered_at = Number(b[0]); }
    else if (query.startsWith("UPDATE rfq_commands_v2 SET acknowledged_at")) { const r = this.commands.find((x) => x.maker_id === b[1] && x.directory_epoch === b[2] && x.envelope_id === b[3]); if (r && r.acknowledged_at === null) r.acknowledged_at = Number(b[0]); }
    const cursor = output as unknown as Iterable<T> & { one(): T }; Object.defineProperty(cursor, "one", { value: () => output[0] as T }); return cursor;
  }
}
function object() { const sql = new Sql(); const state = { storage: { sql, transactionSync: <T>(callback: () => T) => callback(), setAlarm: async () => undefined }, blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback() }; return { target: new RfqReplayDurableObject(state as never), sql }; }
const base = { envelope: { ciphertext: "opaque" }, envelopeDigest: "d1", makerId: "m", directoryEpoch: 7, replayNonce: "n", envelopeId: "e", rfqDigest: "r", account: "a", chainId: "starknet:SN_SEPOLIA", expiresAt: Math.floor(Date.now() / 1_000) + 300 };
async function post(target: RfqReplayDurableObject, path: string, body: unknown) { return target.fetch(new Request(`https://do.invalid${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })); }

test("SQLite replay transition enforces both nonce and semantic RFQ uniqueness", async () => {
  const { target } = object();
  assert.equal((await post(target, "/ingress", { ...base, chainId: "starknet:SN_MAIN" })).status, 400);
  assert.equal((await post(target, "/ingress", base)).status, 201);
  assert.equal((await post(target, "/ingress", base)).status, 200);
  assert.equal((await post(target, "/ingress", { ...base, envelopeDigest: "d2" })).status, 409);
  assert.equal((await post(target, "/ingress", { ...base, rfqDigest: "r2", envelopeId: "e2", envelopeDigest: "d3" })).status, 409);
  assert.equal((await post(target, "/ingress", { ...base, replayNonce: "n2", envelopeId: "e3", envelopeDigest: "d4" })).status, 409);
});

test("leased inbox and commands advance beyond 50, acknowledge idempotently, and isolate epochs", async () => {
  const { target, sql } = object(); const now = Math.floor(Date.now() / 1_000);
  for (let index = 0; index < 101; index += 1) {
    const epoch = index === 100 ? 8 : 7; const id = `e${String(index).padStart(3, "0")}`;
    sql.envelopes.push({ maker_id: "m", directory_epoch: epoch, replay_nonce: `n${index}`, envelope_digest: `d${index}`, envelope_id: id, rfq_digest: `r${index}`, taker_account: `a${index}`, envelope_json: JSON.stringify({ id }), created_at: now, expires_at: now + 300, delivered_at: null, acknowledged_at: null });
    if (index < 100) sql.commands.push({ maker_id: "m", directory_epoch: 7, envelope_id: id, rfq_digest: `r${index}`, action: "select", created_at: now, delivered_at: null, acknowledged_at: null });
  }
  const get = async (path: string) => (await target.fetch(new Request(`https://do.invalid${path}`))).json() as Promise<Record<string, Array<{ envelopeId: string }>>>;
  const inbox1 = (await get("/inbox?makerId=m&directoryEpoch=7")).envelopes; const inbox2 = (await get("/inbox?makerId=m&directoryEpoch=7")).envelopes;
  assert.equal(inbox1.length, 50); assert.equal(inbox2.length, 50); assert.equal(new Set([...inbox1, ...inbox2].map((x) => x.envelopeId)).size, 100);
  assert.deepEqual((await get("/inbox?makerId=m&directoryEpoch=8")).envelopes.map((x) => x.envelopeId), ["e100"]);
  assert.equal((await post(target, "/inbox/ack", { makerId: "m", directoryEpoch: 7, envelopeIds: inbox1.map((x) => x.envelopeId) })).status, 200);
  assert.equal((await post(target, "/inbox/ack", { makerId: "m", directoryEpoch: 7, envelopeIds: inbox1.map((x) => x.envelopeId) })).status, 200);
  const commands1 = (await get("/commands?makerId=m&directoryEpoch=7")).commands; const commands2 = (await get("/commands?makerId=m&directoryEpoch=7")).commands;
  assert.equal(new Set([...commands1, ...commands2].map((x) => x.envelopeId)).size, 100);
  assert.equal((await post(target, "/commands/ack", { makerId: "m", directoryEpoch: 7, envelopeIds: commands1.map((x) => x.envelopeId) })).status, 200);
});
