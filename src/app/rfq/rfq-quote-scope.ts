export type RfqQuoteRequestScope = Readonly<{
  account: string;
  chainId: string;
  providerIndex: number;
}>;

export type CurrentRfqQuoteScope = Readonly<{
  account?: string;
  chainId?: string;
  providerIndex: number;
}>;

export const RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE =
  "The quote response was discarded because the connected wallet account, chain, or provider changed. No quote was added to this context." as const;

export class RfqQuoteScopeInvalidatedError extends Error {
  constructor() {
    super(RFQ_QUOTE_SCOPE_INVALIDATED_MESSAGE);
    this.name = "RfqQuoteScopeInvalidatedError";
  }
}

export function rfqQuoteScopeMatches(
  started: RfqQuoteRequestScope,
  current: CurrentRfqQuoteScope,
): boolean {
  return (
    started.account === current.account &&
    started.chainId === current.chainId &&
    started.providerIndex === current.providerIndex
  );
}

export function assertRfqQuoteScopeMatches(
  started: RfqQuoteRequestScope,
  current: CurrentRfqQuoteScope,
): void {
  if (!rfqQuoteScopeMatches(started, current))
    throw new RfqQuoteScopeInvalidatedError();
}
