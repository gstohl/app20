import type { RefObject } from "react";
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

export default function RfqFinalReview({ terms, onAccept, onDecline, disabled, declineDisabled, blockers = [], snapshot, onQuoteExpire, onReservationExpire, focusRef }: {
  terms: RfqFinalReviewTerms;
  onAccept: () => void;
  onDecline: () => void;
  disabled?: boolean;
  declineDisabled?: boolean;
  blockers?: readonly string[];
  snapshot?: RfqFinalReviewSnapshot;
  onQuoteExpire?: () => void;
  onReservationExpire?: () => void;
  focusRef?: RefObject<HTMLElement | null>;
}) {
  return <section ref={focusRef} tabIndex={-1} className={styles.finalReview} aria-labelledby="final-review-title">
    <strong>{FINAL_REVIEW_ENVIRONMENT}</strong>
    <h3 id="final-review-title">Final value review</h3>

    <dl className={styles.finalReviewHeadline}>
      <div><dt>You sell</dt><dd>{humanUnits(terms.sellAmount, terms.sellDecimals)} {terms.sellSymbol}</dd></div>
      <div><dt>You receive</dt><dd>{humanUnits(terms.buyAmount, terms.buyDecimals)} {terms.buySymbol}</dd></div>
      <div><dt>Maker</dt><dd>{terms.makerId} · {terms.spreadBps} bps spread</dd></div>
      <div><dt>Fill policy</dt><dd>Full fill only</dd></div>
    </dl>

    <dl className={styles.finalReviewSummary}>
      <div><dt>Quote expires</dt><dd><RfqCountdown expiresAt={terms.quoteExpiresAt} onExpire={onQuoteExpire}/></dd></div>
      <div><dt>Reservation expires</dt><dd><RfqCountdown expiresAt={terms.reservationExpiresAt} onExpire={onReservationExpire}/></dd></div>
      <div><dt>Refund available after</dt><dd><RfqCountdown expiresAt={terms.settlementExpiresAt}/></dd></div>
      <div><dt>Fees you pay</dt><dd>STRK20 pool fee {snapshot?.poolFee === undefined ? "unavailable" : `${humanUnits(snapshot.poolFee, 18)} STRK`} · APP20 fee {terms.app20FeeAmount.toString()} base units · gas {snapshot?.walletConfirmedGasBaseUnits === undefined ? "unknown until the wallet confirms" : `${snapshot.walletConfirmedGasBaseUnits.toString()} base units, wallet-confirmed`}</dd></div>
      <div><dt>If the maker never fills</dt><dd>You refund the full {humanUnits(terms.sellAmount, terms.sellDecimals)} {terms.sellSymbol} after the settlement deadline. Refund is a separate action you take.</dd></div>
      <div><dt>Settlement authority</dt><dd>None yet. This localnet-only demo can finalize only through modeled same-devnet readers and exact maker reconciliation. Sepolia/Mainnet production authority remains unavailable.</dd></div>
      <div><dt>Wallet / chain</dt><dd>{snapshot ? `${snapshot.account} · ${snapshot.chainId}` : "unavailable"}</dd></div>
    </dl>

    <p className={styles.finalReviewWarning}>{LEGACY_ESCROW_WARNING}</p>

    <h4>Privacy boundaries</h4>
    <ul>
      <li>Not published as a public order before local settlement; this does not establish that activity cannot be correlated.</li>
      <li>Invited makers already learned the pair, side, exact size, floor, and expiry.</li>
      <li>Public in this local devnet demo: shield/unshield, pool fees, legacy escrow terms, lifecycle timing, and OPEN payout-note amounts. A future approved public-network design would expose its reviewed public fields.</li>
      <li>Observable by services: loopback request timing and maker response fanout; quote responses are request-scoped signed JSON.</li>
    </ul>

    {blockers.length ? <div role="alert" className={styles.finalReviewBlockers}><strong>Acceptance blocked</strong><ul>{blockers.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}

    <div className={styles.finalReviewActions}>
      <button className={styles.finalReviewAccept} type="button" disabled={disabled || blockers.length > 0} onClick={onAccept}>Accept and fund on LOCALNET</button>
      <button className={styles.finalReviewDecline} type="button" disabled={declineDisabled} onClick={onDecline}>Decline selected quote</button>
    </div>

    <details className={styles.finalReviewDetails}>
      <summary>Protocol details</summary>
      <dl>
        <div><dt>Exact sell</dt><dd>{terms.sellAmount.toString()} base units · {terms.sellAddress} · {terms.sellDecimals} decimals</dd></div>
        <div><dt>Exact receive</dt><dd>{terms.buyAmount.toString()} base units · {terms.buyAddress} · {terms.buyDecimals} decimals</dd></div>
        <div><dt>Registry</dt><dd>{terms.registryRevision || APP20_TOKEN_REGISTRY_REVISION}</dd></div>
        <div><dt>RFQ / quote nonce</dt><dd><code>{terms.rfqId}</code> · <code>{terms.quoteNonce}</code></dd></div>
        <div><dt>Quote digest</dt><dd>{terms.quoteDigest ? <code>{terms.quoteDigest}</code> : "Unavailable on active local Quote V1 · not inferred"}</dd></div>
        <div><dt>Intent digest bound by maker signature</dt><dd><code>{terms.intentDigest}</code></dd></div>
        <div><dt>Reservation / fence</dt><dd><code>{terms.reservationId}</code> · {terms.reservationFence?.toString() ?? "V1 fence unavailable"}</dd></div>
        <div><dt>Maker key</dt><dd>{terms.makerKeyId}</dd></div>
        <div><dt>Maker spread versus reference</dt><dd>{terms.spreadBps} bps · {humanUnits(terms.referenceGrossBuyAmount - terms.buyAmount, terms.buyDecimals)} {terms.buySymbol} versus named fixture reference</dd></div>
        <div><dt>Public STRK available for fee</dt><dd>{snapshot?.publicFeeBalance === undefined ? "unavailable" : `${snapshot.publicFeeBalance.toString()} base units · ${humanUnits(snapshot.publicFeeBalance, 18)} STRK`}</dd></div>
        <div><dt>STRK20 pool fee</dt><dd>{snapshot?.poolFee === undefined ? "unavailable" : `${snapshot.poolFee.toString()} base units · ${humanUnits(snapshot.poolFee, 18)} STRK`} · read {snapshot ? new Date(snapshot.observedAt * 1_000).toISOString() : "unavailable"} · pool <code>{snapshot?.poolAddress ?? "unavailable"}</code></dd></div>
        <div><dt>Public fee balance after pool fee</dt><dd>{snapshot?.publicFeeBalance === undefined || snapshot.poolFee === undefined ? "unavailable" : snapshot.publicFeeBalance >= snapshot.poolFee ? `${(snapshot.publicFeeBalance - snapshot.poolFee).toString()} base units remaining` : `${(snapshot.poolFee - snapshot.publicFeeBalance).toString()} base units short`}</dd></div>
        <div><dt>Fresh private sell balance</dt><dd>{snapshot?.shieldedBalance?.toString() ?? "Unavailable · Ready Wallet API is not probed for final-review feature detection"}</dd></div>
        <div><dt>Private note maturity</dt><dd>{snapshot?.shieldedMature === undefined ? "Unavailable · not inferred; G10 remains partial" : snapshot.shieldedMature ? "Mature" : "Not mature"}</dd></div>
        <div><dt>Enforced in local fixture</dt><dd><code>{terms.economicPolicyId}</code> · per-trade cap {terms.perTradeCapBaseUnits.toString()} {terms.sellSymbol} base units · total reference deviation cap {terms.maximumTotalDeviationBps} bps · maker spread cap {terms.maximumMakerSpreadBps} bps · full-fill only · reviewed floor {terms.minBuyAmount.toString()} {terms.buySymbol} base units</dd></div>
        <div><dt>APP20 fee policy</dt><dd><code>{terms.app20FeePolicyId}</code></dd></div>
        <div><dt>Not configured</dt><dd>Maker aggregate, market aggregate, daily, concentration, and production exposure controls.</dd></div>
      </dl>
    </details>
  </section>;
}
