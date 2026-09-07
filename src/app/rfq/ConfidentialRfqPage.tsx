import { lazy, Suspense, useState } from "react";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { CONFIDENTIAL_RFQ_STATUS } from "@/lib/confidential-rfq-status";
import desk from "./rfq.module.css";
import styles from "./confidential-rfq.module.css";

const LocalLab = import.meta.env.DEV && import.meta.env.VITE_CONFIDENTIAL_RFQ_LAB
  ? lazy(() => import("@/dev/confidential/ConfidentialLab")) : undefined;

export default function ConfidentialRfqPage() {
  const connected = useStoreWallet(state => state.isConnected);
  const [reverse, setReverse] = useState(false);
  const [sell, setSell] = useState("");
  const [minimum, setMinimum] = useState("");
  const sellSymbol = reverse ? "USDC" : "STRK";
  const buySymbol = reverse ? "STRK" : "USDC";
  const available = CONFIDENTIAL_RFQ_STATUS.mainnetEnabled && CONFIDENTIAL_RFQ_STATUS.browserWalletSupported;
  const availability = !available
    ? "Confidential swaps are not available on this network yet."
    : connected
      ? "Your wallet must support confidential quotes to continue."
      : "Connect your wallet to request quotes.";

  return <main className={`${desk.page} ${styles.ticketPage}`} aria-label="Confidential RFQ">
    <h1 className={desk.workspaceTitle}>Confidential RFQ</h1>
    {LocalLab ? <div className={styles.labWorkspace}><Suspense fallback={<p>Opening your workspace…</p>}><LocalLab /></Suspense></div> :
      <section className={`${desk.privateIntentDesk} ${styles.ticket}`} aria-label="Confidential swap">
        <header className={desk.privateIntentHeader}>
          <h2 className={styles.ticketTitle}>Instant RFQ</h2>
          <div className={desk.ticketPromise}><span>Confidential swap</span></div>
        </header>
        <form className={desk.privateIntentForm} onSubmit={event => event.preventDefault()}>
          <div className={desk.swapAssetStack}>
            <label className={desk.swapAssetCard}>
              <span className={desk.swapAssetHead}><b>You sell</b><small>Shielded balance</small></span>
              <span className={desk.swapAssetControl}>
                <input aria-label={`You sell (${sellSymbol})`} inputMode="decimal" placeholder="0.00" value={sell} onChange={event => setSell(event.target.value)} autoComplete="off" />
                <strong>{sellSymbol}</strong>
              </span>
            </label>
            <button className={desk.swapDirection} type="button" aria-label="Reverse swap direction" title="Reverse swap direction" onClick={() => { setReverse(value => !value); setSell(""); setMinimum(""); }}>⇅</button>
            <label className={desk.swapAssetCard}>
              <span className={desk.swapAssetHead}><b>Minimum receive</b><small>Set by you</small></span>
              <span className={desk.swapAssetControl}>
                <input aria-label={`Minimum you receive (${buySymbol})`} inputMode="decimal" placeholder="0.00" value={minimum} onChange={event => setMinimum(event.target.value)} autoComplete="off" />
                <strong>{buySymbol}</strong>
              </span>
            </label>
          </div>
          <label className={styles.makerField}>
            Quote from
            <select aria-label="Quote from" disabled><option>Best available makers</option></select>
          </label>
          <button className={desk.privateIntentQuoteButton} type="submit" disabled aria-describedby="rfq-availability">Request quotes</button>
          <p id="rfq-availability" className={styles.availability} role="status">{availability}</p>
        </form>
        <section className={styles.swapRecords} aria-label="Swap records">
          <h3>Swap records</h3>
          <p>{connected ? "Your swaps will appear here." : "Connect your wallet to see your swaps."}</p>
        </section>
        <details className={styles.privacyDetails}>
          <summary>Privacy &amp; fees</summary>
          <p>Quotes stay between counterparties. Both sides approve the same terms; both assets settle together as encrypted notes.</p>
          <p>Activity, timing and network fees remain public. Shielding and unshielding reveal their token amounts. A hosted proving service can access the private data it proves.</p>
          <p>You review the final amounts and fees before approving a swap.</p>
        </details>
      </section>}
  </main>;
}
