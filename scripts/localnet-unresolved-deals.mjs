const UNRESOLVED_ESCROW_STATUSES = new Set([1, 2]);

/**
 * Produces the browser-safe recovery projection for one authenticated account
 * and market. The coordinator supplies exact authorization while the chain
 * read proves that value is still unresolved. No maker inventory, signing
 * material, process state, or private keys are projected.
 */
export async function listBrowserSafeUnresolvedLocalnetDeals({
  requests,
  deals,
  account,
  chainId,
  market,
  escrowAddress,
  observeEscrow,
  validateObservation,
}) {
  const dealByIntent = new Map(deals.map((deal) => [deal.intentDigest, deal]));
  const results = [];
  for (const request of requests) {
    if (
      request.account !== account ||
      request.chainId !== chainId ||
      request.market !== market ||
      !request.selection
    )
      continue;
    const association = dealByIntent.get(request.intentDigest);
    const terms =
      request.ticketAuthorization?.settlementTerms ?? request.settlementTerms;
    const ticketAddress =
      request.ticketAuthorization?.ticketAddress ?? terms?.ticketAddress;
    if (
      !association ||
      !terms ||
      !ticketAddress ||
      association.rfqId !== request.rfqId ||
      association.account !== account ||
      association.chainId !== chainId ||
      association.dealId !== request.rfqId ||
      association.reservationId !== request.selection.reservationId ||
      association.makerId !== request.selection.makerId ||
      association.fence !== request.selection.fence ||
      association.quoteDigest !== request.selection.quoteDigest ||
      !request.fundingAttemptId
    )
      continue;

    const observed = await observeEscrow(association.dealId);
    if (!UNRESOLVED_ESCROW_STATUSES.has(observed.status)) continue;
    validateObservation(
      observed,
      {
        sellToken: terms.sellToken,
        sellAmount: terms.sellAmount,
        buyToken: terms.buyToken,
        buyAmount: terms.buyAmount,
        deadline: terms.deadline,
        ticketAddress,
      },
      observed.status,
    );
    results.push(
      Object.freeze({
        source: "localnet-coordinator-and-chain",
        authority: "server-derived-resume-only",
        account,
        chainId,
        market,
        rfqId: request.rfqId,
        dealId: association.dealId,
        intentDigest: request.intentDigest,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
        fundingAttemptId: request.fundingAttemptId,
        selection: Object.freeze({
          solverId: request.selection.makerId,
          reservationId: request.selection.reservationId,
          reservationFence: request.selection.fence,
          quoteDigest: request.selection.quoteDigest,
        }),
        terms: Object.freeze({
          sellToken: terms.sellToken,
          sellAmount: terms.sellAmount,
          buyToken: terms.buyToken,
          buyAmount: terms.buyAmount,
          deadline: terms.deadline,
          ticketAddress,
        }),
        observation: Object.freeze({
          ...observed,
          legAAmount: observed.legAAmount.toString(),
          legBTerms: observed.legBTerms.toString(),
          legBAmount: observed.legBAmount.toString(),
        }),
        escrowAddress,
      }),
    );
  }
  return Object.freeze(results);
}
