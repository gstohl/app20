import { Contract, type RpcProvider } from "starknet";
import { ConfigError } from "./errors.js";
import type { OhttpTransportOption } from "./ohttp.js";
import {
  loadPrivacyPoolAbi,
  loadPrivacySdk,
  loadPrivacySdkTesting,
} from "./sdk.js";

export type DiscoveryKind = "service" | "contract" | "custom";

export interface DiscoveryContext {
  provider: RpcProvider;
  poolAddress: string;
}

/** Stable package-owned seam around the privacy SDK's discovery provider. */
export interface Strk20Discovery {
  readonly kind: DiscoveryKind;
  resolve(context: DiscoveryContext): Promise<unknown>;
}

/** Structural type accepted by `customDiscovery`. */
export interface PrivacyDiscoveryProvider {
  discoverNotes(...args: unknown[]): Promise<unknown>;
  discoverChannels(...args: unknown[]): Promise<unknown>;
  discoverRequirement(...args: unknown[]): Promise<unknown>;
}

export interface ServiceDiscoveryOptions {
  /** Encrypt discovery requests locally and optionally send them through a blind relay. */
  ohttp?: OhttpTransportOption;
}

/** Use the production HTTP indexer/discovery service. */
export function serviceDiscovery(
  url: string,
  options: ServiceDiscoveryOptions = {},
): Strk20Discovery {
  if (!url.trim()) {
    throw new ConfigError("A non-empty discovery service URL is required.");
  }
  return {
    kind: "service",
    async resolve(context) {
      if (!options.ohttp) return { url };
      const sdk = await loadPrivacySdk();
      if (!sdk.IndexerDiscoveryProvider) {
        throw new ConfigError(
          "Installed privacy SDK does not export IndexerDiscoveryProvider for OHTTP discovery.",
        );
      }
      return new sdk.IndexerDiscoveryProvider(url, context.poolAddress, {
        ohttp: options.ohttp,
      });
    },
  };
}

export interface ContractDiscoveryOptions {
  /** Defaults to the SDK's bounded concurrency/retry policy. Pass false to disable. */
  rateLimit?:
    | false
    | {
        concurrency?: number;
        maxRetries?: number;
        baseDelayMs?: number;
      };
}

const POOL_VIEW_METHODS = [
  "channel_exists",
  "get_num_of_channels",
  "get_channel_info",
  "subchannel_exists",
  "get_subchannel_info",
  "get_outgoing_channel_info",
  "get_note",
  "nullifier_exists",
  "get_public_key",
  "get_enc_private_key",
  "get_auditor_public_key",
  "get_fee_amount",
  "get_fee_collector",
  "get_proof_validity_blocks",
] as const;

function plainPoolView(
  contract: object,
): Record<string, (...args: unknown[]) => unknown> {
  return Object.fromEntries(
    POOL_VIEW_METHODS.map((name) => [
      name,
      (...args: unknown[]) => {
        const method = Reflect.get(contract, name);
        if (typeof method !== "function") {
          throw new ConfigError(`Privacy pool ABI is missing ${name}().`);
        }
        return Reflect.apply(method, contract, args);
      },
    ]),
  );
}

/**
 * Query notes/channels directly from the privacy-pool contract. This avoids a
 * hosted indexer for development but is slower than service discovery.
 */
export function contractDiscovery(
  options: ContractDiscoveryOptions = {},
): Strk20Discovery {
  return {
    kind: "contract",
    async resolve(context) {
      const [testing, abiModule] = await Promise.all([
        loadPrivacySdkTesting(),
        loadPrivacyPoolAbi(),
      ]);
      const abi = abiModule.PrivacyPoolABI as never;
      const contract = new Contract({
        abi,
        address: context.poolAddress,
        providerOrAccount: context.provider,
      }).typedv2(abi);
      const pool = plainPoolView(contract);
      const rateLimit =
        options.rateLimit === false ? undefined : (options.rateLimit ?? {});
      return new testing.ContractDiscoveryProvider(
        pool,
        rateLimit ? { rateLimit } : undefined,
      );
    },
  };
}

/** Attach an application-owned discovery/indexer implementation. */
export function customDiscovery(
  provider: PrivacyDiscoveryProvider,
): Strk20Discovery {
  if (
    !provider ||
    typeof provider.discoverNotes !== "function" ||
    typeof provider.discoverChannels !== "function" ||
    typeof provider.discoverRequirement !== "function"
  ) {
    throw new ConfigError(
      "A custom discovery provider must implement discoverNotes(), discoverChannels(), and discoverRequirement().",
    );
  }
  return {
    kind: "custom",
    async resolve() {
      return provider;
    },
  };
}
