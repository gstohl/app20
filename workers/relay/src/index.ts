import {
  bootstrapQuotaSubject,
  handlePrivacyBootstrap,
} from "./bootstrap.ts";
import { errorResponse } from "./errors.ts";
import { DurableAtomicGate, RelayGateDurableObject } from "./gate.ts";
import { spaSecurityHeaders } from "./headers.ts";
import { relayOhttp } from "./ohttp.ts";
import { requireSameOrigin } from "./origin.ts";
import { relayRpc } from "./rpc.ts";
import { handleRfq } from "./rfq.ts";
import { RfqReplayDurableObject } from "./rfq-replay-do.ts";
import { expireOhttpSessionCookie } from "./session.ts";
import type { RelayDependencies, RelayEnv } from "./types.ts";

export { issueOhttpSession, requireOhttpSession } from "./session.ts";
export { spaSecurityHeaders } from "./headers.ts";
export { RelayGateDurableObject, RfqReplayDurableObject };
export type { AtomicGate, RelayEnv, SpaSecurityConfig } from "./types.ts";

// Localnet-final policy is immutable in application code. Checked-in or
// externally persisted Worker configuration cannot activate dormant RFQ routes.
export const RFQ_TRANSPORT_ENABLED = false as const;

function configuredOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function serveAsset(
  request: Request,
  env: RelayEnv,
): Promise<Response> {
  if (!env.ASSETS) {
    return Response.json(
      { error: "Not found." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  const asset = await env.ASSETS.fetch(request);
  const headers = new Headers(asset.headers);
  for (const [name, value] of spaSecurityHeaders({
    privyFrameOrigins: configuredOrigins(env.PRIVY_FRAME_ORIGINS),
    privyConnectOrigins: configuredOrigins(env.PRIVY_CONNECT_ORIGINS),
  })) {
    headers.set(name, value);
  }
  return new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
}

export function createRelayHandler(overrides: Partial<RelayDependencies> = {}) {
  return async function handle(
    request: Request,
    env: RelayEnv,
  ): Promise<Response> {
    const dependencies: RelayDependencies = {
      fetch: overrides.fetch ?? fetch,
      now: overrides.now,
      gate: overrides.gate,
      privyDirectory: overrides.privyDirectory,
    };
    try {
      const path = new URL(request.url).pathname;
      if (path === "/api/privacy/logout") {
        if (request.method !== "POST") {
          return Response.json(
            { error: "Method not allowed." },
            { status: 405, headers: { "cache-control": "no-store" } },
          );
        }
        requireSameOrigin(request, env);
        return new Response(null, {
          status: 204,
          headers: {
            "cache-control": "no-store",
            "set-cookie": expireOhttpSessionCookie(),
          },
        });
      }
      if (path === "/api/privacy/bootstrap") {
        const gate =
          dependencies.gate ?? new DurableAtomicGate(env.RELAY_GATE);
        const lease = await gate.acquire({
          subject: await bootstrapQuotaSubject(request, env),
          service: "privy-bootstrap",
          budget: "privy-bootstrap",
        });
        try {
          return await handlePrivacyBootstrap(
            request,
            env,
            dependencies.privyDirectory,
          );
        } finally {
          try {
            await lease.release();
          } catch {
            // Durable lease expiry is the fail-safe.
          }
        }
      }
      const gateForRequest = () =>
        dependencies.gate ?? new DurableAtomicGate(env.RELAY_GATE);
      if (path === "/api/ohttp/prover") {
        return await relayOhttp(
          request,
          "prover",
          env,
          dependencies,
          gateForRequest(),
        );
      }
      if (path === "/api/ohttp/discovery") {
        return await relayOhttp(
          request,
          "discovery",
          env,
          dependencies,
          gateForRequest(),
        );
      }
      if (path === "/api/starknet/sepolia") {
        return await relayRpc(
          request,
          "sepolia",
          env,
          dependencies,
          gateForRequest(),
        );
      }
      if (path === "/api/starknet/mainnet") {
        return await relayRpc(
          request,
          "mainnet",
          env,
          dependencies,
          gateForRequest(),
        );
      }
      if (path.startsWith("/api/rfq/")) {
        if (!RFQ_TRANSPORT_ENABLED) {
          return Response.json(
            { error: "Not found." },
            { status: 404, headers: { "cache-control": "no-store" } },
          );
        }
        return await handleRfq(request, env);
      }
      if (path.startsWith("/api/")) {
        return Response.json(
          { error: "Not found." },
          { status: 404, headers: { "cache-control": "no-store" } },
        );
      }
      return await serveAsset(request, env);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

const handler = createRelayHandler();
export default {
  fetch(request: Request, env: RelayEnv): Promise<Response> {
    return handler(request, env);
  },
};
