import { CROSS_CHAIN_STAGES } from "@app20/domain";
import { ONE_CLICK_HAS_TESTNET } from "@app20/near-intents";

const REVIEW_STAGES = CROSS_CHAIN_STAGES.filter((stage) =>
  [
    "DRAFT",
    "QUOTING",
    "AWAITING_REVIEW",
    "PREFLIGHT_POLICY",
    "AWAITING_SIGNATURE",
    "SOURCE_FINALIZED",
    "SETTLEMENT_PENDING",
    "DESTINATION_CONFIRMING",
    "COMPLETED",
    "REFUND_PENDING",
    "REFUNDED",
  ].includes(stage),
);

export default function IntentsPage() {
  return (
    <main className="desk-page">
      <header className="desk-intro">
        <div>
          <p>APP20 / CROSS-CHAIN INTENTS</p>
          <h1>Set the bounds. Let execution compete.</h1>
          <span>
            APP20 is integrating NEAR Intents behind a dry-only connector. No
            deposit address is created, no wallet signature is requested, and no
            cross-chain value can move from this build.
          </span>
        </div>
        <strong className="review-only-stamp">
          REVIEW ONLY · CANNOT SUBMIT
        </strong>
      </header>

      <p className="desk-boundary-summary">
        <b>DRY REVIEW:</b> a future provider and solver may learn route, amount,
        destination, refund, and timing data. This build sends none of it.
      </p>

      <div className="desk-grid">
        <section
          className="panel-frame desk-primary"
          aria-labelledby="intent-status-title"
        >
          <div className="panel-heading">
            <span>INTEGRATION STATUS</span>
            <strong id="intent-status-title">Dry quote boundary</strong>
          </div>
          <div className="integration-checks">
            <article>
              <b>01</b>
              <div>
                <strong>Canonical APP20 intent</strong>
                <p>
                  Source, destination, and refund accounts, assets, integer
                  amounts, slippage, fee ceiling, deadline, provider modes, and
                  disclosure set map from one domain-separated intent.
                </p>
              </div>
              <span className="fact-token is-checked">
                SCHEMA BINDING CHECKED
              </span>
            </article>
            <article>
              <b>02</b>
              <div>
                <strong>NEAR 1Click dry mode</strong>
                <p>
                  Policy preflight completes before transport. The connector
                  permits only <code>dry: true</code> quotes from the immutable
                  reviewed request and accepts only pinned response fields.
                  Funding fields and every unknown field fail closed before
                  signature verification.
                </p>
              </div>
              <span className="fact-token is-checked">DRY SCHEMA CHECKED</span>
            </article>
            <article>
              <b>03</b>
              <div>
                <strong>Provider verification</strong>
                <p>
                  A quote-signature verifier must return algorithm, key-id, and
                  signed-payload-digest provenance. No live verifier or
                  credentialed transport is configured in the application yet.
                </p>
              </div>
              <span className="fact-token">NOT CONFIGURED</span>
            </article>
            <article>
              <b>04</b>
              <div>
                <strong>Funding and settlement</strong>
                <p>
                  Live deposits, signed intents, status polling, refunds, and
                  destination finality remain disabled pending Mainnet-only
                  adversarial validation.
                </p>
              </div>
              <span className="fact-token">BLOCKED</span>
            </article>
          </div>
          <button type="button" className="desk-disabled-action" disabled>
            Create live intent — unavailable
          </button>
        </section>

        <aside
          className="panel-frame desk-disclosure"
          aria-labelledby="intent-disclosure-title"
        >
          <div className="panel-heading">
            <span>DISCLOSURE</span>
            <strong id="intent-disclosure-title">
              Cross-chain is a public boundary
            </strong>
          </div>
          <dl>
            <div>
              <dt>Intents testnet</dt>
              <dd>{ONE_CLICK_HAS_TESTNET ? "Available" : "None"}</dd>
            </div>
            <div>
              <dt>Current mode</dt>
              <dd>Dry quotes only</dd>
            </div>
            <div>
              <dt>Custody window</dt>
              <dd>Trusted swapping agent in live 1Click</dd>
            </div>
            <div>
              <dt>Solver learns</dt>
              <dd>Route terms needed for execution</dd>
            </div>
            <div>
              <dt>Public</dt>
              <dd>Deposits, destination settlement, amount and timing</dd>
            </div>
          </dl>
          <p>
            Amount and timing can reconnect source and destination activity.
            Confidential Intents does not make destination settlement private.
          </p>
        </aside>
      </div>

      <ol className="lifecycle-strip" aria-label="Cross-chain lifecycle model">
        {REVIEW_STAGES.map((stage, index) => (
          <li key={stage}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            {stage.replaceAll("_", " ")}
          </li>
        ))}
      </ol>
    </main>
  );
}
