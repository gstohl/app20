import { canonicalizeStarknetFelt } from "@app20/domain";
import {
  executeConfiguredChainVerifier,
  type ConfiguredChainVerifierCapability,
} from "./settlement-receipt-chain";

export const SETTLEMENT_RECEIPT_DOMAIN = "app20/settlement-receipt/v1";

export type SettlementOutcome = "settled" | "refunded";
export type SettlementStage = "fund" | "fill" | "claim" | "timeout";
export type ChainFinality = "pending" | "accepted" | "confirmed" | "finalized";
export type RequiredFinality = "confirmed" | "finalized";

export type ReceiptBinding = Readonly<{
  version: 1;
  domain: typeof SETTLEMENT_RECEIPT_DOMAIN;
  chainId: string;
  escrowAddress: string;
  escrowClassHash?: string;
  dealId: string;
  claimTicketId: string;
  intentDigest: string;
  /** Final VNext transcript identity emitted by every authoritative lifecycle event. */
  commitmentDigest: string;
  directoryDigest: string;
  rfqDigest: string;
  settlementContextDigest: string;
  winningQuoteDigest: string;
  makerKeyId: string;
  directoryEpoch: number;
  reservationId: string;
  reservationFence: bigint;
  registryRevision: string;
  inputAsset: string;
  inputAmountBaseUnits: bigint;
  outputAsset: string;
  outputAmountBaseUnits: bigint;
  outcome: SettlementOutcome;
}>;

export type LocalLifecycleEvidence = Readonly<{
  stage: SettlementStage;
  transactionHash: string;
  observedAt: number;
}>;

export type ChainLifecycleEvidence = Readonly<{
  stage: SettlementStage;
  transactionHash: string;
  event: Readonly<{
    blockHash: string;
    eventSelector: string;
    blockNumber: number;
    transactionIndex: number;
    eventIndex: number;
  }>;
  finality: ChainFinality;
}>;

export type LocalSettlementReceipt = ReceiptBinding &
  Readonly<{
    evidenceKind: "local";
    lifecycle: readonly LocalLifecycleEvidence[];
  }>;

export type ChainSettlementReceipt = ReceiptBinding &
  Readonly<{
    evidenceKind: "chain";
    requiredFinality: RequiredFinality;
    lifecycle: readonly ChainLifecycleEvidence[];
  }>;

export type SettlementReceipt = LocalSettlementReceipt | ChainSettlementReceipt;

const DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_U256 = (1n << 256n) - 1n;
const VERIFIED_CHAIN_RECEIPT = Symbol("app20.verified-chain-receipt");
const VERIFIED_CHAIN_RECEIPTS = new WeakSet<object>();
const INVALIDATED_CHAIN_RECEIPTS = new WeakSet<object>();
const FINALITY_RANK: Record<ChainFinality, number> = {
  pending: 0,
  accepted: 1,
  confirmed: 2,
  finalized: 3,
};

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requireFelt(value: string, label: string, allowZero = false): string {
  let normalized: string;
  try {
    normalized = canonicalizeStarknetFelt(value);
  } catch {
    throw new Error(`${label} must be a canonicalizable Starknet felt.`);
  }
  if (!allowZero && normalized === "0x0") {
    throw new Error(`${label} must not be zero.`);
  }
  return normalized;
}

function requireDigest(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex digest.`);
  }
  return normalized;
}

function requirePositiveU256(value: bigint, label: string): bigint {
  if (value <= 0n || value > MAX_U256) {
    throw new Error(`${label} must be a positive u256 value.`);
  }
  return value;
}

function requireSafeNonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function requireUnixSeconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive unix-seconds timestamp.`);
  }
  return value;
}

function expectedStages(
  outcome: SettlementOutcome,
): readonly SettlementStage[] {
  return outcome === "settled"
    ? ["fund", "fill", "claim"]
    : ["fund", "timeout"];
}

