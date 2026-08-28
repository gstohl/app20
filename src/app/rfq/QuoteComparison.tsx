import type { SolverQuote } from "@app20/private-intents";
import type { BrowserSafeMakerStatus } from "./rfq-operations";
import MakerCohortPanel from "./MakerCohortPanel";

export default function QuoteComparison({ quotes, cohort, selectedReservationId, sellDecimals, buyDecimals, sellSymbol, buySymbol, onSelectedExpire }: {
  quotes: readonly SolverQuote[];
  cohort: readonly BrowserSafeMakerStatus[];
  selectedReservationId: string;
  sellDecimals: number;
  buyDecimals: number;
  sellSymbol: string;
  buySymbol: string;
  onSelectedExpire?: () => void;
}) {
  return <MakerCohortPanel
    makers={cohort}
    quotes={quotes}
    selectedReservationId={selectedReservationId}
    sellDecimals={sellDecimals}
    buyDecimals={buyDecimals}
    sellSymbol={sellSymbol}
    buySymbol={buySymbol}
    onSelectedExpire={onSelectedExpire}
  />;
}
