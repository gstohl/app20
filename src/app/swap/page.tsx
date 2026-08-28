"use client";
import { useActiveStarknetSession } from "@/app/active-session";
import { useFrontendProvider } from "@/app/components/client/provider/providerContext";
import { networkForProviderIndex, type App20TokenNetwork } from "@/lib/token-registry";
import { resolveSwapRoutePair } from "@/lib/swap-route";
import { Link } from "@tanstack/react-router";
import styles from "./swap.module.css";

export type SwapPageProps = Readonly<{ tokenA?: string; tokenB?: string }>;
export default function SwapPage({ tokenA = "strk", tokenB = "usdc" }: SwapPageProps) {
  const session = useActiveStarknetSession();
  const providerIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);
  const network: App20TokenNetwork | null = session.network ?? networkForProviderIndex(providerIndex);
  const resolution = network ? resolveSwapRoutePair(network, tokenA, tokenB) : { kind: "invalid" as const, message: "Select a supported Starknet network." };
  if (resolution.kind === "invalid" || resolution.kind === "unverified" || resolution.kind === "duplicate") {
    return <main className={styles.page}><section className={styles.notice} role="alert"><strong>NON-EXECUTABLE PAIR REVIEW</strong><h1>Pair unavailable</h1><p>{resolution.message}</p><p>No RFQ, quote, proposal, or transaction was created.</p><Link to="/rfq" hash="new">Open RFQ</Link></section></main>;
  }
  const pair = resolution.pair;
  return <main className={styles.page}><section className={styles.notice}><strong>PAIR HANDOFF · NO EXECUTION</strong><h1>{pair.tokenA.symbol} / {pair.tokenB.symbol}</h1><p>This route reviews registry-bound pair metadata only. It cannot request quotes, reserve inventory, invoke a wallet, or route publicly.</p><div className={styles.noticeActions}><Link to="/rfq" search={(previous) => ({ ...previous, pair: pair.pairId })} hash="new">Open RFQ</Link><Link to="/rfq/markets/$tokenA/$tokenB/proposal" params={{ tokenA: pair.tokenA.key, tokenB: pair.tokenB.key }}>Draft market proposal</Link></div></section></main>;
}
