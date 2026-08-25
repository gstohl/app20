"use client";

import { useActiveStarknetSession } from "@/app/active-session";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import {
  digestPoolCreationReview,
  validatePoolCreationDraft,
  type PoolCreationReview,
} from "@/lib/pool-creation";
import { buildPoolReadiness } from "@/lib/pool-readiness";
import {
  APP20_TOKEN_REGISTRY_REVISION,
  networkForProviderIndex,
  resolveCanonicalPair,
} from "@/lib/token-registry";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./pool-create.module.css";

export type PoolCreationPageProps = Readonly<{
  tokenA: string;
  tokenB: string;
}>;

type PreparedDraft = Readonly<{
  key: string;
  review: PoolCreationReview;
  checksum: string;
}>;

function shortFelt(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

export default function PoolCreationPage({
  tokenA,
  tokenB,
}: PoolCreationPageProps) {
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const session = useActiveStarknetSession();
  const selectedNetwork = networkForProviderIndex(providerIndex);
  const proposalNetwork = session.network ?? selectedNetwork;
  const pairResolution = proposalNetwork
    ? resolveCanonicalPair(proposalNetwork, tokenA, tokenB)
    : null;
  const pair = pairResolution?.ok ? pairResolution.pair : null;
  const [proposedAmountA, setProposedAmountA] = useState("");
  const [proposedAmountB, setProposedAmountB] = useState("");
  const [referencePrice, setReferencePrice] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PreparedDraft | null>(null);
  const generation = useRef(0);

  const validation = pair
    ? validatePoolCreationDraft({
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
    proposalNetwork,
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

  const readiness = buildPoolReadiness({
    correctNetwork: session.compatible
      ? {
          status: pair && session.network === pair.network ? "pass" : "block",
          freshness: "current",
          evidence:
            pair && session.network === pair.network
              ? `${pair.network.toUpperCase()} session matches the proposal.`
              : "The active session does not match the proposal network.",
        }
      : {
          status: session.connected ? "block" : "unknown",
          freshness: "current",
          evidence: session.reason,
        },
    ownerAccount: session.account
      ? {
          status: "pass",
          freshness: "current",
          evidence: `Active ${session.rail.toUpperCase()} account ${shortFelt(session.account)}.`,
        }
      : {
          status: "unknown",
          freshness: "current",
          evidence: "Connect the proposal owner in the header.",
        },
    allowedContracts: pair
      ? {
          status: "pass",
          freshness: "current",
          evidence: `Both contracts are reviewed in ${APP20_TOKEN_REGISTRY_REVISION}.`,
        }
      : {
          status: "block",
          freshness: "current",
          evidence:
            "The requested pair is not in the active network allowlist.",
        },
  });

  function invalidateReview() {
    generation.current += 1;
    setPrepared(null);
    setShowErrors(false);
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (!validation?.ok) {
      invalidateReview();
      setShowErrors(true);
      return;
    }
    const requestGeneration = ++generation.current;
    setPreparing(true);
    try {
      const checksum = await digestPoolCreationReview(validation.review);
      if (requestGeneration !== generation.current) return;
      setPrepared({ key: draftKey, review: validation.review, checksum });
    } finally {
      if (requestGeneration === generation.current) setPreparing(false);
    }
  }

  if (!pair) {
    const reason = pairResolution?.ok
      ? "The pair is unavailable."
      : (pairResolution?.message ?? "No supported network is selected.");
    return (
      <main className={styles.page}>
        <section className={styles.invalidCard} role="alert">
          <p className={styles.eyebrow}>APP20 / POOL PROPOSAL</p>
          <h1>Asset not reviewed</h1>
          <p>{reason}</p>
          <p>
            APP20 cannot prepare or deploy a proposal for unverified token
            metadata. No transaction or quote was created.
          </p>
          <Link to="/">Back to Swap</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>APP20 / POOL PROPOSAL</p>
          <h1>Prepare draft</h1>
        </div>
        <nav
          className={styles.headerActions}
          aria-label="Pool proposal navigation"
        >
          <Link
            to="/swap/$tokenA/$tokenB"
            params={{ tokenA: pair.tokenA.key, tokenB: pair.tokenB.key }}
          >
            ← Back to pair
          </Link>
          <Link to="/vault">Open Desk</Link>
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
          This is a session-only proposal review. It does not create a pool,
          fund inventory, or authorize deployment.
        </p>
      </div>

      <div className={styles.workspace}>
        <form
          className={styles.formPanel}
          aria-labelledby="pool-proposal-title"
          onSubmit={(event) => void submitDraft(event)}
        >
          <section className={styles.formSection}>
            <header className={styles.sectionHeader}>
              <div>
                <span>01 / CANONICAL ASSETS</span>
                <h2 id="pool-proposal-title">Reviewed proposal scope</h2>
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
                  <em>{validation.errors.proposedAmountA}</em>
                ) : null}
              </label>
              <label className={styles.inventoryCard}>
                <span>Proposed amount B</span>
                <div>
                  <input
                    aria-label={`${pair.tokenB.symbol} proposed amount`}
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
                  <em>{validation.errors.proposedAmountB}</em>
                ) : null}
              </label>
            </div>
            <label className={styles.field}>
              <span>Non-executable reference price</span>
              <div className={styles.inputShell}>
                <input
                  aria-label={`Non-executable reference price in ${pair.tokenB.symbol} per ${pair.tokenA.symbol}`}
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
                <em>{validation.errors.referencePrice}</em>
              ) : null}
            </label>
            {showErrors && validation && !validation.ok ? (
              <p className={styles.formError} role="alert">
                Resolve the blocked proposal fields and active-session evidence.
              </p>
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

        <aside className={styles.reviewPanel} aria-label="Pool proposal review">
          <header className={styles.reviewHeader}>
            <div>
              <span>SESSION REVIEW</span>
              <h2>{currentPrepared ? "Draft prepared" : "Readiness"}</h2>
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
                Deterministic identifier only—not a signature, approval, pool
                ID, transaction, or deployment authorization.
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
            <span>DEPLOYMENT READINESS</span>
            <div className={styles.readinessList}>
              {Object.values(readiness.checks).map((check) => (
                <article key={check.key}>
                  <i
                    className={
                      check.status === "pass"
                        ? styles.checkPass
                        : check.status === "block"
                          ? styles.checkBlock
                          : styles.checkUnknown
                    }
                  >
                    {check.status}
                  </i>
                  <div>
                    <strong>{check.label}</strong>
                    <p>{check.evidence}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <button
            type="button"
            className={styles.deployButton}
            disabled
            title="No reviewed factory, ABI, calldata, or deployment approval exists"
          >
            Deployment unavailable
          </button>
          <p className={styles.deployHint}>{readiness.deployment.evidence}</p>
        </aside>
      </div>
    </main>
  );
}
