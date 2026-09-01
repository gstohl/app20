"use client";

import { useActiveStarknetSession } from "@/app/active-session";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import {
  digestMarketProposalReview,
  validateMarketProposalDraft,
  type MarketProposalReview,
} from "@/lib/market-proposal";
import {
  APP20_TOKEN_REGISTRY_REVISION,
  networkForProviderIndex,
  resolveCanonicalPair,
  resolveSessionTokenNetwork,
} from "@/lib/token-registry";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./market-proposal.module.css";

export type MarketProposalPageProps = Readonly<{
  tokenA: string;
  tokenB: string;
}>;

type PreparedDraft = Readonly<{
  key: string;
  review: MarketProposalReview;
  checksum: string;
}>;

function shortFelt(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

export default function MarketProposalPage({
  tokenA,
  tokenB,
}: MarketProposalPageProps) {
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const session = useActiveStarknetSession();
  const selectedNetwork = networkForProviderIndex(providerIndex);
  const networkResolution = resolveSessionTokenNetwork({
    selectedNetwork,
    sessionNetwork: session.network,
    connected: session.connected,
    compatible: session.compatible,
    reason: session.reason,
  });
  const pairResolution = networkResolution.ok
    ? resolveCanonicalPair(networkResolution.network, tokenA, tokenB)
    : null;
  const pair = pairResolution?.ok ? pairResolution.pair : null;
  const [proposedAmountA, setProposedAmountA] = useState("");
  const [proposedAmountB, setProposedAmountB] = useState("");
  const [referencePrice, setReferencePrice] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [invalidSubmissionCount, setInvalidSubmissionCount] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PreparedDraft | null>(null);
  const generation = useRef(0);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const validation = pair
    ? validateMarketProposalDraft({
        account: session.account ?? "",
        chainId: session.chainId ?? "",
        registryRevision: APP20_TOKEN_REGISTRY_REVISION,
        tokenA: pair.tokenA,
        tokenB: pair.tokenB,
        proposedAmountA,
        proposedAmountB,
        referencePrice,
      })
    : null;
  const contextKey = JSON.stringify([
    networkResolution.ok ? networkResolution.network : null,
    pair?.tokenA.address ?? tokenA,
    pair?.tokenB.address ?? tokenB,
    session.account,
    session.chainId,
    session.compatible,
    APP20_TOKEN_REGISTRY_REVISION,
  ]);
  const draftKey = JSON.stringify([
    contextKey,
    proposedAmountA,
    proposedAmountB,
    referencePrice,
  ]);
  const currentPrepared = prepared?.key === draftKey ? prepared : null;
  const previousContextKey = useRef(contextKey);

  useEffect(() => {
    if (previousContextKey.current === contextKey) return;
    previousContextKey.current = contextKey;
    generation.current += 1;
    setPrepared(null);
    setPreparing(false);
    setShowErrors(false);
  }, [contextKey]);

  useEffect(() => {
    if (invalidSubmissionCount > 0) errorSummaryRef.current?.focus();
  }, [invalidSubmissionCount]);

  function invalidateReview() {
    generation.current += 1;
    setPrepared(null);
    setShowErrors(false);
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (!validation?.ok) {
      generation.current += 1;
      setPrepared(null);
      setPreparing(false);
      setInvalidSubmissionCount((count) => count + 1);
      return;
    }
    const requestGeneration = ++generation.current;
    setPreparing(true);
    try {
      const checksum = await digestMarketProposalReview(validation.review);
      if (requestGeneration !== generation.current) return;
      setPrepared({ key: draftKey, review: validation.review, checksum });
    } finally {
      if (requestGeneration === generation.current) setPreparing(false);
    }
  }

  if (!pair) {
    const reason = networkResolution.ok
      ? pairResolution?.ok
        ? "The pair is unavailable."
        : (pairResolution?.message ?? "No supported network is selected.")
      : networkResolution.message;
    return (
      <main className={styles.page}>
        <section className={styles.invalidCard} role="alert">
          <p className={styles.eyebrow}>APP20 / MARKET PROPOSAL</p>
          <h1>Asset not reviewed</h1>
          <p>{reason}</p>
          <p>
            APP20 cannot draft a market proposal for unverified token metadata.
            No transaction, liquidity venue, or quote was created.
          </p>
          <Link to="/rfq">Back to RFQ</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.eyebrow} aria-label="Breadcrumb">
            <Link to="/rfq">RFQ</Link>
            {" / "}
            <span>Markets</span>
            {" / "}
            <Link
              to="/swap/$tokenA/$tokenB"
              params={{ tokenA: pair.tokenA.key, tokenB: pair.tokenB.key }}
            >
              {pair.tokenA.symbol} / {pair.tokenB.symbol}
            </Link>
            {" / "}
            <span aria-current="page">Proposal</span>
          </nav>
          <h1>Draft market proposal</h1>
          <strong>PROPOSAL ONLY · NO DEPLOYMENT</strong>
        </div>
        <nav
          className={styles.headerActions}
          aria-label="Market proposal navigation"
        >
          <Link
            to="/swap/$tokenA/$tokenB"
            params={{ tokenA: pair.tokenA.key, tokenB: pair.tokenB.key }}
          >
            ← Back to pair
          </Link>
          <Link to="/rfq">Open RFQ</Link>
        </nav>
      </header>

      <div className={styles.pairBanner}>
        <div>
          <span>REVIEWED PAIR</span>
          <strong>{pair.tokenA.symbol}</strong>
          <i>/</i>
          <strong>{pair.tokenB.symbol}</strong>
        </div>
        <p>
          This session-only review does not create a venue, AMM, order book, LP
          position, inventory, transaction, or deployment authorization.
        </p>
      </div>

      <div className={styles.workspace}>
        <form
          className={styles.formPanel}
          aria-labelledby="market-proposal-title"
          onSubmit={(event) => void submitDraft(event)}
        >
          <section className={styles.formSection}>
            <header className={styles.sectionHeader}>
              <div>
                <span>01 / CANONICAL ASSETS</span>
                <h2 id="market-proposal-title">Reviewed proposal scope</h2>
              </div>
              <strong>{pair.network.toUpperCase()}</strong>
            </header>
            <dl className={styles.canonicalGrid}>
              {[pair.tokenA, pair.tokenB].map((token) => (
                <div key={token.address}>
                  <dt>{token.symbol}</dt>
                  <dd>{shortFelt(token.address)}</dd>
                  <small>{token.decimals} decimals · allowlisted</small>
                </div>
              ))}
              <div>
                <dt>Active owner</dt>
                <dd>
                  {session.account ? shortFelt(session.account) : "Unknown"}
                </dd>
                <small>{session.reason}</small>
              </div>
              <div>
                <dt>Chain</dt>
                <dd>
                  {session.chainId ? shortFelt(session.chainId) : "Unknown"}
                </dd>
                <small>{APP20_TOKEN_REGISTRY_REVISION}</small>
              </div>
            </dl>
          </section>

          <section className={styles.formSection}>
            <header className={styles.sectionHeader}>
              <div>
                <span>02 / NEUTRAL DRAFT</span>
                <h2>Exact proposed amounts</h2>
              </div>
              <strong>NO VALUE MOVEMENT</strong>
            </header>
            <div className={styles.inventoryGrid}>
              <label className={styles.inventoryCard}>
                <span>Proposed amount A</span>
                <div>
                  <input
                    aria-label={`${pair.tokenA.symbol} proposed amount`}
                    aria-describedby={
                      showErrors && validation?.errors.proposedAmountA
                        ? "market-proposal-amount-a-error"
                        : undefined
                    }
                    aria-errormessage={
                      showErrors && validation?.errors.proposedAmountA
                        ? "market-proposal-amount-a-error"
                        : undefined
                    }
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={proposedAmountA}
                    aria-invalid={
                      showErrors && Boolean(validation?.errors.proposedAmountA)
                    }
                    onChange={(event) => {
                      setProposedAmountA(event.target.value);
                      invalidateReview();
                    }}
                    placeholder="0.00"
                  />
                  <strong>{pair.tokenA.symbol}</strong>
                </div>
                {showErrors && validation?.errors.proposedAmountA ? (
                  <em id="market-proposal-amount-a-error">
                    {validation.errors.proposedAmountA}
                  </em>
                ) : null}
              </label>
              <label className={styles.inventoryCard}>
                <span>Proposed amount B</span>
                <div>
                  <input
                    aria-label={`${pair.tokenB.symbol} proposed amount`}
                    aria-describedby={
                      showErrors && validation?.errors.proposedAmountB
                        ? "market-proposal-amount-b-error"
                        : undefined
                    }
                    aria-errormessage={
                      showErrors && validation?.errors.proposedAmountB
                        ? "market-proposal-amount-b-error"
                        : undefined
                    }
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={proposedAmountB}
                    aria-invalid={
                      showErrors && Boolean(validation?.errors.proposedAmountB)
                    }
                    onChange={(event) => {
                      setProposedAmountB(event.target.value);
                      invalidateReview();
                    }}
                    placeholder="0.00"
                  />
                  <strong>{pair.tokenB.symbol}</strong>
                </div>
                {showErrors && validation?.errors.proposedAmountB ? (
                  <em id="market-proposal-amount-b-error">
                    {validation.errors.proposedAmountB}
                  </em>
                ) : null}
              </label>
            </div>
            <label className={styles.field}>
              <span>Non-executable reference price</span>
              <div className={styles.inputShell}>
                <input
                  aria-label={`Non-executable reference price in ${pair.tokenB.symbol} per ${pair.tokenA.symbol}`}
                  aria-describedby={
                    showErrors && validation?.errors.referencePrice
                      ? "market-proposal-reference-price-error"
                      : undefined
                  }
                  aria-errormessage={
                    showErrors && validation?.errors.referencePrice
                      ? "market-proposal-reference-price-error"
                      : undefined
                  }
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={referencePrice}
                  aria-invalid={
                    showErrors && Boolean(validation?.errors.referencePrice)
                  }
                  onChange={(event) => {
                    setReferencePrice(event.target.value);
                    invalidateReview();
                  }}
                  placeholder="0.00"
                />
                <strong>
                  {pair.tokenB.symbol} / {pair.tokenA.symbol}
                </strong>
              </div>
              <small>
                Identifier context only. This is not an APP20 quote or an
                executable market price.
              </small>
              {showErrors && validation?.errors.referencePrice ? (
                <em id="market-proposal-reference-price-error">
                  {validation.errors.referencePrice}
                </em>
              ) : null}
            </label>
            {showErrors && validation && !validation.ok ? (
              <div
                ref={errorSummaryRef}
                className={styles.formError}
                role="alert"
                tabIndex={-1}
                aria-labelledby="market-proposal-error-summary-title"
              >
                <strong id="market-proposal-error-summary-title">
                  Proposal needs attention
                </strong>
                <p>
                  Resolve the blocked proposal fields and active-session
                  evidence.
                </p>
                <ul>
                  {Object.values(validation.errors).map((message) =>
                    message ? <li key={message}>{message}</li> : null,
                  )}
                </ul>
              </div>
            ) : null}
          </section>

          <button
            type="submit"
            className={styles.primaryButton}
            disabled={preparing}
          >
            {preparing ? "Preparing review…" : "Prepare draft review"}
          </button>
        </form>

        <aside
          className={styles.reviewPanel}
          aria-label="Market proposal review"
        >
          <header className={styles.reviewHeader}>
            <div>
              <span>SESSION REVIEW</span>
              <h2>
                {currentPrepared
                  ? "Proposal identifier prepared"
                  : "Proposal summary"}
              </h2>
            </div>
            <strong className={currentPrepared ? styles.ready : undefined}>
              {currentPrepared ? "DRAFT PREPARED" : "NOT PREPARED"}
            </strong>
          </header>

          {currentPrepared ? (
            <section className={styles.checksum} role="status">
              <span>REVIEW CHECKSUM</span>
              <code>{currentPrepared.checksum}</code>
              <p>
                Deterministic identifier only—not a signature, approval,
                transaction, venue ID, or deployment authorization.
              </p>
              <dl>
                <div>
                  <dt>{pair.tokenA.symbol} base units</dt>
                  <dd>{currentPrepared.review.proposedAmountABaseUnits}</dd>
                </div>
                <div>
                  <dt>{pair.tokenB.symbol} base units</dt>
                  <dd>{currentPrepared.review.proposedAmountBBaseUnits}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          <section className={styles.readinessSection}>
            <span>PROPOSAL ONLY · NO DEPLOYMENT</span>
            <p>
              Reviewed assets, owner/session, network, exact amounts, registry
              revision, and a non-executable reference price are the entire
              proposal scope.
            </p>
            <p>
              The checksum is an identifier only. It does not represent
              operational readiness or a liquidity action.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
