import type { SolverQuote } from "@app20/private-intents";
import type { BrowserSafeMakerStatus } from "./rfq-operations";
import RfqCountdown from "./RfqCountdown";
import styles from "./rfq.module.css";

function effectiveRate(
  quote: SolverQuote,
  sellDecimals: number,
  buyDecimals: number,
): string {
  const scale = 1_000_000n;
  const numerator = quote.buyAmount * 10n ** BigInt(sellDecimals) * scale;
  const denominator = quote.sellAmount * 10n ** BigInt(buyDecimals);
  const scaled = numerator / denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export default function MakerCohortPanel({
  makers,
  quotes = [],
  selectedReservationId,
  sellDecimals,
  buyDecimals,
  sellSymbol,
  buySymbol,
  onSelectedExpire,
}: {
  makers: readonly BrowserSafeMakerStatus[];
  quotes?: readonly SolverQuote[];
  selectedReservationId?: string;
  sellDecimals?: number;
  buyDecimals?: number;
  sellSymbol?: string;
  buySymbol?: string;
  onSelectedExpire?: () => void;
}) {
  const quoteByMaker = new Map(quotes.map((quote) => [quote.solverId, quote]));
  return (
    <section aria-labelledby="maker-cohort-title">
      <h3 id="maker-cohort-title">Invited-maker cohort</h3>
      <p>
        Every invited local fixture maker is shown. Capacity is a coarse
        browser-safe band, never a raw balance or inventory proof.
      </p>
      {quotes.length ? (
        <p>
          Deterministic ranking: highest verified receive; later quote expiry;
          maker ID; reservation ID.
        </p>
      ) : null}
      <ul className={styles.makerCohort} aria-label="Invited maker cohort">
        {makers.map((maker) => {
          const quote = quoteByMaker.get(maker.makerId);
          const selected = quote?.reservationId === selectedReservationId;
          const eligible =
            maker.eligible && (quotes.length === 0 || Boolean(quote));
          return (
            <li
              key={maker.makerId}
              className={styles.makerCard}
              data-selected={selected || undefined}
              aria-label={`Maker ${maker.makerId}`}
            >
              <h4>
                {maker.makerId}
                {selected ? <span> · Selected</span> : null}
              </h4>
              <p className={styles.makerQuote}>
                {quote &&
                sellDecimals !== undefined &&
                buyDecimals !== undefined ? (
                  <>
                    Verified signed quote · {quote.buyAmount.toString()} base
                    units · {quote.spreadBps} bps ·{" "}
                    {effectiveRate(quote, sellDecimals, buyDecimals)}{" "}
                    {buySymbol} / {sellSymbol}
                    <br />
                    <RfqCountdown
                      expiresAt={quote.quoteExpiresAt}
                      onExpire={selected ? onSelectedExpire : undefined}
                    />
                  </>
                ) : (
                  "No eligible signed quote"
                )}
              </p>
              <dl>
                <div>
                  <dt>Key</dt>
                  <dd>
                    <code>{maker.keyId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Invitation</dt>
                  <dd>{maker.invitationStatus}</dd>
                </div>
                <div>
                  <dt>Capacity band</dt>
                  <dd>{maker.capacityBand} · raw inventory not exposed</dd>
                </div>
                <div>
                  <dt>Eligibility</dt>
                  <dd>
                    <strong>
                      {eligible
                        ? selected
                          ? "Eligible · selected"
                          : "Eligible"
                        : "Excluded"}
                    </strong>{" "}
                    · {maker.rationale}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
