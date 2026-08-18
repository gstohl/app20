import {
  Strk20Privy,
  type SessionOptions,
  type Strk20PrivyOptions,
} from "./client.js";
import type {
  AuthorizationOptions,
  CreateWalletInput,
  StarknetWalletInfo,
} from "./types.js";
import {
  privyProxyProver,
  type PrivyAccessTokenRequest,
  type PrivyAccessTokenSource,
  type PrivyProxyProverOptions,
} from "./proxy/provider.js";

export interface PrivyStrk20ClientOptions extends Strk20PrivyOptions {
  proxy: Omit<PrivyProxyProverOptions, "accessToken" | "abortSignal">;
}

export interface PrivyProxySessionOptions
  extends Omit<SessionOptions, "prover" | "provingUrl" | "authorization"> {
  /** Current Privy user access token, preferably supplied by a refresh callback. */
  accessToken: PrivyAccessTokenSource;
  authorization?: Omit<AuthorizationOptions, "userJwts" | "userJwtProvider">;
  /**
   * `auto` uses a configured backend authorization key, otherwise the user JWT.
   * `both` is for a quorum that explicitly requires both signatures.
   */
  walletAuthorization?: "auto" | "server" | "both";
  abortSignal?: AbortSignal | (() => AbortSignal | undefined);
}

async function resolveAccessToken(
  source: PrivyAccessTokenSource,
  request: PrivyAccessTokenRequest,
): Promise<string> {
  const token = typeof source === "function" ? await source(request) : source;
  if (!token.trim()) throw new Error("Privy access token is empty.");
  return token;
}

/**
 * Server-side client combining Privy wallet signing with the authenticated
 * STRK20 prover proxy. It does not call Ready-hosted infrastructure.
 */
export class PrivyStrk20Client {
  readonly core: Strk20Privy;
  readonly proxy: PrivyStrk20ClientOptions["proxy"];

  constructor(options: PrivyStrk20ClientOptions) {
    const { proxy, ...coreOptions } = options;
    this.proxy = proxy;
    this.core = new Strk20Privy(coreOptions);
  }

  get network() {
    return this.core.network;
  }

  get config() {
    return this.core.config;
  }

  createWallet(input: CreateWalletInput = {}): Promise<StarknetWalletInfo> {
    return this.core.createWallet(input);
  }

  getWallet(walletId: string): Promise<StarknetWalletInfo> {
    return this.core.getWallet(walletId);
  }

  listWallets(userId?: string): Promise<StarknetWalletInfo[]> {
    return this.core.listWallets(userId);
  }

  /**
   * Create a short-lived operation session for one authenticated Privy user.
   * The access token always authenticates the prover proxy. Wallet `rawSign`
   * uses either that token's user signer or a configured backend signer.
   */
  async session(
    walletOrId: string | StarknetWalletInfo,
    options: PrivyProxySessionOptions,
  ) {
    if (
      typeof options.accessToken === "string" &&
      !options.accessToken.trim()
    ) {
      throw new Error("Privy access token is empty.");
    }
    const {
      accessToken,
      abortSignal,
      walletAuthorization = "auto",
      authorization,
      ...sessionOptions
    } = options;
    let ownershipToken = await resolveAccessToken(accessToken, {
      forceRefresh: false,
    });
    let claims: { user_id: string };
    try {
      claims = await this.core.privy
        .utils()
        .auth()
        .verifyAccessToken(ownershipToken);
    } catch (error) {
      if (typeof accessToken !== "function") throw error;
      ownershipToken = await resolveAccessToken(accessToken, {
        forceRefresh: true,
      });
      claims = await this.core.privy
        .utils()
        .auth()
        .verifyAccessToken(ownershipToken);
    }
    const walletId =
      typeof walletOrId === "string" ? walletOrId : walletOrId.walletId;
    const ownedWallets = await this.core.listWallets(claims.user_id);
    const ownedWallet = ownedWallets.find(
      (wallet) => wallet.walletId === walletId,
    );
    if (!ownedWallet) {
      throw new Error(
        "Wallet does not belong to the authenticated Privy user.",
      );
    }
    const serverAuthorizationKey =
      authorization?.authorizationPrivateKey ??
      this.core.config.authorizationPrivateKey;
    const useServerAuthorization =
      walletAuthorization === "server" ||
      walletAuthorization === "both" ||
      (walletAuthorization === "auto" && Boolean(serverAuthorizationKey));
    if (useServerAuthorization && !serverAuthorizationKey) {
      throw new Error(
        "Server wallet authorization requires PRIVY_WALLET_AUTH_PRIVATE_KEY.",
      );
    }
    const useUserAuthorization =
      walletAuthorization === "both" || !useServerAuthorization;
    const prover = privyProxyProver({
      ...this.proxy,
      accessToken,
      abortSignal,
    });
    return this.core.session(ownedWallet, {
      ...sessionOptions,
      authorization: {
        ...authorization,
        ...(useUserAuthorization
          ? {
              userJwtProvider: async (request: PrivyAccessTokenRequest) => [
                await resolveAccessToken(accessToken, request),
              ],
            }
          : {}),
      },
      prover,
    });
  }
}