function assertBinding(receipt: SettlementReceipt): void {
  if (receipt.version !== 1 || receipt.domain !== SETTLEMENT_RECEIPT_DOMAIN) {
    throw new Error("Only settlement receipt v1 is supported.");
  }
  if (receipt.outcome !== "settled" && receipt.outcome !== "refunded") {
    throw new Error("Settlement outcome must be settled or refunded.");
  }
  if (receipt.evidenceKind !== "local" && receipt.evidenceKind !== "chain") {
    throw new Error("Receipt evidenceKind must be local or chain.");
  }
  if (
    receipt.evidenceKind === "chain" &&
    receipt.requiredFinality !== "confirmed" &&
    receipt.requiredFinality !== "finalized"
  ) {
    throw new Error("Chain receipts require confirmed or finalized finality.");
  }
  requireText(receipt.chainId, "chainId");
  requireFelt(receipt.escrowAddress, "escrowAddress");
  if (receipt.escrowClassHash !== undefined) {
    requireFelt(receipt.escrowClassHash, "escrowClassHash");
  }
  requireFelt(receipt.dealId, "dealId");
  requireFelt(receipt.claimTicketId, "claimTicketId");
  requireDigest(receipt.intentDigest, "intentDigest");
  requireDigest(receipt.commitmentDigest, "commitmentDigest");
  requireDigest(receipt.directoryDigest, "directoryDigest");
  requireDigest(receipt.rfqDigest, "rfqDigest");
  requireDigest(receipt.settlementContextDigest, "settlementContextDigest");
  requireDigest(receipt.winningQuoteDigest, "winningQuoteDigest");
  requireText(receipt.makerKeyId, "makerKeyId");
  requireSafeNonNegative(receipt.directoryEpoch, "directoryEpoch");
  requireDigest(receipt.reservationId, "reservationId");
  requirePositiveU256(receipt.reservationFence, "reservationFence");
  requireText(receipt.registryRevision, "registryRevision");
  requireFelt(receipt.inputAsset, "inputAsset");
  requireFelt(receipt.outputAsset, "outputAsset");
  requirePositiveU256(receipt.inputAmountBaseUnits, "inputAmountBaseUnits");
  requirePositiveU256(receipt.outputAmountBaseUnits, "outputAmountBaseUnits");
  if (
    receipt.outcome === "refunded" &&
    (requireFelt(receipt.outputAsset, "outputAsset") !==
      requireFelt(receipt.inputAsset, "inputAsset") ||
      receipt.outputAmountBaseUnits !== receipt.inputAmountBaseUnits)
  ) {
    throw new Error(
      "A refunded receipt must return the exact input asset and amount.",
    );
  }
}

export function assertSettlementReceipt(receipt: SettlementReceipt): void {
  assertBinding(receipt);
  const stages = expectedStages(receipt.outcome);
  if (receipt.lifecycle.length !== stages.length) {
    throw new Error(
      `The ${receipt.outcome} receipt requires ${stages.join(" → ")} lifecycle evidence.`,
    );
  }
  receipt.lifecycle.forEach((item, index) => {
    if (item.stage !== stages[index]) {
      throw new Error(
        `Lifecycle evidence must be ordered ${stages.join(" → ")}.`,
      );
    }
    requireFelt(item.transactionHash, `${item.stage} transactionHash`);
  });
  if (receipt.evidenceKind === "local") {
    receipt.lifecycle.forEach((item) => {
      requireUnixSeconds(item.observedAt, `${item.stage} observedAt`);
    });
    return;
  }

  let previousCoordinate: readonly [number, number, number] | null = null;
  const coordinates = new Set<string>();
  receipt.lifecycle.forEach((item) => {
    requireFelt(item.event.blockHash, `${item.stage} blockHash`);
    requireFelt(item.event.eventSelector, `${item.stage} eventSelector`);
    const coordinate = [
      requireSafeNonNegative(
        item.event.blockNumber,
        `${item.stage} blockNumber`,
      ),
      requireSafeNonNegative(
        item.event.transactionIndex,
        `${item.stage} transactionIndex`,
      ),
      requireSafeNonNegative(item.event.eventIndex, `${item.stage} eventIndex`),
    ] as const;
    const coordinateKey = coordinate.join(":");
    if (coordinates.has(coordinateKey)) {
      throw new Error("Lifecycle event coordinates must be unique.");
    }
    coordinates.add(coordinateKey);
    if (
      previousCoordinate &&
      (coordinate[0] < previousCoordinate[0] ||
        (coordinate[0] === previousCoordinate[0] &&
          coordinate[1] < previousCoordinate[1]) ||
        (coordinate[0] === previousCoordinate[0] &&
          coordinate[1] === previousCoordinate[1] &&
          coordinate[2] <= previousCoordinate[2]))
    ) {
      throw new Error(
        "Lifecycle event coordinates must be strictly increasing.",
      );
    }
    previousCoordinate = coordinate;
    if (!(item.finality in FINALITY_RANK)) {
      throw new Error(`${item.stage} finality is invalid.`);
    }
  });
}

