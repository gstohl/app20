import { canonicalizeStarknetFelt } from "@app20/domain";
import type { ChainSettlementReceipt, ReceiptBinding, SettlementStage } from "./settlement-receipt";

export const STARKNET_RPC_SPEC_VERSION = "0.10.2" as const;
export type StarknetReceiptEvent = Readonly<{ from_address: string; keys: readonly string[]; data: readonly string[] }>;
export type ConfiguredReceiptRpc = Readonly<{ label: string; url: string }>;
export type ConfiguredChainReceiptManifest = Readonly<{
  chainId: string;
  escrowAddress: string;
  escrowClassHash: string;
  abiManifestDigest: string;
  abiBytes: string;
  eventSelectors: Readonly<Record<SettlementStage, string>>;
  requiredFinality: "finalized";
  rpcSpecVersion: typeof STARKNET_RPC_SPEC_VERSION;
  rpcQuorum: readonly ConfiguredReceiptRpc[];
  /** Exact deployment-reviewed origins; no caller-selected endpoint is accepted. */
  reviewedRpcOrigins: readonly string[];
  validUntil: number;
  /** Metadata only. The fixed generated decoder is a server import, never caller code. */
  decoderIdentity: Readonly<{ abiDigest: string; generatedModuleDigest: string }>;
}>;

declare const RUNTIME_VERIFIER: unique symbol;
/** Nominal handle. There is deliberately no exported constructor or registration API. */
export type ConfiguredChainVerifierCapability = Readonly<{ [RUNTIME_VERIFIER]: true }>;

function reviewedOrigin(endpoint: ConfiguredReceiptRpc): string {
  let url: URL;
  try { url = new URL(endpoint.url); } catch { throw new Error(`RPC ${endpoint.label} is not a valid reviewed origin.`); }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  const ipv6 = hostname.includes(":");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || ipv4 || ipv6 || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error(`RPC ${endpoint.label} is not a reviewed public HTTPS origin.`);
  return url.origin;
}

/** Pure deployment-config validation; DNS/connect enforcement remains a server-adapter responsibility. */
export function assertReviewedReceiptRpcOrigins(manifest: Pick<ConfiguredChainReceiptManifest, "rpcQuorum" | "reviewedRpcOrigins">): readonly string[] {
  const origins = manifest.rpcQuorum.map(reviewedOrigin);
  const reviewed = manifest.reviewedRpcOrigins.map((value) => {
    let url: URL; try { url = new URL(value); } catch { throw new Error("Reviewed RPC allowlist contains an invalid origin."); }
    if (url.origin !== value || reviewedOrigin({ label: "allowlist", url: value }) !== value) throw new Error("Reviewed RPC allowlist must contain exact public HTTPS origins.");
    return value;
  });
  if (origins.length < 2 || new Set(origins).size !== origins.length || new Set(manifest.rpcQuorum.map((item) => item.label)).size !== origins.length) throw new Error("At least two independently administered RPC origins are required.");
  if (new Set(reviewed).size !== reviewed.length || origins.some((origin) => !reviewed.includes(origin)) || reviewed.length !== origins.length) throw new Error("RPC quorum must exactly match the deployment-reviewed origin allowlist.");
  return origins;
}

export type CanonicalBlockView = Readonly<{ block_hash?: unknown; block_number?: unknown; transactions?: unknown }>;
/** Requires the canonical block fetched by block_number, never retrieval by a caller-supplied hash. */
export function assertCanonicalBlockNumberMembership(input: { block: CanonicalBlockView; expectedBlockHash: string; expectedBlockNumber: number; transactionHash: string; transactionIndex: number }): void {
  const felt = (value: unknown, label: string): string => { if (typeof value !== "string") throw new Error(`${label} is missing.`); let canonical: string; try { canonical = canonicalizeStarknetFelt(value); } catch { throw new Error(`${label} is invalid.`); } if (canonical === "0x0") throw new Error(`${label} must not be zero.`); return canonical; };
  if (!Number.isSafeInteger(input.expectedBlockNumber) || input.expectedBlockNumber < 0 || !Number.isSafeInteger(input.transactionIndex) || input.transactionIndex < 0) throw new Error("Canonical block coordinates are invalid.");
  const transactions = input.block.transactions;
  if (felt(input.block.block_hash, "canonical block hash") !== felt(input.expectedBlockHash, "expected block hash") || Number(input.block.block_number) !== input.expectedBlockNumber || !Array.isArray(transactions) || felt(transactions[input.transactionIndex], "canonical transaction hash") !== felt(input.transactionHash, "receipt transaction hash")) throw new Error("Receipt transaction is not a member of the canonical block at its block number.");
}

const bindingKeys: readonly (keyof ReceiptBinding)[] = ["version", "domain", "chainId", "escrowAddress", "escrowClassHash", "dealId", "claimTicketId", "intentDigest", "commitmentDigest", "directoryDigest", "rfqDigest", "settlementContextDigest", "winningQuoteDigest", "makerKeyId", "directoryEpoch", "reservationId", "reservationFence", "registryRevision", "inputAsset", "inputAmountBaseUnits", "outputAsset", "outputAmountBaseUnits", "outcome"];
/** Kept as an invariant list for the future fixed generated decoder composition root. */
export function assertDecodedReceiptBinding(receipt: ChainSettlementReceipt, decoded: ReceiptBinding): void {
  for (const key of bindingKeys) {
    const actual = receipt[key]; const candidate = decoded[key];
    if (typeof actual === "bigint" ? candidate !== actual : String(candidate).toLowerCase() !== String(actual).toLowerCase()) throw new Error(`Decoded settlement event does not match receipt ${String(key)}.`);
  }
}

/**
 * Authority creation is disabled until a server-only composition root can provide a generated
 * pinned-ABI decoder plus a DNS-pinning/no-redirect public-network adapter. General app code
 * cannot register callbacks or construct a capability.
 */
export async function executeConfiguredChainVerifier(_capability: ConfiguredChainVerifierCapability, _receipt: ChainSettlementReceipt): Promise<number> {
  throw new Error("Configured-chain receipt authority is unavailable until the runtime-provenanced server verifier is composed.");
}
