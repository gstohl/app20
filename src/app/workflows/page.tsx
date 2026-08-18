import { enforcementDisclosure } from "@app20/policy-client";

export default function WorkflowsPage() {
  return (
    <main className="desk-page">
      <header className="desk-intro">
        <div>
          <p>APP20 / VERIFIABLE WORKFLOWS</p>
          <h1>Confidential inputs. Explicit evidence.</h1>
          <span>
            The workflow boundary is vendor-neutral. APP20 has not selected a
            production TEE, provisioned a signing key, or enabled a value-moving
            workflow.
          </span>
        </div>
        <strong className="review-only-stamp">
          REVIEW ONLY · NO ENGINE · CANNOT RUN
        </strong>
      </header>

      <p className="desk-boundary-summary" id="workflow-unavailable-reason">
        <b>LOCAL REVIEW:</b> this build cannot send inputs, attest an engine,
        sign, or submit a workflow. No workflow input leaves this browser.
      </p>

      <div className="desk-grid workflow-grid">
        <section
          className="panel-frame desk-primary"
          aria-labelledby="workflow-policy-title"
        >
          <div className="panel-heading">
            <span>POLICY CONTRACT</span>
            <strong id="workflow-policy-title">Two-phase authorization</strong>
          </div>
          <div className="workflow-phases">
            <article>
              <small>PHASE 01 / PREFLIGHT</small>
              <h2>Review the logical intent</h2>
              <p>
                Account, chain, asset, recipient, amount bounds, fee ceiling,
                expiry, refund target, and disclosure recipients are evaluated
                before quote or build side effects.
              </p>
            </article>
            <article>
              <small>PHASE 02 / FINAL</small>
              <h2>Bind exact execution bytes</h2>
              <p>
                Signed receipt bytes bind workflow id and epoch; intent,
                execution, quote, and constraint digests; attestation vendor,
                challenge, evidence, measurement, and key; nonce, counter, and
                validity. An atomic replay guard rejects reuse and rollback.
              </p>
            </article>
          </div>
          <div className="enforcement-level">
            <span>SHIPPED ENFORCEMENT LEVEL</span>
            <strong>ADVISORY INTERFACE ONLY</strong>
            <p>{enforcementDisclosure("advisory")}</p>
          </div>
          <p
            className="desk-unavailable-action"
            role="status"
            aria-describedby="workflow-unavailable-reason"
          >
            Execution unavailable in this review build
          </p>
        </section>

        <aside
          className="panel-frame desk-disclosure"
          aria-labelledby="attestation-title"
        >
          <div className="panel-heading">
            <span>EVIDENCE DOSSIER</span>
            <strong id="attestation-title">Attestation not present</strong>
          </div>
          <dl>
            <div>
              <dt>Vendor root</dt>
              <dd>Not configured</dd>
            </div>
            <div>
              <dt>Measurement</dt>
              <dd>Not configured</dd>
            </div>
            <div>
              <dt>Debug mode</dt>
              <dd>Must be disabled</dd>
            </div>
            <div>
              <dt>Revocation state</dt>
              <dd>Must be current</dd>
            </div>
            <div>
              <dt>Ephemeral key</dt>
              <dd>Must bind the user challenge</dd>
            </div>
            <div>
              <dt>Policy receipt</dt>
              <dd>Must bind exact execution</dd>
            </div>
          </dl>
          <p>
            Inputs marked <b>SENT TO ENCLAVE</b> become visible to that approved
            program. This build does not transmit pool keys, notes, witnesses,
            mailbox keys, reusable wallet credentials, or workflow inputs.
          </p>
        </aside>
      </div>

      <ul className="evidence-labels" aria-label="Workflow disclosure legend">
        <li>
          <b>LOCAL ONLY</b>
          <small>Never leaves this device</small>
        </li>
        <li>
          <b>SENT TO ENCLAVE</b>
          <small>Plaintext to measured code</small>
        </li>
        <li>
          <b>ATTESTATION REQUIRED</b>
          <small>Fresh evidence must verify</small>
        </li>
        <li>
          <b>PUBLIC ON-CHAIN</b>
          <small>Visible after submission</small>
        </li>
      </ul>
    </main>
  );
}
