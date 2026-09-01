import type { SolverQuote } from "@app20/private-intents";
import { useMemo } from "react";
import {
  directoryFreshnessState,
  summarizeMakerCohort,
  type BrowserSafeMakerStatus,
  type MakerDirectoryStatus,
} from "./rfq-operations";
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

function keyPresentation(maker: BrowserSafeMakerStatus, now: number): string {
  if (maker.keyStatus === "rotated")
    return "Rotated · excluded from eligibility";
  if (maker.keyStatus === "revoked")
    return "Revoked · excluded from eligibility";
  if (maker.keyStatus === "expired" || now >= maker.keyValidUntil)
    return "Expired · excluded from eligibility";
  if (maker.keyValidUntil - now <= 5 * 60) return "Valid · expiring soon";
  return "Valid";
}

export default function MakerCohortPanel({
  makers,
  directory,
  governedMakerCount = makers.length,
  now = Math.floor(Date.now() / 1_000),
  quotes = [],
  selectedReservationId,
  sellDecimals,
  buyDecimals,
  sellSymbol,
  buySymbol,
  onSelectedExpire,
}: {
  makers: readonly BrowserSafeMakerStatus[];
  directory?: MakerDirectoryStatus;
  governedMakerCount?: number;
  now?: number;
  quotes?: readonly SolverQuote[];
  selectedReservationId?: string;
  sellDecimals?: number;
  buyDecimals?: number;
  sellSymbol?: string;
  buySymbol?: string;
  onSelectedExpire?: () => void;
}) {
  const quoteByMaker = useMemo(
    () => new Map(quotes.map((quote) => [quote.solverId, quote])),
    [quotes],
  );
  const summary = useMemo(
    () => summarizeMakerCohort(makers, governedMakerCount),
    [makers, governedMakerCount],
  );
  const freshness = directory
    ? directoryFreshnessState(directory, now)
    : "unavailable";
  return (
    <section aria-labelledby="maker-cohort-title">
      <h3 id="maker-cohort-title">Invited-maker cohort</h3>
      <p>
        Governed makers {summary.governed} · invited {summary.invited} ·
        responded {summary.responded} · refused {summary.refused} · unavailable{" "}
        {summary.unavailable}.
      </p>
      <dl>
        <div>
          <dt>Maker-directory epoch</dt>
          <dd>{directory?.epoch ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Maker-directory checkpoint</dt>
          <dd>
            {directory ? <code>{directory.checkpoint}</code> : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt>Directory freshness</dt>
          <dd>
            <strong>
              {freshness === "fresh"
                ? "Fresh"
                : freshness === "expiring"
                  ? "Expiring · stale soon; refresh before use"
                  : freshness === "expired"
                    ? "Expired · stale; not eligible"
                    : "Unavailable · stale; not eligible"}
            </strong>{" "}
            {directory
              ? `· valid through ${new Date(directory.validUntil * 1_000).toISOString()}`
              : null}
          </dd>
        </div>
      </dl>
      <p>
        Every governed local fixture maker is shown. Capacity is a coarse
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
          const selected = Boolean(
            quote && quote.reservationId === selectedReservationId,
          );
          const keyEligible =
            maker.keyStatus === "valid" && now < maker.keyValidUntil;
          const eligible =
            maker.eligible &&
            keyEligible &&
            freshness === "fresh" &&
            (quotes.length === 0 || Boolean(quote));
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
                  <dt>Key ID</dt>
                  <dd>
                    <code>{maker.keyId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Key status</dt>
                  <dd>
                    <strong>{keyPresentation(maker, now)}</strong> · valid
                    through{" "}
                    {new Date(maker.keyValidUntil * 1_000).toISOString()}
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
