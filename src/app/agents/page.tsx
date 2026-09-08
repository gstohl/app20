import { Link } from '@tanstack/react-router';
import styles from './agents.module.css';

export default function AgentsPage() {
  return <main className={styles.page}>
    <header>
      <p className={styles.eyebrow}>APP20 / AGENTS</p>
      <h1>Private payments and confidential swaps</h1>
      <p>Build with your own account and signing policy. Both sides approve the same swap, and both assets settle together as encrypted notes.</p>
    </header>
    <nav aria-label="Agent resources">
      <Link to="/rfq">Confidential RFQ</Link>
      <a href="/agents.md">Plain-text agent guide</a>
      <a href="/.well-known/app20.json">Deployment manifest</a>
    </nav>
    <section>
      <h2>Node.js library</h2>
      <p>Use <code>@app20/agent-sdk/confidential</code> to prepare an agreement, collect separate approvals, inspect encrypted funding and recover an incomplete swap after its deadline. Each party keeps its own signing key.</p>
      <p><a href="/downloads/app20-agent-sdk-0.1.0.tgz" download>Download npm package</a> · <a href="/downloads/app20-agent-sdk-0.1.0.sha256">SHA-256</a> · <a href="/agent-sdk.md">API guide and examples</a></p>
      <pre>{`npm install https://app20.io/downloads/app20-agent-sdk-0.1.0.tgz

import { confidentialCapabilities } from '@app20/agent-sdk/confidential';

// Check support before asking a wallet to sign.
console.log(confidentialCapabilities.mainnetEnabled);`}</pre>
      <p>Requires Node 24+ and includes TypeScript definitions. The package is distributed as an npm-installable archive; it is not yet published to the npm registry.</p>
    </section>
    <section>
      <h2>Try the swap flow</h2>
      <p>Run <code>npm run dev:confidential</code> in the source checkout and open <code>http://127.0.0.1:5198/rfq</code>. Create an agreement, fund each side and approve the exchange. You can also let an incomplete swap expire and refund the funded side independently.</p>
      <p>This local workspace controls two disposable wallets and simulates proving. <strong>A separate real-proof settlement is verified on mainnet:</strong> both agreed encrypted outputs arrived, and the escrow became empty and settled. One operator controlled both wallets and funded both legs.</p>
      <p>The browser integration includes Ready signing and encrypted quote rooms. Native Ready end-to-end acceptance, mainnet refunds and independent review remain unverified. <a href="/evidence/confidential-settlement-2026-09-08.json">Read the settlement evidence</a>.</p>
      <p><Link to="/rfq">Open RFQ →</Link> · <a href="/agent-sdk.md">Read the integration guide</a></p>
    </section>
    <section>
      <h2>Run a confidential maker</h2>
      <p>Use the source checkout with your own protected adapter, explicit prices, inventory limits and fee budget. The maker verifies the escrow and mature encrypted taker funding before funding its side.</p>
      <pre>{`node scripts/confidential-maker.mjs --run --adapter /absolute/protected/adapter.mjs`}</pre>
      <p>Keep wallet keys and journals outside the repository and retain them across restarts. <a href="/agents.md">Adapter configuration and recovery instructions</a>. The older downloadable maker tool supports historical recovery only.</p>
    </section>
    <section>
      <h2>Chat and payments</h2>
      <p>In the repository’s <code>npm run dev:localnet</code> environment, open <Link to="/chat">Chat</Link> to send an encrypted message or payment between the Alice and Bob development wallets. Payments and same-token invoices spend existing encrypted notes and include an unfunded encrypted message.</p>
      <p>A real-proof Chat message is verified on mainnet through the operator Node harness, including decryption, replay protection and an unchanged private balance. Ready extension and mainnet recipient-payment acceptance remain unverified. Fixed offers and invoices requiring conversion remain unavailable until confidential atomic wallet integration is ready. There is no <code>sendChat</code> SDK API yet.</p>
    </section>
    <section>
      <h2>Privacy and signing</h2>
      <p>Keep ordinary wallet viewing keys private. A swap uses new viewing material limited to that escrow, and both parties approve the exact terms and destinations.</p>
      <p>Escrow activity, deployment wallet links, timing, network fees and ciphertext/proof sizes remain visible. Shielding and unshielding expose their own assets and amounts. Counterparties know their agreement, and a hosted prover can access the private data it proves.</p>
      <p>Check current network support in the <a href="/.well-known/app20.json">deployment manifest</a> before signing. Unavailable confidential operations stop without submitting a public trade.</p>
    </section>
  </main>;
}
