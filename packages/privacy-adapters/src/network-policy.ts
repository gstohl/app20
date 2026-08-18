export type PrivacyNetwork = "mainnet" | "sepolia" | "localnet";
export type PrivacyAdapterKind =
  | "ready"
  | "wallet-standard"
  | "privy"
  | "localnet";
export type PrivacySubmissionMode = "live" | "build-only";
export type PrivacyOperation =
  | "connect"
  | "public-read"
  | "private-read"
  | "register"
  | "shield"
  | "private-transfer"
  | "unshield"
  | "mail"
  | "mail-with-transfer";

export interface NetworkPolicyInput {
  network: PrivacyNetwork;
  adapter: PrivacyAdapterKind;
  operation: PrivacyOperation;
  submissionMode?: PrivacySubmissionMode;
}

export interface NetworkPolicyDecision {
  allowed: boolean;
  submittable: boolean;
  code:
    | "allowed"
    | "mainnet-ready-only"
    | "unreviewed-wallet-standard"
    | "localnet-adapter-only"
    | "localnet-not-live"
    | "build-only";
  reason?: string;
}

const NON_SUBMITTING_OPERATIONS = new Set<PrivacyOperation>([
  "connect",
  "public-read",
  "private-read",
]);

/**
 * Product routing policy. It is deliberately enforced below React and before
 * any signer, discovery, prover, or submission adapter is constructed.
 *
 * Wallet-brand identity is not a cryptographic attestation. The Ready adapter
 * must additionally validate the Wallet Standard feature id before calling
 * this policy.
 */
export function evaluateNetworkPolicy(
  input: NetworkPolicyInput,
): NetworkPolicyDecision {
  if (input.network === "mainnet" && input.adapter !== "ready") {
    return {
      allowed: false,
      submittable: false,
      code: "mainnet-ready-only",
      reason: "Mainnet privacy operations are available through Ready only.",
    };
  }

  if (input.adapter === "wallet-standard") {
    return {
      allowed: false,
      submittable: false,
      code: "unreviewed-wallet-standard",
      reason:
        "Use Ready Wallet Standard on live networks or the Privy rail on Sepolia.",
    };
  }

  if (input.network === "localnet" && input.adapter !== "localnet") {
    return {
      allowed: false,
      submittable: false,
      code: "localnet-adapter-only",
      reason: "Localnet accepts only the build-gated development adapter.",
    };
  }

  if (input.network !== "localnet" && input.adapter === "localnet") {
    return {
      allowed: false,
      submittable: false,
      code: "localnet-not-live",
      reason: "The development adapter is disabled on live networks.",
    };
  }

  const isMutation = !NON_SUBMITTING_OPERATIONS.has(input.operation);
  if (isMutation && input.submissionMode === "build-only") {
    return {
      allowed: true,
      submittable: false,
      code: "build-only",
      reason: "The operation may be built and reviewed but cannot be submitted.",
    };
  }

  return { allowed: true, submittable: true, code: "allowed" };
}

export class NetworkPolicyError extends Error {
  readonly code: Exclude<NetworkPolicyDecision["code"], "allowed">;

  constructor(decision: NetworkPolicyDecision) {
    super(decision.reason ?? "Privacy adapter blocked by network policy.");
    this.name = "NetworkPolicyError";
    this.code = decision.code as Exclude<
      NetworkPolicyDecision["code"],
      "allowed"
    >;
  }
}

export function assertNetworkPolicy(input: NetworkPolicyInput): void {
  const decision = evaluateNetworkPolicy(input);
  if (!decision.allowed) throw new NetworkPolicyError(decision);
}

export function assertSubmittableNetworkPolicy(
  input: NetworkPolicyInput,
): void {
  const decision = evaluateNetworkPolicy(input);
  if (!decision.allowed || !decision.submittable) {
    throw new NetworkPolicyError(decision);
  }
}

function normalizeWalletId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Known Wallet Standard feature ids for the Ready/Argent extension lineage.
 * Display names are intentionally ignored because any extension can spoof one.
 */
const READY_WALLET_FEATURE_IDS = new Set(["ready", "argentx"]);

export function isReadyWalletFeatureId(id: string): boolean {
  return READY_WALLET_FEATURE_IDS.has(normalizeWalletId(id));
}

export function adapterKindForWalletFeatureId(
  id: string,
): "ready" | "wallet-standard" {
  return isReadyWalletFeatureId(id) ? "ready" : "wallet-standard";
}
