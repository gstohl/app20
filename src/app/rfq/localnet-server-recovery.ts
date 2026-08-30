import { canonicalizeStarknetFelt } from "@app20/domain";
import {
  beginRfqPhaseAttempt,
  canonicalRfqAccount,
  canonicalRfqChainId,
  createRfqLifecycleRecord,
  reconcileRfqLifecycleWithLocalDeal,
  reviseRfqLifecycle,
  type RfqLifecycleRecord,
} from "./rfq-lifecycle";
import { makerFillAttemptTarget } from "./localnet-maker-fill-recovery";
import {
  fundingTicketAttemptTarget,
  type LocalnetMarketToken,
  type LocalnetServerRecoveryDeal,
} from "./localnet-private-intents";

export type LocalnetRecoveryMarket = Readonly<{
  pairId: "STRK_USDC" | "USDC_STRK";
  sell: LocalnetMarketToken;
  buy: LocalnetMarketToken;
}>;

function sameFelt(left: string, right: string): boolean {
  return canonicalizeStarknetFelt(left) === canonicalizeStarknetFelt(right);
}

/**
 * Rebuilds convenience state from the authenticated local coordinator and its
 * fresh escrow observation. Placeholders are deliberately non-authoritative:
 * they are sufficient for exact recovery targets, not a recovered signed quote.
 */
export function rebuildServerDerivedRfqRecord(
  deal: LocalnetServerRecoveryDeal,
  context: Readonly<{
    account: string;
    chainId: string;
    now: number;
    markets: readonly LocalnetRecoveryMarket[];
  }>,
): RfqLifecycleRecord {
  if (
    canonicalRfqAccount(deal.account) !==
      canonicalRfqAccount(context.account) ||
    canonicalRfqChainId(deal.chainId) !==
      canonicalRfqChainId(context.chainId) ||
    !sameFelt(deal.rfqId, deal.dealId)
  )
    throw new Error(
      "The server-derived deal does not match this wallet context.",
    );
  const market = context.markets.find(
    (candidate) =>
      sameFelt(candidate.sell.address, deal.terms.sellToken) &&
      sameFelt(candidate.buy.address, deal.terms.buyToken),
  );
  if (!market)
    throw new Error(
      "The server-derived deal names an unsupported local market.",
    );
  if (deal.terms.deadline !== deal.expiresAt)
    throw new Error("The server-derived settlement deadline is inconsistent.");

  const quote = Object.freeze({
    version: "Quote V1" as const,
    solverId: deal.selection.solverId,
    solverKey: "server-derived-unavailable",
    nonce: deal.selection.reservationId,
    reservationId: deal.selection.reservationId,
    spreadBps: 0,
    pricingProvenance:
      "Server-derived resume metadata; original quote presentation unavailable.",
    quotedAt: deal.createdAt,
    quoteExpiresAt: deal.expiresAt,
    reservationExpiresAt: deal.expiresAt,
    buyAmount: deal.terms.buyAmount,
    intentDigest: deal.intentDigest,
    signature: "server-derived-unavailable",
    quoteDigest: deal.selection.quoteDigest,
    reservationFence: deal.selection.reservationFence,
  });
  let record = createRfqLifecycleRecord({
    chainId: deal.chainId,
    account: deal.account,
    rfqId: deal.rfqId,
    state: "reviewing",
    now: deal.createdAt,
    requestDigest: deal.intentDigest,
    terms: Object.freeze({
      pairId: market.pairId,
      sellSymbol: market.sell.symbol,
      sellAddress: deal.terms.sellToken,
      sellDecimals: market.sell.decimals,
      sellAmount: deal.terms.sellAmount,
      buySymbol: market.buy.symbol,
      buyAddress: deal.terms.buyToken,
      buyDecimals: market.buy.decimals,
      // The original floor is not needed for payout recovery and is not present
      // in the coordinator projection. Absence means unavailable; it must never
      // be inferred as zero or presented as a recovered executable quote term.
      buyAmount: deal.terms.buyAmount,
      rfqExpiresAt: deal.expiresAt,
    }),
    selectedQuote: quote,
    settlement: Object.freeze({
      version: "Localnet V2" as const,
      escrowAddress: deal.escrowAddress,
      dealId: deal.dealId,
      ticketAddress: deal.terms.ticketAddress,
      deadline: deal.terms.deadline,
    }),
  });
  record = beginRfqPhaseAttempt(
    record,
    "funding",
    deal.fundingAttemptId,
    deal.createdAt,
    fundingTicketAttemptTarget({
      account: record.account,
      chainId: record.chainId,
      rfqId: record.rfqId,
      dealId: deal.dealId,
      intentDigest: deal.intentDigest,
      solverId: deal.selection.solverId,
      reservationId: deal.selection.reservationId,
      reservationFence: deal.selection.reservationFence,
      quoteDigest: deal.selection.quoteDigest,
      sellToken: deal.terms.sellToken,
      sellAmount: BigInt(deal.terms.sellAmount),
      buyToken: deal.terms.buyToken,
      buyAmount: BigInt(deal.terms.buyAmount),
      deadline: deal.terms.deadline,
    }),
  );
  if (deal.observation.status === 2 || deal.observation.status === 3) {
    record = reconcileRfqLifecycleWithLocalDeal(
      record,
      {
        ...deal.observation,
        status: 1,
        legBAmount: "0",
        dealId: deal.dealId,
        escrowAddress: deal.escrowAddress,
      },
      context.now,
    );
    record = beginRfqPhaseAttempt(
      record,
      "fill",
      `observed:fill:${deal.dealId}`,
      context.now,
      makerFillAttemptTarget({
        account: record.account,
        chainId: record.chainId,
        rfqId: record.rfqId,
        dealId: deal.dealId,
        intentDigest: deal.intentDigest,
        solverId: deal.selection.solverId,
        reservationId: deal.selection.reservationId,
        reservationFence: deal.selection.reservationFence,
        quoteDigest: deal.selection.quoteDigest,
        sellToken: deal.terms.sellToken,
        sellAmount: BigInt(deal.terms.sellAmount),
        buyToken: deal.terms.buyToken,
        buyAmount: BigInt(deal.terms.buyAmount),
        deadline: deal.terms.deadline,
        ticketAddress: deal.terms.ticketAddress,
      }),
    );
  }
  record = reviseRfqLifecycle(record, {
    recoverySource: "server-derived",
    reason:
      "Server-derived resume record. Exact public settlement bindings were rediscovered; original browser quote presentation was not recovered, and no action was submitted.",
    updatedAt: context.now,
  });
  return reconcileRfqLifecycleWithLocalDeal(
    record,
    {
      ...deal.observation,
      dealId: deal.dealId,
      escrowAddress: deal.escrowAddress,
    },
    context.now,
  );
}
