import { assertEncryptedRfqEnvelope, type EncryptedRfqEnvelopeV1 } from "@app20/private-intents";
import { RelayHttpError } from "./errors.ts";
import { requireSameOrigin } from "./origin.ts";
import { RFQ_ALLOWED_CHAIN_ID, requireMakerAuth, requireTakerCapability, requireTakerTuple, type TakerCapabilityAction, type TakerCapabilityContext } from "./rfq-auth.ts";
import { noStoreJson, readBoundedJson } from "./rfq-limits.ts";
import type { RelayEnv } from "./types.ts";

async function digestEnvelope(envelope: EncryptedRfqEnvelopeV1): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ aadDigest: envelope.aadDigest, encapsulatedKey: envelope.encapsulatedKey, ciphertext: envelope.ciphertext }))));
  return `0x${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function namespace(env: RelayEnv) {
  if (!env.RFQ_REPLAY) throw new RelayHttpError(503, "RFQ durable transport is unavailable.");
  return env.RFQ_REPLAY;
}
function stub(env: RelayEnv, makerId: string) {
  const ns = namespace(env);
  return ns.get(ns.idFromName(`rfq-replay:${makerId}`));
}
async function forward(target: ReturnType<typeof stub>, path: string, body: unknown): Promise<Response> {
  return target.fetch(`https://rfq-do.invalid${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function requireSepoliaRoute(capability: TakerCapabilityContext): void {
  if (capability.chainId !== RFQ_ALLOWED_CHAIN_ID) throw new RelayHttpError(403, "Private RFQ transport is Sepolia-only; Mainnet is hard-denied.");
}
async function requireRfqQuota(env: RelayEnv, makerId: string, principal: string, operation: string): Promise<void> {
  const response = await forward(stub(env, makerId), "/quota", { principal, operation });
  if (!response.ok) throw new RelayHttpError(response.status === 429 ? 429 : 503, response.status === 429 ? "RFQ quota exceeded." : "RFQ quota unavailable.");
}

