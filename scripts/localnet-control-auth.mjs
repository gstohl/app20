import { timingSafeEqual } from "node:crypto";

export class LocalnetMutationGuardError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "LocalnetMutationGuardError";
    this.status = status;
  }
}

function sameToken(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string")
    return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Local-demo CSRF/control-plane guard. The control token is injected by Vite's
 * server-side proxy and must never be supplied by browser application code.
 */
export function assertLocalnetRuntimeEpoch(pathname, body, expectedEpoch) {
  const epochBound =
    pathname === "/invoke" ||
    pathname === "/privacy" ||
    pathname === "/balances" ||
    pathname.startsWith("/private-intents/") ||
    pathname.startsWith("/escrow/ensure-") ||
    pathname === "/rfq/authority/verify";
  if (epochBound && body?.runtimeEpoch !== expectedEpoch) {
    throw new LocalnetMutationGuardError(
      409,
      "Mutation belongs to a stale localnet runtime epoch.",
    );
  }
}

export function assertLocalnetMutationGuards(
  request,
  { expectedOrigin, controlToken },
) {
  if (request.method !== "POST") {
    throw new LocalnetMutationGuardError(
      405,
      "Localnet mutations require POST.",
    );
  }
  const contentType = request.headers["content-type"] ?? "";
  if (
    typeof contentType !== "string" ||
    !contentType.toLowerCase().startsWith("application/json")
  ) {
    throw new LocalnetMutationGuardError(
      415,
      "Localnet mutations require application/json.",
    );
  }
  if (request.headers.origin !== expectedOrigin) {
    throw new LocalnetMutationGuardError(
      403,
      "Localnet mutation origin was refused.",
    );
  }
  const fetchSite = request.headers["sec-fetch-site"];
  if (
    fetchSite !== undefined &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    throw new LocalnetMutationGuardError(
      403,
      "Cross-site localnet mutation was refused.",
    );
  }
  if (!sameToken(request.headers["x-app20-localnet-control"], controlToken)) {
    throw new LocalnetMutationGuardError(
      403,
      "Localnet control authentication failed.",
    );
  }
}
