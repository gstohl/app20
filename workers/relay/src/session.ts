import { RelayHttpError } from "./errors.ts";
import type { RelayEnv } from "./types.ts";

const COOKIE_NAME = "app20_ohttp_session";
const TTL_SECONDS = 30 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface SessionPayload {
  v: 1;
  sub: string;
  exp: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string, env: RelayEnv): Promise<Uint8Array> {
  const secretBytes = encoder.encode(secret);
  if ((env.ENVIRONMENT ?? "production") === "production" && secretBytes.byteLength < 32) {
    throw new RelayHttpError(500, "Relay configuration is invalid.");
  }
  if (secretBytes.byteLength === 0) throw new RelayHttpError(500, "Relay configuration is invalid.");
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function encodeSession(subjectIdentifier: string, env: RelayEnv, nowSeconds: number): Promise<string> {
  const pseudonym = base64Url(await hmac(env.OHTTP_SESSION_SECRET, `subject:${subjectIdentifier}`, env));
  const payload = base64Url(encoder.encode(JSON.stringify({ v: 1, sub: pseudonym, exp: nowSeconds + TTL_SECONDS })));
  const signature = base64Url(await hmac(env.OHTTP_SESSION_SECRET, `session:${payload}`, env));
  return `${payload}.${signature}`;
}

export function expireOhttpSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/ohttp; Max-Age=0`;
}

/** Called only after a bootstrap handler has independently authenticated its user. */
export async function issueOhttpSession(
  authenticatedSubjectIdentifier: string,
  env: RelayEnv,
  now = Date.now(),
): Promise<string> {
  if (!authenticatedSubjectIdentifier) throw new RelayHttpError(400, "Authenticated subject is required.");
  const value = await encodeSession(authenticatedSubjectIdentifier, env, Math.floor(now / 1000));
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/api/ohttp; Max-Age=${TTL_SECONDS}`;
}

function cookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator > 0 && entry.slice(0, separator).trim() === COOKIE_NAME) {
      try {
        return decodeURIComponent(entry.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function requireOhttpSession(request: Request, env: RelayEnv, now = Date.now()): Promise<SessionPayload> {
  const value = cookie(request);
  if (!value) throw new RelayHttpError(401, "Privacy session is required.");
  const parts = value.split(".");
  if (parts.length !== 2) throw new RelayHttpError(401, "Privacy session is invalid.");
  const payloadBytes = fromBase64Url(parts[0]);
  const received = fromBase64Url(parts[1]);
  if (!payloadBytes || !received) throw new RelayHttpError(401, "Privacy session is invalid.");
  const expected = await hmac(env.OHTTP_SESSION_SECRET, `session:${parts[0]}`, env);
  if (!constantTimeEqual(received, expected)) throw new RelayHttpError(401, "Privacy session is invalid.");
  try {
    const parsed = JSON.parse(decoder.decode(payloadBytes)) as Partial<SessionPayload>;
    const nowSeconds = Math.floor(now / 1000);
    if (parsed.v !== 1 || typeof parsed.sub !== "string" || parsed.sub.length < 32 || typeof parsed.exp !== "number" || !Number.isInteger(parsed.exp) || parsed.exp <= nowSeconds || parsed.exp > nowSeconds + TTL_SECONDS + 30) {
      throw new Error("invalid");
    }
    return parsed as SessionPayload;
  } catch {
    throw new RelayHttpError(401, "Privacy session is invalid.");
  }
}
