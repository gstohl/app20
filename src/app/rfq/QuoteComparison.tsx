import type { SolverQuote } from "@app20/private-intents";
import type {
    BrowserSafeMakerStatus,
    MakerDirectoryStatus,
} from "./rfq-operations";
import MakerCohortPanel from "./MakerCohortPanel";

export default function QuoteComparison({
    quotes,
    cohort,
    directory,
    governedMakerCount,
    now,
    selectedReservationId,
    sellDecimals,
    buyDecimals,
    sellSymbol,
    buySymbol,
    onSelectedExpire,
}: {
    quotes: readonly SolverQuote[];
    cohort: readonly BrowserSafeMakerStatus[];
    directory: MakerDirectoryStatus;
    governedMakerCount: number;
    now: number;
    selectedReservationId: string;
    sellDecimals: number;
    buyDecimals: number;
    sellSymbol: string;
    buySymbol: string;
    onSelectedExpire?: () => void;
}) {
    return (
        <MakerCohortPanel
            makers={cohort}
            directory={directory}
            governedMakerCount={governedMakerCount}
            now={now}
            quotes={quotes}
            selectedReservationId={selectedReservationId}
            sellDecimals={sellDecimals}
            buyDecimals={buyDecimals}
            sellSymbol={sellSymbol}
            buySymbol={buySymbol}
            onSelectedExpire={onSelectedExpire}
        />
    );
}
