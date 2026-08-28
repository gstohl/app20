import { decodeSolverQuoteV2, digestSolverQuoteV2, encodeSolverQuoteV2 } from "@app20/private-intents";
import { noStoreJson, readBoundedJson } from "./rfq-limits.ts";

type SqlCursor<T> = Iterable<T> & { one(): T };
interface SqlStorage { exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlCursor<T>; }
interface RfqDoStorage { sql: SqlStorage; transactionSync<T>(callback: () => T): T; setAlarm(time: number): Promise<void>; }
interface RfqDoState { storage: RfqDoStorage; blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>; }
type Ingress = { envelope: Record<string, unknown>; envelopeDigest: string; makerId: string; replayNonce: string; envelopeId: string; rfqDigest: string; directoryEpoch: number; account: string; chainId: "starknet:SN_SEPOLIA"; expiresAt: number };
type QuoteInput = { makerId: string; envelopeId: string; rfqDigest: string; payload: unknown; directoryEpoch: number };
type CommandInput = { makerId: string; directoryEpoch: number; envelopeId: string; rfqDigest: string; account: string; chainId: "starknet:SN_SEPOLIA"; action: "select" | "release" };
type AckInput = { makerId: string; directoryEpoch: number; envelopeIds: string[] };
const MAX_ACTIVE_ENVELOPES = 100;
const MAX_ACTIVE_PER_PRINCIPAL = 20;
const DELIVERY_LIMIT = 50;
const DELIVERY_LEASE_SECONDS = 30;

function nowSeconds(): number { return Math.floor(Date.now() / 1_000); }
function validEpoch(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function parseEpoch(url: URL): number { const value = Number(url.searchParams.get("directoryEpoch")); return validEpoch(value) ? value : -1; }
function validAck(input: AckInput): boolean { return Boolean(input?.makerId && validEpoch(input.directoryEpoch) && Array.isArray(input.envelopeIds) && input.envelopeIds.length > 0 && input.envelopeIds.length <= DELIVERY_LIMIT && input.envelopeIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)); }