function canonicalBinding(receipt: SettlementReceipt) {
  return {
    chainId: requireText(receipt.chainId, "chainId"),
    claimTicketId: requireFelt(receipt.claimTicketId, "claimTicketId"),
    commitmentDigest: requireDigest(receipt.commitmentDigest, "commitmentDigest"),
    dealId: requireFelt(receipt.dealId, "dealId"),
    directoryDigest: requireDigest(receipt.directoryDigest, "directoryDigest"),
    directoryEpoch: receipt.directoryEpoch,
    domain: receipt.domain,
    escrowAddress: requireFelt(receipt.escrowAddress, "escrowAddress"),
    ...(receipt.escrowClassHash === undefined
      ? {}
      : {
          escrowClassHash: requireFelt(
            receipt.escrowClassHash,
            "escrowClassHash",
          ),
        }),
    evidenceKind: receipt.evidenceKind,
    inputAmountBaseUnits: receipt.inputAmountBaseUnits.toString(),
    inputAsset: requireFelt(receipt.inputAsset, "inputAsset"),
    intentDigest: requireDigest(receipt.intentDigest, "intentDigest"),
    makerKeyId: requireText(receipt.makerKeyId, "makerKeyId"),
    outcome: receipt.outcome,
    outputAmountBaseUnits: receipt.outputAmountBaseUnits.toString(),
    outputAsset: requireFelt(receipt.outputAsset, "outputAsset"),
    registryRevision: requireText(receipt.registryRevision, "registryRevision"),
    reservationFence: receipt.reservationFence.toString(),
    reservationId: requireDigest(receipt.reservationId, "reservationId"),
    rfqDigest: requireDigest(receipt.rfqDigest, "rfqDigest"),
    settlementContextDigest: requireDigest(receipt.settlementContextDigest, "settlementContextDigest"),
    version: receipt.version,
    winningQuoteDigest: requireDigest(
      receipt.winningQuoteDigest,
      "winningQuoteDigest",
    ),
  };
}

