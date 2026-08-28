import type { SolverQuote } from "@app20/private-intents";
import type { BrowserSafeMakerStatus } from "./rfq-operations";
import RfqCountdown from "./RfqCountdown";

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
      <table aria-label="Invited maker cohort">
        <thead>
          <tr>
            <th scope="col">Maker / key</th>
            <th scope="col">Invitation</th>
            <th scope="col">Capacity band</th>
            <th scope="col">Quote</th>
            <th scope="col">Eligibility rationale</th>
          </tr>
        </thead>
        <tbody>
          {makers.map((maker) => {
            const quote = quoteByMaker.get(maker.makerId);
            const selected = quote?.reservationId === selectedReservationId;
            const eligible =
              maker.eligible && (quotes.length === 0 || Boolean(quote));
            return (
              <tr key={maker.makerId}>
                <td>
                  {maker.makerId}
                  <br />
                  <code>{maker.keyId}</code>
                </td>
                <td>{maker.invitationStatus}</td>
                <td>{maker.capacityBand} · raw inventory not exposed</td>
                <td>
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
                </td>
                <td>
                  <strong>
                    {eligible
                      ? selected
                        ? "Eligible · selected"
                        : "Eligible"
                      : "Excluded"}
                  </strong>{" "}
                  · {maker.rationale}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
