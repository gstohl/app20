import { PrivyClient, type AuthorizationContext } from "@privy-io/node";
import { PrivyError } from "./errors.js";
export { splitStarkSignature } from "./hash-signer.js";
import type { AuthorizationOptions, Strk20Config } from "./types.js";

export function createPrivyClient(
  config: Pick<Strk20Config, "privyAppId" | "privyAppSecret">,
): PrivyClient {
  return new PrivyClient({
    appId: config.privyAppId,
    appSecret: config.privyAppSecret,
  });
}

export function authorizationContext(
  options: AuthorizationOptions = {},
  fallbackPrivateKey?: string,
): AuthorizationContext | undefined {
  const authorization_private_keys = [
    ...(options.authorizationPrivateKey
      ? [options.authorizationPrivateKey]
      : []),
    ...(!options.authorizationPrivateKey && fallbackPrivateKey
      ? [fallbackPrivateKey]
      : []),
  ];
  const user_jwts = options.userJwts ?? [];
  if (authorization_private_keys.length === 0 && user_jwts.length === 0) {
    return undefined;
  }
  return {
    ...(authorization_private_keys.length
      ? { authorization_private_keys }
      : {}),
    ...(user_jwts.length ? { user_jwts } : {}),
  };
}

export async function requireAuthorizationAsync(
  options: AuthorizationOptions = {},
  fallbackPrivateKey?: string,
  forceRefresh = false,
): Promise<AuthorizationContext> {
  const resolved = options.userJwtProvider
    ? await options.userJwtProvider({ forceRefresh })
    : [];
  const dynamicJwts = Array.isArray(resolved) ? resolved : [resolved];
  return requireAuthorization(
    {
      ...options,
      userJwts: [
        ...(options.userJwts ?? []),
        ...dynamicJwts.filter((jwt) => jwt.length > 0),
      ],
    },
    fallbackPrivateKey,
  );
}

export function requireAuthorization(
  options: AuthorizationOptions = {},
  fallbackPrivateKey?: string,
): AuthorizationContext {
  const context = authorizationContext(options, fallbackPrivateKey);
  if (!context) {
    throw new PrivyError(
      "Signing requires authorization: pass userJwts or set PRIVY_WALLET_AUTH_PRIVATE_KEY.",
    );
  }
  return context;
}

export function extractSignature(payload: unknown): string {
  if (typeof payload === "string") {
    return payload.startsWith("0x") ? payload : `0x${payload}`;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const nested =
      record.signature ??
      (record.data && typeof record.data === "object"
        ? (record.data as Record<string, unknown>).signature
        : undefined);
    if (typeof nested === "string") {
      return nested.startsWith("0x") ? nested : `0x${nested}`;
    }
  }
  throw new PrivyError("Privy rawSign did not return a signature.");
}
