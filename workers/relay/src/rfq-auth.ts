import { RelayHttpError } from "./errors.ts";
import type { RelayEnv } from "./types.ts";

export const RFQ_ALLOWED_CHAIN_ID = "starknet:SN_SEPOLIA" as const;
export type MakerCapabilityOperation = "maker-inbox" | "maker-quote" | "maker-commands";
export type TakerCapabilityAction = "ingress" | "quote-poll" | "select" | "release";
export type RfqCapabilityOperation = MakerCapabilityOperation | TakerCapabilityAction;
export type TakerCapabilityScope = Readonly<{ makerId: string; envelopeId: string; action: TakerCapabilityAction }>;
export type MakerCapabilityContext = Readonly<{ kind: "maker"; makerId: string; directoryEpoch: number; operations: readonly MakerCapabilityOperation[]; expiresAt: number; nonce: string }>;
export type TakerCapabilityContext = Readonly<{ kind: "taker"; account: string; chainId: typeof RFQ_ALLOWED_CHAIN_ID; rfqDigest: string; directoryEpoch: number; directoryDigest: string; scopes: readonly TakerCapabilityScope[]; operations: readonly TakerCapabilityAction[]; expiresAt: number; nonce: string }>;
type Capability = MakerCapabilityContext | TakerCapabilityContext;

function base64url(bytes: Uint8Array): string { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function decode(value: string): Uint8Array {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error("malformed base64url");
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (x) => x.charCodeAt(0));
    if (base64url(bytes) !== value) throw new Error("non-canonical base64url");
    return bytes;
  } catch {
    throw new RelayHttpError(401, "RFQ capability verification failed.");
  }
}
function secret(env: RelayEnv, kind: Capability["kind"]): string { const value = kind === "maker" ? env.RFQ_MAKER_AUTH : env.RFQ_TAKER_CAPABILITY_SECRET; if (!value || new TextEncoder().encode(value).length < 32) throw new RelayHttpError(503, "RFQ capability issuer is unavailable."); return value; }
async function mac(value: string, key: string): Promise<Uint8Array> { const imported = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(value))); }
function bearer(request: Request): string { const value = request.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7) : ""; }
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }
function validScope(scope: TakerCapabilityScope): boolean { return Boolean(scope?.makerId?.trim() && /^0x[0-9a-f]{64}$/i.test(scope.envelopeId) && ["ingress", "quote-poll", "select", "release"].includes(scope.action)); }

/** Server-side issuer seam. Root keys never enter browser code; callers receive only exact tuple-scoped tokens. */
export async function issueRfqCapability(capability: Capability, env: RelayEnv): Promise<string> {
  if (!Number.isSafeInteger(capability.expiresAt) || capability.expiresAt <= 0 || !capability.nonce || !capability.operations.length || !unique(capability.operations)) throw new Error("RFQ capability scope is incomplete.");
  if (capability.kind === "taker") {
    if (capability.chainId !== RFQ_ALLOWED_CHAIN_ID) throw new Error("RFQ capabilities are Sepolia-only; Mainnet is hard-denied.");
    if (!capability.scopes.length || capability.scopes.length > 64 || capability.scopes.some((scope) => !validScope(scope))) throw new Error("RFQ taker capability tuple scope is invalid.");
    const tuples = capability.scopes.map((scope) => `${scope.makerId}\0${scope.envelopeId.toLowerCase()}\0${scope.action}`);
    if (!unique(tuples) || capability.scopes.some((scope) => !capability.operations.includes(scope.action))) throw new Error("RFQ taker capability tuple scope is duplicated or inconsistent.");
  }
  const payload = base64url(new TextEncoder().encode(JSON.stringify(capability)));
  return `${payload}.${base64url(await mac(payload, secret(env, capability.kind)))}`;
}
async function verify(request: Request, env: RelayEnv, kind: Capability["kind"], operation: RfqCapabilityOperation): Promise<Capability> {
  const [payload, signature, extra] = bearer(request).split("."); if (!payload || !signature || extra) throw new RelayHttpError(401, "RFQ capability verification failed.");
  const payloadBytes = decode(payload); const supplied = decode(signature);
  const expected = await mac(payload, secret(env, kind));
  let mismatch = supplied.length ^ expected.length; for (let index = 0; index < expected.length; index += 1) mismatch |= (supplied[index] ?? 0) ^ expected[index]!; if (mismatch !== 0) throw new RelayHttpError(401, "RFQ capability verification failed.");
  let context: Capability; try { context = JSON.parse(new TextDecoder().decode(payloadBytes)) as Capability; } catch { throw new RelayHttpError(401, "RFQ capability verification failed."); }
  const now = Math.floor(Date.now() / 1_000); if (context.kind !== kind || !Number.isSafeInteger(context.expiresAt) || context.expiresAt <= now || context.expiresAt > now + 15 * 60 || !context.operations?.includes(operation as never) || !context.nonce) throw new RelayHttpError(401, "RFQ capability is expired or out of scope.");
  return Object.freeze(context);
}
export async function requireMakerAuth(request: Request, env: RelayEnv, operation: MakerCapabilityOperation): Promise<MakerCapabilityContext> {
  const context = await verify(request, env, "maker", operation) as MakerCapabilityContext; if (!context.makerId?.trim() || !Number.isSafeInteger(context.directoryEpoch) || context.directoryEpoch < 0) throw new RelayHttpError(401, "RFQ maker capability is invalid."); return context;
}
export async function requireTakerCapability(request: Request, env: RelayEnv, operation: TakerCapabilityAction): Promise<TakerCapabilityContext> {
  const context = await verify(request, env, "taker", operation) as TakerCapabilityContext;
  if (!context.account?.trim() || context.chainId !== RFQ_ALLOWED_CHAIN_ID || !/^0x[0-9a-f]{64}$/i.test(context.rfqDigest) || !/^0x[0-9a-f]{64}$/i.test(context.directoryDigest) || !Number.isSafeInteger(context.directoryEpoch) || context.directoryEpoch < 0 || !Array.isArray(context.scopes) || !context.scopes.length || context.scopes.length > 64 || context.scopes.some((scope) => !validScope(scope))) throw new RelayHttpError(401, "RFQ taker capability is invalid.");
  return context;
}
export function requireTakerTuple(context: TakerCapabilityContext, makerId: string, envelopeId: string, action: TakerCapabilityAction): void {
  if (!context.scopes.some((scope) => scope.makerId === makerId && scope.envelopeId.toLowerCase() === envelopeId.toLowerCase() && scope.action === action)) throw new RelayHttpError(403, "RFQ capability does not authorize this exact maker/envelope/action tuple.");
}
