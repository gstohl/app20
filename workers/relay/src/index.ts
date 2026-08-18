import { errorResponse } from "./errors.ts";
import { DurableAtomicGate, RelayGateDurableObject } from "./gate.ts";
import { relayOhttp } from "./ohttp.ts";
import { relayRpc } from "./rpc.ts";
import type { RelayDependencies, RelayEnv } from "./types.ts";

export { issueOhttpSession, requireOhttpSession } from "./session.ts";
export { spaSecurityHeaders } from "./headers.ts";
export { RelayGateDurableObject };
export type { AtomicGate, RelayEnv, SpaSecurityConfig } from "./types.ts";

export function createRelayHandler(overrides: Partial<RelayDependencies> = {}) {
  return async function handle(request: Request, env: RelayEnv): Promise<Response> {
    const dependencies: RelayDependencies = {
      fetch: overrides.fetch ?? fetch,
      now: overrides.now,
      gate: overrides.gate,
    };
    try {
      const gate = dependencies.gate ?? new DurableAtomicGate(env.RELAY_GATE);
      const path = new URL(request.url).pathname;
      if (path === "/api/ohttp/prover") return await relayOhttp(request, "prover", env, dependencies, gate);
      if (path === "/api/ohttp/discovery") return await relayOhttp(request, "discovery", env, dependencies, gate);
      if (path === "/api/starknet/sepolia") return await relayRpc(request, "sepolia", env, dependencies, gate);
      if (path === "/api/starknet/mainnet") return await relayRpc(request, "mainnet", env, dependencies, gate);
      return Response.json({ error: "Not found." }, { status: 404, headers: { "cache-control": "no-store" } });
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
