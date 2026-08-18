import { abortScope } from "./abort.ts";
import { exactArrayBuffer, readBoundedRequest, readBoundedResponse } from "./body.ts";
import { RelayHttpError } from "./errors.ts";
import { requireSameOrigin, validateUpstreamUrl } from "./origin.ts";
import { requireOhttpSession } from "./session.ts";
import type { AtomicGate, RelayDependencies, RelayEnv } from "./types.ts";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

type OhttpService = "prover" | "discovery";

function serviceConfig(service: OhttpService, env: RelayEnv): { url: string; authorization?: string; timeoutMs: number } {
  return service === "prover"
    ? { url: env.PROVER_UPSTREAM_URL, authorization: env.PROVER_UPSTREAM_AUTHORIZATION, timeoutMs: 180_000 }
    : { url: env.DISCOVERY_UPSTREAM_URL, authorization: env.DISCOVERY_UPSTREAM_AUTHORIZATION, timeoutMs: 30_000 };
}

export async function relayOhttp(
  request: Request,
  service: OhttpService,
  env: RelayEnv,
  dependencies: RelayDependencies,
  gate: AtomicGate,
): Promise<Response> {
  requireSameOrigin(request, env);
  if (request.method !== "POST") throw new RelayHttpError(405, "Method not allowed.");
  const mediaType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "message/ohttp-req") throw new RelayHttpError(415, "Expected message/ohttp-req.");
  const session = await requireOhttpSession(request, env, dependencies.now?.());
  const config = serviceConfig(service, env);
  const upstreamUrl = validateUpstreamUrl(config.url, env);
  const lease = await gate.acquire({
    subject: session.sub,
    service,
    budget: service === "prover" ? "ohttp-prover" : "ohttp-discovery",
  });
  try {
    const body = await readBoundedRequest(request, MAX_REQUEST_BYTES, "OHTTP request is too large.");
    const headers = new Headers({
      "content-type": "message/ohttp-req",
      accept: "message/ohttp-res",
    });
    if (config.authorization) headers.set("authorization", config.authorization);
    const scope = abortScope(request.signal, config.timeoutMs);
    try {
      const upstream = await dependencies.fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: exactArrayBuffer(body),
        redirect: "error",
        signal: scope.signal,
      });
      const responseType = (upstream.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!upstream.ok || responseType !== "message/ohttp-res") {
        await upstream.body?.cancel();
        throw new RelayHttpError(502, "OHTTP upstream unavailable.");
      }
      const bytes = await readBoundedResponse(upstream, MAX_RESPONSE_BYTES, "OHTTP upstream unavailable.");
      return new Response(exactArrayBuffer(bytes), {
        status: 200,
        headers: { "content-type": "message/ohttp-res", "cache-control": "no-store" },
      });
    } finally {
      scope.close();
    }
  } finally {
    try { await lease.release(); } catch { /* Expiring gate lease is the fail-safe. */ }
  }
}
