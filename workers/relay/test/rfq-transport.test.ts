import test from "node:test";
import assert from "node:assert/strict";
import { createRelayHandler } from "../src/index.ts";
import { issueRfqCapability, requireMakerAuth, requireTakerCapability, requireTakerTuple } from "../src/rfq-auth.ts";
import type { RelayEnv } from "../src/types.ts";
const D = `0x${"11".repeat(32)}`; const E2 = `0x${"22".repeat(32)}`; const NOW = () => Math.floor(Date.now() / 1_000);
function env(overrides: Partial<RelayEnv> = {}): RelayEnv { return { ENVIRONMENT: "production", RFQ_TRANSPORT_ENABLED: "false", PROVER_UPSTREAM_URL: "https://p.invalid", DISCOVERY_UPSTREAM_URL: "https://d.invalid", STARKNET_SEPOLIA_RPC_URL: "https://s.invalid", STARKNET_MAINNET_RPC_URL: "https://m.invalid", OHTTP_SESSION_SECRET: "x".repeat(40), PRIVY_APP_ID: "id", PRIVY_APP_SECRET: "x".repeat(40), SEPOLIA_POOL_ADDRESS: "0x1", SEPOLIA_STRK_TOKEN_ADDRESS: "0x2", READY_ACCOUNT_CLASS_HASH: "0x3", RELAY_GATE: {} as RelayEnv["RELAY_GATE"], RFQ_MAKER_AUTH: "m".repeat(40), RFQ_TAKER_CAPABILITY_SECRET: "t".repeat(40), ...overrides }; }
const handler = createRelayHandler();
function base64url(bytes: Uint8Array): string { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
async function signRawTakerCapability(payloadValue: Record<string, unknown>, configured: RelayEnv): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(payloadValue)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(configured.RFQ_TAKER_CAPABILITY_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))}`;
}
const scope = (makerId: string, envelopeId: string, action: "ingress" | "quote-poll" | "select" | "release") => ({ makerId, envelopeId, action });
function nonCanonicalSignatureAlias(token: string, canonicalTail: string, aliasTail: string): string {
  const [payload, signature] = token.split(".");
  assert.ok(payload && signature);
  assert.equal(signature.at(-1), canonicalTail);
  return `${payload}.${signature.slice(0, -1)}${aliasTail}`;
}
test("RFQ transport remains absent even when every dormant dependency is configured", async () => { const configured = env({ RFQ_DIRECTORY_JSON: JSON.stringify({ version: 1, signature: "opaque" }), RFQ_REPLAY: { idFromName: (name: string) => name, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) } }); for (const path of ["directory", "ingress", "maker/inbox", "taker/quotes", "taker/select", "unknown"]) { const response = await handler(new Request(`https://app.invalid/api/rfq/${path}`, { method: path === "ingress" || path === "taker/select" ? "POST" : "GET", headers: { origin: "https://app.invalid", authorization: "Bearer configured-secret", "content-type": "application/json" }, body: path === "ingress" || path === "taker/select" ? "{}" : undefined }), configured); assert.equal(response.status, 404); assert.equal(response.headers.get("cache-control"), "no-store"); } });
test("signed expiring capabilities derive principal and enforce exact tuples", async () => {
  const configured = env();
  const makerToken = await issueRfqCapability({ kind: "maker", makerId: "maker-a", directoryEpoch: 7, operations: ["maker-inbox"], expiresAt: NOW() + 60, nonce: "n1" }, configured);
  const request = new Request("https://app.invalid/api/rfq/maker/inbox?makerId=maker-b", { headers: { authorization: `Bearer ${makerToken}` } });
  assert.equal((await requireMakerAuth(request, configured, "maker-inbox")).makerId, "maker-a");
  await assert.rejects(requireMakerAuth(request, configured, "maker-quote"));
  for (const [canonicalTail, aliasTail] of [["Q", "R"], ["A", "B"], ["g", "h"], ["w", "x"]] as const) {
    let knownToken = "";
    for (let index = 0; index < 256 && !knownToken; index += 1) {
      const candidate = await issueRfqCapability({ kind: "maker", makerId: "maker-a", directoryEpoch: 7, operations: ["maker-inbox"], expiresAt: NOW() + 60, nonce: `alias-${canonicalTail}-${index}` }, configured);
      if (candidate.endsWith(canonicalTail)) knownToken = candidate;
    }
    assert.ok(knownToken, `could not produce known ${canonicalTail} signature tail`);
    const alias = new Request(request.url, { headers: { authorization: `Bearer ${nonCanonicalSignatureAlias(knownToken, canonicalTail, aliasTail)}` } });
    await assert.rejects(requireMakerAuth(alias, configured, "maker-inbox"), /verification failed/);
  }
  const [payload, signature] = makerToken.split(".");
  for (const malformed of [`${payload}.${signature}=`, `${payload}.A`, `${payload}=.${signature}`]) {
    await assert.rejects(requireMakerAuth(new Request(request.url, { headers: { authorization: `Bearer ${malformed}` } }), configured, "maker-inbox"), /verification failed/);
  }
  const takerToken = await issueRfqCapability({ kind: "taker", account: "0x1", chainId: "starknet:SN_SEPOLIA", rfqDigest: D, directoryEpoch: 7, directoryDigest: D, scopes: [scope("maker-a", D, "ingress"), scope("maker-b", E2, "release")], operations: ["ingress", "release"], expiresAt: NOW() + 60, nonce: "n2" }, configured);
  const taker = await requireTakerCapability(new Request("https://app.invalid", { headers: { authorization: `Bearer ${takerToken}`, "x-app20-taker-account": "victim" } }), configured, "ingress");
  assert.equal(taker.account, "0x1");
  assert.doesNotThrow(() => requireTakerTuple(taker, "maker-a", D, "ingress"));
  assert.throws(() => requireTakerTuple(taker, "maker-b", D, "ingress"));
  assert.throws(() => requireTakerTuple(taker, "maker-b", E2, "select"));
  await assert.rejects(issueRfqCapability({ kind: "taker", account: "0x1", chainId: "starknet:SN_SEPOLIA", rfqDigest: D, directoryEpoch: 1, directoryDigest: D, scopes: [scope("m", D, "ingress"), scope("m", D, "ingress")], operations: ["ingress"], expiresAt: NOW() + 60, nonce: "dup" }, configured), /duplicated/);
});
test("signed Mainnet capabilities are rejected at issuance, verification, and routes", async () => {
  const forwarded: string[] = [];
  const configured = env({ RFQ_REPLAY: { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request | string) => { forwarded.push(new URL(typeof request === "string" ? request : request.url).pathname); return new Response(null, { status: 204 }); } }) } });
  const mainnet = { kind: "taker", account: "0x1", chainId: "starknet:SN_MAIN", rfqDigest: D, directoryEpoch: 7, directoryDigest: D, scopes: [scope("maker-a", D, "ingress"), scope("maker-a", D, "quote-poll"), scope("maker-a", D, "select")], operations: ["ingress", "quote-poll", "select"], expiresAt: NOW() + 60, nonce: "mainnet" };
  await assert.rejects(issueRfqCapability(mainnet as never, configured), /Sepolia-only.*Mainnet.*hard-denied/);
  const token = await signRawTakerCapability(mainnet, configured);
  const headers = { origin: "https://app.invalid", authorization: `Bearer ${token}` };
  await assert.rejects(requireTakerCapability(new Request("https://app.invalid", { headers }), configured, "ingress"), /invalid/);
  const ingress = await handler(new Request("https://app.invalid/api/rfq/ingress", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" }), configured);
  const quotes = await handler(new Request("https://app.invalid/api/rfq/taker/quotes", { headers }), configured);
  const select = await handler(new Request("https://app.invalid/api/rfq/taker/select", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ makerId: "maker-a", envelopeId: D, rfqDigest: D, action: "select" }) }), configured);
  assert.deepEqual([ingress.status, quotes.status, select.status], [404, 404, 404]);
  assert.deepEqual(forwarded, []);
});
test("select scope cannot authorize release", async () => {
  const forwarded: string[] = [];
  const configured = env({ RFQ_REPLAY: { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request | string) => { const path = new URL(typeof request === "string" ? request : request.url).pathname; forwarded.push(path); return path === "/quota" ? new Response(null, { status: 204 }) : Response.json({ accepted: true }, { status: 201 }); } }) } });
  const token = await issueRfqCapability({ kind: "taker", account: "0x1", chainId: "starknet:SN_SEPOLIA", rfqDigest: D, directoryEpoch: 7, directoryDigest: D, scopes: [scope("maker-a", D, "select")], operations: ["select"], expiresAt: NOW() + 60, nonce: "select-only" }, configured);
  const response = await handler(new Request("https://app.invalid/api/rfq/taker/select", { method: "POST", headers: { origin: "https://app.invalid", authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ makerId: "maker-a", envelopeId: D, rfqDigest: D, action: "release" }) }), configured);
  assert.equal(response.status, 404);
  assert.deepEqual(forwarded, []);
});
test("configured directory remains unavailable", async () => { const response = await handler(new Request("https://app.invalid/api/rfq/directory", { headers: { origin: "https://app.invalid" } }), env({ RFQ_DIRECTORY_JSON: JSON.stringify({ version: 1, signature: "opaque" }) })); assert.equal(response.status, 404); assert.equal(response.headers.get("cache-control"), "no-store"); });
test("ingress is denied before request parsing or storage", async () => { const configured = env(); const response = await handler(new Request("https://app.invalid/api/rfq/ingress", { method: "POST", headers: { origin: "https://app.invalid", authorization: "Bearer invalid", "content-length": "999999" }, body: "{}" }), configured); assert.equal(response.status, 404); });
