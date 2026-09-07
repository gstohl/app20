import { lazy, Suspense } from 'react';
import { Link } from '@tanstack/react-router';
import { RfqNavigation } from './MainnetTradeWorkspace';
import styles from './confidential-rfq.module.css';

const LocalLab = import.meta.env.DEV && import.meta.env.VITE_CONFIDENTIAL_RFQ_LAB
  ? lazy(() => import('@/dev/confidential/ConfidentialLab')) : undefined;

export default function ConfidentialRfqPage() {
  return <main className={styles.page} aria-label="Confidential RFQ">
    <div className={styles.eyebrow}>ENCRYPTED TERMS · JOINT APPROVAL</div>
    <h1>Confidential RFQ</h1>
    <RfqNavigation confidential />
    {LocalLab ? <Suspense fallback={<p>Opening the local workspace…</p>}><LocalLab /></Suspense> : <>
      <section className={styles.intro}>
        <span className={styles.badge}>Development release</span>
        <h2>Agree privately. Exchange together.</h2>
        <p>Both sides approve the same terms and fund a dedicated shielded escrow. A single settlement delivers both assets as encrypted notes. If the trade expires, each side can recover its original asset independently.</p>
        <div className={styles.steps}><article><span>01</span><h3>Agree</h3><p>Exact amounts and destinations, approved by both sides.</p></article><article><span>02</span><h3>Fund</h3><p>Separate private transfers into the shared escrow.</p></article><article><span>03</span><h3>Exchange</h3><p>Both assets settle together. Timeout refunds stay available.</p></article></div>
        <p><strong>Mainnet and browser-wallet activation are pending.</strong> The Node SDK and local workspace implement this flow; real STARK proofs, wallet support and independent review are still required.</p>
        <p><Link to="/agents">Node SDK and development guide →</Link></p>
      </section>
      <section className={styles.disclosure}><h2>What remains visible</h2><p>Escrow activity, timing and fees remain public. Shielding and unshielding expose their public token amounts. Counterparties know their own trade, and a hosted prover can access its private payload.</p><p>The current <Link to="/rfq">mainnet RFQ</Link> uses the earlier settlement path, whose funded trade amounts and assets are public.</p></section>
    </>}
  </main>;
}
