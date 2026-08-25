"use client";

import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import {
  POOL_FEE_TIERS,
  validatePoolCreationDraft,
  type PoolCreationReview,
  type PoolFeeBps,
} from "@/lib/pool-creation";
import { resolveSwapRoutePair } from "@/lib/swap-route";
import { Strk20Networks } from "@/utils/constants";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import styles from "./pool-create.module.css";

export type PoolCreationPageProps = Readonly<{
  tokenA: string;
  tokenB: string;
}>;

const FEE_TIER_COPY: Readonly<
  Record<PoolFeeBps, Readonly<{ label: string; detail: string }>>
> = {
  5: { label: "0.05%", detail: "Tight pair" },
  30: { label: "0.30%", detail: "Standard" },
  100: { label: "1.00%", detail: "Wide pair" },
};

function tokenLabel(value: string): string {
  return value.startsWith("0x") && value.length > 18
    ? `${value.slice(0, 10)}…${value.slice(-6)}`
    : value.toUpperCase();
}

function formatReviewAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(value);
}

export default function PoolCreationPage({
  tokenA,
  tokenB,
}: PoolCreationPageProps) {
  const pair = resolveSwapRoutePair(tokenA, tokenB);
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const connected = useStoreWallet((state) => state.isConnected);
  const [feeBps, setFeeBps] = useState<PoolFeeBps>(30);
  const [initialPrice, setInitialPrice] = useState("");
  const [tokenAInventory, setTokenAInventory] = useState("");
  const [tokenBInventory, setTokenBInventory] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [prepared, setPrepared] = useState<PoolCreationReview | null>(null);

  if (!pair) {
    return (
      <main className={styles.page}>
        <section className={styles.invalidCard} role="alert">
          <p className={styles.eyebrow}>APP20 / CREATE POOL</p>
          <h1>Invalid token pair</h1>
          <p>The route contains a token identifier APP20 will not accept.</p>
          <Link
            to="/swap/$tokenA/$tokenB"
            params={{ tokenA: "strk", tokenB: "usdc" }}
          >
            Open STRK / USDC
          </Link>
        </section>
      </main>
    );
  }

  const labelA = tokenLabel(pair.tokenA);
  const labelB = tokenLabel(pair.tokenB);
  const validation = validatePoolCreationDraft({
    tokenA: pair.tokenA,
    tokenB: pair.tokenB,
    feeBps,
    initialPrice,
    tokenAInventory,
    tokenBInventory,
  });

  function invalidateReview() {
    setPrepared(null);
    setShowErrors(false);
  }

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (!validation.ok) {
      setPrepared(null);
      return;
    }
    setPrepared(validation.review);
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>APP20 / PRIVATE POOLS</p>
          <h1>Create pool</h1>
        </div>
        <nav
          className={styles.headerActions}
          aria-label="Pool creation navigation"
        >
          <Link
            to="/swap/$tokenA/$tokenB"
            params={{ tokenA: pair.tokenA, tokenB: pair.tokenB }}
          >
            ← Back to pair
          </Link>
          <Link to="/vault">Open Desk</Link>
        </nav>
      </header>

      <div className={styles.pairBanner}>
        <div>
          <span>PAIR</span>
          <strong>{labelA}</strong>
          <i>/</i>
          <strong>{labelB}</strong>
        </div>
        <p>
          Configure the pool draft and initial private inventory. Nothing is
          deployed or transferred from this screen.
        </p>
      </div>

      <div className={styles.workspace}>
        <form
          className={styles.formPanel}
          aria-labelledby="pool-configuration-title"
          onSubmit={submitDraft}
        >
          <section className={styles.formSection}>
            <header className={styles.sectionHeader}>
              <div>
                <span>01 / MARKET</span>
                <h2 id="pool-configuration-title">Pool configuration</h2>
              </div>
              <strong>PRIVATE INVENTORY</strong>
            </header>

            {showErrors && validation.errors.pair ? (
              <p className={styles.formError} role="alert">
                {validation.errors.pair}
              </p>
            ) : null}

            <fieldset className={styles.feeFieldset}>
              <legend>Fee tier</legend>
              <div className={styles.feeOptions}>
                {POOL_FEE_TIERS.map((tier) => (
                  <label key={tier} className={styles.feeOption}>
                    <input
                      type="radio"
                      name="fee-tier"
                      value={tier}
                      checked={feeBps === tier}
                      onChange={() => {
                        setFeeBps(tier);
                        invalidateReview();
                      }}
                    />
                    <span>
                      <strong>{FEE_TIER_COPY[tier].label}</strong>
                      <small>{FEE_TIER_COPY[tier].detail}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className={styles.field}>
              <span>Initial reference price</span>
              <div className={styles.inputShell}>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={initialPrice}
                  aria-label={`Initial price in ${labelB} per ${labelA}`}
                  aria-invalid={
                    showErrors && Boolean(validation.errors.initialPrice)
                  }
                  onChange={(event) => {
                    setInitialPrice(event.target.value);
                    invalidateReview();
                  }}
                  placeholder="0.00"
                />
                <strong>
                  {labelB} / {labelA}
                </strong>
              </div>
              <small>
                Draft reference only. Executable prices still require signed
                APP20 quotes.
              </small>
              {showErrors && validation.errors.initialPrice ? (
                <em>{validation.errors.initialPrice}</em>
              ) : null}
            </label>
          </section>

          <section className={styles.formSection}>
            <header className={styles.sectionHeader}>
              <div>
                <span>02 / INVENTORY</span>
                <h2>Starting liquidity</h2>
              </div>
              <strong>NOT YET FUNDED</strong>
            </header>

            <div className={styles.inventoryGrid}>
              <label className={styles.inventoryCard}>
                <span>Token A inventory</span>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={tokenAInventory}
                    aria-label={`${labelA} starting inventory`}
                    aria-invalid={
                      showErrors && Boolean(validation.errors.tokenAInventory)
                    }
                    onChange={(event) => {
                      setTokenAInventory(event.target.value);
                      invalidateReview();
                    }}
                    placeholder="0.00"
                  />
                  <strong>{labelA}</strong>
                </div>
                {showErrors && validation.errors.tokenAInventory ? (
                  <em>{validation.errors.tokenAInventory}</em>
                ) : null}
              </label>

              <label className={styles.inventoryCard}>
                <span>Token B inventory</span>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={tokenBInventory}
                    aria-label={`${labelB} starting inventory`}
                    aria-invalid={
                      showErrors && Boolean(validation.errors.tokenBInventory)
                    }
                    onChange={(event) => {
                      setTokenBInventory(event.target.value);
                      invalidateReview();
                    }}
                    placeholder="0.00"
                  />
                  <strong>{labelB}</strong>
                </div>
                {showErrors && validation.errors.tokenBInventory ? (
                  <em>{validation.errors.tokenBInventory}</em>
                ) : null}
              </label>
            </div>

            <div className={styles.inventoryNotice}>
              <strong>Inventory is not transferred during preparation.</strong>
              <p>
                Funding and shielding remain separate, explicit wallet actions
                after a reviewed pool deployment exists.
              </p>
            </div>
          </section>

          <button type="submit" className={styles.primaryButton}>
            Prepare pool creation
          </button>
        </form>

        <aside className={styles.reviewPanel} aria-label="Pool creation review">
          <header className={styles.reviewHeader}>
            <div>
              <span>CREATION REVIEW</span>
              <h2>{prepared ? "Review ready" : "Draft summary"}</h2>
            </div>
            <strong className={prepared ? styles.ready : undefined}>
              {prepared ? "PREPARED" : "DRAFT"}
            </strong>
          </header>

          <dl className={styles.reviewList}>
            <div>
              <dt>Pair</dt>
              <dd>
                {labelA} / {labelB}
              </dd>
            </div>
            <div>
              <dt>Pool type</dt>
              <dd>Private inventory</dd>
            </div>
            <div>
              <dt>Fee tier</dt>
              <dd>{FEE_TIER_COPY[feeBps].label}</dd>
            </div>
            <div>
              <dt>Initial price</dt>
              <dd>
                {prepared
                  ? `${formatReviewAmount(prepared.initialPrice)} ${labelB}`
                  : initialPrice || "Required"}
              </dd>
            </div>
            <div>
              <dt>{labelA} inventory</dt>
              <dd>
                {prepared
                  ? formatReviewAmount(prepared.tokenAInventory)
                  : tokenAInventory || "Required"}
              </dd>
            </div>
            <div>
              <dt>{labelB} inventory</dt>
              <dd>
                {prepared
                  ? formatReviewAmount(prepared.tokenBInventory)
                  : tokenBInventory || "Required"}
              </dd>
            </div>
            <div>
              <dt>Reference value</dt>
              <dd>
                {prepared
                  ? `${formatReviewAmount(prepared.totalReferenceValueInTokenB)} ${labelB}`
                  : "Calculated on review"}
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{Strk20Networks[providerIndex] ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Owner wallet</dt>
              <dd>{connected ? "Connected" : "Connect in header"}</dd>
            </div>
            <div>
              <dt>Pool factory</dt>
              <dd className={styles.blocked}>Not configured</dd>
            </div>
          </dl>

          {prepared ? (
            <div className={styles.status} role="status">
              <strong>Creation review prepared</strong>
              <p>
                The draft is valid. No transaction was submitted and no value
                moved.
              </p>
            </div>
          ) : null}

          <section className={styles.deploymentGate}>
            <span>DEPLOYMENT GATE</span>
            <h3>Contract integration required</h3>
            <ul>
              <li>Reviewed factory address</li>
              <li>Reviewed factory ABI and calldata</li>
              <li>Independent contract approval</li>
              <li>Explicit wallet confirmation</li>
            </ul>
          </section>

          <button
            type="button"
            className={styles.deployButton}
            disabled
            title="A reviewed pool factory is not configured"
          >
            Deploy pool unavailable
          </button>
          <p className={styles.deployHint}>
            APP20 will not fabricate a deployment transaction without a reviewed
            factory contract.
          </p>
        </aside>
      </div>
    </main>
  );
}
