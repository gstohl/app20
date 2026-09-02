import { canonicalizeStarknetFelt } from "@app20/domain";
import { poseidonHashMany } from "@scure/starknet";
import { PrivateIntentError, type StarknetPool } from "./index.ts";

export const PRIVATE_RFQ_V2_DOMAIN = "app20/private-rfq/v2" as const;

export type PrivateRfqV2 = Readonly<{
  version: 2;
  domain: typeof PRIVATE_RFQ_V2_DOMAIN;
  rfqId: string;
  rfqFelt: string;
  takerCommitment: string;
  chainId: StarknetPool;
  registryRevision: string;
  directoryEpoch: number;
  settlementHelper: string;
  sellToken: string;
  buyToken: string;
  sellBucketMinBaseUnits: bigint;
  sellBucketMaxBaseUnits: bigint;
  createdAt: number;
  responseDeadline: number;
  expiresAt: number;
  lockExpiresAt: number;
}>;

export type PrivateRfqV2Wire = Readonly<
  Omit<PrivateRfqV2, "sellBucketMinBaseUnits" | "sellBucketMaxBaseUnits"> & {
    sellBucketMinBaseUnits: string;
    sellBucketMaxBaseUnits: string;
  }
>;

const DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const MAX_U128 = (1n << 128n) - 1n;
const MAX_RFQ_LIFETIME_SECONDS = 24 * 60 * 60;
const PRIVATE_RFQ_V2_WIRE_FIELDS = [
  "buyToken",
  "chainId",
  "createdAt",
  "directoryEpoch",
  "domain",
  "expiresAt",
  "lockExpiresAt",
  "registryRevision",
  "responseDeadline",
  "rfqFelt",
  "rfqId",
  "sellBucketMaxBaseUnits",
  "sellBucketMinBaseUnits",
  "sellToken",
  "settlementHelper",
  "takerCommitment",
  "version",
] as const;
const PRIVATE_RFQ_V2_WIRE_FIELD_SET = new Set<string>(
  PRIVATE_RFQ_V2_WIRE_FIELDS,
);

function requireDigest(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new PrivateIntentError(`${label} must be a 32-byte hex digest.`);
  }
  return normalized;
}

function requireFelt(value: string, label: string, allowZero = false): string {
  let felt: string;
  try {
    felt = canonicalizeStarknetFelt(value);
  } catch {
    throw new PrivateIntentError(`${label} must be a Starknet felt.`);
  }
  if (!allowZero && felt === "0x0") {
    throw new PrivateIntentError(`${label} must not be zero.`);
  }
  return felt;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new PrivateIntentError(`${label} is required.`);
  return normalized;
}

function requireInteger(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new PrivateIntentError(
      `${label} must be a safe integer >= ${minimum}.`,
    );
  }
  return value;
}

function requirePool(value: StarknetPool): StarknetPool {
  if (
    value !== "starknet:SN_MAIN" &&
    value !== "starknet:SN_SEPOLIA" &&
    value !== "starknet:APP20_LOCALNET"
  ) {
    throw new PrivateIntentError(
      "chainId must name a supported STRK20 deployment.",
    );
  }
  return value;
}

function requireBucketAmount(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value <= 0n || value > MAX_U128) {
    throw new PrivateIntentError(`${label} must be a positive u128 value.`);
  }
  return value;
}

