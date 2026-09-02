import {
  PRIVATE_RFQ_V2_DOMAIN,
  assertPrivateRfqV2,
  bucketForAmount,
  createTakerAuthorizationKey,
  type PrivateRfqV2,
  type SizeBucket,
  type SizeBucketSymbol,
  type StarknetPool,
} from "@app20/private-intents";
import type { NoteMaturityStatus } from "@/lib/note-maturity";

export type V3RequestTokens =
  | Readonly<{
      sellSymbol: SizeBucketSymbol;
      sellToken: string;
      buyToken: string;
    }>
  | Readonly<{
      sell: Readonly<{ symbol: SizeBucketSymbol; address: string }>;
      buy: Readonly<{ address: string }>;
    }>;

export type CreateV3RequestInput = Readonly<{
  exactSellAmount: bigint;
  floor: bigint;
  tokens: V3RequestTokens;
  rfqId: string;
  rfqFelt: string;
  chainId: StarknetPool;
  registryRevision: string;
  directoryEpoch: number;
  settlementHelper: string;
  createdAt: number;
}>;

export type CreatedV3Request = Readonly<{
  rfq: PrivateRfqV2;
  takerSigningKey: string;
  takerCommitment: string;
  bucket: SizeBucket;
  localFloor: bigint;
}>;

function normalizeTokens(tokens: V3RequestTokens): Readonly<{
  sellSymbol: SizeBucketSymbol;
  sellToken: string;
  buyToken: string;
}> {
  return "sell" in tokens
    ? Object.freeze({
        sellSymbol: tokens.sell.symbol,
        sellToken: tokens.sell.address,
        buyToken: tokens.buy.address,
      })
    : Object.freeze({ ...tokens });
}

/**
 * Creates the size-blind wire request and its local-only execution bindings.
 * The exact amount and floor are deliberately absent from `rfq`.
 */
export function createV3Request(input: CreateV3RequestInput): CreatedV3Request {
  if (
    typeof input.exactSellAmount !== "bigint" ||
    input.exactSellAmount <= 0n
  ) {
    throw new Error("Exact sell amount must be positive.");
  }
  if (typeof input.floor !== "bigint" || input.floor < 0n) {
    throw new Error("The local floor must be a non-negative bigint.");
  }
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt <= 0) {
    throw new Error("RFQ creation time must be a positive unix timestamp.");
  }
  if (input.chainId !== "starknet:APP20_LOCALNET") {
    throw new Error("RFQ v3 is disabled outside the APP20 localnet.");
  }
  const tokens = normalizeTokens(input.tokens);
  const bucket = bucketForAmount(tokens.sellSymbol, input.exactSellAmount);
  const { signingKey: takerSigningKey, publicKey: takerCommitment } =
    createTakerAuthorizationKey();
  const responseDeadline = input.createdAt + 30;
  const expiresAt = input.createdAt + 90;
  const rfq: PrivateRfqV2 = Object.freeze({
    version: 2,
    domain: PRIVATE_RFQ_V2_DOMAIN,
    rfqId: input.rfqId,
    rfqFelt: input.rfqFelt,
    takerCommitment,
    chainId: input.chainId,
    registryRevision: input.registryRevision,
    directoryEpoch: input.directoryEpoch,
    settlementHelper: input.settlementHelper,
    sellToken: tokens.sellToken,
    buyToken: tokens.buyToken,
    sellBucketMinBaseUnits: bucket.min,
    sellBucketMaxBaseUnits: bucket.max,
    createdAt: input.createdAt,
    responseDeadline,
    expiresAt,
    lockExpiresAt: expiresAt,
  });
  assertPrivateRfqV2(rfq);
  return Object.freeze({
    rfq,
    takerSigningKey,
    takerCommitment,
    bucket,
    localFloor: input.floor,
  });
}

export type V3RequestMaturityGate =
  | Readonly<{ ready: true }>
  | Readonly<{
      ready: false;
      matureAtBlock: number;
      blocksRemaining: number;
    }>;

/** Gates only quote requesting against the newest observed account deposit. */
export function v3RequestMaturityGate(
  status: NoteMaturityStatus,
  token?: string,
): V3RequestMaturityGate {
  const matchesToken = (candidate: string): boolean => {
    if (!token) return true;
    try {
      return BigInt(candidate) === BigInt(token);
    } catch {
      throw new Error("The note maturity token is invalid.");
    }
  };
  const latestMature = status.mature
    .filter((deposit) => matchesToken(deposit.token))
    .reduce((latest, deposit) => Math.max(latest, deposit.blockNumber), -1);
  const latestPending = status.pending
    .filter(({ deposit }) => matchesToken(deposit.token))
    .reduce<NoteMaturityStatus["pending"][number] | undefined>(
      (latest, pending) =>
        !latest || pending.deposit.blockNumber > latest.deposit.blockNumber
          ? pending
          : latest,
      undefined,
    );
  if (!latestPending || latestPending.deposit.blockNumber <= latestMature) {
    return Object.freeze({ ready: true });
  }
  return Object.freeze({
    ready: false,
    matureAtBlock: latestPending.matureAtBlock,
    blocksRemaining: latestPending.blocksRemaining,
  });
}

export const maturityGateForV3Request = v3RequestMaturityGate;
