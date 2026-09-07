import { useWalletMode } from './walletMode';
import { Link, Navigate, useRouterState } from '@tanstack/react-router';
import IndependentMakers from './IndependentMakers';
import styles from './rfq.module.css';

export function RfqNavigation({ maker = false }: { maker?: boolean }) {
  return <nav className={styles.deskSubnav} aria-label="RFQ workspace">
    <Link to="/rfq" activeOptions={{ exact: true }} aria-current={!maker ? 'page' : undefined}>New</Link>
    <Link to="/rfq/maker" aria-current={maker ? 'page' : undefined}>Become a maker</Link>
  </nav>;
}

export default function MainnetTradeWorkspace() {
  const mode = useWalletMode(state => state.mode);
  const setMode = useWalletMode(state => state.setMode);
  const hash = useRouterState({ select: state => state.location.hash });
  if (hash === 'maker') return <Navigate to="/rfq/maker" replace />;
  return <main className={styles.page} aria-label="Private trading">
    <h1 className={styles.workspaceTitle}>Private RFQ</h1>
    <RfqNavigation />
    <section className={styles.privateWorkspace}>
      <aside className={styles.tradeTicket} aria-label="Private RFQ ticket">
        {mode === "privy" ? <section><h2>Choose your trading wallet</h2><p>This RFQ screen uses Ready. Your Privy account and its funds are separate.</p><button onClick={() => setMode("ready")}>Use Ready for this trade</button></section> : <IndependentMakers />}
      </aside>
    </section>
    <nav className={styles.separateOperations} aria-label="Trading tools">
      <span>Elsewhere</span><Link to="/funding">Shield / unshield funding</Link><Link to="/chat">Chat</Link><Link to="/agents">For agents</Link><Link to="/recovery/privy">Privy wallet</Link>
    </nav>
  </main>;
}
