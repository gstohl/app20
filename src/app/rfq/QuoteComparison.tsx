import {
  evaluatePriceSchedule,
  type SelectFillsV3Result,
  type SolverQuoteV3,
} from "@app20/private-intents";
import type { LocalnetQuoteRefusalV3 } from "./localnet-private-intents";
import type { QuoteComparisonV3Row } from "./rfq-v3-selection";
import CopyableId from "./CopyableId";
import RfqCountdown from "./RfqCountdown";
import { humanUnits } from "./human-units";
import styles from "./rfq.module.css";

function unitPrice(
  valueE18: bigint,
  sellDecimals: number,
  buyDecimals: number,
): string {
  const humanE18 =
    (valueE18 * 10n ** BigInt(sellDecimals)) / 10n ** BigInt(buyDecimals);
  return humanUnits(humanE18, 18);
}

function outcomeLabel(outcome: QuoteComparisonV3Row["outcome"]): string {
  if (outcome === "selected") return "Selected fill";
  if (outcome === "does-not-cover") return "Does not cover this size";
  return "Not selected";
}

export type QuoteComparisonProps = Readonly<{
  quotes: readonly SolverQuoteV3[];
  comparison: readonly QuoteComparisonV3Row[];
  refusals: readonly LocalnetQuoteRefusalV3[];
  selection: SelectFillsV3Result;
  exactSellAmount: bigint;
  sellDecimals: number;
  buyDecimals: number;
  sellSymbol: string;
  buySymbol: string;
}>;

/** Every governed maker outcome stays visible; selection is never colour-only. */
export default function QuoteComparison({
  quotes,
  comparison,
  refusals,
  selection,
  exactSellAmount,
  sellDecimals,
  buyDecimals,
  sellSymbol,
  buySymbol,
}: QuoteComparisonProps) {
  const quoteByMaker = new Map(quotes.map((quote) => [quote.solverId, quote]));
  return (
    <div className={styles.v3QuoteComparison}>
      {selection.kind === "selected" ? (
        <aside
          className={styles.selectionRationale}
          aria-label="Selection rationale"
        >
          <strong>
            {selection.fills.length === 1
              ? "SINGLE FILL SELECTED"
              : `SPLIT FILL SELECTED · ${selection.fills.length} LOCKS`}
          </strong>
          <p>
            {selection.fills.length === 1
              ? "One signed lock covers the exact size and gives the best deterministic exact-size receive."
              : "No single winning lock covers the full exact size, so deterministic best-price depth is allocated across locks."}
          </p>
          <ol>
            {selection.fills.map((fill) => (
              <li key={fill.quote.lockId}>
                {fill.quote.solverId} · lock <code>{fill.quote.lockId}</code> ·
                sell {humanUnits(fill.amountA, sellDecimals)} {sellSymbol} ·
                receive {humanUnits(fill.amountB, buyDecimals)} {buySymbol}
              </li>
            ))}
          </ol>
          <p>
            Total receive {humanUnits(selection.totalB, buyDecimals)}{" "}
            {buySymbol} · rule <code>{selection.rule}</code>
          </p>
        </aside>
      ) : (
        <p role="alert">
          <strong>Selection refused.</strong> {selection.reason}. No Take is
          available.
        </p>
      )}

      <ul className={styles.v3QuoteList} aria-label="Verified maker quotes">
        {comparison.map((row) => {
          const quote = quoteByMaker.get(row.makerId);
          if (!quote) return null;
          let exactReceive: bigint | "does not cover";
          try {
            exactReceive = evaluatePriceSchedule(
              quote.schedule,
              exactSellAmount,
            );
          } catch {
            exactReceive = "does not cover";
          }
          const exactUnitPriceE18 =
            exactReceive === "does not cover"
              ? null
              : (exactReceive * 10n ** 18n) / exactSellAmount;
          return (
            <li key={quote.lockId} data-outcome={row.outcome}>
              <header>
                <h4>
                  Rank {row.rank} · {row.makerId}
                </h4>
                <strong>{outcomeLabel(row.outcome)}</strong>
              </header>
              <dl>
                <div>
                  <dt>Evaluated receive at the exact size</dt>
                  <dd>
                    {exactReceive === "does not cover"
                      ? "Does not cover this size"
                      : `${humanUnits(exactReceive, buyDecimals)} ${buySymbol} · ${exactReceive.toString()} base units`}
                  </dd>
                </div>
                <div>
                  <dt>Unit price</dt>
                  <dd>
                    {exactUnitPriceE18 === null
                      ? "Unavailable · does not cover this size"
                      : `${unitPrice(exactUnitPriceE18, sellDecimals, buyDecimals)} ${buySymbol} / ${sellSymbol}`}
                  </dd>
                </div>
                <div>
                  <dt>Outcome</dt>
                  <dd>{outcomeLabel(row.outcome)}</dd>
                </div>
                <div>
                  <dt>Open collateral lock</dt>
                  <dd>
                    <CopyableId value={quote.lockId} label="Lock ID" />
                  </dd>
                </div>
                <div>
                  <dt>Lock expires</dt>
                  <dd>
                    <RfqCountdown expiresAt={quote.lockExpiresAt} />
                  </dd>
                </div>
                <div>
                  <dt>Quoted spread / provenance</dt>
                  <dd>
                    {quote.spreadBps} bps · {quote.pricingProvenance}
                  </dd>
                </div>
              </dl>
              <ul aria-label={`${row.makerId} selection rationale`}>
                {row.rationale.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="maker-refusals-title">
        <h4 id="maker-refusals-title">Maker refusals</h4>
        {refusals.length ? (
          <ul className={styles.v3RefusalList}>
            {refusals.map((refusal) => (
              <li key={refusal.makerId}>
                <strong>{refusal.makerId} · Refused</strong>
                <span>{refusal.reason}</span>
                <code>{refusal.quoteDigest}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p>No invited maker refused this request.</p>
        )}
      </section>
    </div>
  );
}