function canonicalBody(rfq: PrivateRfqV2) {
  if (rfq.version !== 2 || rfq.domain !== PRIVATE_RFQ_V2_DOMAIN) {
    throw new PrivateIntentError("Only private RFQ v2 is supported.");
  }
  const createdAt = requireInteger(rfq.createdAt, "createdAt", 1);
  const responseDeadline = requireInteger(
    rfq.responseDeadline,
    "responseDeadline",
    1,
  );
  const expiresAt = requireInteger(rfq.expiresAt, "expiresAt", 1);
  const lockExpiresAt = requireInteger(rfq.lockExpiresAt, "lockExpiresAt", 1);
  if (
    responseDeadline <= createdAt ||
    expiresAt <= responseDeadline ||
    expiresAt - createdAt > MAX_RFQ_LIFETIME_SECONDS
  ) {
    throw new PrivateIntentError(
      "RFQ v2 deadlines must be ordered and bounded to 24 hours.",
    );
  }
  if (lockExpiresAt !== expiresAt) {
    throw new PrivateIntentError(
      "lockExpiresAt must equal the RFQ expiresAt timestamp.",
    );
  }
  const sellToken = requireFelt(rfq.sellToken, "sellToken");
  const buyToken = requireFelt(rfq.buyToken, "buyToken");
  if (sellToken === buyToken) {
    throw new PrivateIntentError("sellToken and buyToken must differ.");
  }
  const sellBucketMinBaseUnits = requireBucketAmount(
    rfq.sellBucketMinBaseUnits,
    "sellBucketMinBaseUnits",
  );
  const sellBucketMaxBaseUnits = requireBucketAmount(
    rfq.sellBucketMaxBaseUnits,
    "sellBucketMaxBaseUnits",
  );
  if (sellBucketMaxBaseUnits <= sellBucketMinBaseUnits) {
    throw new PrivateIntentError(
      "RFQ v2 size bucket maximum must be greater than its minimum.",
    );
  }
  return {
    buyToken,
    chainId: requirePool(rfq.chainId),
    createdAt,
    directoryEpoch: requireInteger(rfq.directoryEpoch, "directoryEpoch"),
    domain: rfq.domain,
    expiresAt,
    lockExpiresAt,
    registryRevision: requireText(rfq.registryRevision, "registryRevision"),
    responseDeadline,
    rfqFelt: requireFelt(rfq.rfqFelt, "rfqFelt"),
    rfqId: requireDigest(rfq.rfqId, "rfqId"),
    sellBucketMaxBaseUnits: sellBucketMaxBaseUnits.toString(),
    sellBucketMinBaseUnits: sellBucketMinBaseUnits.toString(),
    sellToken,
    settlementHelper: requireFelt(rfq.settlementHelper, "settlementHelper"),
    takerCommitment: requireFelt(rfq.takerCommitment, "takerCommitment", true),
    version: rfq.version,
  };
}

export function assertPrivateRfqV2(rfq: PrivateRfqV2): void {
  canonicalBody(rfq);
}

export function canonicalPrivateRfqV2(rfq: PrivateRfqV2): string {
  return JSON.stringify(canonicalBody(rfq));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `0x${bytesToHex(new Uint8Array(digest))}`;
}

export async function digestPrivateRfqV2(rfq: PrivateRfqV2): Promise<string> {
  return sha256Hex(canonicalPrivateRfqV2(rfq));
}

export function createTakerSecret(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    bytes[0] &= 0x07;
    const secret = BigInt(`0x${bytesToHex(bytes)}`);
    if (secret >= 1n << 128n) return `0x${secret.toString(16)}`;
  }
}

export function takerCommitmentFor(secret: string): string {
  const canonical = requireFelt(secret, "takerSecret");
  const commitment = poseidonHashMany([BigInt(canonical)]);
  return `0x${commitment.toString(16)}`;
}

export function encodePrivateRfqV2(rfq: PrivateRfqV2): PrivateRfqV2Wire {
  const body = canonicalBody(rfq);
  return Object.freeze({ ...body });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function decodePrivateRfqV2(value: unknown): PrivateRfqV2 {
  if (!isRecord(value)) {
    throw new PrivateIntentError(
      "Private RFQ v2 wire payload must be an object.",
    );
  }
  for (const field of PRIVATE_RFQ_V2_WIRE_FIELDS) {
    if (!(field in value)) {
      throw new PrivateIntentError(`Private RFQ v2 ${field} is required.`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!PRIVATE_RFQ_V2_WIRE_FIELD_SET.has(field)) {
      throw new PrivateIntentError(
        `Private RFQ v2 field ${field} is unsupported.`,
      );
    }
  }
  if (
    typeof value.sellBucketMinBaseUnits !== "string" ||
    !DECIMAL_PATTERN.test(value.sellBucketMinBaseUnits) ||
    typeof value.sellBucketMaxBaseUnits !== "string" ||
    !DECIMAL_PATTERN.test(value.sellBucketMaxBaseUnits)
  ) {
    throw new PrivateIntentError(
      "Private RFQ v2 wire bucket amounts must be canonical decimal strings.",
    );
  }
  const rfq = {
    ...value,
    sellBucketMinBaseUnits: BigInt(value.sellBucketMinBaseUnits),
    sellBucketMaxBaseUnits: BigInt(value.sellBucketMaxBaseUnits),
  } as PrivateRfqV2;
  canonicalBody(rfq);
  return Object.freeze(rfq);
}
