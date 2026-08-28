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

export function validateFinalReview(input: {
  initial: RfqFinalReviewSnapshot;
  current: RfqFinalReviewSnapshot;
  terms: RfqFinalReviewTerms;
  now: number;
}): FinalReviewCheck {
  const blockers: string[] = [];
  if (input.current.account.toLowerCase() !== input.initial.account.toLowerCase()) blockers.push("Connected account changed.");
  if (input.current.chainId !== input.initial.chainId) blockers.push("Wallet network changed.");
  if (input.current.walletRail !== input.initial.walletRail) blockers.push("Wallet rail changed.");
  if (input.now >= input.terms.quoteExpiresAt) blockers.push("Quote expired.");
  if (input.now >= input.terms.reservationExpiresAt) blockers.push("Reservation expired.");
  if (input.initial.poolFee === undefined || input.current.poolFee === undefined) blockers.push("Fresh STRK20 pool fee is unavailable.");
  else if (input.initial.poolFee !== input.current.poolFee) blockers.push("Live STRK20 pool fee changed.");
  if (!input.initial.poolAddress || !input.current.poolAddress) blockers.push("Bound STRK20 pool address is unavailable.");
  else if (input.initial.poolAddress.toLowerCase() !== input.current.poolAddress.toLowerCase()) blockers.push("Bound STRK20 pool address changed.");
  if (input.current.publicFeeBalance === undefined) blockers.push("Fresh public fee balance is unavailable.");
  else if (input.current.poolFee !== undefined && input.current.publicFeeBalance < input.current.poolFee) {
    blockers.push("Fresh public fee balance does not cover the STRK20 pool fee.");
  }
  if (
    input.terms.app20FeePolicyId !== LOCALNET_APP20_FEE_POLICY_ID ||
    input.terms.app20FeeAmount !== 0n
  ) {
    blockers.push("The APP20 fee policy is unsupported or non-zero.");
  }
  if (input.terms.requiresMatureNote && input.current.shieldedMature !== true) {
    blockers.push("Required shielded-note maturity evidence is unavailable or not mature.");
  }
  if (input.current.shieldedBalance !== undefined && input.current.shieldedBalance < input.terms.sellAmount) {
    blockers.push("Observed shielded balance no longer covers the exact sell amount.");
  }
  return Object.freeze({ ok: blockers.length === 0, blockers: Object.freeze(blockers) });
}
