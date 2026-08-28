/**
 * Durable production composition for POST /escrow/ensure-ticket.
 *
 * The owner check happens before the journal transition on the first request.
 * Once ticket-pending is durable, the same resolver can reconstruct those exact
 * terms without the volatile owner cache. The chain operation must itself query
 * get_ticket(dealId) before idempotently ensuring it, so every crash window is
 * replayable with the same target.
 */
export async function runLocalnetEnsureTicketRoute({
 coordinator,
 target,
 settlementTerms,
 resolveOwner,
 validateOwner,
 ensureTicket,
}) {
 const exact = Object.freeze({ ...target, ...settlementTerms });
 const owner = resolveOwner(exact);
 validateOwner(owner, exact);

 await coordinator.authorizeFundingTicket(exact);
 const ticketAddress = await ensureTicket(exact.dealId);
 const finalized = await coordinator.persistFundingTicket({
  ...exact,
  ticketAddress,
 });
 return Object.freeze({
  ticketAddress: finalized.ticketAuthorization.ticketAddress,
 });
}
