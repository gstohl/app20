import { PrivyClient } from "@privy-io/node";
import { RelayHttpError } from "./errors.ts";
import { requireSameOrigin } from "./origin.ts";
import { issueOhttpSession } from "./session.ts";
import type { RelayEnv } from "./types.ts";

const MAX_STARKNET_WALLETS = 32;

export interface BrowserWalletMetadata {
  walletId: string;
  publicKey: string;
  privyAddress: string;
  displayName?: string;
  createdAt: number;
  exportedAt?: number;
  importedAt?: number;
  authorization: {
    kind: "user-only" | "shared-recovery" | "multisig" | "unavailable";
    threshold: number;
    userSignerCount: number;
    appSignerCount: number;
    browserSignable: boolean;
    appCanSignAlone: boolean;
  };
}

export interface PrivyWalletDirectory {
  authenticateAndList(accessToken: string): Promise<{
    subject: string;
    wallets: BrowserWalletMetadata[];
  }>;
}

function required(value: string | undefined): string {
  if (!value)
    throw new RelayHttpError(500, "Bootstrap configuration is invalid.");
  return value;
}

function requestOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    throw new RelayHttpError(400, "Invalid request URL.");
  }
}

function bearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 16_384) {
    throw new RelayHttpError(401, "Unauthorized.");
  }
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) throw new RelayHttpError(401, "Unauthorized.");
  return match[1];
}

export async function bootstrapQuotaSubject(
  request: Request,
  env: RelayEnv,
): Promise<string> {
  if (env.TRUST_CLIENT_IP_HEADERS !== "true") return "bootstrap-anonymous";
  const source = request.headers.get("cf-connecting-ip");
  if (!source) return "bootstrap-unknown";
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `bootstrap-${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

export function createPrivyWalletDirectory(
  env: RelayEnv,
): PrivyWalletDirectory {
  const client = new PrivyClient({
    appId: required(env.PRIVY_APP_ID),
    appSecret: required(env.PRIVY_APP_SECRET),
  });
  return {
    async authenticateAndList(accessToken) {
      let claims: { user_id: string };
      try {
        claims = await client.utils().auth().verifyAccessToken(accessToken);
      } catch {
        throw new RelayHttpError(401, "Unauthorized.");
      }

      const wallets: BrowserWalletMetadata[] = [];
      try {
        for await (const wallet of client.wallets().list({
          chain_type: "starknet",
          user_id: claims.user_id,
        })) {
          if (wallet.chain_type !== "starknet" || !wallet.public_key) continue;
          if (wallets.length >= MAX_STARKNET_WALLETS) {
            throw new RelayHttpError(413, "Too many Starknet wallets.");
          }
          const quorum = wallet.owner_id
            ? await client.keyQuorums().get(wallet.owner_id)
            : undefined;
          const userIds = quorum?.user_ids ?? [];
          const threshold = quorum?.authorization_threshold ?? 0;
          const appSignerCount = quorum?.authorization_keys.length ?? 0;
          const userIncluded = userIds.includes(claims.user_id);
          const browserSignable = userIncluded && threshold === 1;
          const candidateDisplayName = Reflect.get(wallet, "display_name");
          const displayName =
            typeof candidateDisplayName === "string"
              ? candidateDisplayName
              : undefined;
          const kind = userIncluded
            ? threshold > 1
              ? "multisig"
              : appSignerCount > 0
                ? "shared-recovery"
                : "user-only"
            : "unavailable";
          wallets.push({
            walletId: wallet.id,
            publicKey: wallet.public_key,
            privyAddress: wallet.address,
            ...(displayName ? { displayName } : {}),
            createdAt: wallet.created_at,
            ...(wallet.exported_at ? { exportedAt: wallet.exported_at } : {}),
            ...(wallet.imported_at ? { importedAt: wallet.imported_at } : {}),
            authorization: {
              kind,
              threshold,
              userSignerCount: userIds.length,
              appSignerCount,
              browserSignable,
              appCanSignAlone: threshold > 0 && appSignerCount >= threshold,
            },
          });
        }
      } catch (error) {
        if (error instanceof RelayHttpError) throw error;
        throw new RelayHttpError(502, "Wallet directory unavailable.");
      }

      wallets.sort((left, right) => left.createdAt - right.createdAt);
      return { subject: claims.user_id, wallets };
    },
  };
}

export async function handlePrivacyBootstrap(
  request: Request,
  env: RelayEnv,
  directory?: PrivyWalletDirectory,
): Promise<Response> {
  if (request.method !== "POST") {
    throw new RelayHttpError(405, "Method not allowed.");
  }
  requireSameOrigin(request, env);
  const selectedDirectory = directory ?? createPrivyWalletDirectory(env);

  let authenticated: Awaited<
    ReturnType<PrivyWalletDirectory["authenticateAndList"]>
  >;
  try {
    authenticated = await selectedDirectory.authenticateAndList(
      bearer(request),
    );
  } catch (error) {
    if (error instanceof RelayHttpError) throw error;
    throw new RelayHttpError(401, "Unauthorized.");
  }

  const origin = requestOrigin(request);
  return Response.json(
    {
      network: "sepolia",
      rpcUrl: `${origin}/api/starknet/sepolia`,
      poolAddress: required(env.SEPOLIA_POOL_ADDRESS),
      readyClassHash: required(env.READY_ACCOUNT_CLASS_HASH),
      strkToken: required(env.SEPOLIA_STRK_TOKEN_ADDRESS),
      submissionMode:
        env.PRIVY_SUBMISSION_MODE === "live" ? "live" : "build-only",
      ohttp: {
        prover: {
          gatewayUrl: "https://prover.ohttp.invalid",
          relayUrl: `${origin}/api/ohttp/prover`,
        },
        discovery: {
          gatewayUrl: "https://discovery.ohttp.invalid",
          relayUrl: `${origin}/api/ohttp/discovery`,
        },
      },
      wallets: authenticated.wallets,
    },
    {
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "set-cookie": await issueOhttpSession(authenticated.subject, env),
      },
    },
  );
}