export class RfqReplayDurableObject {
  private readonly state: RfqDoState;
  private readonly ready: Promise<void>;
  constructor(state: RfqDoState) {
    this.state = state;
    this.ready = state.blockConcurrencyWhile(async () => {
      // V2 table names prevent a legacy partial schema from being mistaken for the reviewed epoch/ack schema.
      state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rfq_envelopes_v2 (protocol_version INTEGER NOT NULL, maker_id TEXT NOT NULL, directory_epoch INTEGER NOT NULL, replay_nonce TEXT NOT NULL, envelope_digest TEXT NOT NULL, envelope_id TEXT NOT NULL, rfq_digest TEXT NOT NULL, taker_account TEXT NOT NULL, chain_id TEXT NOT NULL, envelope_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, delivered_at INTEGER, acknowledged_at INTEGER, UNIQUE(protocol_version, maker_id, directory_epoch, replay_nonce), UNIQUE(maker_id, directory_epoch, rfq_digest), UNIQUE(envelope_id))`);
      state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rfq_quotes_v2 (maker_id TEXT NOT NULL, directory_epoch INTEGER NOT NULL, envelope_id TEXT NOT NULL, rfq_digest TEXT NOT NULL, quote_key_id TEXT NOT NULL, quote_nonce TEXT NOT NULL, quote_digest TEXT NOT NULL, taker_account TEXT NOT NULL, chain_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(maker_id, directory_epoch, quote_key_id, quote_nonce), UNIQUE(maker_id, directory_epoch, envelope_id))`);
      state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rfq_commands_v2 (maker_id TEXT NOT NULL, directory_epoch INTEGER NOT NULL, envelope_id TEXT NOT NULL, rfq_digest TEXT NOT NULL, action TEXT NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER, acknowledged_at INTEGER, UNIQUE(maker_id, directory_epoch, envelope_id))`);
      state.storage.sql.exec("CREATE TABLE IF NOT EXISTS rfq_quotas (principal TEXT NOT NULL, operation TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL, UNIQUE(principal, operation, window_start))");
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url); const path = url.pathname;
    if (request.method === "POST" && path === "/ingress") return this.ingress(await readBoundedJson(request) as Ingress);
    if (request.method === "POST" && path === "/quote") return this.quote(await readBoundedJson(request) as QuoteInput);
    if (request.method === "POST" && path === "/command") return this.command(await readBoundedJson(request) as CommandInput);
    if (request.method === "POST" && path === "/quota") return this.quota(await readBoundedJson(request) as { principal: string; operation: string });
    if (request.method === "POST" && path === "/inbox/ack") return this.acknowledge(await readBoundedJson(request) as AckInput, "inbox");
    if (request.method === "POST" && path === "/commands/ack") return this.acknowledge(await readBoundedJson(request) as AckInput, "commands");
    if (request.method === "GET" && path === "/inbox") return this.inbox(url);
    if (request.method === "GET" && path === "/quotes") return this.quotes(url);
    if (request.method === "GET" && path === "/commands") return this.commands(url);
    return noStoreJson({ error: "Not found." }, { status: 404 });
  }

  async alarm(): Promise<void> {
    const now = nowSeconds();
    this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec(`DELETE FROM rfq_commands_v2 WHERE envelope_id IN (SELECT envelope_id FROM rfq_envelopes_v2 WHERE expires_at <= ?)`, now);
      this.state.storage.sql.exec(`DELETE FROM rfq_quotes_v2 WHERE envelope_id IN (SELECT envelope_id FROM rfq_envelopes_v2 WHERE expires_at <= ?)`, now);
      this.state.storage.sql.exec(`DELETE FROM rfq_envelopes_v2 WHERE expires_at <= ?`, now);
    });
    await this.scheduleNextAlarm();
  }
  private async scheduleNextAlarm(): Promise<void> { const row = [...this.state.storage.sql.exec<{ next_expiry: number | null }>(`SELECT MIN(expires_at) AS next_expiry FROM rfq_envelopes_v2`)][0]; if (row?.next_expiry) await this.state.storage.setAlarm(row.next_expiry * 1_000); }

  private async ingress(input: Ingress): Promise<Response> {
    if (!input?.makerId || !input.replayNonce || !input.envelopeDigest || !input.envelopeId || !input.rfqDigest || !validEpoch(input.directoryEpoch) || !input.account || input.chainId !== "starknet:SN_SEPOLIA" || !Number.isSafeInteger(input.expiresAt)) return noStoreJson({ error: "Invalid RFQ ingress." }, { status: 400 });
    const now = nowSeconds(); if (input.expiresAt <= now || input.expiresAt > now + 3_600) return noStoreJson({ error: "RFQ ingress expiry is outside policy." }, { status: 400 });
    const result = this.state.storage.transactionSync(() => {
      const noncePrior = [...this.state.storage.sql.exec<{ envelope_digest: string; envelope_id: string }>(`SELECT envelope_digest, envelope_id FROM rfq_envelopes_v2 WHERE protocol_version = 1 AND maker_id = ? AND directory_epoch = ? AND replay_nonce = ?`, input.makerId, input.directoryEpoch, input.replayNonce)][0];
      const rfqPrior = [...this.state.storage.sql.exec<{ envelope_digest: string; envelope_id: string }>(`SELECT envelope_digest, envelope_id FROM rfq_envelopes_v2 WHERE maker_id = ? AND directory_epoch = ? AND rfq_digest = ?`, input.makerId, input.directoryEpoch, input.rfqDigest)][0];
      if (noncePrior || rfqPrior) return noncePrior && rfqPrior && noncePrior.envelope_id === rfqPrior.envelope_id && noncePrior.envelope_digest === input.envelopeDigest ? { kind: "idempotent", envelopeId: noncePrior.envelope_id } : { kind: "conflict" };
      const makerCount = [...this.state.storage.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM rfq_envelopes_v2 WHERE maker_id = ? AND expires_at > ?`, input.makerId, now)][0]?.count ?? 0;
      const principalCount = [...this.state.storage.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM rfq_envelopes_v2 WHERE maker_id = ? AND taker_account = ? AND expires_at > ?`, input.makerId, input.account, now)][0]?.count ?? 0;
      if (makerCount >= MAX_ACTIVE_ENVELOPES || principalCount >= MAX_ACTIVE_PER_PRINCIPAL) return { kind: "full" };
      this.state.storage.sql.exec(`INSERT INTO rfq_envelopes_v2 (protocol_version, maker_id, directory_epoch, replay_nonce, envelope_digest, envelope_id, rfq_digest, taker_account, chain_id, envelope_json, created_at, expires_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, input.makerId, input.directoryEpoch, input.replayNonce, input.envelopeDigest, input.envelopeId, input.rfqDigest, input.account, input.chainId, JSON.stringify(input.envelope), now, input.expiresAt);
      return { kind: "accepted", envelopeId: input.envelopeId };
    });
    await this.scheduleNextAlarm();
    if (result.kind === "conflict") return noStoreJson({ error: "RFQ replay conflict." }, { status: 409 });
    if (result.kind === "full") return noStoreJson({ error: "RFQ maker/principal queue is full." }, { status: 429 });
    return noStoreJson(result, { status: result.kind === "accepted" ? 201 : 200 });
  }

  private inbox(url: URL): Response {
    const makerId = url.searchParams.get("makerId") ?? ""; const directoryEpoch = parseEpoch(url); const now = nowSeconds();
    if (!makerId || directoryEpoch < 0) return noStoreJson({ error: "Invalid maker inbox scope." }, { status: 400 });
    const rows = this.state.storage.transactionSync(() => {
      const selected = [...this.state.storage.sql.exec<{ envelope_json: string; envelope_id: string; rfq_digest: string }>(`SELECT envelope_json, envelope_id, rfq_digest FROM rfq_envelopes_v2 WHERE maker_id = ? AND directory_epoch = ? AND acknowledged_at IS NULL AND created_at <= ? AND expires_at > ? AND (delivered_at IS NULL OR delivered_at <= ?) ORDER BY CASE WHEN delivered_at IS NULL THEN 0 ELSE 1 END, created_at, envelope_id LIMIT 50`, makerId, directoryEpoch, now, now, now - DELIVERY_LEASE_SECONDS)];
      for (const row of selected) this.state.storage.sql.exec(`UPDATE rfq_envelopes_v2 SET delivered_at = ? WHERE maker_id = ? AND directory_epoch = ? AND envelope_id = ? AND acknowledged_at IS NULL`, now, makerId, directoryEpoch, row.envelope_id);
      return selected;
    });
    return noStoreJson({ envelopes: rows.map((row) => ({ envelopeId: row.envelope_id, rfqDigest: row.rfq_digest, envelope: JSON.parse(row.envelope_json) })) });
  }

  private async quote(input: QuoteInput): Promise<Response> {
    if (!input?.makerId || !input.envelopeId || !input.rfqDigest || !validEpoch(input.directoryEpoch)) return noStoreJson({ error: "Invalid maker quote." }, { status: 400 });
    let quote; try { quote = decodeSolverQuoteV2(input.payload); } catch { return noStoreJson({ error: "Invalid quote v2 payload." }, { status: 400 }); }
    if (quote.solverId !== input.makerId || quote.rfqDigest !== input.rfqDigest || quote.directoryEpoch !== input.directoryEpoch) return noStoreJson({ error: "Quote v2 context mismatch." }, { status: 403 });
    const envelope = [...this.state.storage.sql.exec<{ taker_account: string; chain_id: string; rfq_digest: string; expires_at: number }>(`SELECT taker_account, chain_id, rfq_digest, expires_at FROM rfq_envelopes_v2 WHERE maker_id = ? AND directory_epoch = ? AND envelope_id = ?`, input.makerId, input.directoryEpoch, input.envelopeId)][0];
    if (!envelope || envelope.rfq_digest !== input.rfqDigest || envelope.expires_at <= nowSeconds()) return noStoreJson({ error: "Unknown, wrong-epoch, or expired RFQ envelope." }, { status: 404 });
    const quoteDigest = await digestSolverQuoteV2(quote);
    const prior = [...this.state.storage.sql.exec<{ quote_digest: string }>(`SELECT quote_digest FROM rfq_quotes_v2 WHERE maker_id = ? AND directory_epoch = ? AND quote_key_id = ? AND quote_nonce = ?`, input.makerId, input.directoryEpoch, quote.quoteKeyId, quote.nonce)][0];
    if (prior) return prior.quote_digest === quoteDigest ? noStoreJson({ accepted: true, idempotent: true }) : noStoreJson({ error: "Quote replay conflict." }, { status: 409 });
    this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec(`INSERT INTO rfq_quotes_v2 (maker_id, directory_epoch, envelope_id, rfq_digest, quote_key_id, quote_nonce, quote_digest, taker_account, chain_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, input.makerId, input.directoryEpoch, input.envelopeId, input.rfqDigest, quote.quoteKeyId, quote.nonce, quoteDigest, envelope.taker_account, envelope.chain_id, JSON.stringify(encodeSolverQuoteV2(quote)), nowSeconds());
      this.state.storage.sql.exec(`UPDATE rfq_envelopes_v2 SET acknowledged_at = ? WHERE maker_id = ? AND directory_epoch = ? AND envelope_id = ?`, nowSeconds(), input.makerId, input.directoryEpoch, input.envelopeId);
    });
    return noStoreJson({ accepted: true }, { status: 201 });
  }

  private quotes(url: URL): Response { const envelopeId = url.searchParams.get("envelopeId") ?? ""; const rfqDigest = url.searchParams.get("rfqDigest") ?? ""; const directoryEpoch = parseEpoch(url); const account = url.searchParams.get("account") ?? ""; const chainId = url.searchParams.get("chainId") ?? ""; const rows = directoryEpoch < 0 ? [] : [...this.state.storage.sql.exec<{ payload_json: string }>(`SELECT payload_json FROM rfq_quotes_v2 WHERE envelope_id = ? AND directory_epoch = ? AND rfq_digest = ? AND taker_account = ? AND chain_id = ?`, envelopeId, directoryEpoch, rfqDigest, account, chainId)]; return noStoreJson({ quotes: rows.map((row) => JSON.parse(row.payload_json)) }); }

  private command(input: CommandInput): Response {
    if ((input.action !== "select" && input.action !== "release") || input.chainId !== "starknet:SN_SEPOLIA" || !validEpoch(input.directoryEpoch)) return noStoreJson({ error: "Invalid RFQ command." }, { status: 400 });
    const envelope = [...this.state.storage.sql.exec<{ taker_account: string; chain_id: string; rfq_digest: string; expires_at: number; directory_epoch: number }>(`SELECT taker_account, chain_id, rfq_digest, expires_at, directory_epoch FROM rfq_envelopes_v2 WHERE maker_id = ? AND directory_epoch = ? AND envelope_id = ?`, input.makerId, input.directoryEpoch, input.envelopeId)][0];
    if (!envelope) return noStoreJson({ error: "Unknown RFQ envelope." }, { status: 404 });
    if (envelope.taker_account !== input.account || envelope.chain_id !== input.chainId || envelope.rfq_digest !== input.rfqDigest || envelope.expires_at <= nowSeconds()) return noStoreJson({ error: "RFQ capability does not own an active envelope." }, { status: 403 });
    const prior = [...this.state.storage.sql.exec<{ action: string }>(`SELECT action FROM rfq_commands_v2 WHERE maker_id = ? AND directory_epoch = ? AND envelope_id = ?`, input.makerId, envelope.directory_epoch, input.envelopeId)][0];
    if (prior) return prior.action === input.action ? noStoreJson({ accepted: true, idempotent: true, authority: "transport-only" }) : noStoreJson({ error: "RFQ command conflict." }, { status: 409 });
    this.state.storage.sql.exec(`INSERT INTO rfq_commands_v2 (maker_id, directory_epoch, envelope_id, rfq_digest, action, created_at) VALUES (?, ?, ?, ?, ?, ?)`, input.makerId, envelope.directory_epoch, input.envelopeId, input.rfqDigest, input.action, nowSeconds());
    return noStoreJson({ accepted: true, authority: "transport-only" }, { status: 201 });
  }

  private quota(input: { principal: string; operation: string }): Response { if (!input?.principal || !input.operation || input.principal.length > 200 || input.operation.length > 40) return noStoreJson({ error: "Invalid RFQ quota scope." }, { status: 400 }); const window = Math.floor(Date.now() / 60_000); const accepted = this.state.storage.transactionSync(() => { const prior = [...this.state.storage.sql.exec<{ count: number }>("SELECT count FROM rfq_quotas WHERE principal = ? AND operation = ? AND window_start = ?", input.principal, input.operation, window)][0]; if ((prior?.count ?? 0) >= 120) return false; this.state.storage.sql.exec("INSERT INTO rfq_quotas (principal, operation, window_start, count) VALUES (?, ?, ?, 1) ON CONFLICT(principal,operation,window_start) DO UPDATE SET count = count + 1", input.principal, input.operation, window); this.state.storage.sql.exec("DELETE FROM rfq_quotas WHERE window_start < ?", window - 2); return true; }); return accepted ? new Response(null, { status: 204 }) : noStoreJson({ error: "RFQ quota exceeded." }, { status: 429 }); }

  private commands(url: URL): Response {
    const makerId = url.searchParams.get("makerId") ?? ""; const directoryEpoch = parseEpoch(url); const now = nowSeconds();
    if (!makerId || directoryEpoch < 0) return noStoreJson({ error: "Invalid maker command scope." }, { status: 400 });
    const rows = this.state.storage.transactionSync(() => {
      const selected = [...this.state.storage.sql.exec<{ envelope_id: string; rfq_digest: string; action: string }>(`SELECT envelope_id, rfq_digest, action FROM rfq_commands_v2 WHERE maker_id = ? AND directory_epoch = ? AND acknowledged_at IS NULL AND (delivered_at IS NULL OR delivered_at <= ?) ORDER BY CASE WHEN delivered_at IS NULL THEN 0 ELSE 1 END, created_at, envelope_id LIMIT 50`, makerId, directoryEpoch, now - DELIVERY_LEASE_SECONDS)];
      for (const row of selected) this.state.storage.sql.exec(`UPDATE rfq_commands_v2 SET delivered_at = ? WHERE maker_id = ? AND directory_epoch = ? AND envelope_id = ? AND acknowledged_at IS NULL`, now, makerId, directoryEpoch, row.envelope_id);
      return selected;
    });
    return noStoreJson({ commands: rows.map((row) => ({ envelopeId: row.envelope_id, rfqDigest: row.rfq_digest, action: row.action })) });
  }

  private acknowledge(input: AckInput, table: "inbox" | "commands"): Response {
    if (!validAck(input)) return noStoreJson({ error: "Invalid RFQ acknowledgement." }, { status: 400 });
    const now = nowSeconds();
    this.state.storage.transactionSync(() => {
      for (const envelopeId of input.envelopeIds) {
        if (table === "inbox") this.state.storage.sql.exec("UPDATE rfq_envelopes_v2 SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE maker_id = ? AND directory_epoch = ? AND envelope_id = ?", now, input.makerId, input.directoryEpoch, envelopeId);
        else this.state.storage.sql.exec("UPDATE rfq_commands_v2 SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE maker_id = ? AND directory_epoch = ? AND envelope_id = ?", now, input.makerId, input.directoryEpoch, envelopeId);
      }
    });
    return noStoreJson({ acknowledged: input.envelopeIds.length });
  }
}
