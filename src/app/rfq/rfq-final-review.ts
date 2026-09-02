import { canonicalizeStarknetFelt } from "@app20/domain";
import {
  evaluatePriceSchedule,
  takeMessageHash,
} from "@app20/private-intents";
import {
  readEscrowLock,
  type LocalnetEscrowLock,
} from "./localnet-private-intents";
import {
  canonicalRfqChainId,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";
import { LOCALNET_APP20_FEE_POLICY_ID } from "./rfq-operations";

export const FINAL_REVIEW_ENVIRONMENT = "LOCALNET DEMO" as const;
export const LEGACY_ESCROW_WARNING =
  "Legacy localnet escrow · not production canonical" as const;

export type RfqFinalReviewSnapshot = Readonly<{
  account: string;
  chainId: string;
  walletRail: string;
  observedAt: number;
  publicFeeBalance?: bigint;
  poolFee?: bigint;
  poolAddress?: string;
  walletConfirmedGasBaseUnits?: bigint;
  shieldedBalance?: bigint;
  shieldedMature?: boolean;
}>;

export type RfqFinalReviewTerms = Readonly<{
  rfqId: string;
  quoteDigest?: string;
  intentDigest: string;
  quoteNonce: string;
  reservationId: string;
  reservationFence?: bigint;
  makerId: string;
  makerKeyId: string;
  sellSymbol: string;
  sellAddress: string;
  sellDecimals: number;
  sellAmount: bigint;
  buySymbol: string;
  buyAddress: string;
  buyDecimals: number;
  buyAmount: bigint;
  minBuyAmount: bigint;
  referenceGrossBuyAmount: bigint;
  perTradeCapBaseUnits: bigint;
  maximumTotalDeviationBps: number;
  maximumMakerSpreadBps: number;
  economicPolicyId: string;
  app20FeePolicyId: string;
  app20FeeAmount: bigint;
  spreadBps: number;
  quoteExpiresAt: number;
  reservationExpiresAt: number;
  settlementExpiresAt: number;
  registryRevision: string;
  requiresMatureNote: boolean;
}>;

export type FinalReviewCheck = Readonly<{
  ok: boolean;
  blockers: readonly string[];
}>;

function sameReviewChain(left: string, right: string): boolean {
  try {
    return canonicalRfqChainId(left) === canonicalRfqChainId(right);
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}

export function validateFinalReview(input: {
  initial: RfqFinalReviewSnapshot;
  current: RfqFinalReviewSnapshot;
  terms: RfqFinalReviewTerms;
  now: number;
}): FinalReviewCheck {
  const blockers: string[] = [];
  if (
    input.current.account.toLowerCase() !== input.initial.account.toLowerCase()
  )
    blockers.push("Connected account changed.");
  if (!sameReviewChain(input.current.chainId, input.initial.chainId))
    blockers.push("Wallet network changed.");
  if (input.current.walletRail !== input.initial.walletRail)
    blockers.push("Wallet rail changed.");
  if (input.now >= input.terms.quoteExpiresAt) blockers.push("Quote expired.");
  if (input.now >= input.terms.reservationExpiresAt)
    blockers.push("Reservation expired.");
  if (input.now >= input.terms.settlementExpiresAt)
    blockers.push("Settlement expired.");
  if (input.terms.buyAmount < input.terms.minBuyAmount)
    blockers.push("Exact receive is below the reviewed minimum.");
  if (input.terms.spreadBps > input.terms.maximumMakerSpreadBps)
    blockers.push("Maker spread exceeds the reviewed maximum.");
  if (input.terms.sellAmount > input.terms.perTradeCapBaseUnits)
    blockers.push("Sell amount exceeds the named per-trade cap.");
  if (
    input.initial.poolFee === undefined ||
    input.current.poolFee === undefined
  )
    blockers.push("Fresh STRK20 pool fee is unavailable.");
  else if (input.initial.poolFee !== input.current.poolFee)
    blockers.push("Live STRK20 pool fee changed.");
  if (!input.initial.poolAddress || !input.current.poolAddress)
    blockers.push("Bound STRK20 pool address is unavailable.");
  else if (
    input.initial.poolAddress.toLowerCase() !==
    input.current.poolAddress.toLowerCase()
  )
    blockers.push("Bound STRK20 pool address changed.");
  if (input.current.publicFeeBalance === undefined)
    blockers.push("Fresh public fee balance is unavailable.");
  else if (
    input.current.poolFee !== undefined &&
    input.current.publicFeeBalance < input.current.poolFee
  ) {
    blockers.push(
      "Fresh public fee balance does not cover the STRK20 pool fee.",
    );
  }
  if (
    input.terms.app20FeePolicyId !== LOCALNET_APP20_FEE_POLICY_ID ||
    input.terms.app20FeeAmount !== 0n
  ) {
    blockers.push("The APP20 fee policy is unsupported or non-zero.");
  }
  if (input.terms.requiresMatureNote && input.current.shieldedMature !== true) {
    blockers.push(
      "Required shielded-note maturity evidence is unavailable or not mature.",
    );
  }
  if (
    input.current.shieldedBalance !== undefined &&
    input.current.shieldedBalance < input.terms.sellAmount
  ) {
    blockers.push(
      "Observed shielded balance no longer covers the exact sell amount.",
    );
  }
  return Object.freeze({
    ok: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}

export type RfqFinalReviewV3Fill = Readonly<{
  makerId: string;
  lockId: string;
  amountA: bigint;
  amountB: bigint;
  lockExpiresAt: number;
}>;

export type RfqFinalReviewV3TakeAuthorization = Readonly<{
  escrowAddress: string;
  publicKey: string;
  message: string;
}>;

export type RfqFinalReviewV3Terms = Readonly<{
  mode: "v3";
  rfqId: string;
  sellAddress: string;
  exactSellAmount: bigint;
  buyAddress: string;
  totalBuyAmount: bigint;
  floorBuyAmount: bigint;
  fills: readonly RfqFinalReviewV3Fill[];
  takeAuthorization: RfqFinalReviewV3TakeAuthorization;
  feeBps: number;
  app20FeeAmount: bigint;
}>;

export function takeAuthorizationForV3Review(
  terms: Pick<
    RfqFinalReviewV3Terms,
    "rfqId" | "sellAddress" | "buyAddress" | "fills"
  >,
  escrowAddress: string,
  publicKey: string,
): RfqFinalReviewV3TakeAuthorization {
  return Object.freeze({
    escrowAddress,
    publicKey,
    message: takeMessageHash({
      escrowAddress,
      rfqFelt: terms.rfqId,
      tokenA: terms.sellAddress,
      tokenB: terms.buyAddress,
      fills: terms.fills.map((fill) => ({
        lockId: fill.lockId,
        amountA: fill.amountA,
      })),
    }),
  });
}

export function takeAuthorizationFromLifecycle(
  record: RfqLifecycleRecord,
): RfqFinalReviewV3TakeAuthorization {
  if (
    record.mode !== "v3" ||
    !record.terms?.buyAmount ||
    !record.settlement ||
    !record.takerCommitment ||
    !record.fills
  ) {
    throw new Error("The persisted RFQ v3 Take authorization is unavailable.");
  }
  return takeAuthorizationForV3Review(
    {
      rfqId: record.rfqId,
      sellAddress: record.terms.sellAddress,
      buyAddress: record.terms.buyAddress,
      fills: record.fills.map((fill) => ({
        makerId: fill.makerId,
        lockId: fill.lockId,
        amountA: BigInt(fill.amountA),
        amountB: BigInt(fill.amountB),
        lockExpiresAt: fill.lockExpiresAt,
      })),
    },
    record.settlement.escrowAddress,
    record.takerCommitment,
  );
}

/** Validates the immutable exact-fill bindings immediately before a v3 Take. */
export function validateV3FinalReview(input: {
  initial: RfqFinalReviewSnapshot;
  current: RfqFinalReviewSnapshot;
  terms: RfqFinalReviewV3Terms;
  now: number;
}): FinalReviewCheck {
  const blockers: string[] = [];
  if (
    input.current.account.toLowerCase() !== input.initial.account.toLowerCase()
  )
    blockers.push("Connected account changed.");
  if (!sameReviewChain(input.current.chainId, input.initial.chainId))
    blockers.push("Wallet network changed.");
  if (input.current.walletRail !== input.initial.walletRail)
    blockers.push("Wallet rail changed.");
  if (
    typeof input.terms.exactSellAmount !== "bigint" ||
    input.terms.exactSellAmount <= 0n
  )
    blockers.push("Exact sell amount is invalid.");
  if (
    !Array.isArray(input.terms.fills) ||
    input.terms.fills.length < 1 ||
    input.terms.fills.length > 4
  ) {
    blockers.push("Take must bind between one and four exact fills.");
  } else {
    const lockIds = new Set<string>();
    let totalA = 0n;
    let totalB = 0n;
    for (const fill of input.terms.fills) {
      try {
        const lockId = BigInt(fill.lockId);
        if (lockId <= 0n) throw new Error();
        const canonical = `0x${lockId.toString(16)}`;
        if (lockIds.has(canonical))
          blockers.push("Take fill lock ids must be distinct.");
        lockIds.add(canonical);
      } catch {
        blockers.push("A Take fill lock id is invalid.");
      }
      if (fill.amountA <= 0n || fill.amountB <= 0n) {
        blockers.push("Every Take fill amount must be positive.");
      } else {
        totalA += fill.amountA;
        totalB += fill.amountB;
      }
      if (
        !Number.isSafeInteger(fill.lockExpiresAt) ||
        input.now >= fill.lockExpiresAt
      )
        blockers.push(`Maker ${fill.makerId}'s lock expired.`);
    }
    if (totalA !== input.terms.exactSellAmount)
      blockers.push(
        "Exact fill sell amounts do not match the reviewed sell total.",
      );
    if (totalB !== input.terms.totalBuyAmount)
      blockers.push(
        "Exact fill receive amounts do not match the reviewed receive total.",
      );
  }
  try {
    const authorization = takeAuthorizationForV3Review(
      input.terms,
      input.terms.takeAuthorization.escrowAddress,
      input.terms.takeAuthorization.publicKey,
    );
    if (
      canonicalizeStarknetFelt(input.terms.takeAuthorization.publicKey) ===
        "0x0" ||
      BigInt(authorization.message) !==
        BigInt(input.terms.takeAuthorization.message)
    ) {
      blockers.push(
        "Exact Take authorization changed after the reviewed tokens or fills were bound.",
      );
    }
  } catch {
    blockers.push("Exact Take authorization is invalid.");
  }
  if (input.terms.totalBuyAmount < input.terms.floorBuyAmount)
    blockers.push("Exact receive is below the local floor.");
  if (input.terms.feeBps !== 0 || input.terms.app20FeeAmount !== 0n)
    blockers.push("RFQ v3 fees must remain 0 bps.");
  if (input.current.shieldedBalance === undefined)
    blockers.push("Fresh shielded balance is unavailable.");
  else if (input.current.shieldedBalance < input.terms.exactSellAmount)
    blockers.push(
      "Fresh shielded balance does not cover the exact sell amount.",
    );
  return Object.freeze({
    ok: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}

export async function validateLiveV3FinalReview(input: {
  initial: RfqFinalReviewSnapshot;
  current: RfqFinalReviewSnapshot;
  terms: RfqFinalReviewV3Terms;
  now: number;
  readLock?: (lockId: string) => Promise<LocalnetEscrowLock>;
}): Promise<FinalReviewCheck> {
  const baseline = validateV3FinalReview(input);
  const blockers = [...baseline.blockers];
  const readLock = input.readLock ?? readEscrowLock;
  const sameFelt = (left: string, right: string): boolean => {
    try {
      return BigInt(left) === BigInt(right);
    } catch {
      return false;
    }
  };
  const liveBlockers = await Promise.all(
    input.terms.fills.map(async (fill): Promise<readonly string[]> => {
      const issues: string[] = [];
      try {
        const lock = await readLock(fill.lockId);
        if (lock.status !== "open") {
          return [`Maker ${fill.makerId}'s lock is no longer open.`];
        }
        if (
          !sameFelt(lock.rfqId, input.terms.rfqId) ||
          !sameFelt(lock.tokenA, input.terms.sellAddress) ||
          !sameFelt(lock.tokenB, input.terms.buyAddress) ||
          !sameFelt(
            lock.takerCommitment,
            input.terms.takeAuthorization.publicKey,
          )
        ) {
          issues.push(`Maker ${fill.makerId}'s lock binding changed.`);
        }
        if (lock.expiry !== fill.lockExpiresAt || input.now >= lock.expiry) {
          issues.push(`Maker ${fill.makerId}'s live lock expired.`);
        }
        if (
          lock.remainingB < fill.amountB ||
          evaluatePriceSchedule(lock.schedule, fill.amountA) !== fill.amountB
        ) {
          issues.push(`Maker ${fill.makerId}'s live lock depth changed.`);
        }
      } catch {
        issues.push(`Maker ${fill.makerId}'s live lock is unavailable.`);
      }
      return issues;
    }),
  );
  blockers.push(...liveBlockers.flat());
  return Object.freeze({
    ok: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}

export const validateFinalReviewV3 = validateV3FinalReview;
