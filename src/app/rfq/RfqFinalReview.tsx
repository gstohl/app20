import type { RefObject } from "react";
import { APP20_TOKEN_REGISTRY_REVISION } from "@/lib/token-registry";
import {
  FINAL_REVIEW_ENVIRONMENT,
  LEGACY_ESCROW_WARNING,
  type RfqFinalReviewSnapshot,
  type RfqFinalReviewTerms,
  type RfqFinalReviewV3Terms,
} from "./rfq-final-review";
import CopyableId from "./CopyableId";
import RfqCountdown from "./RfqCountdown";
import { humanUnits } from "./human-units";
import styles from "./rfq.module.css";

export type RfqFinalReviewV3DisplayTerms = RfqFinalReviewV3Terms &
  Readonly<{
    sellSymbol: string;
    sellDecimals: number;
    buySymbol: string;
    buyDecimals: number;
    requestDigest: string;
  }>;

type SharedProps = Readonly<{
  onAccept: () => void;
  onDecline: () => void;
  disabled?: boolean;
  declineDisabled?: boolean;
  declineLabel?: string;
  blockers?: readonly string[];
  snapshot?: RfqFinalReviewSnapshot;
  focusRef?: RefObject<HTMLElement | null>;
}>;

export type RfqFinalReviewProps = SharedProps &
  (
    | Readonly<{
        terms: RfqFinalReviewTerms;
        onQuoteExpire?: () => void;
        onReservationExpire?: () => void;
      }>
    | Readonly<{
        terms: RfqFinalReviewV3DisplayTerms;
        onQuoteExpire?: never;
        onReservationExpire?: never;
      }>
  );

function ReviewActions({
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
  disabled,
  declineDisabled,
  blockers,
}: SharedProps &
  Readonly<{
    acceptLabel: string;
    declineLabel: string;
    blockers: readonly string[];
  }>) {
  return (
    <div className={styles.finalReviewActions}>
      <button
        className={styles.finalReviewAccept}
        type="button"
        disabled={disabled || blockers.length > 0}
        onClick={onAccept}
      >
        {acceptLabel}
      </button>
      <button
        className={styles.finalReviewDecline}
        type="button"
        disabled={declineDisabled}
        onClick={onDecline}
      >
        {declineLabel}
      </button>
    </div>
  );
}