/** Canonical JSON is an evidence binding and identifier, never authorization. */
export function canonicalSettlementReceipt(receipt: SettlementReceipt): string {
  assertSettlementReceipt(receipt);
  const binding = canonicalBinding(receipt);
  if (receipt.evidenceKind === "local") {
    return JSON.stringify({
      ...binding,
      lifecycle: receipt.lifecycle.map((item) => ({
        observedAt: item.observedAt,
        stage: item.stage,
        transactionHash: requireFelt(
          item.transactionHash,
          `${item.stage} transactionHash`,
        ),
      })),
    });
  }
  return JSON.stringify({
    ...binding,
    lifecycle: receipt.lifecycle.map((item) => ({
      event: {
        blockHash: requireFelt(item.event.blockHash, `${item.stage} blockHash`),
        blockNumber: item.event.blockNumber,
        eventIndex: item.event.eventIndex,
        eventSelector: requireFelt(item.event.eventSelector, `${item.stage} eventSelector`),
        transactionIndex: item.event.transactionIndex,
      },
      finality: item.finality,
      stage: item.stage,
      transactionHash: requireFelt(
        item.transactionHash,
        `${item.stage} transactionHash`,
      ),
    })),
    requiredFinality: receipt.requiredFinality,
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestSettlementReceipt(
  receipt: SettlementReceipt,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalSettlementReceipt(receipt)),
  );
  return `0x${bytesToHex(new Uint8Array(digest))}`;
}

export type VerifiedChainSettlementReceipt = Readonly<{
  [VERIFIED_CHAIN_RECEIPT]: true;
  receipt: ChainSettlementReceipt;
  verifiedAt: number;
  verificationReference: string;
  expiresAt: number;
}>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export async function verifyChainSettlementReceipt(
  receipt: ChainSettlementReceipt,
  input: {
    verificationReference: string;
    verifier: ConfiguredChainVerifierCapability;
  },
): Promise<VerifiedChainSettlementReceipt> {
  assertSettlementReceipt(receipt);
  const requiredRank = FINALITY_RANK[receipt.requiredFinality];
  if (
    receipt.lifecycle.some(
      (item) => FINALITY_RANK[item.finality] < requiredRank,
    )
  ) {
    throw new Error("Chain receipt has not reached its required finality.");
  }
  const verificationReference = requireText(
    input.verificationReference,
    "receipt verificationReference",
  );
  const cloned = structuredClone(receipt);
  const verifiedAt = await executeConfiguredChainVerifier(input.verifier, cloned);
  requireUnixSeconds(verifiedAt, "receipt verifiedAt");
  const verified = deepFreeze({
    [VERIFIED_CHAIN_RECEIPT]: true as const,
    receipt: deepFreeze(cloned),
    verifiedAt,
    verificationReference,
    expiresAt: verifiedAt + 300,
  });
  VERIFIED_CHAIN_RECEIPTS.add(verified);
  return verified;
}

export type ReceiptAuthority = Readonly<{
  authoritative: boolean;
  reason: string;
}>;

/** A reorg/canonical-membership monitor can revoke in-memory authority immediately. */
export function invalidateVerifiedChainSettlementReceipt(
  value: VerifiedChainSettlementReceipt,
): void {
  if (!VERIFIED_CHAIN_RECEIPTS.has(value)) {
    throw new Error("Only a configured-chain verified receipt can be invalidated.");
  }
  INVALIDATED_CHAIN_RECEIPTS.add(value);
}

/** Raw local or chain evidence is never authoritative without configured-chain verification. */
export function settlementReceiptAuthority(
  value: SettlementReceipt | VerifiedChainSettlementReceipt,
): ReceiptAuthority {
  const now = Math.floor(Date.now() / 1_000);
  if (
    value !== null &&
    typeof value === "object" &&
    VERIFIED_CHAIN_RECEIPTS.has(value) &&
    (value as VerifiedChainSettlementReceipt)[VERIFIED_CHAIN_RECEIPT] === true
  ) {
    const verified = value as VerifiedChainSettlementReceipt;
    if (INVALIDATED_CHAIN_RECEIPTS.has(verified)) {
      return { authoritative: false, reason: "Configured-chain verification was invalidated by reorg or canonical-membership loss." };
    }
    if (now >= verified.expiresAt) {
      return { authoritative: false, reason: "Configured-chain verification is stale and must be refreshed." };
    }
    return {
      authoritative: true,
      reason: `Configured-chain verification succeeded (${verified.verificationReference}).`,
    };
  }
  const receipt = value as SettlementReceipt;
  assertSettlementReceipt(receipt);
  if (receipt.evidenceKind === "local") {
    return {
      authoritative: false,
      reason: "Local lifecycle evidence is non-authoritative.",
    };
  }
  const requiredRank = FINALITY_RANK[receipt.requiredFinality];
  const insufficient = receipt.lifecycle.find(
    (item) => FINALITY_RANK[item.finality] < requiredRank,
  );
  if (insufficient) {
    return {
      authoritative: false,
      reason: `${insufficient.stage} has not reached ${receipt.requiredFinality} finality.`,
    };
  }
  return {
    authoritative: false,
    reason:
      "Supplied chain evidence is not authoritative until a trusted integration verifies contract identity, event payloads, canonical-chain membership, and finality.",
  };
}
