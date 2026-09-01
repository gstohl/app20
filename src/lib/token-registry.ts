import { canonicalizeStarknetAddress } from "@/lib/addresses";
import {
  addrSTRK,
  LOCALNET_PROVIDER_INDEX,
  localnetUsdcToken,
  localnetWalletEnabled,
} from "@/utils/constants";

export const APP20_TOKEN_REGISTRY_REVISION =
  "app20/token-registry/2026-08-25" as const;

export type App20TokenNetwork = "mainnet" | "sepolia" | "localnet";
export type App20TokenKey = "strk" | "usdc";

export type App20CanonicalToken = Readonly<{
  network: App20TokenNetwork;
  key: App20TokenKey;
  address: string;
  symbol: "STRK" | "USDC";
  decimals: 18 | 6;
  aliases: readonly string[];
}>;

export type CanonicalTokenResolution =
  | Readonly<{ ok: true; token: App20CanonicalToken }>
  | Readonly<{
      ok: false;
      code: "INVALID_TOKEN" | "TOKEN_NOT_ALLOWED" | "TOKEN_UNCONFIGURED";
      message: string;
    }>;

export type CanonicalPairResolution =
  | Readonly<{
      ok: true;
      pair: Readonly<{
        network: App20TokenNetwork;
        tokenA: App20CanonicalToken;
        tokenB: App20CanonicalToken;
        key: string;
      }>;
    }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_TOKEN"
        | "TOKEN_NOT_ALLOWED"
        | "TOKEN_UNCONFIGURED"
        | "SAME_TOKEN";
      message: string;
    }>;

function canonicalToken(
  input: Omit<App20CanonicalToken, "address"> & { address: string },
): App20CanonicalToken | null {
  try {
    const address = canonicalizeStarknetAddress(input.address);
    if (address === "0x0") return null;
    return Object.freeze({
      ...input,
      address,
      aliases: Object.freeze([
        ...new Set(input.aliases.map((alias) => alias.toLowerCase())),
      ]),
    });
  } catch {
    return null;
  }
}

function strkToken(network: App20TokenNetwork): App20CanonicalToken {
  return canonicalToken({
    network,
    key: "strk",
    address: addrSTRK,
    symbol: "STRK",
    decimals: 18,
    aliases: ["strk", "starknet", addrSTRK],
  }) as App20CanonicalToken;
}

export function app20TokenRegistry(
  network: App20TokenNetwork,
): readonly App20CanonicalToken[] {
  const tokens: App20CanonicalToken[] = [strkToken(network)];
  if (network === "localnet" && localnetWalletEnabled) {
    const usdc = canonicalToken({
      network,
      key: "usdc",
      address: localnetUsdcToken,
      symbol: "USDC",
      decimals: 6,
      aliases: ["usdc", "usd-coin", localnetUsdcToken],
    });
    if (usdc) tokens.push(usdc);
  }
  return Object.freeze(tokens);
}

export function networkForProviderIndex(
  providerIndex: number,
): App20TokenNetwork | null {
  if (providerIndex === 0) return "mainnet";
  if (providerIndex === 2) return "sepolia";
  if (providerIndex === LOCALNET_PROVIDER_INDEX && localnetWalletEnabled) {
    return "localnet";
  }
  return null;
}

function tokenInputKind(input: string): "alias" | "felt" | "invalid" {
  const trimmed = input.trim();
  if (/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(trimmed)) return "felt";
  if (/^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(trimmed)) return "alias";
  return "invalid";
}

export function resolveCanonicalToken(
  network: App20TokenNetwork,
  input: string,
  registry: readonly App20CanonicalToken[] = app20TokenRegistry(network),
): CanonicalTokenResolution {
  const scopedRegistry = registry.filter((token) => token.network === network);
  const kind = tokenInputKind(input);
  if (kind === "invalid") {
    return {
      ok: false,
      code: "INVALID_TOKEN",
      message: "Token identifier is malformed.",
    };
  }
  if (kind === "felt") {
    let address: string;
    try {
      address = canonicalizeStarknetAddress(input);
    } catch {
      return {
        ok: false,
        code: "INVALID_TOKEN",
        message: "Token address is not a bounded Starknet felt.",
      };
    }
    const token = scopedRegistry.find((entry) => entry.address === address);
    return token
      ? { ok: true, token }
      : {
          ok: false,
          code: "TOKEN_NOT_ALLOWED",
          message: "Token contract is not reviewed for this network.",
        };
  }

  const alias = input.trim().toLowerCase();
  const matches = scopedRegistry.filter(
    (entry) =>
      entry.key === alias ||
      entry.symbol.toLowerCase() === alias ||
      entry.aliases.includes(alias),
  );
  if (new Set(matches.map((entry) => entry.address)).size > 1) {
    return {
      ok: false,
      code: "TOKEN_NOT_ALLOWED",
      message: "Token alias conflicts with reviewed registry metadata.",
    };
  }
  const token = matches[0];
  if (token) return { ok: true, token };
  if (alias === "usdc" && network !== "localnet") {
    return {
      ok: false,
      code: "TOKEN_UNCONFIGURED",
      message: "USDC is not configured from reviewed metadata on this network.",
    };
  }
  return {
    ok: false,
    code: "TOKEN_NOT_ALLOWED",
    message: "Asset not reviewed for this network.",
  };
}

export function resolveCanonicalPair(
  network: App20TokenNetwork,
  tokenAInput: string,
  tokenBInput: string,
  registry: readonly App20CanonicalToken[] = app20TokenRegistry(network),
): CanonicalPairResolution {
  const tokenA = resolveCanonicalToken(network, tokenAInput, registry);
  if (!tokenA.ok) return tokenA;
  const tokenB = resolveCanonicalToken(network, tokenBInput, registry);
  if (!tokenB.ok) return tokenB;
  if (tokenA.token.address === tokenB.token.address) {
    return {
      ok: false,
      code: "SAME_TOKEN",
      message: "Choose two canonically different token contracts.",
    };
  }
  return {
    ok: true,
    pair: Object.freeze({
      network,
      tokenA: tokenA.token,
      tokenB: tokenB.token,
      key: `${network}:${tokenA.token.address}:${tokenB.token.address}`,
    }),
  };
}

export function configuredMarketPair(
  network: App20TokenNetwork,
  registry: readonly App20CanonicalToken[] = app20TokenRegistry(network),
): CanonicalPairResolution {
  return resolveCanonicalPair(network, "strk", "usdc", registry);
}

export type SessionTokenNetworkInput = Readonly<{
  selectedNetwork: App20TokenNetwork | null;
  sessionNetwork: App20TokenNetwork | null;
  connected: boolean;
  compatible: boolean;
  reason?: string;
}>;

export type SessionTokenNetworkResolution =
  | Readonly<{ ok: true; network: App20TokenNetwork }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Bind secondary-route token metadata to one network. A connected but
 * incompatible session fails closed instead of silently using the wallet
 * chain or the selected provider.
 */
export function resolveSessionTokenNetwork(
  input: SessionTokenNetworkInput,
): SessionTokenNetworkResolution {
  if (input.connected && !input.compatible) {
    const reason = input.reason?.trim();
    return {
      ok: false,
      message:
        reason || "The connected account and selected network do not match.",
    };
  }
  const network = input.compatible
    ? input.sessionNetwork
    : input.selectedNetwork;
  if (!network) {
    return { ok: false, message: "Select a supported Starknet network." };
  }
  return { ok: true, network };
}