function Blockers({ blockers }: { blockers: readonly string[] }) {
  return blockers.length ? (
    <div role="alert" className={styles.finalReviewBlockers}>
      <strong>Acceptance blocked</strong>
      <ul>
        {blockers.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  ) : null;
}

function V3FinalReview({
  terms,
  onAccept,
  onDecline,
  disabled,
  declineDisabled,
  declineLabel,
  blockers = [],
  snapshot,
  focusRef,
}: SharedProps & { terms: RfqFinalReviewV3DisplayTerms }) {
  const lockExpiry = Math.min(...terms.fills.map((fill) => fill.lockExpiresAt));
  return (
    <section
      ref={focusRef}
      tabIndex={-1}
      className={styles.finalReview}
      aria-labelledby="final-review-title"
    >
      <strong>{FINAL_REVIEW_ENVIRONMENT} · LIFECYCLE V3</strong>
      <h3 id="final-review-title">Final atomic Take review</h3>
      <p>
        This click submits one atomic Take. Maker collateral is already locked;
        there is no later claim or taker refund step.
      </p>

      <dl className={styles.finalReviewHeadline}>
        <div>
          <dt>You sell exactly</dt>
          <dd>
            {humanUnits(terms.exactSellAmount, terms.sellDecimals)}{" "}
            {terms.sellSymbol}
          </dd>
        </div>
        <div>
          <dt>You receive in the same transaction</dt>
          <dd>
            {humanUnits(terms.totalBuyAmount, terms.buyDecimals)}{" "}
            {terms.buySymbol}
          </dd>
        </div>
        <div>
          <dt>Fill shape</dt>
          <dd>
            {terms.fills.length === 1
              ? "Single collateralized fill"
              : `${terms.fills.length}-maker atomic split`}
          </dd>
        </div>
        <div>
          <dt>APP20 fee</dt>
          <dd>0 bps · 0 base units</dd>
        </div>
      </dl>

      <h4>Every exact fill</h4>
      <ol className={styles.finalReviewFills}>
        {terms.fills.map((fill) => (
          <li key={fill.lockId}>
            <strong>{fill.makerId}</strong>
            <span>
              Sell {humanUnits(fill.amountA, terms.sellDecimals)}{" "}
              {terms.sellSymbol} · receive{" "}
              {humanUnits(fill.amountB, terms.buyDecimals)} {terms.buySymbol}
            </span>
            <CopyableId value={fill.lockId} label="Lock ID" />
          </li>
        ))}
      </ol>

      <dl className={styles.finalReviewSummary}>
        <div>
          <dt>Local floor</dt>
          <dd>
            {humanUnits(terms.floorBuyAmount, terms.buyDecimals)}{" "}
            {terms.buySymbol}; the reviewed total is not below it
          </dd>
        </div>
        <div>
          <dt>Locks expire</dt>
          <dd>
            <RfqCountdown expiresAt={lockExpiry} /> · all fills share the bound
            RFQ settlement deadline
          </dd>
        </div>
        <div>
          <dt>Fresh private sell balance</dt>
          <dd>
            {snapshot?.shieldedBalance === undefined
              ? "Unavailable"
              : `${humanUnits(snapshot.shieldedBalance, terms.sellDecimals)} ${terms.sellSymbol} · ${snapshot.shieldedBalance.toString()} base units`}
          </dd>
        </div>
        <div>
          <dt>Balance snapshot</dt>
          <dd>
            {snapshot
              ? `${snapshot.account} · ${snapshot.chainId} · read ${new Date(snapshot.observedAt * 1_000).toISOString()}`
              : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt>Settlement authority</dt>
          <dd>
            None yet. After submission, the exact on-chain Take record and the
            lifecycle v3 authority reader must agree before this browser calls
            it settled.
          </dd>
        </div>
      </dl>

      <h4>Privacy boundaries</h4>
      <ul>
        <li>
          Losing makers saw only the fixed size bucket, pair, side, and expiry;
          the exact size and floor stayed in this browser.
        </li>
        <li>
          Take publishes the exact per-lock amounts and OPEN payout-note amount
          on this local devnet. Timing and service fanout remain observable.
        </li>
        <li>
          This remains a localnet-only demo. Sepolia and Mainnet execution are
          disabled.
        </li>
      </ul>

      <Blockers blockers={blockers} />
      <ReviewActions
        acceptLabel="Take atomically on LOCALNET"
        declineLabel={declineLabel ?? "Decline locked quotes"}
        onAccept={onAccept}
        onDecline={onDecline}
        disabled={disabled}
        declineDisabled={declineDisabled}
        blockers={blockers}
      />

      <details className={styles.finalReviewDetails}>
        <summary>Protocol details</summary>
        <dl>
          <div>
            <dt>Exact sell</dt>
            <dd>
              {terms.exactSellAmount.toString()} base units ·{" "}
              {terms.sellAddress}
            </dd>
          </div>
          <div>
            <dt>Exact receive</dt>
            <dd>
              {terms.totalBuyAmount.toString()} base units · {terms.buyAddress}
            </dd>
          </div>
          <div>
            <dt>Fee binding</dt>
            <dd>
              {terms.feeBps} bps · {terms.app20FeeAmount.toString()} base units
            </dd>
          </div>
          <div>
            <dt>RFQ ID</dt>
            <dd>
              <CopyableId value={terms.rfqId} label="RFQ ID" />
            </dd>
          </div>
          <div>
            <dt>Request digest</dt>
            <dd>
              <code>{terms.requestDigest}</code>
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

function LegacyFinalReview({
  terms,
  onAccept,
  onDecline,
  disabled,
  declineDisabled,
  blockers = [],
  snapshot,
  onQuoteExpire,
  onReservationExpire,
  focusRef,
}: SharedProps & {
  terms: RfqFinalReviewTerms;
  onQuoteExpire?: () => void;
  onReservationExpire?: () => void;
}) {
  return (
    <section
      ref={focusRef}
      tabIndex={-1}
      className={styles.finalReview}
      aria-labelledby="final-review-title"
    >
      <strong>{FINAL_REVIEW_ENVIRONMENT}</strong>
      <h3 id="final-review-title">Final value review</h3>

      <dl className={styles.finalReviewHeadline}>
        <div>
          <dt>You sell</dt>
          <dd>
            {humanUnits(terms.sellAmount, terms.sellDecimals)}{" "}
            {terms.sellSymbol}
          </dd>
        </div>
        <div>
          <dt>You receive</dt>
          <dd>
            {humanUnits(terms.buyAmount, terms.buyDecimals)} {terms.buySymbol}
          </dd>
        </div>
        <div>
          <dt>Maker</dt>
          <dd>
            {terms.makerId} · {terms.spreadBps} bps spread
          </dd>
        </div>
        <div>
          <dt>Fill policy</dt>
          <dd>Full fill only</dd>
        </div>
      </dl>

      <dl className={styles.finalReviewSummary}>
        <div>
          <dt>Quote expires</dt>
          <dd>
            <RfqCountdown
              expiresAt={terms.quoteExpiresAt}
              onExpire={onQuoteExpire}
            />
          </dd>
        </div>
        <div>
          <dt>Reservation expires</dt>
          <dd>
            <RfqCountdown
              expiresAt={terms.reservationExpiresAt}
              onExpire={onReservationExpire}
            />
          </dd>
        </div>
        <div>
          <dt>Refund available after</dt>
          <dd>
            <RfqCountdown expiresAt={terms.settlementExpiresAt} />
          </dd>
        </div>
        <div>
          <dt>Fees you pay</dt>
          <dd>
            STRK20 pool fee{" "}
            {snapshot?.poolFee === undefined
              ? "unavailable"
              : `${humanUnits(snapshot.poolFee, 18)} STRK`}{" "}
            · APP20 fee {terms.app20FeeAmount.toString()} base units · gas{" "}
            {snapshot?.walletConfirmedGasBaseUnits === undefined
              ? "unknown until the wallet confirms"
              : `${snapshot.walletConfirmedGasBaseUnits.toString()} base units, wallet-confirmed`}
          </dd>
        </div>
        <div>
          <dt>If the maker never fills</dt>
          <dd>
            You refund the full{" "}
            {humanUnits(terms.sellAmount, terms.sellDecimals)}{" "}
            {terms.sellSymbol} after the settlement deadline. Refund is a
            separate action you take.
          </dd>
        </div>
        <div>
          <dt>Settlement authority</dt>
          <dd>
            None yet. This localnet-only demo can finalize only through modeled
            same-devnet readers and exact maker reconciliation. Sepolia/Mainnet
            production authority remains unavailable.
          </dd>
        </div>
        <div>
          <dt>Wallet / chain</dt>
          <dd>
            {snapshot
              ? `${snapshot.account} · ${snapshot.chainId}`
              : "unavailable"}
          </dd>
        </div>
      </dl>

      <p className={styles.finalReviewWarning}>{LEGACY_ESCROW_WARNING}</p>
      <h4>Privacy boundaries</h4>
      <ul>
        <li>
          Not published as a public order before local settlement; this does not
          establish that activity cannot be correlated.
        </li>
        <li>
          Invited makers already learned the pair, side, exact size, floor, and
          expiry.
        </li>
        <li>
          Public in this local devnet demo: shield/unshield, pool fees, legacy
          escrow terms, lifecycle timing, and OPEN payout-note amounts.
        </li>
        <li>
          Observable by services: loopback request timing and maker response
          fanout; quote responses are request-scoped signed JSON.
        </li>
      </ul>

      <Blockers blockers={blockers} />
      <ReviewActions
        acceptLabel="Accept and fund on LOCALNET"
        declineLabel="Decline selected quote"
        onAccept={onAccept}
        onDecline={onDecline}
        disabled={disabled}
        declineDisabled={declineDisabled}
        blockers={blockers}
      />

      <details className={styles.finalReviewDetails}>
        <summary>Protocol details</summary>
        <dl>
          <div>
            <dt>Exact sell</dt>
            <dd>
              {terms.sellAmount.toString()} base units · {terms.sellAddress} ·{" "}
              {terms.sellDecimals} decimals
            </dd>
          </div>
          <div>
            <dt>Exact receive</dt>
            <dd>
              {terms.buyAmount.toString()} base units · {terms.buyAddress} ·{" "}
              {terms.buyDecimals} decimals
            </dd>
          </div>
          <div>
            <dt>Registry</dt>
            <dd>{terms.registryRevision || APP20_TOKEN_REGISTRY_REVISION}</dd>
          </div>
          <div>
            <dt>RFQ ID</dt>
            <dd>
              <CopyableId value={terms.rfqId} label="RFQ ID" />
            </dd>
          </div>
          <div>
            <dt>Quote ID</dt>
            <dd>
              <CopyableId value={terms.quoteNonce} label="Quote ID" />
            </dd>
          </div>
          <div>
            <dt>Quote digest</dt>
            <dd>
              {terms.quoteDigest ? (
                <code>{terms.quoteDigest}</code>
              ) : (
                "Unavailable on active local Quote V1 · not inferred"
              )}
            </dd>
          </div>
          <div>
            <dt>Intent digest bound by maker signature</dt>
            <dd>
              <code>{terms.intentDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Reservation / fence</dt>
            <dd>
              <CopyableId value={terms.reservationId} label="Reservation ID" />{" "}
              · {terms.reservationFence?.toString() ?? "V1 fence unavailable"}
            </dd>
          </div>
          <div>
            <dt>Maker key</dt>
            <dd>{terms.makerKeyId}</dd>
          </div>
          <div>
            <dt>Fresh private sell balance</dt>
            <dd>
              {snapshot?.shieldedBalance?.toString() ??
                "Unavailable · Ready Wallet API is not probed for final-review feature detection"}
            </dd>
          </div>
          <div>
            <dt>Private note maturity</dt>
            <dd>
              {snapshot?.shieldedMature === undefined
                ? "Unavailable · not inferred; G10 remains partial"
                : snapshot.shieldedMature
                  ? "Mature"
                  : "Not mature"}
            </dd>
          </div>
          <div>
            <dt>APP20 fee policy</dt>
            <dd>
              <code>{terms.app20FeePolicyId}</code>
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

export default function RfqFinalReview(props: RfqFinalReviewProps) {
  return "mode" in props.terms && props.terms.mode === "v3" ? (
    <V3FinalReview {...props} terms={props.terms} />
  ) : (
    <LegacyFinalReview {...props} terms={props.terms as RfqFinalReviewTerms} />
  );
}
