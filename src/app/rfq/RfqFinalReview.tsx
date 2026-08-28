import { APP20_TOKEN_REGISTRY_REVISION } from "@/lib/token-registry";
import { FINAL_REVIEW_ENVIRONMENT, LEGACY_ESCROW_WARNING, type RfqFinalReviewSnapshot, type RfqFinalReviewTerms } from "./rfq-final-review";
import RfqCountdown from "./RfqCountdown";
import styles from "./rfq.module.css";

function humanUnits(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals) || "0";
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

export default function RfqFinalReview({ terms, onAccept, onDecline, disabled, declineDisabled, blockers = [], snapshot, onQuoteExpire, onReservationExpire }: {
  terms: RfqFinalReviewTerms;
  onAccept: () => void;
  onDecline: () => void;
  disabled?: boolean;
  declineDisabled?: boolean;
  blockers?: readonly string[];
  snapshot?: RfqFinalReviewSnapshot;
  onQuoteExpire?: () => void;
  onReservationExpire?: () => void;
}) {
  return <section className={styles.finalReview} aria-labelledby="final-review-title">
    <strong>{FINAL_REVIEW_ENVIRONMENT}</strong>
    <h3 id="final-review-title">Final value review</h3>
    <p>{LEGACY_ESCROW_WARNING}</p>
    <dl>
      <div><dt>Direction</dt><dd>{terms.sellSymbol} → {terms.buySymbol} · Full fill only</dd></div>
      <div><dt>Exact sell</dt><dd>{humanUnits(terms.sellAmount, terms.sellDecimals)} {terms.sellSymbol} · {terms.sellAmount.toString()} base units · {terms.sellAddress} · {terms.sellDecimals} decimals</dd></div>
      <div><dt>Exact receive</dt><dd>{humanUnits(terms.buyAmount, terms.buyDecimals)} {terms.buySymbol} · {terms.buyAmount.toString()} base units · {terms.buyAddress} · {terms.buyDecimals} decimals</dd></div>
      <div><dt>Registry</dt><dd>{terms.registryRevision || APP20_TOKEN_REGISTRY_REVISION}</dd></div>
      <div><dt>RFQ / quote nonce</dt><dd><code>{terms.rfqId}</code> · <code>{terms.quoteNonce}</code></dd></div>
      <div><dt>Quote digest</dt><dd>{terms.quoteDigest ? <code>{terms.quoteDigest}</code> : "Unavailable on active local Quote V1 · not inferred"}</dd></div>
      <div><dt>Intent digest bound by maker signature</dt><dd><code>{terms.intentDigest}</code></dd></div>
      <div><dt>Reservation / fence</dt><dd><code>{terms.reservationId}</code> · {terms.reservationFence?.toString() ?? "V1 fence unavailable"}</dd></div>
      <div><dt>Maker / key</dt><dd>{terms.makerId} · {terms.makerKeyId}</dd></div>
      <div><dt>Maker spread</dt><dd>{terms.spreadBps} bps · {humanUnits(terms.referenceGrossBuyAmount - terms.buyAmount, terms.buyDecimals)} {terms.buySymbol} versus named fixture reference</dd></div>
      <div><dt>Quote clock</dt><dd><RfqCountdown expiresAt={terms.quoteExpiresAt} onExpire={onQuoteExpire}/></dd></div>
      <div><dt>Reservation clock</dt><dd><RfqCountdown expiresAt={terms.reservationExpiresAt} onExpire={onReservationExpire}/></dd></div>
      <div><dt>Settlement clock</dt><dd><RfqCountdown expiresAt={terms.settlementExpiresAt}/></dd></div>
      <div><dt>Fresh account / chain</dt><dd>{snapshot ? `${snapshot.account} · ${snapshot.chainId}` : "unavailable"}</dd></div>
      <div><dt>Public STRK available for fee</dt><dd>{snapshot?.publicFeeBalance === undefined ? "unavailable" : `${snapshot.publicFeeBalance.toString()} base units · ${humanUnits(snapshot.publicFeeBalance, 18)} STRK`}</dd></div>
      <div><dt>STRK20 pool fee</dt><dd>{snapshot?.poolFee === undefined ? "unavailable" : `${snapshot.poolFee.toString()} base units · ${humanUnits(snapshot.poolFee, 18)} STRK`} · read {snapshot ? new Date(snapshot.observedAt * 1_000).toISOString() : "unavailable"} · pool <code>{snapshot?.poolAddress ?? "unavailable"}</code></dd></div>
      <div><dt>Public fee balance after pool fee</dt><dd>{snapshot?.publicFeeBalance === undefined || snapshot.poolFee === undefined ? "unavailable" : snapshot.publicFeeBalance >= snapshot.poolFee ? `${(snapshot.publicFeeBalance - snapshot.poolFee).toString()} base units remaining` : `${(snapshot.poolFee - snapshot.publicFeeBalance).toString()} base units short`}</dd></div>
      <div><dt>Fresh private sell balance</dt><dd>{snapshot?.shieldedBalance?.toString() ?? "Unavailable · Ready Wallet API is not probed for final-review feature detection"}</dd></div>
      <div><dt>Private note maturity</dt><dd>{snapshot?.shieldedMature === undefined ? "Unavailable · not inferred; G10 remains partial" : snapshot.shieldedMature ? "Mature" : "Not mature"}</dd></div>
      <div><dt>Gas</dt><dd>{snapshot?.walletConfirmedGasBaseUnits === undefined ? "Unknown unless wallet-confirmed · not estimated or inferred" : `${snapshot.walletConfirmedGasBaseUnits.toString()} base units · wallet-confirmed`}</dd></div>
      <div><dt>APP20 fee</dt><dd>{terms.app20FeeAmount.toString()} base units under named fixture policy <code>{terms.app20FeePolicyId}</code></dd></div>
      <div><dt>Enforced in local fixture</dt><dd><code>{terms.economicPolicyId}</code> · per-trade cap {terms.perTradeCapBaseUnits.toString()} {terms.sellSymbol} base units · total reference deviation cap {terms.maximumTotalDeviationBps} bps · maker spread cap {terms.maximumMakerSpreadBps} bps · full-fill only · reviewed floor {terms.minBuyAmount.toString()} {terms.buySymbol} base units</dd></div>
      <div><dt>Not configured</dt><dd>Maker aggregate, market aggregate, daily, concentration, and production exposure controls.</dd></div>
      <div><dt>Net result / fill policy</dt><dd>−{humanUnits(terms.sellAmount, terms.sellDecimals)} {terms.sellSymbol}; +{humanUnits(terms.buyAmount, terms.buyDecimals)} {terms.buySymbol} in one full fill only; −{snapshot?.poolFee === undefined ? "unknown" : `${humanUnits(snapshot.poolFee, 18)} STRK`} pool fee; gas {snapshot?.walletConfirmedGasBaseUnits === undefined ? "unknown" : "wallet-confirmed"}; APP20 fee 0</dd></div>
      <div><dt>Refund</dt><dd>After the bound settlement deadline if no maker fill is observed</dd></div>
    </dl>
    <h4>Privacy boundaries</h4>
    <ul>
      <li>Not published as an order before local settlement; this does not establish that activity cannot be correlated.</li>
      <li>Disclosed to invited makers: pair, side, exact size, floor, and expiry.</li>
      <li>Observed in this local devnet demo: shield/unshield, pool fees, legacy escrow terms, lifecycle timing, and OPEN amounts. A future approved public-network design would expose its reviewed public fields.</li>
      <li>Observable by services: loopback request timing and maker response fanout; quote responses are request-scoped signed JSON.</li>
    </ul>
    {blockers.length ? <div role="alert"><strong>Acceptance blocked</strong><ul>{blockers.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    <button type="button" disabled={declineDisabled} onClick={onDecline}>Decline selected quote</button>
    <button type="button" disabled={disabled || blockers.length > 0} onClick={onAccept}>Accept and fund on LOCALNET</button>
  </section>;
}
