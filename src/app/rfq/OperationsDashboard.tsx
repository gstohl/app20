"use client";

import { Link } from "@tanstack/react-router";
import MakerCohortPanel from "./MakerCohortPanel";
import { useRfqOperations } from "./use-rfq-operations";
import {
  LOCALNET_APP20_FEE_POLICY_ID,
  LOCALNET_ECONOMIC_POLICY_ID,
  LOCALNET_MAX_MAKER_SPREAD_BPS,
  LOCALNET_MAX_TOTAL_DEVIATION_BPS,
} from "./rfq-operations";
import styles from "./rfq.module.css";

export default function OperationsDashboard() {
  const availability = useRfqOperations();
  const status = availability.status;
  return <main className={styles.page}>
    <nav className={styles.deskSubnav} aria-label="RFQ operations navigation">
      <Link to="/rfq">RFQ workspace</Link>
      <Link to="/rfq/operations" aria-current="page">Operations</Link>
    </nav>
    <section className={styles.operationsDashboard} aria-labelledby="operations-title">
      <header>
        <strong>LOCALNET DEMO · BROWSER-SAFE STATUS</strong>
        <h1 id="operations-title">RFQ operations</h1>
        <p>This dashboard reads only <code>/rfq/operations/status</code>. It does not expose or request raw health, process IDs, settlement accounts, logs, secrets, or maker inventory.</p>
      </header>
      <section aria-label="Incident gate">
        <h2>Incident gate</h2>
        <dl>
          <div><dt>Effective mode</dt><dd><strong>{availability.mode}</strong></dd></div>
          <div><dt>Reason</dt><dd>{availability.reason}</dd></div>
          <div><dt>New requests / funding / fills</dt><dd>{availability.mode === "running" ? "Allowed under fresh local fixture status" : "Blocked fail closed"}</dd></div>
          <div><dt>Claims / refunds</dt><dd>Enabled in running, paused, drain-only, stale, and unknown status</dd></div>
          <div><dt>Observed</dt><dd>{status ? new Date(status.observedAt * 1_000).toISOString() : "Unavailable"}</dd></div>
          <div><dt>Valid until</dt><dd>{status ? new Date(status.validUntil * 1_000).toISOString() : "Unavailable"}</dd></div>
        </dl>
      </section>
      <section aria-label="Economic policy">
        <h2>Named localnet fixture economics</h2>
        <dl>
          <div><dt>Policy</dt><dd><code>{LOCALNET_ECONOMIC_POLICY_ID}</code></dd></div>
          <div><dt>Instant floor</dt><dd>Fixed 2 USDC / STRK reference less at most {LOCALNET_MAX_TOTAL_DEVIATION_BPS} bps; never minBuy=1</dd></div>
          <div><dt>Maker spread cap</dt><dd>{LOCALNET_MAX_MAKER_SPREAD_BPS} bps</dd></div>
          <div><dt>APP20 fee policy</dt><dd><code>{LOCALNET_APP20_FEE_POLICY_ID}</code> · zero</dd></div>
          <div><dt>Fill policy</dt><dd>Full fill only</dd></div>
        </dl>
      </section>
      {status ? <>
        <section aria-label="Directory checkpoint">
          <h2>Directory checkpoint</h2>
          <p>Epoch {status.directory.epoch} · {status.directory.checkpoint} · valid until {new Date(status.directory.validUntil * 1_000).toISOString()}</p>
        </section>
        <MakerCohortPanel
          makers={status.makers}
          directory={status.directory}
          governedMakerCount={status.cohort.governed}
          now={availability.asOf}
        />
      </> : <p role="alert">Browser-safe operations status is unknown. New requests and funding are blocked; claim and refund recovery remain available.</p>}
    </section>
  </main>;
}
