"use client";

import type { LocalnetMarketPairId } from "@/app/vault/LocalnetPrivateIntentDesk";
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

function tokenLabel(value: string): string {
  return value.startsWith("0x") && value.length > 18
    ? `${value.slice(0, 10)}…${value.slice(-6)}`
    : value.toUpperCase();
}

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
  const pair = resolveSwapRoutePair(tokenA, tokenB);

  if (!pair) {
    return (
      <main className={styles.page}>
        <section className={styles.notice} role="alert">
          <p className={styles.eyebrow}>APP20 / SWAP</p>
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

  if (!pair.pairId) {
    return (
      <main className={styles.page}>
        <section className={styles.notice} aria-labelledby="no-pool-title">
          <p className={styles.eyebrow}>APP20 / PRIVATE POOL</p>
          <h1 id="no-pool-title">
            No pool for {tokenLabel(pair.tokenA)} / {tokenLabel(pair.tokenB)}
          </h1>
          <p>
            APP20 has no configured private inventory pool for this pair. No
            quote was requested and nothing was routed publicly.
          </p>
          <div className={styles.noticeActions}>
            <Link
              className={styles.primaryLink}
              to="/pools/create/$tokenA/$tokenB"
              params={{ tokenA: pair.tokenA, tokenB: pair.tokenB }}
            >
              Create pool
            </Link>
            <Link
              to="/swap/$tokenA/$tokenB"
              params={{ tokenA: "strk", tokenB: "usdc" }}
            >
              Use STRK / USDC
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.swapCard} aria-label="APP20 swap">
        <header className={styles.poolBar}>
          <div>
            <span>PRIVATE POOL</span>
            <strong>
              {tokenLabel(pair.tokenA)} / {tokenLabel(pair.tokenB)}
            </strong>
          </div>
          <span>INVENTORY FIRST</span>
        </header>
        <Suspense fallback={<p className={styles.loading}>Loading swap…</p>}>
          <LocalnetPrivateIntentDesk
            initialPairId={pair.pairId}
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
              params={{ tokenA: pair.tokenA, tokenB: pair.tokenB }}
            >
              Create pool
            </Link>
            <Link to="/vault">Desk &amp; funding →</Link>
          </nav>
        </footer>
      </section>
    </main>
  );
}
