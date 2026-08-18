import { RelayHttpError } from "./errors.ts";
import type { RelayEnv } from "./types.ts";

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function isExplicitLocalDevelopment(env: RelayEnv, url: URL): boolean {
  return env.ENVIRONMENT === "development" && env.ALLOW_LOCAL_DEVELOPMENT === "true" && isLoopback(url.hostname);
}

export function requireSameOrigin(request: Request, env: RelayEnv): void {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    throw new RelayHttpError(400, "Invalid request URL.");
  }

  let expectedOrigin = requestUrl.origin;
  if (env.TRUST_FORWARDED_ORIGIN === "true") {
    const proto = request.headers.get("x-forwarded-proto");
    const host = request.headers.get("x-forwarded-host");
    if (!proto || !host || (proto !== "https" && proto !== "http")) {
      throw new RelayHttpError(403, "Origin validation failed.");
    }
    try {
      expectedOrigin = new URL(`${proto}://${host}`).origin;
    } catch {
      throw new RelayHttpError(403, "Origin validation failed.");
    }
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    if (isExplicitLocalDevelopment(env, requestUrl)) return;
    throw new RelayHttpError(403, "Origin validation failed.");
  }
  if (origin !== expectedOrigin) throw new RelayHttpError(403, "Cross-origin request rejected.");
}

export function validateUpstreamUrl(raw: string, env: RelayEnv): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RelayHttpError(500, "Relay configuration is invalid.");
  }
  if (url.protocol === "https:") return url.toString();
  const localAllowed = isExplicitLocalDevelopment(env, url) && env.ALLOW_LOOPBACK_HTTP === "true";
  if (url.protocol !== "http:" || !localAllowed) {
    throw new RelayHttpError(500, "Relay configuration is invalid.");
  }
  return url.toString();
}