export async function handleRfq(request: Request, env: RelayEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/rfq/directory") {
    if (request.method !== "GET") return noStoreJson({ error: "Method not allowed." }, { status: 405 });
    requireSameOrigin(request, env);
    if (!env.RFQ_DIRECTORY_JSON) throw new RelayHttpError(503, "Governed maker directory is unavailable.");
    let directory: unknown;
    try { directory = JSON.parse(env.RFQ_DIRECTORY_JSON); } catch { throw new RelayHttpError(503, "Governed maker directory is unavailable."); }
    return noStoreJson(directory);
  }
  if (path === "/api/rfq/ingress") {
    if (request.method !== "POST") return noStoreJson({ error: "Method not allowed." }, { status: 405 });
    requireSameOrigin(request, env);
    const capability = await requireTakerCapability(request, env, "ingress");
    requireSepoliaRoute(capability);
    const envelope = await readBoundedJson(request) as EncryptedRfqEnvelopeV1;
    await assertEncryptedRfqEnvelope(envelope);
    const now = Math.floor(Date.now() / 1_000);
    if (envelope.aad.rfqDigest.toLowerCase() !== capability.rfqDigest.toLowerCase() || envelope.aad.directoryDigest.toLowerCase() !== capability.directoryDigest.toLowerCase() || envelope.aad.directoryEpoch !== capability.directoryEpoch || envelope.aad.createdAt < now - 30 || envelope.aad.createdAt > now + 30 || envelope.aad.expiresAt <= now || envelope.aad.expiresAt > now + 60 * 60) throw new RelayHttpError(403, "RFQ capability context does not match envelope.");
    requireTakerTuple(capability, envelope.aad.recipientMakerId, envelope.aad.envelopeId, "ingress");
    await requireRfqQuota(env, envelope.aad.recipientMakerId, capability.account, "ingress");
    return forward(stub(env, envelope.aad.recipientMakerId), "/ingress", { envelope, envelopeDigest: await digestEnvelope(envelope), makerId: envelope.aad.recipientMakerId, replayNonce: envelope.aad.replayNonce, envelopeId: envelope.aad.envelopeId, rfqDigest: envelope.aad.rfqDigest, directoryEpoch: envelope.aad.directoryEpoch, account: capability.account, chainId: capability.chainId, expiresAt: envelope.aad.expiresAt });
  }
  if (path === "/api/rfq/maker/inbox") {
    if (request.method !== "GET") return noStoreJson({ error: "Method not allowed." }, { status: 405 });
    const maker = await requireMakerAuth(request, env, "maker-inbox");
    await requireRfqQuota(env, maker.makerId, maker.makerId, "maker-inbox");
    return stub(env, maker.makerId).fetch(`https://rfq-do.invalid/inbox?makerId=${encodeURIComponent(maker.makerId)}&directoryEpoch=${maker.directoryEpoch}`);
  }
  if (path === "/api/rfq/maker/quote") {
    if (request.method !== "POST") return noStoreJson({ error: "Method not allowed." }, { status: 405 });
    const body = await readBoundedJson(request) as Record<string, unknown>;
    const maker = await requireMakerAuth(request, env, "maker-quote");
    await requireRfqQuota(env, maker.makerId, maker.makerId, "maker-quote");
    return forward(stub(env, maker.makerId), "/quote", { ...body, makerId: maker.makerId, directoryEpoch: maker.directoryEpoch });
  }
  if (path === "/api/rfq/taker/quotes") {
    if (request.method !== "GET") return noStoreJson({ error: "Method not allowed." }, { status: 405 });
    requireSameOrigin(request, env);
    const capability = await requireTakerCapability(request, env, "quote-poll");
    requireSepoliaRoute(capability);
    const scopes = capability.scopes.filter((scope) => scope.action === "quote-poll");
    if (scopes.length !== 1) throw new RelayHttpError(403, "Quote-poll capability must bind exactly one maker envelope tuple.");
    const makerId = scopes[0]!.makerId;
    const envelopeId = scopes[0]!.envelopeId;
    const rfqDigest = capability.rfqDigest;
    await requireRfqQuota(env, makerId, capability.account, "quote-poll");
    const target = new URL("https://rfq-do.invalid/quotes");
    target.searchParams.set("envelopeId", envelopeId);
    target.searchParams.set("rfqDigest", rfqDigest);
    target.searchParams.set("directoryEpoch", String(capability.directoryEpoch));
    target.searchParams.set("account", capability.account);
    target.searchParams.set("chainId", capability.chainId);
    return stub(env, makerId).fetch(target.toString());
  }
  if (path === "/api/rfq/taker/select") {
    if (request.method !== "POST") return noStoreJson({ error: "Method not allowed." }, { status: 405 });
    requireSameOrigin(request, env);
    const body = await readBoundedJson(request) as Record<string, unknown>;
    const action = body.action as TakerCapabilityAction;
    if (action !== "select" && action !== "release") throw new RelayHttpError(403, "RFQ command action is invalid.");
    const capability = await requireTakerCapability(request, env, action);
    requireSepoliaRoute(capability);
    const makerId = typeof body.makerId === "string" ? body.makerId : "";
    const envelopeId = typeof body.envelopeId === "string" ? body.envelopeId : "";
    requireTakerTuple(capability, makerId, envelopeId, action);
    if (String(body.rfqDigest).toLowerCase() !== capability.rfqDigest.toLowerCase()) throw new RelayHttpError(403, "RFQ capability context does not match selection/release.");
    await requireRfqQuota(env, makerId, capability.account, action);
    return forward(stub(env, makerId), "/command", { ...body, directoryEpoch: capability.directoryEpoch, account: capability.account, chainId: capability.chainId });
  }
  if (path === "/api/rfq/maker/commands") {
    if (request.method !== "GET") return noStoreJson({ error: "Method not allowed." }, { status: 405 });
    const maker = await requireMakerAuth(request, env, "maker-commands");
    await requireRfqQuota(env, maker.makerId, maker.makerId, "maker-commands");
    return stub(env, maker.makerId).fetch(`https://rfq-do.invalid/commands?makerId=${encodeURIComponent(maker.makerId)}&directoryEpoch=${maker.directoryEpoch}`);
  }
  if (path === "/api/rfq/maker/inbox/ack" || path === "/api/rfq/maker/commands/ack") {
    if (request.method !== "POST") return noStoreJson({ error: "Method not allowed." }, { status: 405 });
    const operation = path.includes("commands") ? "maker-commands" : "maker-inbox";
    const maker = await requireMakerAuth(request, env, operation);
    const body = await readBoundedJson(request) as Record<string, unknown>;
    await requireRfqQuota(env, maker.makerId, maker.makerId, `${operation}-ack`);
    return forward(stub(env, maker.makerId), path.includes("commands") ? "/commands/ack" : "/inbox/ack", { ...body, makerId: maker.makerId, directoryEpoch: maker.directoryEpoch });
  }
  return noStoreJson({ error: "Not found." }, { status: 404 });
}
