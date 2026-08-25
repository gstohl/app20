"use client";

import { useActiveStarknetSession } from "@/app/active-session";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import type { LocalnetMarketPairId } from "@/app/vault/LocalnetPrivateIntentDesk";
import {
  networkForProviderIndex,
  type App20TokenNetwork,
} from "@/lib/token-registry";
import { resolveSwapRoutePair } from "@/lib/swap-route";
import { Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import styles from "./swap.module.css";

const LocalnetPrivateIntentDesk = lazy(
  () => import("@/app/vault/LocalnetPrivateIntentDesk"),
);

export type SwapPageProps = Readonly<{
  tokenA?: string;
  tokenB?: string;
}>;

function pairTokens(pairId: LocalnetMarketPairId): {
  tokenA: "strk" | "usdc";
  tokenB: "strk" | "usdc";
} {
  return pairId === "STRK_USDC"
    ? { tokenA: "strk", tokenB: "usdc" }
    : { tokenA: "usdc", tokenB: "strk" };
}

export default function SwapPage({
  tokenA = "strk",
  tokenB = "usdc",
}: SwapPageProps) {
  const navigate = useNavigate();
  const session = useActiveStarknetSession();
  const providerIndex = useFrontendProvider(
    (state) => state.currentFrontendProviderIndex,
  );
  const network: App20TokenNetwork | null =
    session.network ?? networkForProviderIndex(providerIndex);
  const resolution = network
    ? resolveSwapRoutePair(network, tokenA, tokenB)
    : {
        kind: "invalid" as const,
        message: "Select a supported Starknet network.",
      };

  if (resolution.kind === "invalid") {
    return (
      <main className={styles.page}>
        <section className={styles.notice} role="alert">
          <p className={styles.eyebrow}>APP20 / SWAP</p>
          <h1>Invalid token pair</h1>
          <p>{resolution.message}</p>
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

  if (resolution.kind === "unverified" || resolution.kind === "duplicate") {
    return (
      <main className={styles.page}>
        <section
          className={styles.notice}
          aria-labelledby="asset-blocked-title"
        >
          <p className={styles.eyebrow}>APP20 / REVIEWED ASSETS</p>
          <h1 id="asset-blocked-title">
            {resolution.kind === "duplicate"
              ? "Choose different assets"
              : "Asset not reviewed"}
          </h1>
          <p>{resolution.message}</p>
          <p>
            No quote, proposal, or public route was created. APP20 does not
            infer token metadata from route text.
          </p>
          <div className={styles.noticeActions}>
            <Link
              to="/swap/$tokenA/$tokenB"
              params={{ tokenA: "strk", tokenB: "usdc" }}
            >
              Open reviewed pair
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const pair = resolution.pair;
  if (resolution.kind === "reviewed-no-inventory") {
    return (
      <main className={styles.page}>
        <section className={styles.notice} aria-labelledby="no-market-title">
          <p className={styles.eyebrow}>APP20 / PRIVATE INVENTORY</p>
          <h1 id="no-market-title">
            No configured market for {pair.tokenA.symbol} / {pair.tokenB.symbol}
          </h1>
          <p>
            Both assets are reviewed for {pair.network}, but APP20 has no
            configured private inventory market. No quote was requested and
            nothing was routed publicly.
          </p>
          <div className={styles.noticeActions}>
            <Link
              className={styles.primaryLink}
              to="/pools/create/$tokenA/$tokenB"
              params={{ tokenA: pair.tokenA.key, tokenB: pair.tokenB.key }}
            >
              Prepare proposal
            </Link>
            <Link to="/vault">Open Desk</Link>
          </div>
        </section>
      </main>
    );
  }

  const pairId = pair.pairId;
  if (!pairId)
    throw new Error("Configured market omitted its pair identifier.");

  return (
    <main className={styles.page}>
      <section className={styles.swapCard} aria-label="APP20 swap">
        <header className={styles.poolBar}>
          <div>
            <span>PRIVATE INVENTORY</span>
            <strong>
              {pair.tokenA.symbol} / {pair.tokenB.symbol}
            </strong>
          </div>
          <span>INVENTORY FIRST</span>
        </header>
        <Suspense fallback={<p className={styles.loading}>Loading swap…</p>}>
          <LocalnetPrivateIntentDesk
            initialPairId={pairId}
            swapOnly
            onPairChange={(nextPairId) => {
              const next = pairTokens(nextPairId);
              void navigate({
                to: "/swap/$tokenA/$tokenB",
                params: next,
              });
            }}
          />
        </Suspense>
        <footer className={styles.cardFooter}>
          <span>Shield and unshield remain public boundaries.</span>
          <nav className={styles.footerLinks} aria-label="Pool and desk links">
            <Link
              to="/pools/create/$tokenA/$tokenB"
              params={{ tokenA: pair.tokenA.key, tokenB: pair.tokenB.key }}
            >
              Prepare proposal
            </Link>
            <Link to="/vault">Desk &amp; funding →</Link>
          </nav>
        </footer>
      </section>
    </main>
  );
}
