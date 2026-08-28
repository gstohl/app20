import type { DirectoryAuthorityKey } from "@app20/private-intents";
import { APP20_TOKEN_REGISTRY_REVISION } from "./token-registry";

export const SEPOLIA_RFQ_CHAIN_ID = "starknet:SN_SEPOLIA" as const;
export type SepoliaRfqManifest = Readonly<{
  version: 1;
  chainId: typeof SEPOLIA_RFQ_CHAIN_ID;
  escrowAddress: string;
  escrowClassHash: string;
  app20ClaimClassHash: string;
  legacyClaimTicketDecision: "replace";
  abiManifestDigest: string;
  registryRevision: typeof APP20_TOKEN_REGISTRY_REVISION;
  directoryAuthorityKeys: readonly DirectoryAuthorityKey[];
  directoryMinimumEpoch: number;
  directoryCheckpoint: Readonly<{ epoch: number; digest: string }> | null;
  requiredFinality: "finalized";
  rpcSpecVersion: "0.10.2";
  rpcQuorum: readonly string[];
  reviewEvidence: Readonly<{ reference: string; reviewedAt: number; validUntil: number }>;
  deploymentEvidence: Readonly<{ reference: string; deployedAt: number }>;
}>;

export const PRODUCTION_PRIVATE_DESK_IMPLEMENTED = false as const;

/** No canonical deployment is configured or authorized; proof fixtures cannot enable the Desk. */
export const SEPOLIA_RFQ_MANIFEST: SepoliaRfqManifest = Object.freeze({
  version: 1,
  chainId: SEPOLIA_RFQ_CHAIN_ID,
  escrowAddress: "0x0",
  escrowClassHash: "0x0",
  app20ClaimClassHash: "0x0",
  legacyClaimTicketDecision: "replace",
  abiManifestDigest: "",
  registryRevision: APP20_TOKEN_REGISTRY_REVISION,
  directoryAuthorityKeys: Object.freeze([]),
  directoryMinimumEpoch: 0,
  directoryCheckpoint: null,
  requiredFinality: "finalized",
  rpcSpecVersion: "0.10.2",
  rpcQuorum: Object.freeze([]),
  reviewEvidence: Object.freeze({ reference: "", reviewedAt: 0, validUntil: 0 }),
  deploymentEvidence: Object.freeze({ reference: "", deployedAt: 0 }),
});

export function validateSepoliaRfqManifest(
  _manifest: SepoliaRfqManifest,
  _now = Math.floor(Date.now() / 1_000),
  _dependencies?: { escrowHelper: string; usdcConfigured: boolean },
): boolean {
  // Localnet-final has no activation path. Future production work must replace
  // this function with reviewed artifact/ABI/product attestations rather than
  // accepting nonzero values or any historical class hash.
  return false;
}
export function isSepoliaRfqCandidateEnabled(manifest: SepoliaRfqManifest, now = Math.floor(Date.now() / 1_000)): boolean {
  return PRODUCTION_PRIVATE_DESK_IMPLEMENTED && validateSepoliaRfqManifest(manifest, now);
}

export function assertPrivateRfqNetwork(network: "mainnet" | "sepolia" | "localnet", manifest: SepoliaRfqManifest): void {
  if (network === "mainnet") throw new Error("Private RFQ is hard-disabled on Mainnet.");
  if (network !== "sepolia" || !isSepoliaRfqCandidateEnabled(manifest)) throw new Error("Bounded Sepolia RFQ candidate is unavailable.");
}
